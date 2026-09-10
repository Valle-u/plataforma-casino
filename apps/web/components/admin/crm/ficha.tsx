/**
 * La ficha del contacto — la cuarta columna de la bandeja.
 *
 * ## Esto no es decoración
 *
 * Tres cosas de la **etapa 1** tenían backend, tests y ningún botón: cerrar
 * una conversación (**1.4**), avisarle al operador del jugador (**1.5**) y dar
 * de alta un jugador desde el chat (**1.6**). El roadmap las daba por hechas
 * porque la API estaba; del lado del operador no existían.
 *
 * Esta pantalla es donde recién pasan a existir.
 *
 * ## El bloque de otra red no esconde nada
 *
 * Cuando el jugador es de una red independiente distinta, el backend **no
 * manda la plata** (**R6**): saldo, movimientos y upline vienen vacíos, no
 * porque no tenga, sino porque no corresponde. Acá se dice con un bloque
 * explícito en vez de mostrar la sección vacía — una billetera en cero y una
 * billetera que no se puede ver son cosas muy distintas.
 *
 * ## Lo que todavía no está
 *
 * **Circuito, tiempos del tramo e historial** los pide el diseño y no existen:
 * `crm_timeline_events` está creada y vacía, y medir por tramos es un modelo
 * que hay que definir antes de dibujarlo (**4.3** y **4.4** del roadmap).
 *
 * **La caja** —cargar, retirar, bono, corrección— quedó **diferida** el
 * 2026-09-09, no descartada. Ver el bloque 7 de `docs/crm/14-decisiones.md`.
 * El hueco se muestra marcado: una sección que falta a propósito no se parece
 * a una que se olvidaron.
 *
 * **Tomar la conversación** necesita que varios agentes compartan una bandeja
 * (**4.6**), que no está construido. Hoy una conversación es de una bandeja,
 * no de una persona.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CircleCheck,
  Copy,
  Link2,
  Loader2,
  Lock,
  ShieldAlert,
  Timer,
  Unlink,
  UserPlus,
} from 'lucide-react';
import type { ContactContext, InboxItem } from '@/lib/chat/types';
import {
  avisarAlOperador,
  cambiarEstadoDeConversacion,
  desvincularContacto,
  getContactContext,
} from '@/lib/chat/crm-api';
import { nombreDelContacto } from '@/lib/chat/use-bandeja';
import { currencyLabel } from '@/lib/format-currency';
import { cn } from '@/lib/cn';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { AltaDeJugador } from './alta-de-jugador';
import { VincularJugador } from './vincular-jugador';

export function Ficha({
  item,
  onEstadoCambiado,
}: {
  item: InboxItem;
  /** Para que la lista refleje el cambio sin recargar. */
  onEstadoCambiado: (status: string) => void;
}): React.ReactElement {
  const contactId = item.contact.id;
  const { user } = useAuth();
  const [ctx, setCtx] = useState<ContactContext | null>(null);
  const [cargando, setCargando] = useState(true);
  const [altaAbierta, setAltaAbierta] = useState(false);

  /** Recargar el contexto: despues del alta, el lead paso a ser jugador. */
  const recargar = useCallback(() => {
    getContactContext(contactId).then(setCtx).catch(() => undefined);
  }, [contactId]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setCtx(null);
    getContactContext(contactId)
      .then((c) => vivo && setCtx(c))
      .catch(() => vivo && setCtx(null))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [contactId]);

  const nombre = nombreDelContacto(item);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <Identidad nombre={nombre} ctx={ctx} />

      <AccionesDeLaConversacion
        conversationId={item.conversation.id}
        contactId={contactId}
        estado={item.conversation.status}
        onEstadoCambiado={onEstadoCambiado}
      />

      {cargando ? (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="animate-spin text-[var(--color-fg-subtle)]" />
        </div>
      ) : (
        <>
          <Dinero
            ctx={ctx}
            onCrearJugador={
              // El alta usa el mismo permiso que el alta del panel. Sin el, el
              // boton no aparece: ofrecer algo que el backend va a rechazar es
              // peor que no ofrecerlo.
              hasPermission(user, 'users.create') ? () => setAltaAbierta(true) : null
            }
          />
          <Vinculo
            // Sin esto, el "¿seguro?" de deshacer sobrevive al cambio de
            // contacto: el operador abriría otra ficha con la confirmación ya
            // armada y un clic de más borraría un vínculo que no miró.
            key={contactId}
            contactId={contactId}
            ctx={ctx}
            nombreSugerido={nombre}
            telefono={ctx?.contact.phone ?? item.contact.phone}
            onCambio={recargar}
          />
          <CajaDiferida />
          <MedicionPendiente />
          <Identificadores
            contactId={contactId}
            conversationId={item.conversation.id}
            telefono={ctx?.contact.phone ?? item.contact.phone}
          />
        </>
      )}

      {altaAbierta && (
        <AltaDeJugador
          contactId={contactId}
          nombreSugerido={nombre}
          telefono={ctx?.contact.phone ?? item.contact.phone}
          onCerrar={() => setAltaAbierta(false)}
          // El contacto dejó de ser lead: la ficha tiene que reflejarlo sin que
          // el operador tenga que cambiar de conversación y volver.
          onCreado={recargar}
        />
      )}
    </div>
  );
}

