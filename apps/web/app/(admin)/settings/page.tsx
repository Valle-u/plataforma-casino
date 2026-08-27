/**
 * /settings — Configuración del tenant (rail de secciones).
 *
 * Reemplaza al viejo page (agrupación por categoría) y absorbe el page
 * `(admin)/design` (que ahora redirige acá). Composición:
 *
 *   - Header: título + buscador global + Refresh + Preview en vivo.
 *   - Rail de secciones: Marca · Apariencia · Home del jugador ·
 *     Notificaciones · Antifraude · Sistema. Cada sección tiene su
 *     propio botón de guardado.
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
  Eye,
  Globe,
  Layers,
  LayoutGrid,
  LayoutTemplate,
  Monitor,
  Palette,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { EditSettingDrawer } from '@/components/admin/edit-setting-drawer';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { HelpNote } from '@/components/ui/help-note';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { hasPermission, useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/cn';
import {
  KNOWN_SETTINGS,
  useTenantSettings,
  type TenantSettingRow,
} from '@/lib/hooks/use-tenant-settings';
import { DesignPreview } from '@/components/admin/settings/design-preview';
import { ScalarSection } from '@/components/admin/settings/scalar-section';
import { SectionApariencia } from '@/components/admin/settings/section-apariencia';
import { SectionAparienciaPanel } from '@/components/admin/settings/section-apariencia-panel';
import { SectionHome } from '@/components/admin/settings/section-home';
import { SectionMarca } from '@/components/admin/settings/section-marca';
import { SectionSistema } from '@/components/admin/settings/section-sistema';
import { SectionPermisos } from '@/components/admin/settings/section-permisos';
import { SectionPlantillas } from '@/components/admin/settings/section-plantillas';
import { SectionNotificacionesEnviadas } from '@/components/admin/settings/section-notificaciones-enviadas';
import { SettingRow } from '@/components/admin/settings/settings-common';
import { useDesignEditor } from '@/components/admin/settings/use-design-editor';

type SectionId =
  | 'marca'
  | 'apariencia'
  | 'apariencia-panel'
  | 'home'
  | 'notificaciones'
  | 'antifraude'
  | 'sistema'
  | 'permisos'
  | 'plantillas'
  | 'enviadas';

const SECTIONS: Array<{
  id: SectionId;
  label: string;
  icon: typeof Globe;
  description: string;
  keywords: string[];
  /** Si está, la sección solo aparece si el user tiene alguno de estos permisos. */
  perm?: string[];
}> = [
  {
    id: 'marca',
    label: 'Marca',
    icon: Globe,
    description: 'El nombre, la frase y el logo que ven los jugadores.',
    keywords: ['marca', 'nombre', 'plataforma', 'logo', 'favicon', 'tagline', 'frase'],
  },
  {
    id: 'apariencia',
    label: 'Apariencia',
    icon: Palette,
    description: 'Los colores y el estilo que ve el jugador.',
    keywords: ['apariencia', 'tema', 'colores', 'paleta', 'accent', 'theme', 'color'],
  },
  {
    id: 'apariencia-panel',
    label: 'Apariencia del panel',
    icon: Monitor,
    description: 'Los colores del panel de control (lo que ves vos y tu equipo).',
    keywords: ['apariencia', 'panel', 'admin', 'colores', 'tema', 'fondo', 'acento', 'control'],
    perm: ['tenant.settings.edit'],
  },
  {
    id: 'home',
    label: 'Home del jugador',
    icon: LayoutTemplate,
    description: 'Los banners grandes y los textos de la portada.',
    keywords: ['home', 'banner', 'carrusel', 'slides', 'textos', 'hero'],
  },
  {
    id: 'notificaciones',
    label: 'Canales de notificación',
    icon: BellRing,
    description: 'Cómo avisarle al jugador: email, push y SMS.',
    keywords: ['notificaciones', 'canales', 'email', 'sms', 'push', 'in-app'],
  },
  {
    id: 'plantillas',
    label: 'Plantillas',
    icon: LayoutGrid,
    description: 'Los textos de los avisos que recibe el jugador.',
    keywords: ['plantillas', 'textos', 'mensajes', 'notificaciones', 'asunto', 'cuerpo'],
    perm: ['tenant.notifications.templates.edit'],
  },
  {
    id: 'enviadas',
    label: 'Notificaciones enviadas',
    icon: BellRing,
    description: 'El registro de todos los avisos enviados; reintentá los que fallaron.',
    keywords: ['notificaciones', 'enviadas', 'registro', 'cola', 'reintentar', 'fallidas'],
    perm: ['notifications.view_any', 'notifications.export', 'notifications.retry'],
  },
  {
    id: 'permisos',
    label: 'Permisos',
    icon: Layers,
    description: 'Otorgá o quitá permisos puntuales a un usuario.',
    keywords: ['permisos', 'usuario', 'otorgar', 'revocar', 'override', 'rol'],
    perm: ['permissions.grant', 'permissions.revoke'],
  },
  {
    id: 'antifraude',
    label: 'Antifraude',
    icon: ShieldCheck,
    description: 'Detección de cuentas duplicadas o sospechosas.',
    keywords: ['antifraude', 'fraude', 'suspected', 'welcome block', 'umbral', 'duplicadas'],
  },
  {
    id: 'sistema',
    label: 'Sistema',
    icon: Server,
    description: 'Mantenimiento, registros, mínimos y avisos.',
    keywords: ['sistema', 'mantenimiento', 'registro', 'deposito', 'retiro', 'minimo', 'retencion', 'history', 'custom', 'avanzado'],
  },
];

