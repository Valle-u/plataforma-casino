/**
 * /mi-diseno — el SOCIO INDEPENDIENTE personaliza el diseño de su casino.
 *
 * Reusa el mismo editor que el admin (Marca / Apariencia / Home + preview),
 * pero guarda en SU propio diseño (partner_branding), no en los settings del
 * tenant. Su red ve este diseño; lo que no cambie usa el default del tenant.
 * Solo visible para socios independientes (gate por useMyBranch().isIndependent).
 */

'use client';

import { Palette, Sparkles, Tag } from 'lucide-react';
import { CollapsibleCard } from '@/components/admin/collapsible-card';
import { DesignPreview } from '@/components/admin/settings/design-preview';
import { SectionApariencia } from '@/components/admin/settings/section-apariencia';
import { SectionHome } from '@/components/admin/settings/section-home';
import { SectionMarca } from '@/components/admin/settings/section-marca';
import { usePartnerDesignEditor } from '@/components/admin/settings/use-partner-design-editor';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { PageShell } from '@/components/ui/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { useMyBranch } from '@/lib/hooks/use-branches';

export default function MiDisenoPage() {
  const branch = useMyBranch();
  const editor = usePartnerDesignEditor();

  if (branch.isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-64 w-full bg-[var(--color-bg-subtle)]" />
      </PageShell>
    );
  }

  if (!branch.data?.isIndependent) {
    return (
      <PageShell>
        <PageHeader icon={Palette} title="Diseño de mi casino" />
        <EmptyState
          label="Esta sección es solo para socios independientes."
          description="Cuando tu casino opere como sucursal independiente vas a poder personalizar su diseño desde acá."
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        icon={Palette}
        title="Diseño de mi casino"
        description="Personalizá cómo ve tu casino tu red: colores, logo, nombre y banners. Lo que dejes sin cambiar usa el diseño por defecto del casino."
      />

      <DesignPreview editor={editor} />

      <div className="flex flex-col gap-4">
        <CollapsibleCard title="Marca" icon={<Tag className="size-4" />}>
          <SectionMarca editor={editor} />
        </CollapsibleCard>
        <CollapsibleCard title="Apariencia (colores)" icon={<Palette className="size-4" />}>
          <SectionApariencia editor={editor} />
        </CollapsibleCard>
        <CollapsibleCard
          title="Home del jugador"
          icon={<Sparkles className="size-4" />}
          defaultOpen={false}
        >
          <SectionHome editor={editor} />
        </CollapsibleCard>
      </div>
    </PageShell>
  );
}
