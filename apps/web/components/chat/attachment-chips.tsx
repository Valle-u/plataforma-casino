/**
 * AttachmentChips — preview de los adjuntos PENDIENTES en el composer (antes de
 * mandar), con botón para quitar cada uno. Compartido por widget y bandeja.
 */

'use client';

import type { CSSProperties } from 'react';
import { FileText, X } from 'lucide-react';
import type { ChatAttachment } from '@/lib/chat/types';

export function AttachmentChips({
  attachments,
  uploading,
  onRemove,
}: {
  attachments: ChatAttachment[];
  uploading?: boolean;
  onRemove: (storageKey: string) => void;
}): React.ReactElement | null {
  if (attachments.length === 0 && !uploading) return null;
  return (
    <div style={wrapStyle}>
      {attachments.map((a) => (
        <div key={a.storageKey} style={chipStyle}>
          {a.kind === 'image' && a.url ? (
            <img src={a.url} alt={a.name} style={thumbStyle} />
          ) : (
            <FileText size={14} style={{ flexShrink: 0 }} />
          )}
          <span style={nameStyle}>{a.name}</span>
          <button
            type="button"
            onClick={() => onRemove(a.storageKey)}
            aria-label={`Quitar ${a.name}`}
            style={removeBtnStyle}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {uploading && <div style={{ ...chipStyle, ...nameStyle }}>Subiendo…</div>}
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  padding: '0 2px 6px',
};
const chipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px 4px 8px',
  borderRadius: 8,
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-border)',
  maxWidth: 180,
};
const thumbStyle: CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 4,
  objectFit: 'cover',
  flexShrink: 0,
};
const nameStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-fg)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const removeBtnStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: 'none',
  color: 'var(--color-fg-muted)',
  cursor: 'pointer',
  padding: 0,
  flexShrink: 0,
};
