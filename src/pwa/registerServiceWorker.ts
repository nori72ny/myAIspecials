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
      let reloadStarted = false;

      const activateWaitingWorker = (candidate: ServiceWorkerRegistration) => {
        candidate.waiting?.postMessage({ type: 'SKIP_WAITING' });
      };

      // A worker left waiting by a previous session is safe to apply before the
      // user can begin a new draft.
      if (registration.waiting) {
        activateWaitingWorker(registration);
      }

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloadStarted) return;
        reloadStarted = true;
        window.location.reload();
      });

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
