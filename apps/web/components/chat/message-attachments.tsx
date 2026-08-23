/**
 * MessageAttachments — render de los adjuntos dentro de una burbuja de chat.
 * Imágenes como miniatura (click → abre el original); PDF como chip con nombre.
 * Compartido por el widget del jugador y la bandeja del operador.
 */

import type { CSSProperties } from 'react';
import { FileText } from 'lucide-react';
import type { ChatAttachment } from '@/lib/chat/types';
import { formatBytes } from '@/lib/chat/upload';

export function MessageAttachments({
  attachments,
}: {
  attachments: ChatAttachment[];
}): React.ReactElement | null {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={wrapStyle}>
      {attachments.map((a, i) =>
        a.kind === 'image' && a.url ? (
          <a
            key={a.storageKey || i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'block', lineHeight: 0 }}
          >
            <img src={a.url} alt={a.name} style={imgStyle} />
          </a>
        ) : (
          <a
            key={a.storageKey || i}
            href={a.url}
            target="_blank"
            rel="noopener noreferrer"
            style={pdfChipStyle}
          >
            <FileText size={16} style={{ flexShrink: 0 }} />
            <span style={pdfNameStyle}>{a.name}</span>
            <span style={pdfSizeStyle}>{formatBytes(a.sizeBytes)}</span>
          </a>
        ),
      )}
    </div>
  );
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
};
const imgStyle: CSSProperties = {
  maxWidth: 190,
  maxHeight: 190,
  borderRadius: 10,
  objectFit: 'cover',
  border: '1px solid rgba(0,0,0,0.15)',
};
const pdfChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 10,
  background: 'var(--color-bg-subtle)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-fg)',
  textDecoration: 'none',
  maxWidth: 200,
};
const pdfNameStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const pdfSizeStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--color-fg-subtle)',
  flexShrink: 0,
};
