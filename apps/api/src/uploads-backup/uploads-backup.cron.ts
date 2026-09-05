/**
 * UploadsBackupCron — copia los archivos subidos a un bucket de backup.
 *
 * **Por qué existe.** Hasta el 2026-09-04 se respaldaban las bases de datos y
 * nada más. Los archivos que los jugadores y cajeros suben —comprobantes de
 * depósito y de transferencias bancarias— no tenían ninguna copia. Y esos
 * archivos **son la prueba documental de movimientos de plata**: si se pierden,
 * una disputa se resuelve contra el registro contable sin nada que lo respalde.
 *
 * **De qué protege y de qué no.** R2 es almacenamiento durable: no está pensado
 * para el caso "se rompió el disco". Protege del caso realista, que es un
 * **borrado accidental** —un bug en el path de borrado, alguien limpiando un
 * tenant— y deja una copia con fecha para poder volver atrás.
 *
 * ⚠️ **No protege de que la cuenta entera se comprometa**: origen y destino
 * viven en la misma cuenta de Cloudflare. Para eso haría falta un proveedor
 * distinto, y hoy no está.
 *
 * **Es incremental.** Compara por `ETag`: lo que ya está copiado y no cambió no
 * se vuelve a subir. La primera corrida copia todo (~90 MB al escribirse esto);
 * las siguientes, sólo lo nuevo.
 *
 * **Copia sin traer los bytes.** Usa `CopyObject`, que se resuelve dentro de
 * R2: los archivos nunca pasan por el contenedor de la API. Por eso da igual
 * que el bucket crezca.
 *
 * Env:
 *   UPLOADS_BACKUP_ENABLED     'false' lo apaga. Default: prendido.
 *   UPLOADS_BACKUP_CRON        default `30 6 * * *` (media hora después de los
 *                              backups de base, que van 0 6 * * *).
 *   UPLOADS_BACKUP_SOURCE      bucket origen. Default `casino-uploads`.
 *   UPLOADS_BACKUP_DEST        bucket destino. Default `casino-backups`.
 *   UPLOADS_BACKUP_PREFIX      prefijo en el destino. Default `uploads/`.
 *   UPLOADS_BACKUP_ENDPOINT    endpoint S3 de R2.
 *   UPLOADS_BACKUP_KEY_ID      access key.
 *   UPLOADS_BACKUP_SECRET      secret key.
 *
 * ⚠️ **No reusa las `R2_*` de la API.** Esas apuntan a una cuenta que no existe
 * (verificado el 2026-09-04: su endpoint ni siquiera resuelve TLS). No rompen
 * nada porque el driver de storage es `cloudflare-worker` y va por el Worker,
 * pero no se puede construir nada encima de ellas.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import {
  CopyObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { AlertsService } from '../alerts/alerts.service';
import { CronLockService } from '../cron-lock/cron-lock.service';

/** Media hora después de los backups de base, para no pelear por el disco. */
const DEFAULT_CRON = '30 6 * * *';
const DEFAULT_SOURCE = 'casino-uploads';
const DEFAULT_DEST = 'casino-backups';
const DEFAULT_PREFIX = 'uploads/';

interface Resultado {
  copiados: number;
  saltados: number;
  fallados: number;
  bytesCopiados: number;
  totalOrigen: number;
}

