/**
 * Vincular un contacto a un jugador que ya existe — **la tercera defensa de D4**.
 *
 * Le da interfaz a un endpoint que existe y probado desde el commit `a8256a3` y
 * que **no llamaba nadie**. Es el mismo patrón que ya pasó con cerrar, avisar y
 * dar de alta: el roadmap los daba por hechos porque el backend estaba.
 *
 * ## Por qué hace falta un vínculo a mano si D4 vincula solo
 *
 * Porque D4 sólo funciona cuando el canal da el teléfono, y buena parte del
 * tiempo no lo da:
 *
 * - **En Telegram no llega nunca** (`03-canales.md`). Ahí un contacto nace como
 *   lead **siempre**, y ésa va a ser la normalidad, no la excepción.
 * - **En WhatsApp llega, pero la segunda defensa puede rechazarlo**: si el
 *   número matchea con más de un jugador, D4 decide no vincular a ninguno. Es
 *   exactamente el caso en que alguien tiene que mirar y elegir — y por eso esta
 *   pantalla **arranca buscando por el teléfono del contacto**: los dos
 *   candidatos que frenaron al automático aparecen listados, y el operador
 *   señala cuál es.
 *
 * ## Lo que esta pantalla tiene que decir en voz alta
 *
 * **Vincular abre la plata.** Con el contacto vinculado, la ficha pasa a mostrar
 * saldo, depósitos y retiros de ese jugador. No es un dato de contacto: es la
 * billetera de una persona. Se dice antes de apretar, no después.
 *
 * **Sólo aparecen jugadores de la propia red.** Lo acota el backend por **R6**.
 * Se aclara en pantalla porque, si no, "no lo encuentro" se lee como "no está en
 * el sistema" cuando en realidad significa "no es tuyo".
 *
 * **Se puede deshacer.** Es la mitad restante de la tercera defensa de D4 y vive
 * en la ficha, no acá. Decirlo baja el costo de equivocarse, que es lo que hace
 * que el operador use el botón en vez de dejar la conversación sin identificar.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, Search, ShieldAlert, X } from 'lucide-react';
import {
  jugadoresParaVincular,
  vincularContacto,
  type JugadorDeLaRed,
} from '@/lib/chat/crm-api';

/** Lo que el backend exige para siquiera correr la consulta. */
const MINIMO = 2;

