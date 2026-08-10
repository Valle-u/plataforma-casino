/**
 * /settings — Configuración del tenant (rail de secciones).
 *
 * Reemplaza al viejo page (agrupación por categoría) y absorbe el page
 * `(admin)/design` (que ahora redirige acá). Composición:
 *
 *   - Header: título + buscador global + Refresh + Preview en vivo.
 *   - Rail de secciones: Marca · Apariencia · Home del jugador ·
 *     Notificaciones · Antifraude · Palace · Tesorería y comisiones ·
 *     Sistema. Cada sección tiene su propio botón de guardado.
 *   - Buscador: filtra secciones y settings conocidos globalmente; al
 *     buscar, muestra resultados planos (filas + drawer de edición).
 *   - Sistema: operación del sitio (mantenimiento, registros, límites)
 *     + custom keys (JSON crudo) detrás del toggle "Avanzado".
 *
 * Todos los cambios pasan por PATCH /tenant/settings → audit + history.
 */

'use client';

import {
  BellRing,
  Coins,
  Dices,
  Eye,
  Globe,
  LayoutTemplate,
  Palette,
  RefreshCw,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { PushNotificationsToggle } from '@/components/push-notifications-toggle';
import { EditSettingDrawer } from '@/components/admin/edit-setting-drawer';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import {
  KNOWN_SETTINGS,
  useTenantSettings,
  type TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';
import { DesignPreview } from '@/components/admin/settings/design-preview';
import { ScalarSection } from '@/components/admin/settings/scalar-section';
import { SectionApariencia } from '@/components/admin/settings/section-apariencia';
import { SectionHome } from '@/components/admin/settings/section-home';
import { SectionMarca } from '@/components/admin/settings/section-marca';
import { SectionSistema } from '@/components/admin/settings/section-sistema';
import { SettingRow } from '@/components/admin/settings/settings-common';
import { useDesignEditor } from '@/components/admin/settings/use-design-editor';

type SectionId =
  | 'marca'
  | 'apariencia'
  | 'home'
  | 'notificaciones'
  | 'antifraude'
  | 'palace'
  | 'tesoreria'
  | 'sistema';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  icon: typeof Globe;
  description: string;
  keywords: string[];
}> = [
  {
    id: 'marca',
    label: 'Marca',
    icon: Globe,
    description: 'Nombre, tagline, logo y favicon.',
    keywords: ['marca', 'nombre', 'plataforma', 'logo', 'favicon', 'tagline'],
  },
  {
    id: 'apariencia',
    label: 'Apariencia',
    icon: Palette,
    description: 'Tema y paleta de colores del player.',
    keywords: ['apariencia', 'tema', 'colores', 'paleta', 'accent', 'theme', 'color'],
  },
  {
    id: 'home',
    label: 'Home del jugador',
    icon: LayoutTemplate,
    description: 'Carrusel de banners y textos.',
    keywords: ['home', 'banner', 'carrusel', 'slides', 'textos', 'hero'],
  },
  {
    id: 'notificaciones',
    label: 'Notificaciones',
    icon: BellRing,
    description: 'Canales de notificación.',
    keywords: ['notificaciones', 'email', 'sms', 'push', 'in-app'],
  },
  {
    id: 'antifraude',
    label: 'Antifraude',
    icon: ShieldCheck,
    description: 'Umbrales de detección de multi-cuentas.',
    keywords: ['antifraude', 'fraude', 'suspected', 'welcome block', 'umbral'],
  },
  {
    id: 'palace',
    label: 'Palace',
    icon: Dices,
    description: 'Integración con Palace Casino.',
    keywords: ['palace', 'api', 'token', 'idioma'],
  },
  {
    id: 'tesoreria',
    label: 'Tesorería y comisiones',
    icon: Coins,
    description: 'Mint mensual y costos de comisión.',
    keywords: ['tesoreria', 'mint', 'presupuesto', 'comisiones', 'costo bancario', 'plataforma'],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    icon: Server,
    description: 'Mantenimiento, registros, límites, custom keys.',
    keywords: ['sistema', 'mantenimiento', 'registro', 'deposito', 'retiro', 'minimo', 'retencion', 'history', 'custom', 'avanzado'],
  },
];

export default function SettingsPage() {
  const settings = useTenantSettings();
  const editor = useDesignEditor();

  const [activeSection, setActiveSection] = useState<SectionId>('apariencia');
  const [query, setQuery] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [searchEditKey, setSearchEditKey] = useState<string | null>(null);

  const settingsByKey = useMemo(() => {
    const map = new Map<string, TenantSettingRow>();
    for (const s of settings.data?.data ?? []) map.set(s.key, s);
    return map;
  }, [settings.data]);

  const metasByCategory = useMemo(() => {
    const map = new Map<string, typeof KNOWN_SETTINGS>();
    for (const m of KNOWN_SETTINGS) {
      const arr = map.get(m.category) ?? [];
      arr.push(m);
      map.set(m.category, arr);
    }
    return map;
  }, []);

  const q = query.trim().toLowerCase();
  const isSearching = q.length > 0;

  const matchingSections = useMemo(
    () =>
      SECTIONS.filter((s) => {
        const hay = [s.label, s.description, ...s.keywords].join(' ').toLowerCase();
        return hay.includes(q);
      }),
    [q],
  );

  const matchingSettings = useMemo(
    () =>
      KNOWN_SETTINGS.filter((m) => {
        const hay = [m.key, m.label, m.description, m.category].join(' ').toLowerCase();
        return hay.includes(q);
      }),
    [q],
  );

  const jumpToSection = (id: SectionId) => {
    setActiveSection(id);
    setQuery('');
  };

  return (
    <div className="p-6 lg:p-8 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <header className="flex flex-col gap-4 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-fg-muted)] font-medium flex items-center gap-2">
              <SettingsIcon className="size-3" />
              Sistema · Configuración
            </span>
            <h1 className="font-display text-3xl lg:text-[2.5rem] leading-none tracking-tight">
              Configuración del tenant
            </h1>
            <p className="text-sm text-[var(--color-fg-muted)] mt-1">
              Marca, apariencia, home, operación y límites. Cambios en audit + history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="md" onClick={() => settings.refetch()} disabled={settings.isFetching}>
              <RefreshCw className={cn('size-3.5', settings.isFetching && 'animate-spin')} />
              Refrescar
            </Button>
            <Button variant="secondary" size="md" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="size-3.5" />
              {showPreview ? 'Ocultar preview' : 'Preview'}
            </Button>
          </div>
        </div>

        {/* Buscador global */}
        <label className="flex h-10 min-w-0 max-w-[520px] items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 transition-colors duration-200 focus-within:border-[var(--color-accent-border)]">
          <Search size={15} className="shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar settings, secciones, keys…"
            aria-label="Buscar settings"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
            >
              limpiar
            </button>
          )}
        </label>
      </header>

      {/* Preview en vivo */}
      {showPreview && <DesignPreview editor={editor} />}

      {settings.isLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full bg-[var(--color-bg-subtle)]" />
          ))}
        </div>
      ) : settings.isError ? (
        <EmptyState
          hint="settings"
          label="No se pudieron cargar los settings."
          action={
            <Button variant="secondary" size="sm" onClick={() => settings.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : (
        <div className="flex gap-6 flex-col lg:flex-row items-start">
          {/* Rail de secciones */}
          <aside className="lg:w-72 w-full shrink-0 flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-4">
            <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
              {SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-2.5 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition-colors text-left whitespace-nowrap',
                    activeSection === section.id && !isSearching
                      ? 'bg-[var(--color-accent-subtle)] text-[var(--color-fg)]'
                      : 'text-[var(--color-fg-muted)] hover:bg-[var(--color-bg-subtle)]',
                  )}
                >
                  <section.icon className="size-4" />
                  {section.label}
                </button>
              ))}
            </div>
          </aside>

          {/* Contenido */}
          <div className="flex-1 min-w-0 w-full">
            {isSearching ? (
              <SearchResults
                q={q}
                sections={matchingSections}
                settings={matchingSettings}
                settingsByKey={settingsByKey}
                onJump={jumpToSection}
                onEdit={setSearchEditKey}
              />
            ) : (
              <ActiveSection
                id={activeSection}
                metasByCategory={metasByCategory}
                settingsByKey={settingsByKey}
                editor={editor}
              />
            )}
          </div>
        </div>
      )}

      <EditSettingDrawer
        settingKey={searchEditKey}
        open={!!searchEditKey}
        onOpenChange={(o) => !o && setSearchEditKey(null)}
        current={searchEditKey ? settingsByKey.get(searchEditKey) : undefined}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// ActiveSection
