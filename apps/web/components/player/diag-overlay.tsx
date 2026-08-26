'use client';

/**
 * DiagOverlay — TEMPORAL. `?diag=2` en la URL captura el flujo de navegación
 * (clicks reales, fetch de RSC, pushState, errores) y lo muestra en pantalla,
 * para diagnosticar el bug del "doble click" en la sesión real del usuario sin
 * usar la consola. REMOVER cuando esté resuelto.
 */

import { useEffect, useState } from 'react';

export function DiagOverlay() {
  const [on, setOn] = useState(false);
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('diag') !== '2') return;
    setOn(true);

    const buf: string[] = [];
    const push = (s: string) => {
      buf.push(s);
      if (buf.length > 14) buf.shift();
      setLines([...buf]);
    };
    // Agrupa errores idénticos en una sola línea con contador, para que no
    // tapen las líneas de click/pushState/PATH.
    const errCounts = new Map<string, number>();
    const errIndex = new Map<string, number>();
    const pushErr = (label: string) => {
      const n = (errCounts.get(label) ?? 0) + 1;
      errCounts.set(label, n);
      const line = `⚠ ×${n} ${label}`;
      if (errIndex.has(label)) {
        buf[errIndex.get(label)!] = line;
      } else {
        buf.push(line);
        if (buf.length > 14) buf.shift();
        // reindexar tras posible shift
        errIndex.forEach((_v, k) => {
          const idx = buf.findIndex((l) => l.includes(k));
          if (idx >= 0) errIndex.set(k, idx);
        });
        errIndex.set(label, buf.length - 1);
      }
      setLines([...buf]);
    };
    const base = (u?: string) => {
      if (!u) return '';
      try {
        return new URL(u).pathname.split('/').pop() || u;
      } catch {
        return u.split('/').pop() || u;
      }
    };
    push('DIAG listo v3. Tocá "Todos los juegos" UNA vez.');

    // fetch (RSC / navegación)
    const of = window.fetch;
    const patched: typeof window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url || String(input);
      const hdrs = (init?.headers || {}) as Record<string, string>;
      const isRSC =
        url.includes('_rsc') || !!hdrs['RSC'] || !!hdrs['rsc'] || !!hdrs['Next-Router-Prefetch'];
      const p = of(input, init);
      if (url.includes('/play') || isRSC) {
        p.then((r) =>
          push(`fetch ${r.status} ${r.headers.get('content-type')?.slice(0, 18)} ${shortUrl(url)}`),
        ).catch((e: unknown) => push('fetch ERROR ' + String(e).slice(0, 40)));
      }
      return p;
    };
    window.fetch = patched;

    // pushState
    const op = history.pushState.bind(history);
    history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
      push('pushState → ' + String(url));
      return op(data as never, unused, url as never);
    };

    // clicks
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const a = t.closest ? t.closest('a') : null;
      push(
        `click trusted=${e.isTrusted} tgt=${t.tagName} a=${a ? a.getAttribute('href') : '—'} prevented=${e.defaultPrevented}`,
      );
    };
    document.addEventListener('click', onClick, false);

    // Snapshot de hoistables del <head> gestionados por React (tag 26): dice
    // qué tipo de nodo churnea y si volvieron los iconos (= build viejo).
    const isReact = (n: Element) =>
      Object.keys(n).some((k) => k.startsWith('__react'));
    const snapHead = () => {
      const q = (sel: string) => Array.from(document.querySelectorAll(sel));
      const titles = q('title');
      const icons = q('link[rel~="icon"]');
      const rTitles = titles.filter(isReact);
      const rIcons = icons.filter(isReact);
      const orphans = [...q('title'), ...q('link'), ...q('meta')].filter(
        (n) => isReact(n) && !n.parentNode,
      ).length;
      return `HEAD t=${titles.length}(R${rTitles.length}) icon=${icons.length}(R${rIcons.length}) orphanR=${orphans}`;
    };
    let snappedOnErr = false;
    push(snapHead());
    const onErr = (e: ErrorEvent) => {
      const where = e.filename ? ` @${base(e.filename)}:${e.lineno}:${e.colno}` : '';
      pushErr(e.message + where);
      if (!snappedOnErr && /removeChild|null/.test(e.message)) {
        snappedOnErr = true;
        push('AT-ERR ' + snapHead());
      }
    };
    window.addEventListener('error', onErr);

    const onRej = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const msg = r && r.message ? r.message : String(r);
      const stackTop =
        r && r.stack ? ' « ' + String(r.stack).split('\n')[1]?.trim().slice(0, 60) : '';
      pushErr('REJECT ' + String(msg).slice(0, 70) + stackTop);
    };
    window.addEventListener('unhandledrejection', onRej);

    // heartbeat de pathname
    let last = location.pathname;
    const id = window.setInterval(() => {
      if (location.pathname !== last) {
        last = location.pathname;
        push('PATH ahora = ' + last);
      }
    }, 300);

    return () => {
      window.fetch = of;
      history.pushState = op;
      document.removeEventListener('click', onClick, false);
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
      window.clearInterval(id);
    };
  }, []);

  if (!on) return null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 6,
        left: 6,
        right: 6,
        zIndex: 2147483647,
        pointerEvents: 'none',
        background: 'rgba(0,0,0,0.9)',
        color: '#0f0',
        font: '11px/1.4 monospace',
        padding: '6px 8px',
        border: '2px solid #0f0',
        borderRadius: 6,
        whiteSpace: 'pre-wrap',
        maxHeight: '45vh',
        overflow: 'hidden',
      }}
    >
      {lines.join('\n')}
    </div>
  );
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u, location.origin);
    return url.pathname + (url.search ? '?' + url.search.slice(1, 12) : '');
  } catch {
    return u.slice(0, 40);
  }
}
