/**
 * Las etapas del circuito, como se ven: nombre, color, orden y qué significan.
 *
 * ## Qué es una etapa acá
 *
 * **Un hecho, no un estado que alguien movió.** El backend la calcula al mirar,
 * a partir de si el contacto tiene cuenta, si depositó y cuándo jugó por última
 * vez (ver `cteDeEtapas` en `chat-crm.service.ts`). Nadie arrastra a nadie de
 * una columna a otra, y por eso nunca queda desactualizado.
 *
 * ## Son excluyentes: cada persona está en una sola
 *
 * Se evalúan en orden y gana la primera que da: el que está jugando aparece en
 * **Jugando** aunque también haya depositado. Por eso los números de esta
 * pantalla **suman el total de contactos** — son una distribución, no un
 * embudo acumulado.
 *
 * ## La que no está
 *
 * El diseño pedía seis, con **"Alta pedida"** entre Lead y Cuenta creada. No
 * existe: nada en el sistema registra que alguien pidió el alta y todavía no la
 * tiene. Dibujarla siempre en cero sería peor que no tenerla.
 */

export type EtapaDelCircuito =
  | 'lead'
  | 'cuenta'
  | 'deposito'
  | 'jugando'
  | 'reactivacion';

export interface EtapaVisible {
  clave: EtapaDelCircuito;
  label: string;
  /** Qué la define, en una línea. Se muestra debajo del número. */
  criterio: string;
  /** Qué conviene hacer con esta gente. El motivo de que la pantalla exista. */
  accion: string;
  color: string;
}

/** En el orden del recorrido. `reactivacion` va última: es la caída. */
export const ETAPAS: EtapaVisible[] = [
  {
    clave: 'lead',
    label: 'Lead',
    criterio: 'Escribió, todavía no tiene cuenta',
    accion: 'Darle el alta desde su ficha',
    color: 'var(--color-fg-muted)',
  },
  {
    clave: 'cuenta',
    label: 'Cuenta creada',
    criterio: 'Tiene cuenta, nunca depositó',
    accion: 'Pasarle el alias y acompañar el primer depósito',
    color: 'var(--color-info, #8fb6ff)',
  },
  {
    clave: 'deposito',
    label: 'Depositó',
    criterio: 'Depósito aprobado, todavía no jugó',
    accion: 'Tiene fichas sin usar: recomendarle por dónde empezar',
    color: 'var(--color-accent-text, var(--color-accent))',
  },
  {
    clave: 'jugando',
    label: 'Jugando',
    criterio: 'Abrió un juego en los últimos 14 días',
    accion: 'Nada. Éstos andan solos',
    color: 'var(--color-success)',
  },
  {
    clave: 'reactivacion',
    label: 'Reactivación',
    criterio: 'Jugó alguna vez, hace más de 14 días que no',
    accion: 'El mensaje que más rinde: preguntarle si está todo bien',
    color: 'var(--color-warning)',
  },
];

export function etapaVisible(clave: string): EtapaVisible {
  return (
    ETAPAS.find((e) => e.clave === clave) ?? {
      clave: 'lead',
      label: clave,
      criterio: '',
      accion: '',
      color: 'var(--color-fg-subtle)',
    }
  );
}
