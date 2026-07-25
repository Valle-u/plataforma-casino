'use client';

import { Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ReferralLinkCard } from '@/components/admin/referral-link-card';
import { useReferralCode } from '@/lib/hooks/use-referrals';

export default function ReferralsPage() {
  const { refetch } = useReferralCode();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link2 className="h-6 w-6" style={{ color: 'var(--color-text-muted)' }} />
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>
              Mis Referidos
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Tu link personal para compartir y atraer jugadores
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Actualizar
        </Button>
      </div>

      {/* Referral link card */}
      <ReferralLinkCard />

      {/* How it works */}
      <div className="rounded-xl p-6" style={{ background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>
          ¿Cómo funciona?
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-subtle)' }}>
            <span className="text-lg font-bold block mb-1" style={{ color: 'var(--color-text)' }}>1. Compartí</span>
            <p>Mandá tu link por WhatsApp, redes sociales o donde quieras. Cada persona que haga click queda registrada.</p>
          </div>
          <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-subtle)' }}>
            <span className="text-lg font-bold block mb-1" style={{ color: 'var(--color-text)' }}>2. Se registran</span>
            <p>Cuando un jugador se registre a través de tu link, quedará vinculado a tu cuenta como usuario final bajo tu jerarquía.</p>
          </div>
          <div className="rounded-lg p-4" style={{ background: 'var(--color-bg-subtle)' }}>
            <span className="text-lg font-bold block mb-1" style={{ color: 'var(--color-text)' }}>3. Seguís acá</span>
            <p>Volví a esta página para ver cuántos clicks y registros generaste. ¡Tus métricas se actualizan en tiempo real!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
