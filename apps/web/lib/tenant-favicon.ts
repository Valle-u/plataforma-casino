/**
 * Favicon dinámico del tenant (Sprint 55.10).
 *
 * Chrome NO aplica un favicon inyectado dinámicamente cuando es WEBP:
 * lo descarga (200 OK) pero sigue mostrando el `<link rel="icon">` PNG
 * estático de la plataforma (la "T" rosa). Con un PNG (o PNG data URL)
 * sí lo aplica — verificado con headless Chrome contra el sitio real y
 * con reproducciones locales del head exacto.
 *
 * Solución: re-encodificar el favicon del tenant a PNG en el cliente
 * (fetch → ImageBitmap → canvas.toDataURL) e inyectarlo como data URL.
 * El atributo `sizes` no ayuda (probado); el PNG es la condición.
 * Si la conversión falla (ej. URL externa sin CORS), se deja la URL
 * original como fallback (comportamiento previo).
 */

const LINK_ATTR = 'data-tenant-branding';

// Token para descartar conversiones async obsoletas cuando el efecto se
// re-ejecuta con un favicon nuevo (evita que un run viejo pise el nuevo).
let applyToken = 0;

/**
 * Deja el <head> con UN SOLO <link rel="icon">: el que le pasamos. Borra
 * TODOS los icon links previos, incluidos los estáticos de la plataforma
 * (`/icons/icon-192.png`, `/icons/icon-512.png` que Next inyecta desde el
 * manifest/metadata). Es la corrección clave: cuando el favicon del tenant
 * convivía con esos estáticos —que declaran `sizes` explícito— Chrome elegía
 * los estáticos por sobre el inyectado (sin `sizes`), y la pestaña seguía
 * mostrando el favicon de la plataforma. Con un único icon link, Chrome no
 * tiene alternativa y aplica el nuestro. No toca el `<link rel="manifest">`,
 * así que los iconos de instalación PWA quedan intactos.
 */
function setSoleIconLink(href: string): void {
  const head = document.head;
  // ⚠️ NUNCA remover <link rel="icon"> que React 19 iza y trackea (los tags
  // HostHoistable, fiber tag 26 — p.ej. los de `metadata.icons` de Next). Se
  // reconocen porque el nodo tiene keys internas `__reactFiber$/__reactMarker$`.
  // Si los sacamos con `.remove()`, el fiber de React queda apuntando a un nodo
  // con `parentNode === null`; en la próxima navegación React limpia ese
  // hoistable con `stateNode.parentNode.removeChild(...)` → "Cannot read
  // properties of null (reading 'removeChild')" EN LOOP, lo que congela el
  // commit del render (bug del "doble click" / dropdowns que no abren).
  // Solo removemos icon-links que NO son de React (el nuestro previo —marcado—
  // y cualquier estático no gestionado por React). Ver docs/DEVLOG.md.
  head
    .querySelectorAll<HTMLLinkElement>('link[rel~="icon"], link[rel="shortcut icon"]')
    .forEach((l) => {
      const reactManaged = Object.keys(l).some((k) => k.startsWith('__react'));
      if (!reactManaged) l.remove();
    });
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = href.startsWith('data:image/png') || /\.png$/i.test(href)
    ? 'image/png'
    : '';
  link.setAttribute('sizes', 'any');
  link.setAttribute(LINK_ATTR, '1');
  link.href = href;
  head.appendChild(link);
}

function isPng(url: string): boolean {
  return /\.png$/i.test(url) || url.startsWith('data:image/png');
}

async function toPngDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    try {
      // Chrome rechaza favicons data URL inyectados dinámicamente cuando
      // superan cierto tamaño (probado: 256px falla, 192px aplica). Cap 128
      // queda holgado y sobra calidad para una pestaña (~16-32px).
      const scale = Math.min(128 / bmp.width, 128 / bmp.height, 1);
      const width = Math.max(1, Math.round(bmp.width * scale));
      const height = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bmp, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    } finally {
      bmp.close();
    }
  } catch {
    return null;
  }
}

/**
 * Reemplaza el favicon del tenant en <head> (recrea el link en cada run
 * para que Chrome detecte la mutación). Si el favicon no es PNG, lo
 * convierte a PNG data URL antes de inyectarlo.
 */
export function applyTenantFavicon(faviconUrl: string): void {
  const token = ++applyToken;
  void (async () => {
    let href = faviconUrl;
    if (!isPng(faviconUrl)) {
      const converted = await toPngDataUrl(faviconUrl);
      if (token !== applyToken) return;
      if (converted) href = converted;
    }
    if (token !== applyToken) return;
    setSoleIconLink(href);
  })();
}

/**
 * Dibuja la Retícula (marca del panel) en un canvas y devuelve un PNG data URL.
 * Se dibuja en vez de cargar un SVG porque Chrome ignora los favicons SVG
 * inyectados dinámicamente y `createImageBitmap` no decodifica el blob SVG;
 * un PNG dibujado siempre se aplica. Los puntos exteriores van más claros que
 * en el logo on-screen (#3d3d3d) para que la grilla se lea a 16-32px.
 */
function drawPanelFaviconPng(): string | null {
  try {
    const S = 64;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const r = S * 0.22;
    const rr = (x: number, y: number, w: number, h: number, rad: number) => {
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, rad);
      } else {
        ctx.beginPath();
        ctx.rect(x, y, w, h);
      }
    };
    ctx.fillStyle = '#141414';
    rr(0, 0, S, S, r);
    ctx.fill();
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = S * 0.03;
    rr(S * 0.015, S * 0.015, S * 0.97, S * 0.97, r);
    ctx.stroke();
    const pos = [S * 0.28, S * 0.5, S * 0.72];
    for (let iy = 0; iy < 3; iy++) {
      for (let ix = 0; ix < 3; ix++) {
        const center = ix === 1 && iy === 1;
        ctx.fillStyle = center ? '#fafafa' : '#7a7a7a';
        ctx.beginPath();
        ctx.arc(pos[ix]!, pos[iy]!, center ? S * 0.097 : S * 0.075, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/**
 * Aplica el favicon FIJO del panel (la Retícula del producto), NO el del tenant.
 * Comparte el slot `data-tenant-branding` con `applyTenantFavicon`, así que al
 * entrar al panel PISA cualquier favicon de tenant y viceversa (mutuamente
 * excluyentes en una misma sesión SPA).
 */
export function applyPanelFavicon(): void {
  if (typeof document === 'undefined') return;
  ++applyToken; // invalida cualquier conversión async de favicon de tenant en curso
  const href = drawPanelFaviconPng();
  if (!href) return;
  setSoleIconLink(href);
}
