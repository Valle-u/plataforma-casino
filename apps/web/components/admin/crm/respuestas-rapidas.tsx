/**
 * Respuestas rápidas — las plantillas del casino.
 *
 * ## Una pestaña, no dos
 *
 * El handoff pide dos: las respuestas rápidas del casino y las **plantillas de
 * WhatsApp aprobadas por Meta**. Las segundas no existen ni pueden existir
 * todavía: son un objeto de Meta, se aprueban una por una, y llegan con la
 * etapa 3 (**D13**, cada socio hace su propio trámite).
 *
 * Dibujar la pestaña vacía sugeriría que se pueden crear desde acá, que es
 * justamente lo que no se puede.
 *
 * ## Lo que se ve de cada plantilla
 *
 * Atajo, título y cuerpo — lo que la tabla guarda. El diseño pide además
 * **categoría** y **usos**: ninguna de las dos existe. La categoría sería una
 * columna nueva; los usos, contar cada inserción, que es una función entera.
 * No se inventan columnas vacías.
 *
 * ## Quién puede qué
 *
 * Crear, cualquiera con acceso al CRM: escribirse una respuesta propia es parte
 * de atender. **Editar y borrar piden `tenant.settings.edit`**, porque el
 * catálogo es de todo el tenant y lo que uno borra desaparece para todos.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  createTemplate,
  deleteTemplate,
  editarPlantilla,
  listTemplates,
} from '@/lib/chat/crm-api';
import type { CrmTemplate } from '@/lib/chat/types';
import { hasPermission, useAuth } from '@/lib/auth-context';

export function RespuestasRapidas(): React.ReactElement {
  const { user } = useAuth();
  const puedeEditar = hasPermission(user, 'tenant.settings.edit');

  const [items, setItems] = useState<CrmTemplate[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setItems(await listTemplates());
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

  return (
    <div className="flex max-w-[860px] flex-col gap-4 py-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-display text-[26px] font-bold tracking-tight text-[var(--color-fg)]">
          Respuestas rápidas
        </h1>
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Lo que contestás siempre, escrito una sola vez. Se insertan en el
          mensaje con su atajo o desde el compositor.
        </p>
      </div>

      {/*
        La aclaración del handoff, dicha como corresponde: no es que la pestaña
        de WhatsApp esté "vacía", es que esas plantillas son otra cosa y no
        salen de acá.
      */}
      <div className="rounded-[12px] border-l-2 border-[var(--color-info,#8fb6ff)] bg-[var(--color-bg-subtle)] px-3 py-2.5">
        <p className="text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
          Éstas son las respuestas <b>del casino</b>: las escribís vos y se usan
          en cualquier canal. Las <b>plantillas de WhatsApp</b> son otra cosa —
          las aprueba Meta una por una y hacen falta para escribirle a alguien
          fuera de la ventana de 24 horas. Van a aparecer cuando WhatsApp esté
          conectado.
        </p>
      </div>

      {!creando ? (
        <button
          type="button"
          onClick={() => setCreando(true)}
          className="flex h-[36px] w-fit items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-[var(--color-accent-fg)]"
        >
          <Plus size={13} /> Nueva respuesta
        </button>
      ) : (
        <Editor
          onCancelar={() => setCreando(false)}
          onGuardar={async (datos) => {
            await createTemplate(datos.title, datos.body, datos.shortcut);
            setCreando(false);
            await cargar();
          }}
        />
      )}

      {error && (
        <p role="alert" className="text-[12px] text-[var(--color-warning)]">
          {error}
        </p>
      )}

      {cargando ? (
        <Loader2 size={16} className="animate-spin text-[var(--color-fg-subtle)]" />
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-[var(--color-fg-muted)]">
          Todavía no hay ninguna. La primera suele ser el alias para depositar.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {items.map((t) =>
            editando === t.id ? (
              <div key={t.id} className="sm:col-span-2">
                <Editor
                  inicial={t}
                  onCancelar={() => setEditando(null)}
                  onGuardar={async (datos) => {
                    await editarPlantilla(t.id, datos);
                    setEditando(null);
                    await cargar();
                  }}
                />
              </div>
            ) : (
              <Tarjeta
                key={t.id}
                plantilla={t}
                puedeEditar={puedeEditar}
                onEditar={() => setEditando(t.id)}
                onBorrado={cargar}
                onError={setError}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

function Tarjeta({
  plantilla,
  puedeEditar,
  onEditar,
  onBorrado,
  onError,
}: {
  plantilla: CrmTemplate;
  puedeEditar: boolean;
  onEditar: () => void;
  onBorrado: () => Promise<void>;
  onError: (m: string) => void;
}): React.ReactElement {
  const [borrando, setBorrando] = useState(false);

  const borrar = useCallback(async () => {
    // Se nombra la plantilla y se dice que la pierden todos: el catálogo es de
    // todo el casino, no de quien la borra.
    if (
      !window.confirm(
        `Borrar "${plantilla.title}"? Deja de estar disponible para todas las bandejas.`,
      )
    ) {
      return;
    }
    setBorrando(true);
    try {
      await deleteTemplate(plantilla.id);
      await onBorrado();
    } catch (err) {
      onError(mensaje(err));
    } finally {
      setBorrando(false);
    }
  }, [plantilla, onBorrado, onError]);

  return (
    <article className="flex flex-col gap-1.5 rounded-[13px] border border-[var(--color-border)] p-3">
      <div className="flex items-center gap-2">
        {plantilla.shortcut && (
          <span className="rounded-[7px] bg-[var(--color-bg-subtle)] px-1.5 py-px font-mono text-[11px] text-[var(--color-accent-text)]">
            {plantilla.shortcut}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--color-fg)]">
          {plantilla.title}
        </span>
        {puedeEditar && (
          <span className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onEditar}
              aria-label={`Editar ${plantilla.title}`}
              className="flex size-7 items-center justify-center rounded-[9px] text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              onClick={() => void borrar()}
              disabled={borrando}
              aria-label={`Borrar ${plantilla.title}`}
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
      <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--color-fg-muted)]">
        {plantilla.body}
      </p>
    </article>
  );
}

function Editor({
  inicial,
  onCancelar,
  onGuardar,
}: {
  inicial?: CrmTemplate;
  onCancelar: () => void;
  onGuardar: (datos: {
    title: string;
    body: string;
    shortcut: string | null;
  }) => Promise<void>;
}): React.ReactElement {
  const [title, setTitle] = useState(inicial?.title ?? '');
  const [body, setBody] = useState(inicial?.body ?? '');
  const [shortcut, setShortcut] = useState(inicial?.shortcut ?? '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = useCallback(async () => {
    if (!title.trim() || !body.trim() || guardando) return;
    setGuardando(true);
    setError(null);
    try {
      await onGuardar({
        title: title.trim(),
        body: body.trim(),
        // El atajo se guarda con la barra adelante aunque el operador no la
        // escriba: así es como después lo va a tipear en el compositor.
        shortcut: shortcut.trim()
          ? shortcut.trim().startsWith('/')
            ? shortcut.trim()
            : `/${shortcut.trim()}`
          : null,
      });
    } catch (err) {
      setError(mensaje(err));
    } finally {
      setGuardando(false);
    }
  }, [title, body, shortcut, guardando, onGuardar]);

  return (
    <div className="flex flex-col gap-2 rounded-[13px] border border-[var(--color-border-strong)] p-3">
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          placeholder="Título (ej. Alias para depositar)"
          className="h-[34px] flex-1 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 text-[12.5px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
        />
        <input
          value={shortcut}
          onChange={(e) => setShortcut(e.target.value)}
          placeholder="/alias"
          className="h-[34px] w-[110px] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 font-mono text-[12px] text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="El texto que se inserta en el mensaje"
        className="resize-y rounded-[10px] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-2.5 py-2 text-[12.5px] leading-relaxed text-[var(--color-fg)] outline-none focus:border-[var(--color-border-strong)]"
      />
      {error && (
        <p role="alert" className="text-[11.5px] text-[var(--color-warning)]">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void guardar()}
          disabled={guardando || !title.trim() || !body.trim()}
          className="flex h-[34px] items-center gap-1.5 rounded-[10px] bg-[var(--color-accent)] px-3 text-[12.5px] font-semibold text-[var(--color-accent-fg)] disabled:opacity-40"
        >
          {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          Guardar
        </button>
        <button
          type="button"
          onClick={onCancelar}
          className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[var(--color-border)] px-3 text-[12.5px] text-[var(--color-fg-muted)]"
        >
          <X size={13} /> Cancelar
        </button>
      </div>
    </div>
  );
}

function mensaje(err: unknown): string {
  const m = (err as { body?: { message?: string }; message?: string })?.body?.message;
  if (typeof m === 'string' && m) return m;
  return (err as { message?: string })?.message || 'No se pudo completar.';
}