export default function SettingsPage() {
  const settings = useTenantSettings();
  const editor = useDesignEditor();
  const { user } = useAuth();

  // Secciones que el user puede ver (las nuevas gatean por permiso, P1).
  const visibleSections = useMemo(
    () =>
      SECTIONS.filter(
        (s) => !s.perm || s.perm.some((p) => hasPermission(user, p)),
      ),
    [user],
  );

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
      visibleSections.filter((s) => {
        const hay = [s.label, s.description, ...s.keywords].join(' ').toLowerCase();
        return hay.includes(q);
      }),
    [q, visibleSections],
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
    <PageShell className="max-w-[1400px]">
      {/* Header */}
      <PageHeader
        icon={SlidersHorizontal}
        title="Configuración"
        description="La marca, la apariencia, la home, los avisos y las reglas de tu casino. Cada cambio queda registrado."
        actions={
          <>
            <Button variant="secondary" size="md" onClick={() => settings.refetch()} disabled={settings.isFetching}>
              <RefreshCw className={cn('size-3.5', settings.isFetching && 'animate-spin')} />
              Refrescar
            </Button>
            <Button variant="secondary" size="md" onClick={() => setShowPreview(!showPreview)}>
              <Eye className="size-3.5" />
              {showPreview ? 'Ocultar preview' : 'Preview'}
            </Button>
          </>
        }
      />

      <HelpNote id="settings">
        Desde acá <strong>personalizás tu casino</strong>. Elegí una sección en el
        menú de la izquierda: <strong>Marca</strong> (nombre, logo),{' '}
        <strong>Apariencia</strong> (colores), <strong>Home</strong> (lo que ven
        los jugadores al entrar), <strong>Notificaciones</strong> y{' '}
        <strong>Plantillas</strong> (los mensajes automáticos), y las{' '}
        <strong>reglas del sistema</strong>. Usá el <strong>buscador</strong> de
        abajo si sabés qué querés cambiar, y el botón <strong>Preview</strong>{' '}
        para ver cómo van quedando los cambios de diseño antes de aplicarlos. Todo
        lo que tocás queda registrado.
      </HelpNote>

      {/* Buscador global */}
      <label className="flex h-11 lg:h-10 min-w-0 max-w-[520px] items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 transition-colors duration-200 focus-within:border-[var(--color-accent-border)]">
        <Search size={15} className="shrink-0 text-[var(--color-fg-subtle)]" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar una opción por nombre…"
          aria-label="Buscar opciones de configuración"
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-subtle)] focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="shrink-0 px-1 min-h-11 lg:min-h-0 text-[11px] text-[var(--color-fg-subtle)] hover:text-[var(--color-fg)]"
          >
            limpiar
          </button>
        )}
      </label>

      {/* Preview en vivo — global (para Marca/Home). En Apariencia se omite
          porque esa sección ya trae su propio preview embebido. */}
      {showPreview && !(activeSection === 'apariencia' && !isSearching) && (
        <DesignPreview editor={editor} />
      )}

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
              {visibleSections.map((section) => (
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
    </PageShell>
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
    case 'apariencia-panel':
      return <SectionAparienciaPanel />;
    case 'home':
      return <SectionHome editor={editor} />;
    case 'notificaciones':
      return (
        <div className="flex flex-col gap-4">
          <ScalarSection
            title="Canales de notificación"
            description="Activa o desactiva cada forma de avisar al jugador: email, dentro del casino, navegador (push) y SMS. Lo que esté apagado, no se envía."
            metas={metas('Notificaciones')}
            settingsByKey={settingsByKey}
          />
        </div>
      );
    case 'antifraude':
      return (
        <ScalarSection
          title="Antifraude"
          description="Detecta cuentas duplicadas (la misma persona con varias cuentas) comparando IP, teléfono y dispositivo. Ajustá qué tan estricto es el control."
          metas={metas('Antifraude')}
          settingsByKey={settingsByKey}
        />
      );
    case 'sistema':
      return <SectionSistema settingsByKey={settingsByKey} />;
    case 'permisos':
      return <SectionPermisos />;
    case 'plantillas':
      return <SectionPlantillas />;
    case 'enviadas':
      return <SectionNotificacionesEnviadas />;
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
        <section className="bg-[var(--color-bg-elevated)] border border-[var(--color-border)] rounded-[var(--radius)] overflow-x-auto">
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
