/**
 * TwoFaFlow — gestión de verificación en 2 pasos (TOTP) para el jugador.
 *
 * Backend (Sprint 51.x, endpoints self-service en /tenant/auth):
 *   - POST   /tenant/auth/2fa/init                       → { secret, otpauthUrl }
 *   - POST   /tenant/auth/2fa/confirm                    → { ok, recoveryCodes[] }
 *   - DELETE /tenant/auth/2fa                            → { ok }
 *   - POST   /tenant/auth/2fa/recovery-codes/regenerate  → { ok, recoveryCodes[] }
 *   - GET    /tenant/auth/2fa/recovery-codes/count       → { active }
 *
 * UX:
 *   - Desactivada: botón "Activar" → modal en 2 pasos: QR + secret manual →
 *     código de 6 dígitos → confirm → recovery codes (se muestran UNA vez).
 *   - Activada: botón "Desactivar" (pide código) + "Regenerar códigos de
 *     respaldo" (pide código, invalida los viejos) + contador de códigos
 *     vigentes.
 *   - Tras cada cambio se llama `refreshMe()` para que `twoFaEnabled`
 *     quede reflejado en toda la app sin recargar.
 */

'use client';

import { Check, Copy, ShieldAlert, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { apiDelete, apiGet, apiPost, isApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';

interface InitResponse {
  secret: string;
  otpauthUrl: string;
}

interface CodesResponse {
  ok: true;
  recoveryCodes: string[];
}

interface CountResponse {
  active: number;
}

/** URL del QR vía API externa (mismo patrón que referral-link-card). */
function qrUrl(otpauthUrl: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`;
}

function mapError(err: unknown): string {
  if (!isApiError(err)) return 'Error de conexión.';
  if (err.status === 409 && err.code === 'TWO_FA_ALREADY_ENABLED') {
    return 'La verificación en 2 pasos ya está activada.';
  }
  if (err.status === 400 && err.code === 'TWO_FA_NOT_INITIALIZED') {
    return 'El setup no se inició. Volvé a intentarlo.';
  }
  if (err.code === 'TWO_FA_CODE_INVALID') {
    return 'El código no es válido. Verificá que sea el de tu app autenticadora.';
  }
  if (err.status === 401 && err.code === 'TWO_FA_CODE_INVALID') {
    return 'El código no es válido.';
  }
  return err.message || 'Error inesperado.';
}

function RecoveryCodesPanel({
  codes,
  title,
  onDone,
  doneLabel = 'Listo',
}: {
  codes: string[];
  title: string;
  onDone: () => void;
  doneLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = codes.join('\n');

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        /* clipboard no disponible — sin toast para no interrumpir. */
      },
    );
  }, [text]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 px-3 py-2.5 border border-[var(--color-accent-border)] bg-[var(--color-accent-subtle)] border-l-2 border-l-[var(--color-accent)]">
        <ShieldAlert className="size-4 text-[var(--color-accent-text)] mt-0.5 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-[0.1em] text-[var(--color-accent-text)] font-medium">
            Guardá estos códigos
          </span>
          <span className="text-[12px] text-[var(--color-fg)]">
            {title} Se muestran UNA sola vez. Cada código puede usarse una
            vez para recuperar tu cuenta si perdés la app autenticadora.
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {codes.map((code) => (
          <code
            key={code}
            className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-[13px] font-mono tracking-wider text-[var(--color-fg)]"
          >
            {code}
          </code>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="secondary" size="md" type="button" onClick={handleCopy}>
          {copied ? (
            <>
              <Check className="size-3.5" />
              Copiado
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              Copiar códigos
            </>
          )}
        </Button>
        <Button variant="primary" size="md" type="button" onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}

function TwoFaCodeForm({
  value,
  onChange,
  error,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
}) {
  return (
    <FormField id="twofa-code" label="Código de 6 dígitos" error={error} hint={hint}>
      <Input
        id="twofa-code"
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder="123456"
        className="font-mono tracking-[0.3em]"
        invalid={!!error}
      />
    </FormField>
  );
}

export function TwoFaFlow({ enabled }: { enabled: boolean }) {
  const { refreshMe } = useAuth();

  // Setup
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<'init' | 'codes'>('init');
  const [initData, setInitData] = useState<InitResponse | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupPending, setSetupPending] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  // Disable
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);
  const [disablePending, setDisablePending] = useState(false);

  // Regenerate
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCode, setRegenCode] = useState('');
  const [regenError, setRegenError] = useState<string | null>(null);
  const [regenPending, setRegenPending] = useState(false);
  const [regenCodes, setRegenCodes] = useState<string[] | null>(null);

  // Contador de códigos de respaldo vigentes.
  const [recoveryCount, setRecoveryCount] = useState<number | null>(null);
  const refreshCount = useCallback(async () => {
    if (!enabled) {
      setRecoveryCount(null);
      return;
    }
    try {
      const r = await apiGet<CountResponse>(
        '/tenant/auth/2fa/recovery-codes/count',
      );
      setRecoveryCount(r.active);
    } catch {
      setRecoveryCount(null);
    }
  }, [enabled]);
  useEffect(() => {
    void refreshCount();
  }, [refreshCount]);

  const openSetup = async () => {
    setSetupOpen(true);
    setSetupStep('init');
    setSetupError(null);
    setSetupCode('');
    setRecoveryCodes(null);
    try {
      const res = await apiPost<InitResponse>('/tenant/auth/2fa/init');
      setInitData(res);
    } catch (err) {
      setSetupError(mapError(err));
    }
  };

  const confirmSetup = async () => {
    if (!initData || setupCode.length !== 6) return;
    setSetupPending(true);
    setSetupError(null);
    try {
      const res = await apiPost<CodesResponse>('/tenant/auth/2fa/confirm', {
        code: setupCode,
      });
      setRecoveryCodes(res.recoveryCodes);
      setSetupStep('codes');
      await refreshMe();
      void refreshCount();
    } catch (err) {
      setSetupError(mapError(err));
    } finally {
      setSetupPending(false);
    }
  };

  const disableTwoFa = async () => {
    if (disableCode.length !== 6) return;
    setDisablePending(true);
    setDisableError(null);
    try {
      await apiDelete('/tenant/auth/2fa', { json: { code: disableCode } });
      toast.success('2FA desactivada');
      setDisableOpen(false);
      setDisableCode('');
      await refreshMe();
      void refreshCount();
    } catch (err) {
      setDisableError(mapError(err));
    } finally {
      setDisablePending(false);
    }
  };

  const regenerateCodes = async () => {
    if (regenCode.length !== 6) return;
    setRegenPending(true);
    setRegenError(null);
    try {
      const res = await apiPost<CodesResponse>(
        '/tenant/auth/2fa/recovery-codes/regenerate',
        { code: regenCode },
      );
      setRegenCodes(res.recoveryCodes);
      void refreshCount();
    } catch (err) {
      setRegenError(mapError(err));
    } finally {
      setRegenPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium text-[var(--color-fg)]">
            Verificación en 2 pasos
          </span>
          <span
            className="text-[11px] font-medium"
            style={{
              color: enabled
                ? 'var(--color-success)'
                : 'var(--color-fg-subtle)',
            }}
          >
            {enabled ? 'Activada' : 'Desactivada'}
          </span>
        </div>
        {enabled ? (
          <Button
            variant="outline-accent"
            size="sm"
            type="button"
            onClick={() => setDisableOpen(true)}
          >
            <Smartphone className="size-3.5" />
            Desactivar
          </Button>
        ) : (
          <Button variant="outline-accent" size="sm" type="button" onClick={() => void openSetup()}>
            <Smartphone className="size-3.5" />
            Activar
          </Button>
        )}
      </div>

      {enabled && (
        <div className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12px] text-[var(--color-fg)]">
              Códigos de respaldo
            </span>
            <span className="text-[11px] text-[var(--color-fg-subtle)]">
              {recoveryCount === null
                ? '—'
                : `${recoveryCount} vigente${recoveryCount === 1 ? '' : 's'}`}
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => {
              setRegenOpen(true);
              setRegenError(null);
              setRegenCode('');
              setRegenCodes(null);
            }}
          >
            Regenerar
          </Button>
        </div>
      )}

      {/* Modal setup (2 pasos) */}
      <Modal
        open={setupOpen}
        onOpenChange={(open) => {
          if (!open && setupPending) return;
          setSetupOpen(open);
        }}
        title="Activar verificación en 2 pasos"
        description={
          setupStep === 'init'
            ? 'Escaneá el QR con tu app autenticadora y confirmá con un código.'
            : '2FA activada. Guardá tus códigos de respaldo.'
        }
        size="md"
        footer={
          setupStep === 'init' ? (
            <>
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => setSetupOpen(false)}
                disabled={setupPending}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => void confirmSetup()}
                disabled={setupCode.length !== 6 || setupPending || !initData}
              >
                {setupPending ? (
                  <>
                    <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                    Activando…
                  </>
                ) : (
                  'Confirmar y activar'
                )}
              </Button>
            </>
          ) : null
        }
      >
        {setupStep === 'codes' && recoveryCodes ? (
          <RecoveryCodesPanel
            codes={recoveryCodes}
            title="Estos son tus códigos de respaldo."
            onDone={() => setSetupOpen(false)}
          />
        ) : initData ? (
          <div className="flex flex-col gap-4">
            {/* img externo (QR) — API qrserver, mismo patrón que referral-link-card. */}
            <img
              src={qrUrl(initData.otpauthUrl)}
              alt="QR para la app autenticadora"
              width={200}
              height={200}
              className="mx-auto block rounded-[var(--radius)] border border-[var(--color-border)] bg-white p-2"
            />
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-fg-muted)] font-medium">
                O ingresá esta clave manualmente
              </span>
              <code className="rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-[12px] font-mono break-all text-[var(--color-fg)]">
                {initData.secret}
              </code>
            </div>
            <TwoFaCodeForm
              value={setupCode}
              onChange={setSetupCode}
              error={setupError ?? undefined}
              hint="Código de 6 dígitos de la app autenticadora."
            />
          </div>
        ) : setupError ? (
          <p className="text-[12px] text-[var(--color-accent-text)]">
            {setupError}
          </p>
        ) : (
          <div className="flex items-center justify-center py-6">
            <span className="size-4 border-2 border-current border-r-transparent animate-spin rounded-full" />
          </div>
        )}
      </Modal>

      {/* Modal desactivar */}
      <Modal
        open={disableOpen}
        onOpenChange={(open) => {
          if (!open && disablePending) return;
          setDisableOpen(open);
        }}
        title="Desactivar verificación en 2 pasos"
        description="Tu cuenta queda protegida solo con password. Ingresá un código actual para confirmar."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={() => setDisableOpen(false)}
              disabled={disablePending}
            >
              Cancelar
            </Button>
            <Button
              variant="outline-accent"
              size="md"
              type="button"
              onClick={() => void disableTwoFa()}
              disabled={disableCode.length !== 6 || disablePending}
            >
              {disablePending ? (
                <>
                  <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                  Desactivando…
                </>
              ) : (
                'Desactivar'
              )}
            </Button>
          </>
        }
      >
        <TwoFaCodeForm
          value={disableCode}
          onChange={setDisableCode}
          error={disableError ?? undefined}
        />
      </Modal>

      {/* Modal regenerar códigos de respaldo */}
      <Modal
        open={regenOpen}
        onOpenChange={(open) => {
          if (!open && regenPending) return;
          setRegenOpen(open);
        }}
        title="Regenerar códigos de respaldo"
        description={
          regenCodes
            ? 'Nuevos códigos generados. Los anteriores ya no funcionan.'
            : 'Los códigos actuales dejarán de servir. Ingresá un código actual para confirmar.'
        }
        size="md"
        footer={
          regenCodes ? (
            <Button
              variant="primary"
              size="md"
              type="button"
              onClick={() => setRegenOpen(false)}
            >
              Listo
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="md"
                type="button"
                onClick={() => setRegenOpen(false)}
                disabled={regenPending}
              >
                Cancelar
              </Button>
              <Button
                variant="primary"
                size="md"
                type="button"
                onClick={() => void regenerateCodes()}
                disabled={regenCode.length !== 6 || regenPending}
              >
                {regenPending ? (
                  <>
                    <span className="size-3 border-2 border-current border-r-transparent animate-spin rounded-full" />
                    Regenerando…
                  </>
                ) : (
                  'Regenerar códigos'
                )}
              </Button>
            </>
          )
        }
      >
        {regenCodes ? (
          <RecoveryCodesPanel
            codes={regenCodes}
            title="Estos son tus NUEVOS códigos de respaldo."
            onDone={() => setRegenOpen(false)}
            doneLabel="Listo"
          />
        ) : (
          <TwoFaCodeForm
            value={regenCode}
            onChange={setRegenCode}
            error={regenError ?? undefined}
          />
        )}
      </Modal>
    </div>
  );
}
