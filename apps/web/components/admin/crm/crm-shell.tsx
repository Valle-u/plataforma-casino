/**
 * El shell del CRM — topbar, menú lateral y barra inferior en mobile.
 *
 * Reemplaza al shell del panel cuando se entra por `crm.` / `crm-`. No lo
 * decora: es **otra estructura**.
 *
 * ## Alto fijo, no scroll de página
 *
 * El panel scrollea con el body: el contenido es tan largo como sea y la página
 * crece. El CRM no puede hacer eso. Su pantalla principal son tres columnas que
 * scrollean **por separado** —la lista de conversaciones, el hilo y la ficha—,
 * y para eso el shell tiene que ocupar exactamente la altura de la ventana y no
 * un píxel más.
 *
 * De ahí `h-[100dvh]` y `overflow-hidden` acá arriba: cada panel de adentro se
 * encarga de su propio scroll. `dvh` y no `vh` porque en mobile la barra del
 * navegador entra y sale, y con `vh` el compositor de mensajes queda tapado.
 *
 * ## El acento sale del tenant, no está cableado
 *
 * El handoff fija lima `#c9f24d` para los botones de acción. Acá se usa
 * `--color-accent`, que el layout del panel resuelve en runtime desde el color
 * de marca del casino (`branding.primaryColor`), con un neutro de fallback.
 *
 * La plataforma es white-label: el logo, el nombre y los colores son de cada
 * casino. Cablear el lima haría del CRM **el único lugar con una marca ajena
 * pegada**, y el propio handoff pide que el logo sea el del tenant. El lima
 * queda como lo que era: el color del casino que se usó para diseñar.
 *
 * ## Lo que este archivo NO decide
 *
 * Qué secciones existen y en qué orden: eso está en `lib/crm/secciones.ts`,
 * junto con el porqué de las que se muestran apagadas.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  BarChart3,
  Contact,
  Database,
  GitBranch,
  Megaphone,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Settings,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  GRUPOS_DEL_CRM,
  TABBAR_MOBILE,
  esSeccionActiva,
  type SeccionDelCrm,
} from '@/lib/crm/secciones';

/**
 * Los íconos que pide el diseño, por nombre.
 *
 * Se importan uno por uno y no con el paquete entero: `lucide-react` trae más
 * de mil, y un import dinámico por nombre se los lleva todos al bundle.
 */
const ICONOS: Record<string, LucideIcon> = {
  'messages-square': MessagesSquare,
  contact: Contact,
  'git-branch': GitBranch,
  database: Database,
  megaphone: Megaphone,
  zap: Zap,
  'bar-chart-3': BarChart3,
  plug: Plug,
  settings: Settings,
};

/** Dónde se guarda si el menú quedó colapsado. */
const CLAVE_LAYOUT = 'crm.app.layout';

export function CrmShell({ children }: { children: ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const [colapsado, setColapsado] = useState(false);
  const esLaBandeja = pathname === '/support';

  // Se lee después de montar y no en el estado inicial: `localStorage` no
  // existe en el servidor, y sembrarlo desde ahí rompería la hidratación.
  // El menú arranca abierto y se cierra en el mismo frame si así quedó.
  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CLAVE_LAYOUT);
      if (!guardado) return;
      const layout = JSON.parse(guardado) as { nav?: boolean };
      if (layout.nav === false) setColapsado(true);
    } catch {
      /* sin localStorage, o con basura adentro: el menú abierto está bien */
    }
  }, []);

  const alternarMenu = useCallback(() => {
    setColapsado((antes) => {
      const ahora = !antes;
      try {
        const crudo = window.localStorage.getItem(CLAVE_LAYOUT);
        const layout = crudo ? (JSON.parse(crudo) as Record<string, unknown>) : {};
        window.localStorage.setItem(
          CLAVE_LAYOUT,
          // Se conserva lo que hayan guardado las columnas de la bandeja: este
          // botón sabe del menú y de nada más.
          JSON.stringify({ ...layout, nav: !ahora }),
        );
      } catch {
        /* que no se pueda recordar no es motivo para que no se pueda cerrar */
      }
      return ahora;
    });
  }, []);

  return (
    <div className="admin-neutral flex h-[100dvh] flex-col overflow-hidden bg-[var(--color-bg)]">
      <a href="#crm-main" className="skip-to-content">
        Saltar al contenido
      </a>

      <TopbarDelCrm colapsado={colapsado} onAlternar={alternarMenu} />

      <div className="flex min-h-0 flex-1">
        <MenuLateral colapsado={colapsado} pathname={pathname} />
        {/*
          El scroll vive acá, no en el body.

          Las secciones normales (Canales, Configuración) son una página larga y
          scrollean adentro de este main. La bandeja, en cambio, se planta en
          `h-full` y no lo hace scrollear nunca: sus tres columnas manejan su
          propio scroll por separado, que es justamente lo que el alto fijo del
          shell viene a habilitar.

          El padding horizontal lo decide el shell y no cada página, porque las
          páginas se comparten con el host del panel —`/support` también existe
          en `admin.`— y allá el `<main>` del panel ya lo pone. Si lo pusieran
          ellas, se duplicaría de un lado y faltaría del otro.

          La bandeja es la excepción: va de borde a borde.
        */}
        <main
          id="crm-main"
          className={cn(
            'min-w-0 flex-1 overflow-y-auto',
            !esLaBandeja && 'px-4 sm:px-6 lg:px-8',
          )}
        >
          {children}
        </main>
      </div>

      <TabbarMobile pathname={pathname} />
    </div>
  );
}

