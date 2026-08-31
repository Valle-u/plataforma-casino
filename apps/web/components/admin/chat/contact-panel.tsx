/**
 * ContactPanel — panel lateral del operador con el CONTEXTO del contacto:
 * identidad + saldo + upline + últimos movimientos, tags y notas internas.
 * Se muestra al lado del hilo en la bandeja. Datos por HTTP (crm-api).
 * Ver docs/22 §4.2.
 */

'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  Plus,
  StickyNote,
  Tag as TagIcon,
  Wallet,
  X,
} from 'lucide-react';
import { currencyLabel } from '@/lib/format-currency';
import type { ContactContext, CrmNote, CrmTag } from '@/lib/chat/types';
import {
  addContactNote,
  assignContactTag,
  createTag,
  getContactContext,
  listContactNotes,
  listContactTags,
  listTagCatalog,
  unassignContactTag,
} from '@/lib/chat/crm-api';

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export function ContactPanel({
  contactId,
  fullWidth = false,
}: {
  contactId: string;
  /** Mobile: ocupa todo el ancho (sin borde lateral), como pantalla propia. */
  fullWidth?: boolean;
}): React.ReactElement {
  // Estilo raíz: panel lateral (desktop) o pantalla completa (mobile).
  const root: CSSProperties = fullWidth
    ? {
        ...panelStyle,
        width: '100%',
        flex: 1,
        minHeight: 0,
        borderLeft: 'none',
      }
    : panelStyle;
  const [ctx, setCtx] = useState<ContactContext | null>(null);
  const [tags, setTags] = useState<CrmTag[]>([]);
  const [catalog, setCatalog] = useState<CrmTag[]>([]);
  const [notes, setNotes] = useState<CrmNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [busyNote, setBusyNote] = useState(false);
  const [showTagAdd, setShowTagAdd] = useState(false);
  const [newTag, setNewTag] = useState('');
  const reqId = useRef(0);

  const load = useCallback(async () => {
    const my = ++reqId.current;
    setLoading(true);
    setError(false);
    try {
      const [c, t, notesRes] = await Promise.all([
        getContactContext(contactId),
        listContactTags(contactId),
        listContactNotes(contactId),
      ]);
      if (my !== reqId.current) return; // llegó una carga más nueva
      setCtx(c);
      setTags(t);
      setNotes(notesRes);
    } catch {
      if (my === reqId.current) setError(true);
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTagAdd = useCallback(async () => {
    setShowTagAdd((v) => !v);
    try {
      setCatalog(await listTagCatalog());
    } catch {
      /* noop */
    }
  }, []);

  const assign = useCallback(
    async (tagId: string) => {
      try {
        await assignContactTag(contactId, tagId);
        setTags(await listContactTags(contactId));
      } catch {
        /* noop */
      }
    },
    [contactId],
  );

  const unassign = useCallback(
    async (tagId: string) => {
      setTags((prev) => prev.filter((t) => t.id !== tagId));
      try {
        await unassignContactTag(contactId, tagId);
      } catch {
        void load();
      }
    },
    [contactId, load],
  );

  const createAndAssign = useCallback(async () => {
    const label = newTag.trim();
    if (!label) return;
    try {
      const tag = await createTag(label);
      await assignContactTag(contactId, tag.id);
      setNewTag('');
      setCatalog(await listTagCatalog());
      setTags(await listContactTags(contactId));
    } catch {
      /* noop */
    }
  }, [newTag, contactId]);

  const addNote = useCallback(async () => {
    const body = noteDraft.trim();
    if (!body || busyNote) return;
    setBusyNote(true);
    try {
      const note = await addContactNote(contactId, body);
      setNotes((prev) => [note, ...prev]);
      setNoteDraft('');
    } catch {
      /* noop */
    } finally {
      setBusyNote(false);
    }
  }, [noteDraft, busyNote, contactId]);

  if (loading && !ctx) {
    return (
      <div style={{ ...root, ...centerStyle }}>
        <Loader2 size={20} className="animate-spin" style={{ opacity: 0.5 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ ...root, ...centerStyle }}>
        <span style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
          No se pudo cargar el contexto.
        </span>
      </div>
    );
  }

  const identity = ctx?.identity;
  const catalogUnassigned = catalog.filter(
    (c) => !tags.some((t) => t.id === c.id),
  );

  // Movimientos unificados (depósitos + retiros) ordenados por fecha, más nuevos
  // primero — una sola lista cronológica en vez de dos separadas.
  const movements = [
    ...(ctx?.recentDeposits ?? []).map((m) => ({
      ...m,
      type: 'deposit' as const,
    })),
    ...(ctx?.recentWithdrawals ?? []).map((m) => ({
      ...m,
      type: 'withdrawal' as const,
    })),
  ]
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 8);

  return (
    <div style={root}>
      {/* Identidad */}
      <section style={sectionStyle}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          {identity?.displayName ||
            identity?.username ||
            ctx?.contact.displayName ||
            (ctx?.contact.isLead ? 'Lead' : 'Contacto')}
        </div>
        {identity?.username && (
          <div style={mutedSm}>@{identity.username}</div>
        )}
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(identity?.email || ctx?.contact.email) && (
            <div style={mutedSm}>{identity?.email ?? ctx?.contact.email}</div>
          )}
          {(identity?.phone || ctx?.contact.phone) && (
            <div style={mutedSm}>{identity?.phone ?? ctx?.contact.phone}</div>
          )}
          {ctx?.upline && (
            <div style={mutedSm}>Operador: {ctx.upline.username}</div>
          )}
          {identity && (
            <div style={mutedSm}>
              Alta: {fmtDate(identity.createdAt)} · {identity.status}
            </div>
          )}
        </div>
      </section>

      {/* Saldo */}
      {ctx?.wallet && (
        <section style={sectionStyle}>
          <div style={labelRow}>
            <Wallet size={14} /> Saldo
          </div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {ctx.wallet.balance} {currencyLabel(ctx.wallet.currency)}
          </div>
          {Number(ctx.wallet.lockedBalance) > 0 && (
            <div style={mutedSm}>Retenido: {ctx.wallet.lockedBalance}</div>
          )}
        </section>
      )}

      {/* Movimientos (depósitos + retiros, cronológico) */}
      {movements.length > 0 && (
        <section style={sectionStyle}>
          <div style={labelRow}>Movimientos</div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              marginTop: 6,
            }}
          >
            {movements.map((m) => (
              <div key={`${m.type}-${m.id}`} style={movRow}>
                {m.type === 'deposit' ? (
                  <ArrowDownToLine
                    size={13}
                    style={{ color: 'var(--color-success)', flexShrink: 0 }}
                  />
                ) : (
                  <ArrowUpFromLine
                    size={13}
                    style={{ color: 'var(--color-warning)', flexShrink: 0 }}
                  />
                )}
                <span style={{ fontWeight: 600 }}>{m.amountChips}</span>
                <span
                  style={{
                    ...mutedSm,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {m.status}
                </span>
                <span style={mutedSm}>{fmtDate(m.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Tags */}
      <section style={sectionStyle}>
        <div style={labelRow}>
          <TagIcon size={14} /> Tags
          <button onClick={() => void openTagAdd()} style={addChipBtn} aria-label="Agregar tag">
            <Plus size={13} />
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          {tags.length === 0 && !showTagAdd && (
            <span style={mutedSm}>Sin tags.</span>
          )}
          {tags.map((t) => (
            <span
              key={t.id}
              style={{
                ...tagChip,
                background: t.color ? `${t.color}22` : 'var(--color-bg-subtle)',
                borderColor: t.color ?? 'var(--color-border)',
              }}
            >
              {t.label}
              <button
                onClick={() => void unassign(t.id)}
                style={tagRemoveBtn}
                aria-label={`Quitar ${t.label}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        {showTagAdd && (
          <div style={tagAddBox}>
            {catalogUnassigned.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                {catalogUnassigned.map((c) => (
                  <button key={c.id} onClick={() => void assign(c.id)} style={catalogChip}>
                    <Plus size={11} /> {c.label}
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createAndAssign();
                }}
                placeholder="Nuevo tag…"
                style={tagInput}
              />
              <button onClick={() => void createAndAssign()} style={smallBtn}>
                Crear
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Notas */}
      <section style={{ ...sectionStyle, borderBottom: 'none', flex: 1 }}>
        <div style={labelRow}>
          <StickyNote size={14} /> Notas internas
        </div>
        <div style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void addNote();
              }
            }}
            placeholder="Agregar una nota (privada)…"
            rows={2}
            style={noteInput}
          />
        </div>
        <button
          onClick={() => void addNote()}
          disabled={!noteDraft.trim() || busyNote}
          style={{
            ...smallBtn,
            alignSelf: 'flex-start',
            opacity: !noteDraft.trim() || busyNote ? 0.5 : 1,
          }}
        >
          Agregar nota
        </button>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {notes.map((n) => (
            <div key={n.id} style={noteCard}>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {n.body}
              </div>
              <div style={{ ...mutedSm, marginTop: 4 }}>{fmtDate(n.createdAt)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ── Estilos ──────────────────────────────────────────────────────────────
const panelStyle: CSSProperties = {
  width: 300,
  flexShrink: 0,
  borderLeft: '1px solid var(--color-border)',
  background: 'var(--color-bg-subtle)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
};
const centerStyle: CSSProperties = {
  alignItems: 'center',
  justifyContent: 'center',
};
const sectionStyle: CSSProperties = {
  padding: '12px 14px',
  borderBottom: '1px solid var(--color-border)',
};
const labelRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const mutedSm: CSSProperties = { fontSize: 12, color: 'var(--color-fg-subtle)' };
const movRow: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
};
const tagChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 6px 3px 9px',
  borderRadius: 12,
  border: '1px solid var(--color-border)',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--color-fg)',
};
const tagRemoveBtn: CSSProperties = {
  display: 'flex',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-fg-muted)',
  cursor: 'pointer',
  padding: 0,
};
const addChipBtn: CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg-muted)',
  cursor: 'pointer',
};
const tagAddBox: CSSProperties = {
  marginTop: 8,
  padding: 8,
  borderRadius: 8,
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
};
const catalogChip: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  padding: '3px 8px',
  borderRadius: 12,
  border: '1px dashed var(--color-border)',
  background: 'transparent',
  color: 'var(--color-fg-muted)',
  fontSize: 12,
  cursor: 'pointer',
};
const tagInput: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-subtle)',
  color: 'var(--color-fg)',
  fontSize: 13,
  outline: 'none',
};
const smallBtn: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--color-accent)',
  color: 'var(--color-accent-fg, #fff)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};
const noteInput: CSSProperties = {
  flex: 1,
  resize: 'none',
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg)',
  color: 'var(--color-fg)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
};
const noteCard: CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border)',
};
