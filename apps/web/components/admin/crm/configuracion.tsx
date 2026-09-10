/**
 * Configuración del CRM — hoy, el gestor de etiquetas.
 *
 * ## Por qué es sólo eso
 *
 * El handoff pide acá un gestor de etiquetas **y seis grupos de ajustes**:
 * atención y horarios, reparto de conversaciones, alertas, privacidad y datos,
 * difusión, identidad.
 *
 * **Ninguno de esos ajustes existe.** No hay un horario de atención que el
 * sistema mire, ni un reparto que configurar —por **D2** una conversación va a
 * la bandeja del dueño del canal, y eso no es un ajuste—, ni alertas más allá
 * del parte diario.
 *
 * Dibujar seis grupos de interruptores que guardan un valor que nada lee sería
 * peor que no dibujarlos: el operador los tocaría, creería que cambió algo, y
 * el sistema se seguiría portando igual. Un ajuste que no hace nada es una
 * mentira con apariencia de función.
 *
 * Las etiquetas, en cambio, **ya se usan**: están en la lista de la bandeja, en
 * la ficha y en Contactos. Lo que faltaba era poder renombrarlas y borrarlas.
 *
 * ## El catálogo es de todo el tenant
 *
 * No hay etiquetas por bandeja. Una que renombra un socio independiente se le
 * renombra también al staff central. Por eso editar y borrar piden
 * `tenant.settings.edit` y no alcanza con tener acceso al CRM — y por eso la
 * pantalla lo dice, en vez de dejar que alguien lo descubra con un 403.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Tag, Trash2, X } from 'lucide-react';
import {
  borrarEtiqueta,
  createTag,
  editarEtiqueta,
  listarCatalogoDeEtiquetas,
  type EtiquetaConUso,
} from '@/lib/chat/crm-api';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';

/**
 * Los colores que se pueden elegir.
 *
 * Una lista corta y no un selector libre: el color se usa como **tinte del
 * texto sobre fondo neutro**, y con cualquier color elegido a mano la mitad de
 * las combinaciones quedan ilegibles. Éstos son los semánticos del panel, que
 * ya están probados sobre este fondo.
 */
const COLORES: Array<{ valor: string | null; nombre: string }> = [
  { valor: null, nombre: 'Sin color' },
  { valor: '#3fb950', nombre: 'Verde' },
  { valor: '#f2555a', nombre: 'Rojo' },
  { valor: '#e3a008', nombre: 'Ámbar' },
  { valor: '#8fb6ff', nombre: 'Azul' },
  { valor: '#f0c46a', nombre: 'Dorado' },
];

