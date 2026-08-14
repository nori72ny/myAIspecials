const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

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

      // Activate a worker left waiting by a previous session, but never reload
      // the current document. The active UI keeps running and the new worker
      // controls the next navigation, so a fast user cannot lose a draft.
      if (registration.waiting) {
        activateWaitingWorker(registration);
      }

      window.setInterval(() => {
        void registration.update().catch(() => {
          // A temporary update-check failure must not interrupt the application.
        });
      }, UPDATE_CHECK_INTERVAL_MS);
    }).catch(() => {
      // PWA registration failure must not interrupt the application UI.
    });
  }, { once: true });
}
