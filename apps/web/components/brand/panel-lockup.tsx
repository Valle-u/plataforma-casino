/**
 * PanelLockup — lockup horizontal de la marca del panel: Retícula + wordmark.
 *
 * Se usa como DEFAULT dentro del panel (sidebar / mobile-nav) cuando el
 * tenant/socio no subió su propio logo. Igual que `PanelMark`, es **siempre
 * monocromático** — la marca del producto, no la del cliente.
 */

import { cn } from '@/lib/cn';
import { PanelMark } from './panel-mark';

export function PanelLockup({
  markSize = 30,
  className,
}: {
  markSize?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <PanelMark size={markSize} />
      <div className="flex flex-col leading-none">
        <span
          className="font-display font-bold"
          style={{ fontSize: 15, color: '#fafafa', letterSpacing: '-0.01em' }}
        >
          Panel
        </span>
        <span
          className="font-mono"
          style={{
            fontSize: 9,
            letterSpacing: '0.2em',
            color: '#8a8a8a',
            marginTop: 2,
          }}
        >
          CONTROL
        </span>
      </div>
    </div>
  );
}