// ──────────────────────────────────────────────────────────────────────

function ActiveSection({
  id,
  metasByCategory,
  settingsByKey,
  editor,
}: {
  id: SectionId;
  metasByCategory: Map<string, typeof KNOWN_SETTINGS>;
  settingsByKey: Map<string, TenantSettingRow>;
  editor: ReturnType<typeof useDesignEditor>;
}) {
  const metas = (category: string) => metasByCategory.get(category) ?? [];
  switch (id) {
    case 'marca':
      return <SectionMarca editor={editor} />;
    case 'apariencia':
      return <SectionApariencia editor={editor} />;
    case 'home':
      return <SectionHome editor={editor} />;
    case 'notificaciones':
      return (
        <div className="flex flex-col gap-4">
          <ScalarSection
            title="Notificaciones"
            description="Master switches por canal. Si un canal está deshabilitado, el dispatcher lo saltea (las notifs quedan en pending)."
            metas={metas('Notificaciones')}
            settingsByKey={settingsByKey}
          />
          <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)]">
            <div className="px-4 py-2 border-b border-[var(--color-border)]">
              <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
                Notificaciones de este dispositivo
              </span>
            </div>
            <div className="px-4 py-3">
              <PushNotificationsToggle panel="admin" />
            </div>
          </section>
        </div>
      );
    case 'antifraude':
      return (
        <ScalarSection
          title="Antifraude"
          description="Umbrales del scan de multi-cuentas. El par de cuentas pasa a suspected/welcome-block según el score (0-100)."
          metas={metas('Antifraude')}
          settingsByKey={settingsByKey}
        />
      );
    case 'palace':
      return (
        <ScalarSection
          title="Palace"
          description="Integración con Palace Casino (agregador de juegos)."
          metas={metas('Palace')}
          settingsByKey={settingsByKey}
        />
      );
    case 'tesoreria':
      return (
        <ScalarSection
          title="Tesorería y comisiones"
          description="Tope mensual de mint de fichas y costos que el motor de comisiones deduce a los socios dependientes."
          metas={metas('Tesorería y comisiones')}
          settingsByKey={settingsByKey}
        />
      );
    case 'sistema':
      return <SectionSistema settingsByKey={settingsByKey} />;
  }
}