export function VincularJugador({
  contactId,
  telefono,
  nombreSugerido,
  onCerrar,
  onVinculado,
}: {
  contactId: string;
  /**
   * El teléfono del contacto, si el canal lo dio. Es la mejor búsqueda inicial
   * que hay: en WhatsApp es el dato con el que el automático ya intentó.
   */
  telefono: string | null;
  /** El nombre que muestra la conversación, para cuando no hay teléfono. */
  nombreSugerido: string;
  onCerrar: () => void;
  onVinculado: () => void;
}): React.ReactElement {
  const [texto, setTexto] = useState(() => telefono ?? nombreSugerido);
  const [resultados, setResultados] = useState<JugadorDeLaRed[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [busco, setBusco] = useState(false);
  const [vinculando, setVinculando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const consulta = texto.trim();

  // Se espera a que deje de escribir: sin eso, cada tecla es una consulta que
  // recorre la jerarquía de cada candidato para filtrar por red.
  useEffect(() => {
    if (consulta.length < MINIMO) {
      setResultados([]);
      setBuscando(false);
      setBusco(false);
      return;
    }
    setBuscando(true);
    let vivo = true;
    const t = setTimeout(() => {
      jugadoresParaVincular(consulta)
        .then((r) => {
          if (!vivo) return;
          setResultados(r);
          setBusco(true);
        })
        .catch(() => {
          if (!vivo) return;
          setResultados([]);
          setBusco(true);
        })
        .finally(() => vivo && setBuscando(false));
    }, 250);
    // Corta las dos cosas: el pedido que todavía no salió y el que ya volvió
    // tarde. Sin lo segundo, una búsqueda vieja pisa a la nueva.
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [consulta]);

  const vincular = useCallback(
    async (jugador: JugadorDeLaRed) => {
      setVinculando(jugador.id);
      setError(null);
      try {
        await vincularContacto(contactId, jugador.id);
        onVinculado();
        onCerrar();
      } catch (err) {
        setError(mensaje(err));
        setVinculando(null);
      }
    },
    [contactId, onCerrar, onVinculado],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Vincular a un jugador"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCerrar();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-[560px] flex-col gap-4 overflow-y-auto rounded-[16px] border border-[var(--color-border-strong)] bg-[var(--color-bg-elevated)] p-5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.9)]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-[19px] font-bold text-[var(--color-fg)]">
              Vincular a un jugador
            </h2>
            <p className="text-[12.5px] leading-snug text-[var(--color-fg-muted)]">
              Para cuando esta persona ya tiene cuenta y el sistema no la
              reconoció solo.
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
          El aviso va ANTES del buscador, no al lado del botón de confirmar: lo
          que se está por hacer es abrir la billetera de una persona en esta
          ficha, y eso tiene que leerse mientras se elige, no después.
        */}
        <div className="flex gap-2 rounded-[12px] border-l-2 border-[var(--color-warning)] bg-[var(--color-warning-bg)] px-3 py-2.5">
          <ShieldAlert size={13} className="mt-px shrink-0 text-[var(--color-warning)]" />
          <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
            Vincular <b>muestra el saldo y los movimientos</b> de ese jugador en
            esta ficha. Si te equivocás, se deshace desde acá mismo y queda
            registrado.
          </span>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-subtle)]">
            Buscar
          </span>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-fg-subtle)]"
            />
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              autoFocus
              spellCheck={false}
              placeholder="Usuario, nombre o teléfono"
              className="h-[38px] w-full rounded-[11px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] pl-9 pr-3 text-[13px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
            />
          </div>
          <p className="text-[11px] leading-snug text-[var(--color-fg-subtle)]">
            El teléfono se normaliza: <code>0341 15 555-1234</code> encuentra al
            que está cargado como <code>+5493415551234</code>.
          </p>
        </label>

        <Resultados
          consulta={consulta}
          buscando={buscando}
          busco={busco}
          resultados={resultados}
          vinculando={vinculando}
          onElegir={(j) => void vincular(j)}
        />

        {error && (
          <p
            role="alert"
            className="rounded-[10px] border-l-2 border-[var(--color-danger,#f2555a)] bg-[var(--color-danger-bg,rgba(242,85,90,.1))] px-2.5 py-2 text-[12px] text-[var(--color-fg)]"
          >
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * La lista, con sus tres vacíos distintos.
 *
 * Son tres estados que se parecen en pantalla y significan cosas opuestas: no
 * escribiste lo suficiente, estoy buscando, y busqué y no hay. Mostrarlos como
 * uno solo deja al operador esperando algo que ya terminó.
 */
function Resultados({
  consulta,
  buscando,
  busco,
  resultados,
  vinculando,
  onElegir,
}: {
  consulta: string;
  buscando: boolean;
  /** Ya volvió al menos una búsqueda para este texto. */
  busco: boolean;
  resultados: JugadorDeLaRed[];
  vinculando: string | null;
  onElegir: (jugador: JugadorDeLaRed) => void;
}): React.ReactElement {
  if (consulta.length < MINIMO) {
    return (
      <p className="px-1 text-[12px] text-[var(--color-fg-subtle)]">
        Escribí al menos {MINIMO} caracteres.
      </p>
    );
  }

  if (buscando && resultados.length === 0) {
    return (
      <div className="flex items-center gap-2 px-1 text-[12px] text-[var(--color-fg-muted)]">
        <Loader2 size={13} className="animate-spin" />
        Buscando…
      </div>
    );
  }

  if (busco && resultados.length === 0) {
    return (
      <div className="flex flex-col gap-1 rounded-[12px] bg-[var(--color-bg-subtle)] px-3 py-2.5">
        <span className="text-[12.5px] font-semibold text-[var(--color-fg)]">
          No encontramos a nadie
        </span>
        <span className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
          Acá sólo aparecen <b>jugadores de tu red</b>. Que no esté no quiere
          decir que no tenga cuenta: puede ser de otra red, y entonces no es tuyo
          para vincular.
        </span>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-1">
      {resultados.map((j) => (
        <li key={j.id}>
          <button
            type="button"
            onClick={() => onElegir(j)}
            disabled={vinculando !== null}
            className="flex w-full items-center gap-2 rounded-[10px] border border-[var(--color-border)] px-2.5 py-2 text-left transition-colors hover:border-[var(--color-border-strong)] disabled:opacity-40"
          >
            <span className="font-mono text-[12.5px] text-[var(--color-fg)]">
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
            {vinculando === j.id ? (
              <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-fg-muted)]" />
            ) : (
              <Link2 size={13} className="shrink-0 text-[var(--color-fg-subtle)]" />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function mensaje(err: unknown): string {
  const m = (err as { body?: { message?: string }; message?: string })?.body?.message;
  if (typeof m === 'string' && m) return m;
  return (err as { message?: string })?.message || 'No se pudo vincular.';
}
