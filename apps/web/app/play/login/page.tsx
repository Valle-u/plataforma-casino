/**
 * /play/login — redirects to lobby with login modal open.
 * Kept for backward compatibility. Auth is now handled via modals.
 */
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PlayLoginPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/play?auth=login');
  }, [router]);
  return null;
}