// ──────────────────────────────────────────────────────────────────────
// SearchResults
// ──────────────────────────────────────────────────────────────────────

function SearchResults({
  q,
  sections,
  settings,
  settingsByKey,
  onJump,
  onEdit,
}: {
  q: string;
  sections: typeof SECTIONS;
  settings: typeof KNOWN_SETTINGS;
  settingsByKey: Map<string, TenantSettingRow>;
  onJump: (id: SectionId) => void;
  onEdit: (key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
          Resultados para “{q}”
        </span>
        <span className="text-[11px] text-[var(--color-fg-subtle)]">
          {sections.length} sección(es) · {settings.length} setting(s)
        </span>
      </div>

      {sections.length === 0 && settings.length === 0 && (
        <EmptyState label="Sin resultados." hint="Probá con otro término." />
      )}

      {sections.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onJump(s.id)}
              className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs font-medium hover:border-[var(--color-accent-border)] transition-colors"
            >
              <s.icon className="size-3.5" />
              {s.label}
              <span className="text-[10px] text-[var(--color-fg-subtle)]">ir →</span>
            </button>
          ))}
        </div>
      )}

      {settings.length > 0 && (
        <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] overflow-x-auto">
          <div className="px-4 py-2 border-b border-[var(--color-border)]">
            <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
              Settings
            </span>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {settings.map((meta) => (
              <SettingRow
                key={meta.key}
                meta={meta}
                current={settingsByKey.get(meta.key)}
                onEdit={() => onEdit(meta.key)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
