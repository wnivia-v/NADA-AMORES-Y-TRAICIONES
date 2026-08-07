import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { OverlayShield } from '@/components/overlay/OverlayShield';
import App from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

// The Electron always-on-top overlay window loads this same bundle with
// ?overlay=1 instead of a separate entry point (see electron/main.cts). It
// renders a tiny standalone widget, not the full app.
const isOverlay = new URLSearchParams(window.location.search).get('overlay') === '1';

if (isOverlay) {
  // The BrowserWindow is created with transparent:true, which only shows
  // through if the page's own background is transparent too — the normal
  // app background-color (set in index.css) would otherwise paint a solid
  // square over the whole overlay window. #root also has no explicit size in
  // the normal app (App.tsx's own layout provides it), so it must be sized
  // here or OverlayShield's 100%/100% collapses to zero.
  document.documentElement.style.background = 'transparent';
  document.documentElement.style.height = '100%';
  document.body.style.background = 'transparent';
  document.body.style.height = '100%';
  document.body.style.overflow = 'hidden';
  root.style.width = '100%';
  root.style.height = '100%';
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      {isOverlay ? <OverlayShield /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
);