export function Configuracion(): React.ReactElement {
  const { user } = useAuth();
  const puedeEditar = hasPermission(user, 'tenant.settings.edit');

  const [etiquetas, setEtiquetas] = useState<EtiquetaConUso[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState('');
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setEtiquetas(await listarCatalogoDeEtiquetas());
      setError(null);
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const crear = useCallback(async () => {
    const label = nueva.trim();
    if (!label || creando) return;
    setCreando(true);
    setError(null);
    try {
      await createTag(label, null);
      setNueva('');
      await cargar();
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setCreando(false);
    }
  }, [nueva, creando, cargar]);

  return (
    <div className="flex max-w-[720px] flex-col gap-4 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-[var(--color-fg)]">
          Configuración
        </h1>
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Las etiquetas con las que ordenás tus contactos.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-[14px] border border-[var(--color-border)] p-4">
        <div className="flex items-center gap-2">
          <Tag size={15} className="text-[var(--color-fg-muted)]" />
          <h2 className="font-display text-[15px] font-bold text-[var(--color-fg)]">
            Etiquetas
          </h2>
          <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
            {etiquetas.length}
          </span>
        </div>

        <p className="text-[11.5px] leading-snug text-[var(--color-fg-muted)]">
          El catálogo es <b>de todo el casino</b>: las mismas etiquetas las ven
          todas las bandejas. Por eso renombrarlas y borrarlas lo hace sólo quien
          administra la configuración.
        </p>

        <div className="flex gap-2">
          <input
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void crear();
            }}
            maxLength={40}
            placeholder="Nombre de la etiqueta"
            className="h-[36px] flex-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 text-[13px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
          />
          <button
            type="button"
            onClick={() => void crear()}
            disabled={!nueva.trim() || creando}
            className="flex h-[36px] items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-[var(--color-accent-fg)] disabled:opacity-40"
          >
            {creando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Crear
          </button>
        </div>

        {error && (
          <p role="alert" className="text-[12px] text-[var(--color-warning)]">
            {error}
          </p>
        )}

        {cargando ? (
          <Loader2 size={16} className="animate-spin text-[var(--color-fg-subtle)]" />
        ) : etiquetas.length === 0 ? (
          <p className="text-[12.5px] text-[var(--color-fg-muted)]">
            Todavía no creaste ninguna etiqueta.
          </p>
        ) : (
          <ul className="flex flex-col">
            {etiquetas.map((e) => (
              <li
                key={e.id}
                className="border-b border-[var(--color-border)] py-2 last:border-b-0"
              >
                {editando === e.id ? (
                  <Edicion
                    etiqueta={e}
                    onListo={() => {
                      setEditando(null);
                      void cargar();
                    }}
                    onCancelar={() => setEditando(null)}
                  />
                ) : (
                  <Renglon
                    etiqueta={e}
                    puedeEditar={puedeEditar}
                    onEditar={() => setEditando(e.id)}
                    onBorrado={cargar}
                    onError={setError}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Lo que el diseño pide y no está. Se dice acá y no se calla: el operador
        que conoce el diseño va a buscar estos ajustes, y es mejor que sepa que
        faltan a que crea que no los encuentra.
      */}
      <section className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--color-border)] p-4">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
          Todavía no hay
        </h2>
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
          Horarios de atención, reparto de conversaciones, alertas, retención de
          datos y difusión. Ninguno de esos ajustes existe del lado del sistema
          todavía, así que no se muestran: un interruptor que no cambia nada es
          peor que un ajuste que falta.
        </p>
      </section>
    </div>
  );
}

function Renglon({
  etiqueta,
  puedeEditar,
  onEditar,
  onBorrado,
  onError,
}: {
  etiqueta: EtiquetaConUso;
  puedeEditar: boolean;
  onEditar: () => void;
  onBorrado: () => Promise<void>;
  onError: (m: string) => void;
}): React.ReactElement {
  const [borrando, setBorrando] = useState(false);

  const borrar = useCallback(async () => {
    // La confirmación dice **a cuántos contactos les saca la etiqueta**. Un
    // "¿estás seguro?" pelado no le da a nadie con qué decidir.
    const aviso =
      etiqueta.uso > 0
        ? `Borrar "${etiqueta.label}" se la saca a ${etiqueta.uso} contacto${etiqueta.uso === 1 ? '' : 's'}. No se puede deshacer.`
        : `Borrar "${etiqueta.label}"? No la usa ningún contacto.`;
    if (!window.confirm(aviso)) return;
    setBorrando(true);
    try {
      await borrarEtiqueta(etiqueta.id);
      await onBorrado();
    } catch (err) {
      onError(mensaje(err));
    } finally {
      setBorrando(false);
    }
  }, [etiqueta, onBorrado, onError]);

  return (
    <div className="flex items-center gap-2">
      <span
        className="rounded-[7px] px-1.5 py-px text-[11px] font-medium"
        style={{
          color: etiqueta.color ?? 'var(--color-fg-muted)',
          background: 'var(--color-bg-subtle)',
        }}
      >
        {etiqueta.label}
      </span>
      <span className="font-mono text-[11px] text-[var(--color-fg-subtle)]">
        {etiqueta.uso === 0
          ? 'sin usar'
          : `${etiqueta.uso} contacto${etiqueta.uso === 1 ? '' : 's'}`}
      </span>

      {puedeEditar && (
        <span className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onEditar}
            aria-label={`Editar ${etiqueta.label}`}
            className="flex size-7 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            onClick={() => void borrar()}
            disabled={borrando}
            aria-label={`Borrar ${etiqueta.label}`}
            className="flex size-7 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-danger,#f2555a)] disabled:opacity-40"
          >
            {borrando ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Trash2 size={13} />
            )}
          </button>
        </span>
      )}
    </div>
  );
}

function Edicion({
  etiqueta,
  onListo,
  onCancelar,
}: {
  etiqueta: EtiquetaConUso;
  onListo: () => void;
  onCancelar: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState(etiqueta.label);
  const [color, setColor] = useState<string | null>(etiqueta.color);
  const [guardando, setGuardando] = useState(false);

  const guardar = useCallback(async () => {
    if (!label.trim() || guardando) return;
    setGuardando(true);
    try {
      await editarEtiqueta(etiqueta.id, { label: label.trim(), color });
      onListo();
    } finally {
      setGuardando(false);
    }
  }, [etiqueta.id, label, color, guardando, onListo]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={40}
          autoFocus
          className="h-[32px] flex-1 rounded-[9px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 text-[12.5px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
        />
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando || !label.trim()}
          aria-label="Guardar"
          className="flex size-8 items-center justify-center rounded-[9px] bg-[var(--color-accent)] text-[var(--color-accent-fg)] disabled:opacity-40"
        >
          {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
        </button>
        <button
          type="button"
          onClick={onCancelar}
          aria-label="Cancelar"
          className="flex size-8 items-center justify-center rounded-[9px] border border-[var(--color-border)] text-[var(--color-fg-muted)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {COLORES.map((c) => (
          <button
            key={c.nombre}
            type="button"
            onClick={() => setColor(c.valor)}
            className={cn(
              'rounded-[7px] border px-2 py-0.5 text-[11px] transition-colors',
              color === c.valor
                ? 'border-[var(--color-border-strong)]'
                : 'border-transparent',
            )}
            style={{
              color: c.valor ?? 'var(--color-fg-muted)',
              background: 'var(--color-bg-subtle)',
            }}
          >
            {c.nombre}
          </button>
        ))}
      </div>
    </div>
  );
}

function mensaje(err: unknown): string {
  const m = (err as { body?: { message?: string }; message?: string })?.body?.message;
  if (typeof m === 'string' && m) return m;
  return (err as { message?: string })?.message || 'No se pudo completar.';
}
