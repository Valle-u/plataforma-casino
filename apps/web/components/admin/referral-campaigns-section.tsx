/**
 * ReferralCampaignsSection — gestión de campañas de referido.
 *
 * Cada operador/admin puede crear códigos EXTRA (campañas, ej. "Instagram")
 * además de su código base. Acá se listan con sus métricas por código y se
 * pueden crear, renombrar y (des)activar. No se borran (se conservan métricas).
 *
 * Leyes: P1 (el backend gatea con referrals.view_own). Sin comisiones.
 */

'use client';

import {
  BarChart3,
  Check,
  Copy,
  Megaphone,
  MousePointerClick,
  Pencil,
  Power,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { CreateReferralCodeModal } from '@/components/admin/create-referral-code-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { isApiError } from '@/lib/api-client';
import {
  useReferralCodes,
  useUpdateReferralCode,
  type ReferralCodeListItem,
} from '@/lib/hooks/use-referrals';

interface ReferralCampaignsSectionProps {
  /** Código actualmente filtrado en el drill-down (null = ninguno). */
  selectedCode?: string | null;
  /** Setea el filtro de métricas al código dado (o null para limpiar). */
  onSelect?: (code: string | null, label?: string) => void;
}

export function ReferralCampaignsSection({
  selectedCode = null,
  onSelect,
}: ReferralCampaignsSectionProps) {
  const { data, isLoading } = useReferralCodes();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ReferralCodeListItem | null>(null);

  const openCreate = useCallback(() => {
    setEditing(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((c: ReferralCodeListItem) => {
    setEditing(c);
    setModalOpen(true);
  }, []);

  const campaigns = data?.campaigns ?? [];
  const activeCount = campaigns.filter((c) => c.isActive).length;
  const cap = data?.campaignCap ?? 20;
  const atCap = activeCount >= cap;

  return (
    <div
      className="rounded-xl p-6"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border)',
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Megaphone
            className="h-5 w-5"
            style={{ color: 'var(--color-text-muted)' }}
          />
          <div>
            <h3
              className="text-lg font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              Campañas
            </h3>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Códigos extra para trackear de dónde vienen tus registros.
              {' '}
              {activeCount}/{cap} activas.
            </p>
          </div>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={openCreate}
          disabled={atCap}
          title={
            atCap
              ? `Llegaste al máximo de ${cap} campañas activas.`
              : undefined
          }
        >
          <Megaphone className="h-4 w-4 mr-1" />
          Crear campaña
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div
          className="text-center py-8 text-sm"
          style={{ color: 'var(--color-fg-subtle)' }}
        >
          Todavía no creaste campañas. Creá una para trackear una fuente de
          tráfico específica (ej. Instagram).
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              onEdit={openEdit}
              selected={selectedCode === c.code}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}

      <CreateReferralCodeModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        editing={editing}
      />
    </div>
  );
}

function CampaignRow({
  campaign,
  onEdit,
  selected,
  onSelect,
}: {
  campaign: ReferralCodeListItem;
  onEdit: (c: ReferralCodeListItem) => void;
  selected: boolean;
  onSelect?: (code: string | null, label?: string) => void;
}) {
  const update = useUpdateReferralCode();
  const [copied, setCopied] = useState(false);

  const fullUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}${campaign.link}`
      : campaign.link;

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [fullUrl]);

  const toggleActive = useCallback(async () => {
    if (!campaign.id) return;
    try {
      await update.mutateAsync({
        id: campaign.id,
        isActive: !campaign.isActive,
      });
      toast.success(
        campaign.isActive ? 'Campaña desactivada' : 'Campaña reactivada',
        { description: campaign.label },
      );
    } catch (err) {
      toast.error('No se pudo actualizar', {
        description: isApiError(err)
          ? err.message
          : 'Error de conexión.',
      });
    }
  }, [campaign, update]);

  return (
    <div
      className="rounded-lg p-4 transition-colors"
      style={{
        background: selected
          ? 'var(--color-accent-subtle)'
          : 'var(--color-bg-subtle)',
        border: selected
          ? '1px solid var(--color-accent-border)'
          : '1px solid var(--color-border)',
        opacity: campaign.isActive ? 1 : 0.6,
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="font-semibold truncate"
              style={{ color: 'var(--color-text)' }}
            >
              {campaign.label}
            </span>
            <Badge
              variant={campaign.isActive ? 'success' : 'neutral'}
              dot
            >
              {campaign.isActive ? 'Activa' : 'Inactiva'}
            </Badge>
          </div>
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {campaign.code}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {onSelect && (
            <Button
              variant={selected ? 'primary' : 'ghost'}
              size="sm"
              onClick={() =>
                onSelect(selected ? null : campaign.code, campaign.label)
              }
              title={selected ? 'Quitar filtro' : 'Ver métricas de esta campaña'}
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEdit(campaign)}
            title="Renombrar etiqueta"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleActive()}
            disabled={update.isPending}
            title={campaign.isActive ? 'Desactivar' : 'Reactivar'}
          >
            <Power
              className="h-3.5 w-3.5"
              style={{
                color: campaign.isActive
                  ? 'var(--color-danger)'
                  : 'var(--color-success)',
              }}
            />
          </Button>
        </div>
      </div>

      {/* Link + copy */}
      <div className="flex items-center gap-2 mb-3">
        <div
          className="flex-1 rounded-md px-2.5 py-1.5 text-xs font-mono truncate"
          style={{
            background: 'var(--color-bg-elevated)',
            color: 'var(--color-text)',
            border: '1px solid var(--color-border)',
          }}
        >
          {fullUrl}
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 mr-1" /> Copiado
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
            </>
          )}
        </Button>
      </div>

      {/* Métricas por código */}
      <div className="flex items-center gap-4 text-xs">
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <MousePointerClick className="h-3.5 w-3.5" />
          <span
            className="font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {campaign.clicks.toLocaleString()}
          </span>
          clicks
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Users className="h-3.5 w-3.5" />
          <span
            className="font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {campaign.signups.toLocaleString()}
          </span>
          registros
        </span>
        <span
          className="inline-flex items-center gap-1.5"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <TrendingUp className="h-3.5 w-3.5" />
          <span
            className="font-semibold tabular-nums"
            style={{ color: 'var(--color-text)' }}
          >
            {campaign.ftds.toLocaleString()}
          </span>
          FTD
        </span>
      </div>
    </div>
  );
}
