/**
 * Alta de un jugador desde el chat (**1.6**, **D9**).
 *
 * Le da interfaz a un endpoint que existía desde la etapa 1 y que **no llamaba
 * nadie**.
 *
 * ## Las tres cosas que esta pantalla tiene que cuidar
 *
 * **1. De quién cuelga no se elige.** Sale de la bandeja por la que esa persona
 * escribió (**D9**). Se muestra, no se edita: con un desplegable, un alta podría
 * terminar colgada de quien convenga y no de quien atendió — y de eso salen las
 * comisiones.
 *
 * **2. Si ya existe un jugador con ese teléfono, hay que frenar.**
 * `users.phone` **no es único**, así que crear igual deja a la misma persona con
 * dos cuentas y el saldo partido; y las cuentas **no se fusionan**. El operador
 * no tiene cómo saberlo mirando una conversación, así que lo mira el servidor y
 * acá se muestra en rojo. Se puede crear igual, pero **tildando a propósito**:
 * a veces son dos personas que comparten teléfono, y eso lo sabe el que está
 * atendiendo, no nosotros.
 *
 * **3. La contraseña se muestra UNA sola vez.** Se genera en el servidor y no
 * se guarda en claro: si se cierra esta pantalla sin copiarla, no hay forma de
 * recuperarla — hay que resetearla. Por eso el modal no se cierra solo al
 * terminar, y el botón de cerrar dice lo que implica.
 *
 * ## Lo que NO hace, y por qué
 *
 * **No manda las credenciales por el chat.** El diseño trae un tilde para eso.
 * En WhatsApp o Telegram la contraseña quedaría escrita en el teléfono del
 * jugador y en el del operador, para siempre, en un canal que ninguno de los
 * dos controla.
 *
 * **No ofrece vincular con el jugador que ya existe** — pero ese botón **ya
 * existe**, en la sección *Vínculo* de la ficha (`vincular-jugador.tsx`).
 * Sigue estando afuera de acá a propósito: vincular mal mete la conversación en
 * la ficha de otra persona y le abre la billetera, así que es una decisión
 * aparte y no un atajo dentro del formulario de alta. Si los homónimos de abajo
 * son la misma persona, lo correcto es **cerrar esto y vincular**.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Loader2,
  TriangleAlert,
  UserPlus,
  X,
} from 'lucide-react';
import {
  crearJugadorDesdeElChat,
  homonimosDelContacto,
  type AltaDesdeElChat,
  type JugadorHomonimo,
} from '@/lib/chat/crm-api';
import { cn } from '@/lib/cn';

export function AltaDeJugador({
  contactId,
  nombreSugerido,
  telefono,
  onCerrar,
  onCreado,
}: {
  contactId: string;
  /** Lo que se sabe del contacto, para no hacer escribir de nuevo. */
  nombreSugerido: string;
  telefono: string | null;
  onCerrar: () => void;
  onCreado: () => void;
}): React.ReactElement {
  const [username, setUsername] = useState(() => sugerirUsuario(nombreSugerido));
  const [displayName, setDisplayName] = useState(nombreSugerido);
  const [homonimos, setHomonimos] = useState<JugadorHomonimo[]>([]);
  const [buscando, setBuscando] = useState(true);
  const [aunAsi, setAunAsi] = useState(false);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<AltaDesdeElChat | null>(null);

  // El chequeo corre al abrir, no al apretar crear: el operador tiene que ver
  // el aviso mientras decide, no después de haber decidido.
  useEffect(() => {
    let vivo = true;
    homonimosDelContacto(contactId)
      .then((h) => vivo && setHomonimos(h))
      .catch(() => {
        // Si la búsqueda falla no se bloquea el alta —sería peor no poder dar
        // de alta a nadie— pero tampoco se finge que no hay homónimos.
        if (vivo) setHomonimos([]);
      })
      .finally(() => vivo && setBuscando(false));
    return () => {
      vivo = false;
    };
  }, [contactId]);

  const crear = useCallback(async () => {
    setCreando(true);
    setError(null);
    try {
      const r = await crearJugadorDesdeElChat(contactId, {
        username: username.trim().toLowerCase(),
        displayName: displayName.trim() || undefined,
      });
      setListo(r);
      onCreado();
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setCreando(false);
    }
  }, [contactId, username, displayName, onCreado]);

  const hayHomonimos = homonimos.length > 0;
  const frenado = hayHomonimos && !aunAsi;
  const usuarioValido = /^[a-z0-9_.-]{3,30}$/.test(username.trim().toLowerCase());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crear jugador"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        // Con la contraseña en pantalla, un clic afuera la haría desaparecer
        // para siempre. Ahí sólo se cierra por el botón.
        if (e.target === e.currentTarget && !listo) onCerrar();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[620px] flex-col gap-4 overflow-y-auto rounded-[16px] border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.9)]">
        {listo ? (
          <Credenciales alta={listo} onCerrar={onCerrar} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="font-display text-[19px] font-bold text-[var(--color-fg)]">
                  Crear jugador
                </h2>
                <p className="text-[12.5px] text-[var(--color-fg-muted)]">
                  Le damos cuenta a alguien que ya está escribiendo.
                </p>
              </div>
              <button
                type="button"
                onClick={onCerrar}
                aria-label="Cerrar"
                className="flex size-7 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]"
              >
                <X size={15} />
              </button>
            </div>

            {/*
              De quién cuelga (D9) — se explica la regla, **no se nombra a
              nadie**.

              El diseño muestra el nombre del operador del que va a colgar. Acá
              no se pone porque el front no lo sabe: lo resuelve el servidor
              desde el dueño de la ficha, y para una bandeja central es el admin
              principal, que este cliente no conoce.

              De ahí salen las comisiones. Nombrar al operador equivocado sería
              peor que no nombrar ninguno — el operador leería un nombre, lo
              daría por bueno, y el alta quedaría colgada de otro lado.
            */}
            <Campo label="Cuelga de">
              <div className="flex min-h-[38px] items-center rounded-[11px] bg-[var(--color-bg-subtle)] px-3 py-2 text-[12.5px] leading-snug text-[var(--color-fg-muted)]">
                La bandeja por la que escribió. No se elige.
              </div>
            </Campo>

            {buscando ? (
              <div className="flex items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
                <Loader2 size={13} className="animate-spin" />
                Revisando si ya tiene cuenta…
              </div>
            ) : (
              hayHomonimos && (
                <Homonimos
                  jugadores={homonimos}
                  telefono={telefono}
                  aunAsi={aunAsi}
                  onAunAsi={setAunAsi}
                />
              )
            )}

            <Campo label="Usuario">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                spellCheck={false}
                className="h-[38px] rounded-[11px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 font-mono text-[13px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
              />
              <p className="text-[11px] text-[var(--color-fg-subtle)]">
                Entre 3 y 30: letras, números, punto, guión o guión bajo.
              </p>
            </Campo>

            <Campo label="Nombre">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-[38px] rounded-[11px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 text-[13px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
              />
            </Campo>

            {telefono && (
              <Campo label="Teléfono">
                <div className="flex h-[38px] items-center rounded-[11px] bg-[var(--color-bg-subtle)] px-3 font-mono text-[13px] text-[var(--color-fg-muted)]">
                  {telefono}
                </div>
                <p className="text-[11px] text-[var(--color-fg-subtle)]">
                  Sale del contacto. Es con lo que lo vamos a reconocer la
                  próxima vez que escriba.
                </p>
              </Campo>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-[10px] border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-2.5 py-2 text-[12px] text-[var(--color-warning)]"
              >
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void crear()}
                disabled={creando || frenado || !usuarioValido}
                className="flex h-[40px] flex-1 items-center justify-center gap-1.5 rounded-[11px] bg-[var(--color-accent)] text-[13px] font-semibold text-[var(--color-accent-fg)] transition-opacity disabled:opacity-40"
              >
                {creando ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <UserPlus size={14} />
                )}
                Crear jugador
              </button>
              <button
                type="button"
                onClick={onCerrar}
                className="h-[40px] rounded-[11px] border border-[var(--color-border)] px-4 text-[13px] text-[var(--color-fg-muted)] transition-colors hover:text-[var(--color-fg)]"
              >
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * El bloque rojo: ya hay alguien con este teléfono.
 *
 * No bloquea del todo a propósito. A veces son dos personas que comparten un
 * teléfono —una pareja, un locutorio— y eso lo sabe el que está atendiendo. Lo
 * que no puede pasar es que se cree **sin haberlo mirado**, y para eso está el
 * tilde.
 */
function Homonimos({
  jugadores,
  telefono,
  aunAsi,
  onAunAsi,
}: {
  jugadores: JugadorHomonimo[];
  telefono: string | null;
  aunAsi: boolean;
  onAunAsi: (v: boolean) => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-[12px] border-l-2 border-[var(--color-danger,#f2555a)] bg-[var(--color-danger-bg,rgba(242,85,90,.1))] px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <TriangleAlert size={13} className="text-[var(--color-danger,#f2555a)]" />
        <span className="text-[12.5px] font-semibold text-[var(--color-fg)]">
          {jugadores.length === 1
            ? 'Ya hay un jugador con este teléfono'
            : `Ya hay ${jugadores.length} jugadores con este teléfono`}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {jugadores.map((j) => (
          <li
            key={j.id}
            className="flex items-center gap-2 rounded-[9px] bg-[var(--color-bg-subtle)] px-2 py-1.5"
          >
            <span className="font-mono text-[12px] text-[var(--color-fg)]">
              {j.username}
            </span>
            {j.displayName && (
              <span className="min-w-0 truncate text-[12px] text-[var(--color-fg-muted)]">
                {j.displayName}
              </span>
            )}
            <span className="ml-auto shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
              {j.status}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
        Si es la misma persona, <b>no crees otra cuenta</b>: quedaría con el
        saldo partido en dos y no se pueden juntar. {telefono ? `Teléfono ${telefono}.` : ''}
      </p>

      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={aunAsi}
          onChange={(e) => onAunAsi(e.target.checked)}
          className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-accent)]"
        />
        <span className="text-[11.5px] leading-snug text-[var(--color-fg)]">
          Lo miré y es otra persona. Crear la cuenta igual.
        </span>
      </label>
    </div>
  );
}

/**
 * La contraseña, una sola vez.
 *
 * El modal no se cierra solo al terminar: si se pierde esta pantalla, la
 * contraseña no se recupera —no se guarda en claro— y hay que resetearla.
 */
function Credenciales({
  alta,
  onCerrar,
}: {
  alta: AltaDesdeElChat;
  onCerrar: () => void;
}): React.ReactElement {
  const [copiado, setCopiado] = useState(false);
  const clave = alta.generatedPassword;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Check size={16} className="text-[var(--color-success)]" />
        <h2 className="font-display text-[19px] font-bold text-[var(--color-fg)]">
          Jugador creado
        </h2>
      </div>

      <div className="flex flex-col gap-1.5 rounded-[12px] bg-[var(--color-bg-subtle)] px-3 py-2.5">
        <Dato label="Usuario" valor={alta.username} />
        {clave && <Dato label="Contraseña" valor={clave} />}
      </div>

      {clave && (
        <>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                .writeText(`Usuario: ${alta.username}\nContraseña: ${clave}`)
                .then(() => {
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 2000);
                })
                .catch(() => {
                  /* sin portapapeles: están a la vista igual */
                });
            }}
            className="flex h-[38px] items-center justify-center gap-1.5 rounded-[11px] border border-[var(--color-border)] text-[13px] text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)]"
          >
            {copiado ? <Check size={14} /> : <Copy size={14} />}
            {copiado ? 'Copiado' : 'Copiar usuario y contraseña'}
          </button>

          <p className="rounded-[10px] border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-2.5 py-2 text-[11.5px] leading-snug text-[var(--color-warning)]">
            <b>Esta contraseña se muestra una sola vez.</b> No se guarda en
            ningún lado: si cerrás sin copiarla, hay que resetearla.
          </p>

          <p className="text-[11.5px] leading-snug text-[var(--color-fg-subtle)]">
            Pasásela por un medio que controles. Mandarla por el chat la deja
            escrita en el teléfono del jugador para siempre.
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onCerrar}
        className="h-[40px] rounded-[11px] bg-[var(--color-accent)] text-[13px] font-semibold text-[var(--color-accent-fg)]"
      >
        {clave ? 'Ya la copié, cerrar' : 'Cerrar'}
      </button>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }): React.ReactElement {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[86px] shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      <span className="min-w-0 flex-1 break-all font-mono text-[14px] text-[var(--color-fg)]">
        {valor}
      </span>
    </div>
  );
}

function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-1.5')}>
      <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
        {label}
      </span>
      {children}
    </div>
  );
}

/**
 * Un usuario a partir del nombre, para no hacerlo escribir de cero.
 *
 * Es sólo una sugerencia: el campo se edita. Si el nombre no deja nada usable
 * —un contacto de Telegram sin nombre, por ejemplo— queda vacío y lo escribe el
 * operador, que es mejor que proponer algo raro.
 */
function sugerirUsuario(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

function mensaje(err: unknown): string {
  const m = (err as { body?: { message?: string }; message?: string })?.body?.message;
  if (typeof m === 'string' && m) return m;
  return (err as { message?: string })?.message || 'No se pudo crear el jugador.';
}
