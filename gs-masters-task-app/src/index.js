import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Capture beforeinstallprompt BEFORE React mounts — it fires early on Android
window._pwaBeforeInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window._pwaBeforeInstall = e;
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Register service worker so the app installs & loads like a native app
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
