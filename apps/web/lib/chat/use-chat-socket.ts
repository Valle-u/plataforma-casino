/**
 * useChatSocket — maneja el ciclo de vida del socket del livechat (jugador y
 * operador comparten este hook; `apiPost` ya elige el panel/cookie por la ruta).
 *
 * AUTH: el WS es cross-origin (front en Vercel, WS en la API), así que la cookie
 * no viaja. Pasamos `auth` como FUNCIÓN: socket.io la invoca en cada (re)conexión,
 * así pedimos un ws-token corto fresco cada vez (POST /tenant/chat/ws-token, que
 * sí va con cookie por el rewrite). Reconexión automática de socket.io.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { apiPost } from '@/lib/api-client';
import type { ChatStatus } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

export function useChatSocket(enabled: boolean): {
  socket: Socket | null;
  status: ChatStatus;
} {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [status, setStatus] = useState<ChatStatus>('connecting');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus('disconnected');
      return;
    }
    const s = io(`${API_URL}/chat`, {
      transports: ['websocket'],
      auth: (cb) => {
        apiPost<{ token: string }>('/tenant/chat/ws-token')
          .then(({ token }) => cb({ token }))
          .catch(() => cb({ token: '' }));
      },
    });
    socketRef.current = s;
    setSocket(s);

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onReconnecting = () => setStatus('connecting');
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.io.on('reconnect_attempt', onReconnecting);

    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.io.off('reconnect_attempt', onReconnecting);
      s.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [enabled]);

  return { socket, status };
}
