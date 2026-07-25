'use client';

import { Check, Copy, MousePointerClick, TrendingUp, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useReferralCode, useReferralStats } from '@/lib/hooks/use-referrals';
import { Skeleton } from '@/components/ui/skeleton';

export function ReferralLinkCard() {
  const { data: codeData, isLoading: codeLoading } = useReferralCode();
  const { data: statsData, isLoading: statsLoading } = useReferralStats();
  const [copied, setCopied] = useState(false);

  const fullUrl = useMemo(() => {
    if (!codeData) return '';
    return `${window.location.origin}/r/${codeData.code}`;
  }, [codeData]);

  const qrUrl = useMemo(() => {
    if (!codeData) return '';
    const url = `${window.location.origin}/r/${codeData.code}`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
  }, [codeData]);

  const handleCopy = useCallback(() => {
    if (!fullUrl) return;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [fullUrl]);

  if (codeLoading) {
    return (
      <div className="rounded-xl p-6" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }}>
        <Skeleton className="h-6 w-40 mb-4" />
        <Skeleton className="h-10 w-full mb-4" />
        <div className="flex gap-4">
          <Skeleton className="h-[200px] w-[200px]" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      </div>
    );
  }

  if (!codeData) return null;

  return (
    <div className="rounded-xl p-6" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }}>
      <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
        Tu link de referido
      </h3>

      {/* URL box + copy */}
      <div className="flex items-center gap-2 mb-6">
        <div
          className="flex-1 rounded-lg px-3 py-2 text-sm font-mono truncate"
          style={{ background: 'var(--color-bg-subtle)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
        >
          {fullUrl || `${typeof window !== 'undefined' ? window.location.origin : ''}/r/${codeData.code}`}
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? (
            <><Check className="h-4 w-4 mr-1" /> Copiado</>
          ) : (
            <><Copy className="h-4 w-4 mr-1" /> Copiar</>
          )}
        </Button>
      </div>

      <div className="flex gap-6 items-start">
        {/* QR code */}
        <div className="rounded-lg p-2" style={{ background: '#ffffff' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrUrl}
            alt={`QR code para ${codeData.code}`}
            width={200}
            height={200}
            className="block"
          />
        </div>

        {/* Stats */}
        <div className="flex-1 space-y-4">
          <h4 className="text-sm font-medium" style={{ color: 'var(--color-text-muted)' }}>
            Métricas (últimos 90 días)
          </h4>
          {statsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-24" />
            </div>
          ) : statsData ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-subtle)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <MousePointerClick className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Clicks</span>
                </div>
                <span className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {statsData.totalClicks.toLocaleString()}
                </span>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-subtle)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Registros</span>
                </div>
                <span className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {statsData.totalSignups.toLocaleString()}
                </span>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'var(--color-bg-subtle)' }}>
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4" style={{ color: 'var(--color-text-muted)' }} />
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Conversión</span>
                </div>
                <span className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
                  {statsData.totalClicks > 0
                    ? `${((statsData.totalSignups / statsData.totalClicks) * 100).toFixed(1)}%`
                    : '—'}
                </span>
              </div>
            </div>
          ) : null}

          <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            Compartí este link con tus clientes. Cuando se registren a través de él, quedarán vinculados a tu cuenta como usuario final bajo tu jerarquía.
          </p>
        </div>
      </div>
    </div>
  );
}
