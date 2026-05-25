import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config para el cliente del slot.
// - port 4001 (4000-4999 reservado a clientes de juegos propios).
// - host 0.0.0.0 para acceso desde celular en LAN.
// - sin base path: el juego se sirve standalone en /play/games/jokers-jewels/play/iframe
//   (proxy/redirect lo manejará la plataforma cuando se integre en sub-fase 2C).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4001,
    host: '0.0.0.0',
  },
});
