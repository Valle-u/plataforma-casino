/**
 * /play/register — redirects to lobby with register modal open.
 * Preserves ?ref= and ?next= for referral links.
 */
'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function RegisterPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const ref = searchParams.get('ref');
    const next = searchParams.get('next');
    const params = new URLSearchParams();
    params.set('auth', 'register');
    if (ref) params.set('ref', ref);
    if (next) params.set('next', next);
    router.replace(`/play?${params.toString()}`);
  }, [router, searchParams]);
  return null;
}

export default function PlayRegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterPageInner />
    </Suspense>
  );
}
