/**
 * Entry point del cliente Joker's Jewels.
 *
 * Sin StrictMode en dev — los double-renders de StrictMode molestan
 * cuando estás debuggeando animaciones de reels. Reactivable cuando
 * agreguemos PixiJS (Sub-fase 2D).
 */

import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('No se encontró #root en index.html');
}
createRoot(container).render(<App />);
