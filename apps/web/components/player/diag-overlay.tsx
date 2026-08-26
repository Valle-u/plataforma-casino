'use client';

/**
 * DiagOverlay — TEMPORAL. Se activa agregando `?diag=1` a la URL. Muestra en
 * pantalla qué elemento está "encima" en varios puntos y si hay algún overlay
 * grande interceptando clicks. pointer-events:none para no interferir. Sirve
 * para diagnosticar el bug del "doble click" en la sesión real del usuario.
 * REMOVER cuando esté resuelto.
 */

import { useEffect, useState } from 'react';

export function DiagOverlay() {
  const [on, setOn] = useState(false);
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('diag') !== '1') return;
    setOn(true);

    const desc = (n: Element | null): string => {
      if (!n) return 'null';
      const cs = getComputedStyle(n);
      const cls = String((n as HTMLElement).className || '')
        .split(' ')
        .filter(Boolean)
        .slice(0, 3)
        .join('.');
      const id = (n as HTMLElement).id ? '#' + (n as HTMLElement).id : '';
      return `${n.tagName}${id}.${cls} {${cs.position} z:${cs.zIndex} pe:${cs.pointerEvents}}`;
    };

    const run = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const pts: Record<string, [number, number]> = {
        centro: [W / 2, H / 2],
        arribaDer: [W - 40, 40],
        izq: [40, 220],
        abajo: [W / 2, H - 100],
      };
      const lines: string[] = [`vp ${W}x${H} · ${location.pathname}`];
      for (const k of Object.keys(pts)) {
        const [x, y] = pts[k]!;
        lines.push(`${k}: ${desc(document.elementFromPoint(x, y))}`);
      }
      const ov = Array.from(document.querySelectorAll('body *')).filter((e) => {
        const c = getComputedStyle(e);
        const r = e.getBoundingClientRect();
        return (
          (c.position === 'fixed' || c.position === 'absolute') &&
          r.width >= W * 0.5 &&
          r.height >= H * 0.5 &&
          c.pointerEvents !== 'none' &&
          c.display !== 'none' &&
          c.visibility !== 'hidden' &&
          r.left > -50 &&
          r.top > -50
        );
      });
      lines.push(`OVERLAYS grandes: ${ov.length}`);
      ov.slice(0, 5).forEach((e) => lines.push('  ' + desc(e)));
      setInfo(lines.join('\n'));
    };

    run();
    const id = window.setInterval(run, 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!on) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 2147483647,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.92)',
        color: '#0f0',
        font: '11px/1.45 monospace',
        padding: '8px 10px',
        border: '2px solid #0f0',
        borderRadius: 6,
        maxWidth: '92vw',
        whiteSpace: 'pre-wrap',
      }}
    >
      {info || 'diag…'}
    </div>
  );
}