/** Topbar de 58px: marca, título de la sección y el botón de colapsar. */
function TopbarDelCrm({
  colapsado,
  onAlternar,
}: {
  colapsado: boolean;
  onAlternar: () => void;
}): React.ReactElement {
  return (
    <header className="flex h-[58px] shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4">
      <button
        type="button"
        onClick={onAlternar}
        aria-label={colapsado ? 'Abrir el menú' : 'Cerrar el menú'}
        className="hidden size-9 items-center justify-center rounded-[11px] text-[var(--color-fg-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)] md:inline-flex"
      >
        {colapsado ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
      </button>

      <div className="flex items-baseline gap-2">
        <span className="font-display text-[15px] font-bold tracking-tight text-[var(--color-fg)]">
          CRM
        </span>
        {/* El punto separador es del diseño; en mobile no entra. */}
        <span className="hidden text-[12.5px] text-[var(--color-fg-subtle)] sm:inline">
          · Atención
        </span>
      </div>
    </header>
  );
}

/** Menú lateral de 238px, o riel de 56px cuando está colapsado. */
function MenuLateral({
  colapsado,
  pathname,
}: {
  colapsado: boolean;
  pathname: string;
}): React.ReactElement {
  return (
    <nav
      aria-label="Secciones del CRM"
      className={cn(
        'hidden shrink-0 flex-col gap-4 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-4 transition-[width] duration-150 md:flex',
        colapsado ? 'w-[56px] px-2' : 'w-[238px] px-3',
      )}
    >
      {GRUPOS_DEL_CRM.map((grupo) => (
        <div key={grupo.titulo} className="flex flex-col gap-1">
          {/* Colapsado no hay ancho para el encabezado, pero el grupo se sigue
              distinguiendo por el espacio entre bloques. */}
          {!colapsado && (
            <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-fg-subtle)]">
              {grupo.titulo}
            </div>
          )}
          {grupo.items.map((item) => (
            <ItemDeMenu
              key={item.href}
              item={item}
              colapsado={colapsado}
              activo={esSeccionActiva(item.href, pathname)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * Un ítem del menú.
 *
 * Si la sección todavía no existe se pinta apagada y **no es un link**: un link
 * muerto promete algo que no está. El `title` explica por qué está en gris, así
 * que no hay que adivinarlo.
 */
function ItemDeMenu({
  item,
  colapsado,
  activo,
}: {
  item: SeccionDelCrm;
  colapsado: boolean;
  activo: boolean;
}): React.ReactElement {
  const Icono = ICONOS[item.icono] ?? MessagesSquare;

  const clases = cn(
    'flex h-[38px] items-center gap-2.5 rounded-[11px] text-[13px] transition-colors',
    colapsado ? 'justify-center px-0' : 'px-2.5',
    activo
      ? 'bg-[var(--color-bg-active,#1c1c1c)] font-semibold text-[var(--color-fg)]'
      : 'font-normal text-[var(--color-fg-muted)]',
  );

  if (!item.lista) {
    return (
      <div
        className={cn(clases, 'cursor-default opacity-40')}
        title={`${item.label} — todavía no está construida`}
        aria-disabled="true"
      >
        <Icono size={16} className="shrink-0" />
        {!colapsado && <span className="truncate">{item.label}</span>}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(clases, 'hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-fg)]')}
      aria-current={activo ? 'page' : undefined}
      title={colapsado ? item.label : undefined}
    >
      <Icono size={16} className="shrink-0" />
      {!colapsado && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/**
 * Barra inferior en pantallas de menos de 760px.
 *
 * Abajo de ese ancho no hay lugar para 238px de menú al lado de una
 * conversación, así que el menú lateral desaparece por completo.
 */
function TabbarMobile({ pathname }: { pathname: string }): React.ReactElement {
  return (
    <nav
      aria-label="Secciones del CRM"
      className="flex shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg-elevated)] md:hidden"
    >
      {TABBAR_MOBILE.map((item) => {
        const Icono = ICONOS[item.icono] ?? MessagesSquare;
        const activo = esSeccionActiva(item.href, pathname);
        const contenido = (
          <>
            <Icono size={18} />
            <span className="text-[10px] font-medium">{item.label}</span>
          </>
        );
        // 52px de alto: el mínimo cómodo para tocar con el pulgar.
        const clases = cn(
          'flex h-[52px] flex-1 flex-col items-center justify-center gap-1',
          activo ? 'text-[var(--color-accent-text)]' : 'text-[var(--color-fg-muted)]',
        );
        return item.lista ? (
          <Link key={item.href} href={item.href} className={clases} aria-current={activo ? 'page' : undefined}>
            {contenido}
          </Link>
        ) : (
          <div key={item.href} className={cn(clases, 'opacity-40')} aria-disabled="true">
            {contenido}
          </div>
        );
      })}
    </nav>
  );
}
