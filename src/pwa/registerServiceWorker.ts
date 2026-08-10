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
    }).catch(() => {
      // PWA registration failure must not interrupt the application UI.
    });
  }, { once: true });
}