@Injectable()
export class UploadsBackupCron {
  private readonly logger = new Logger(UploadsBackupCron.name);
  private readonly habilitado: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly cronLock: CronLockService,
    private readonly alertas: AlertsService,
  ) {
    this.habilitado =
      this.config.get<string>('UPLOADS_BACKUP_ENABLED') !== 'false' &&
      Boolean(this.credenciales());

    if (this.config.get<string>('UPLOADS_BACKUP_ENABLED') === 'false') {
      this.logger.warn(
        'UploadsBackupCron DESHABILITADO via UPLOADS_BACKUP_ENABLED=false.',
      );
      return;
    }
    if (!this.habilitado) {
      // Sin credenciales no se registra el cron, pero se avisa fuerte: el
      // modo de falla peor de un backup es creer que corre y que no corra.
      this.logger.warn(
        'UploadsBackupCron SIN CONFIGURAR: faltan UPLOADS_BACKUP_ENDPOINT / ' +
          '_KEY_ID / _SECRET. Los comprobantes NO se están respaldando.',
      );
      return;
    }
    this.registrar();
  }

  private credenciales(): { endpoint: string; keyId: string; secret: string } | null {
    const endpoint = this.config.get<string>('UPLOADS_BACKUP_ENDPOINT');
    const keyId = this.config.get<string>('UPLOADS_BACKUP_KEY_ID');
    const secret = this.config.get<string>('UPLOADS_BACKUP_SECRET');
    if (!endpoint || !keyId || !secret) return null;
    return { endpoint, keyId, secret };
  }

  private registrar(): void {
    const expr = this.config.get<string>('UPLOADS_BACKUP_CRON') ?? DEFAULT_CRON;
    const job = new CronJob(expr, () => {
      void this.cronLock
        // El lock espera `Promise<void>`: el resultado sólo interesa a quien
        // llame a `correr()` a mano.
        .runExclusive('uploads-backup', async () => {
          await this.correr();
        })
        .catch((err) => {
          this.logger.error(
            `Cron uploads-backup tiró: ${(err as Error).message}`,
          );
        });
    });
    this.scheduler.addCronJob('uploads-backup', job);
    job.start();
    this.logger.log(
      `UploadsBackupCron registrado schedule="${expr}" ` +
        `${this.bucketOrigen()} → ${this.bucketDestino()}/${this.prefijo()}`,
    );
  }

  private bucketOrigen(): string {
    return this.config.get<string>('UPLOADS_BACKUP_SOURCE') ?? DEFAULT_SOURCE;
  }

  private bucketDestino(): string {
    return this.config.get<string>('UPLOADS_BACKUP_DEST') ?? DEFAULT_DEST;
  }

  private prefijo(): string {
    const p = this.config.get<string>('UPLOADS_BACKUP_PREFIX') ?? DEFAULT_PREFIX;
    return p.endsWith('/') ? p : `${p}/`;
  }

  private cliente(): S3Client {
    const c = this.credenciales()!;
    return new S3Client({
      region: 'auto',
      endpoint: c.endpoint,
      // R2 exige path-style: su certificado wildcard no cubre el subdominio de
      // dos niveles `bucket.cuenta.r2.cloudflarestorage.com` y el handshake TLS
      // falla. Ya mordió una vez, en el workflow de backup de agosto.
      forcePathStyle: true,
      credentials: { accessKeyId: c.keyId, secretAccessKey: c.secret },
    });
  }

  /** Corre la copia. Público para poder dispararlo a mano desde un script. */
  async correr(): Promise<Resultado> {
    const s3 = this.cliente();
    const origen = this.bucketOrigen();
    const destino = this.bucketDestino();
    const prefijo = this.prefijo();

    const [enOrigen, enDestino] = await Promise.all([
      this.listar(s3, origen),
      this.listar(s3, destino, prefijo),
    ]);

    // ETag del destino indexado por la key ORIGINAL (sin el prefijo), para
    // poder comparar manzanas con manzanas.
    const yaCopiado = new Map<string, string>();
    for (const o of enDestino) {
      if (!o.Key || !o.ETag) continue;
      yaCopiado.set(o.Key.slice(prefijo.length), o.ETag);
    }

    const res: Resultado = {
      copiados: 0,
      saltados: 0,
      fallados: 0,
      bytesCopiados: 0,
      totalOrigen: enOrigen.length,
    };

    for (const o of enOrigen) {
      if (!o.Key) continue;
      if (yaCopiado.get(o.Key) === o.ETag) {
        res.saltados += 1;
        continue;
      }
      try {
        await s3.send(
          new CopyObjectCommand({
            Bucket: destino,
            Key: `${prefijo}${o.Key}`,
            // El origen va como `/bucket/key`, url-encodeado: hay keys con
            // espacios y acentos (los comprobantes se suben con el nombre que
            // les puso el usuario).
            CopySource: `/${origen}/${encodeURIComponent(o.Key).replace(/%2F/g, '/')}`,
          }),
        );
        res.copiados += 1;
        res.bytesCopiados += o.Size ?? 0;
      } catch (err) {
        res.fallados += 1;
        this.logger.error(
          `no se pudo copiar "${o.Key}": ${(err as Error).message}`,
        );
      }
    }

    const mb = (res.bytesCopiados / 1048576).toFixed(1);
    this.logger.log(
      `uploads-backup: ${res.copiados} copiados (${mb} MB), ` +
        `${res.saltados} sin cambios, ${res.fallados} fallados, ` +
        `${res.totalOrigen} en origen.`,
    );

    if (res.fallados > 0) {
      await this.alertas.enviar({
        clave: 'uploads-backup-fallado',
        nivel: 'aviso',
        titulo: 'Fallaron archivos en el backup de comprobantes',
        detalle: [
          `${res.fallados} de ${res.totalOrigen} archivos no se pudieron copiar.`,
          '',
          'Los comprobantes son la prueba documental de los movimientos de plata.',
          'Ver los logs de la API para saber cuáles.',
        ].join('\n'),
      });
    }

    return res;
  }

  /** Lista un bucket entero, paginando. */
  private async listar(
    s3: S3Client,
    Bucket: string,
    Prefix?: string,
  ): Promise<_Object[]> {
    const out: _Object[] = [];
    let token: string | undefined;
    do {
      const r = await s3.send(
        new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }),
      );
      out.push(...(r.Contents ?? []));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
}
