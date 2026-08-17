const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

function announceUpdateReady() {
  window.dispatchEvent(new CustomEvent('origin:pwa-update-ready'));
}

export function registerOriginServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  if (!window.isSecureContext || window.self !== window.top) {
    return;
  }

  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).then((registration) => {
      const activateWaitingWorker = (candidate: ServiceWorkerRegistration) => {
        candidate.waiting?.postMessage({ type: 'SKIP_WAITING' });
      };
      const checkForUpdate = () => {
        void registration.update().catch(() => {
          // A temporary update-check failure must not interrupt the application.
        });
      };

      // A worker that was waiting before this launch is safe to activate: the
      // current document is a fresh session and we never force a reload.
      if (registration.waiting) {
        activateWaitingWorker(registration);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && registration.waiting) {
            // Keep the current draft intact. The next app launch activates it.
            announceUpdateReady();
          }
        });
      });

      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.addEventListener('online', checkForUpdate);
    }).catch(() => {
      // PWA registration failure must not interrupt the application UI.
    });
  }, { once: true });
}