/** Quién es, y desde cuándo. */
function Identidad({
  nombre,
  ctx,
}: {
  nombre: string;
  ctx: ContactContext | null;
}): React.ReactElement {
  const desde = ctx?.identity?.createdAt;
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-subtle)] text-[14px] font-semibold text-[var(--color-fg)]"
      >
        {nombre.charAt(0).toUpperCase()}
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[15px] font-bold text-[var(--color-fg)]">
          {nombre}
        </span>
        <span className="text-[11.5px] text-[var(--color-fg-subtle)]">
          {desde
            ? `Contacto desde ${new Date(desde).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
            : ctx?.contact.isLead
              ? 'Lead — todavía sin cuenta'
              : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * Resolver y avisar (**1.4** y **1.5**).
 *
 * "Avisar" no transfiere nada: a la otra bandeja le llega quién escribió y
 * cuándo, **nunca el contenido**. Se dice en el botón mismo porque es la
 * confusión más fácil de tener — en cualquier otra herramienta, derivar mueve
 * la conversación.
 */
function AccionesDeLaConversacion({
  conversationId,
  contactId,
  estado,
  onEstadoCambiado,
}: {
  conversationId: string;
  contactId: string;
  estado: string;
  onEstadoCambiado: (status: string) => void;
}): React.ReactElement {
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cambiar = useCallback(
    async (status: 'open' | 'pending' | 'resolved') => {
      setTrabajando(status);
      setError(null);
      try {
        const r = await cambiarEstadoDeConversacion(conversationId, status);
        onEstadoCambiado(r.status);
      } catch (err) {
        setError(mensaje(err));
      } finally {
        setTrabajando(null);
      }
    },
    [conversationId, onEstadoCambiado],
  );

  const avisar = useCallback(async () => {
    setTrabajando('avisar');
    setError(null);
    setAviso(null);
    try {
      await avisarAlOperador(contactId);
      setAviso('Le avisamos a su operador. La conversación se queda acá.');
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setTrabajando(null);
    }
  }, [contactId]);

  const resuelta = estado === 'resolved';

  return (
    <Seccion titulo="La conversación">
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => void cambiar(resuelta ? 'open' : 'resolved')}
          disabled={trabajando !== null}
          className="flex h-[36px] items-center justify-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] text-[12.5px] font-semibold text-[var(--color-accent-fg)] transition-opacity disabled:opacity-50"
        >
          {trabajando === 'resolved' || trabajando === 'open' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <CircleCheck size={13} />
          )}
          {resuelta ? 'Reabrir' : 'Resolver'}
        </button>

        {!resuelta && (
          <button
            type="button"
            onClick={() => void cambiar(estado === 'pending' ? 'open' : 'pending')}
            disabled={trabajando !== null}
            className="flex h-[34px] items-center justify-center gap-1.5 rounded-[10px] border border-[var(--color-border)] text-[12.5px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] disabled:opacity-50"
          >
            <Timer size={13} />
            {estado === 'pending' ? 'Sacar de espera' : 'Marcar en espera'}
          </button>
        )}

        <button
          type="button"
          onClick={() => void avisar()}
          disabled={trabajando !== null}
          className="flex h-[34px] items-center justify-center gap-1.5 rounded-[10px] border border-[var(--color-border)] text-[12.5px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] disabled:opacity-50"
        >
          {trabajando === 'avisar' ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <UserPlus size={13} />
          )}
          Avisarle a su operador
        </button>

        <p className="text-[11px] leading-snug text-[var(--color-fg-subtle)]">
          Avisar <b>no manda la conversación</b>: al otro le llega quién escribió
          y cuándo, nada de lo que dijeron.
        </p>

        {aviso && (
          <p className="rounded-[9px] bg-[var(--color-bg-subtle)] px-2 py-1.5 text-[11.5px] text-[var(--color-fg-muted)]">
            {aviso}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[11.5px] text-[var(--color-warning)]">
            {error}
          </p>
        )}
      </div>
    </Seccion>
  );
}

/**
 * La billetera, o el motivo por el que no se ve.
 *
 * El bloque de otra red es **explícito a propósito**: el backend no mandó la
 * plata por R6, y una sección vacía se lee como "no tiene movimientos".
 */
function Dinero({
  ctx,
  onCrearJugador,
}: {
  ctx: ContactContext | null;
  /** Sólo se ofrece si el operador puede crear usuarios. */
  onCrearJugador: (() => void) | null;
}): React.ReactElement {
  if (!ctx) {
    return (
      <Seccion titulo="Dinero">
        <p className="text-[12px] text-[var(--color-fg-muted)]">
          No se pudo traer el contexto del contacto.
        </p>
      </Seccion>
    );
  }

  if (ctx.network && !ctx.network.same) {
    return (
      <Seccion titulo="Dinero">
        <div className="flex gap-2 rounded-[12px] border-l-2 border-[var(--color-danger,#f2555a)] bg-[var(--color-danger-bg,rgba(242,85,90,.1))] px-2.5 py-2">
          <ShieldAlert
            size={13}
            className="mt-px shrink-0 text-[var(--color-danger,#f2555a)]"
          />
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-semibold text-[var(--color-fg)]">
              Es de otra red{ctx.network.label ? ` · ${ctx.network.label}` : ''}
            </span>
            <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
              Le podés responder y avisarle a su operador. El saldo y los
              movimientos <b>no se muestran</b>: son de una red independiente.
            </span>
          </div>
        </div>
      </Seccion>
    );
  }

  if (ctx.contact.isLead || !ctx.wallet) {
    return (
      <Seccion titulo="Dinero">
        <p className="text-[12px] leading-snug text-[var(--color-fg-muted)]">
          Todavía no tiene cuenta. Es un lead: escribió, pero no hay jugador
          asociado.
        </p>
        {onCrearJugador && (
          <button
            type="button"
            onClick={onCrearJugador}
            className="flex h-[34px] items-center justify-center gap-1.5 rounded-[10px] border border-[var(--color-border)] text-[12.5px] text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)]"
          >
            <UserPlus size={13} />
            Crear jugador
          </button>
        )}
      </Seccion>
    );
  }

  const w = ctx.wallet;
  return (
    <Seccion titulo="Dinero">
      <div className="flex flex-col gap-1">
        <span className="font-display text-[24px] font-bold leading-none text-[var(--color-fg)]">
          {plata(w.balance)}{' '}
          <span className="text-[13px] font-medium text-[var(--color-fg-subtle)]">
            {currencyLabel(w.currency)}
          </span>
        </span>
        <span className="text-[11.5px] text-[var(--color-fg-subtle)]">
          Bono {plata(w.bonusBalance)} · Bloqueado {plata(w.lockedBalance)}
        </span>
        {ctx.upline && (
          <span className="mt-1 text-[11.5px] text-[var(--color-fg-muted)]">
            Cuelga de <b>{ctx.upline.username}</b>
          </span>
        )}
      </div>
    </Seccion>
  );
}

/**
 * Quién es esta persona — **la tercera defensa de D4**, del lado del operador.
 *
 * D4 vincula solo por teléfono, y acepta a sabiendas dos costos: que un número
 * compartido o mal cargado **una a dos personas en una sola ficha**, y que
 * cuando el canal no da el teléfono no vincule a nadie. Los dos se arreglan
 * acá: un botón para vincular a mano y otro para deshacer.
 *
 * ## Por qué esto no es un detalle de comodidad
 *
 * En **Telegram el teléfono no llega nunca**, así que el vínculo automático no
 * funciona y **todo contacto nace como lead**. Sin este botón, el único camino
 * para identificar a alguien que ya es jugador sería crearle una segunda cuenta
 * — que es exactamente lo que el freno del alta existe para impedir.
 *
 * ## Deshacer pide confirmación, vincular no
 *
 * No son simétricos. Vincular mal se ve enseguida —aparece el nombre y el saldo
 * de otro— y se deshace acá mismo. Deshacer, en cambio, borra un vínculo que
 * quizá puso el sistema hace meses, y para rehacerlo hay que saber a quién
 * apuntaba. Por eso el destructivo es el que pregunta.
 */
function Vinculo({
  contactId,
  ctx,
  nombreSugerido,
  telefono,
  onCambio,
}: {
  contactId: string;
  ctx: ContactContext | null;
  nombreSugerido: string;
  telefono: string | null;
  /** Para que la ficha refleje el cambio sin cambiar de conversación. */
  onCambio: () => void;
}): React.ReactElement | null {
  const [abierto, setAbierto] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin contexto no se sabe si está vinculado, y ofrecer las dos cosas sería
  // adivinar. El motivo ya se muestra en el bloque de Dinero.
  if (!ctx) return null;

  const deshacer = async (): Promise<void> => {
    setTrabajando(true);
    setError(null);
    try {
      await desvincularContacto(contactId);
      setConfirmando(false);
      onCambio();
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setTrabajando(false);
    }
  };

  if (ctx.contact.userId) {
    return (
      <Seccion titulo="Vínculo">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-[12px] text-[var(--color-fg-muted)]">
            <Link2 size={12} className="shrink-0 text-[var(--color-fg-subtle)]" />
            <span>
              Vinculado a{' '}
              <b className="font-mono text-[var(--color-fg)]">
                {ctx.identity?.username ?? 'un jugador'}
              </b>
            </span>
          </div>

          {confirmando ? (
            <div className="flex flex-col gap-1.5 rounded-[12px] border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-2.5 py-2">
              <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
                El contacto vuelve a ser un lead y se deja de ver su plata.
                Las conversaciones, las notas y las etiquetas <b>quedan</b>.
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => void deshacer()}
                  disabled={trabajando}
                  className="flex h-[32px] flex-1 items-center justify-center gap-1.5 rounded-[9px] bg-[var(--color-danger,#f2555a)] text-[12px] font-semibold text-white transition-opacity disabled:opacity-50"
                >
                  {trabajando ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
                  Sí, deshacer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmando(false)}
                  disabled={trabajando}
                  className="h-[32px] rounded-[9px] border border-[var(--color-border)] px-3 text-[12px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)] disabled:opacity-50"
                >
                  No
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmando(true)}
              className="flex h-[32px] items-center justify-center gap-1.5 rounded-[9px] border border-[var(--color-border)] text-[12px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
            >
              <Unlink size={12} />
              No es esta persona
            </button>
          )}

          {error && (
            <p role="alert" className="text-[11.5px] text-[var(--color-warning)]">
              {error}
            </p>
          )}
        </div>
      </Seccion>
    );
  }

  return (
    <Seccion titulo="Vínculo">
      <div className="flex flex-col gap-1.5">
        <p className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
          No sabemos quién es. Si ya tiene cuenta, vinculalo y vas a ver su
          saldo y sus movimientos acá.
        </p>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="flex h-[34px] items-center justify-center gap-1.5 rounded-[10px] border border-[var(--color-border)] text-[12.5px] text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)]"
        >
          <Link2 size={13} />
          Vincular a un jugador
        </button>
      </div>

      {abierto && (
        <VincularJugador
          contactId={contactId}
          telefono={telefono}
          nombreSugerido={nombreSugerido}
          onCerrar={() => setAbierto(false)}
          onVinculado={onCambio}
        />
      )}
    </Seccion>
  );
}

/**
 * El hueco de la caja, marcado.
 *
 * El diseño mete cargar, retirar, bono y corrección acá adentro. Es una
 * decisión **diferida, no descartada**: cambia si el CRM mueve fichas, y con
 * eso hay que rederivar E8/P3 y el techo del empleado.
 *
 * Se muestra el hueco en vez de no mostrar nada porque una sección que falta a
 * propósito no se parece a una que se olvidaron.
 */
function CajaDiferida(): React.ReactElement {
  return (
    <Seccion titulo="Caja">
      <div className="flex gap-2 rounded-[12px] bg-[var(--color-bg-subtle)] px-2.5 py-2">
        <Lock size={12} className="mt-0.5 shrink-0 text-[var(--color-fg-subtle)]" />
        <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
          Cargar, retirar, bonos y correcciones desde el chat están
          <b> sin decidir</b>. Por ahora la plata se mueve desde el panel.
        </span>
      </div>
    </Seccion>
  );
}

/** Circuito, tramos e historial: pedidos por el diseño, sin datos todavía. */
function MedicionPendiente(): React.ReactElement {
  return (
    <Seccion titulo="Circuito y tiempos">
      <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
        La etapa del circuito, los tiempos del tramo y el historial todavía no se
        miden.
      </span>
    </Seccion>
  );
}

/** Los ids, para pegarlos en un ticket o en una consulta. */
function Identificadores({
  contactId,
  conversationId,
  telefono,
}: {
  contactId: string;
  conversationId: string;
  telefono: string | null;
}): React.ReactElement {
  return (
    <Seccion titulo="Identificadores">
      <div className="flex flex-col gap-1">
        <Copiable label="contact_id" valor={contactId} />
        <Copiable label="conversation_id" valor={conversationId} />
        {telefono && <Copiable label="teléfono" valor={telefono} />}
      </div>
    </Seccion>
  );
}

function Copiable({ label, valor }: { label: string; valor: string }): React.ReactElement {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(valor)
          .then(() => {
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1600);
          })
          .catch(() => {
            /* sin portapapeles: el valor está a la vista igual */
          });
      }}
      className="group flex items-center gap-1.5 text-left"
      title={`Copiar ${label}`}
    >
      <span className="w-[100px] shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-fg-muted)]">
        {valor}
      </span>
      {copiado ? (
        <Check size={11} className="shrink-0 text-[var(--color-success)]" />
      ) : (
        <Copy
          size={11}
          className="shrink-0 text-[var(--color-fg-subtle)] opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
    </button>
  );
}

function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className={cn('flex flex-col gap-1.5')}>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/**
 * Un monto, con separadores de miles.
 *
 * Los saldos llegan como string decimal a proposito —nunca como numero de
 * punto flotante— asi que se formatean, no se operan.
 */
function plata(valor: string): string {
  const n = Number(valor);
  if (Number.isNaN(n)) return valor;
  return n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mensaje(err: unknown): string {
  const m = (err as { body?: { message?: string }; message?: string })?.body?.message;
  if (typeof m === 'string' && m) return m;
  return (err as { message?: string })?.message || 'No se pudo completar.';
}
