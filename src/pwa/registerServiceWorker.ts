const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SAFE_APPLY_RETRY_INTERVAL_MS = 5000;
const UPDATE_RELOAD_GUARD_KEY = 'origin:pwa-update-reload';
const SAFE_APPLY_DELAY_MS = 1500;

function announceUpdateReady() {
  window.dispatchEvent(new CustomEvent('origin:pwa-update-ready'));
}

function hasUnsavedUserWork(): boolean {
  if (document.visibilityState !== 'visible') return true;

  // Keep any open dialog/modal mounted until the user closes it. This protects
  // transient form state that may not yet have been persisted anywhere.
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return true;

  // Rich-text editors can hold unsaved work without exposing an input.value.
  if (document.activeElement?.closest?.('[contenteditable="true"], [role="textbox"]')) return true;

  const editableInputs = Array.from(document.querySelectorAll(
    'textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
  ));
  if (editableInputs.some((element) => {
    const value = (element as HTMLInputElement | HTMLTextAreaElement).value;
    return typeof value === 'string' && value.length > 0;
  })) return true;

  if (document.documentElement.dataset.originStorageState === 'hydrating') return true;
  if (document.querySelector('[data-testid="origin-thinking"], [aria-busy="true"]')) return true;
  const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
  if (fileInputs.some((element) => (element as HTMLInputElement).files?.length)) return true;
  return false;
}

function canAutoApplyUpdate(): boolean {
  return !hasUnsavedUserWork() && document.visibilityState === 'visible';
}

export function registerOriginServiceWorker(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  if (!window.isSecureContext || window.self !== window.top) {
    return;
  }

  sessionStorage.removeItem(UPDATE_RELOAD_GUARD_KEY);

  window.addEventListener('load', () => {
    // A first install calls clients.claim(), but the current page is already fresh.
    // Subscribe before register() resolves so a fast first claim cannot be missed.
    let hadController = Boolean(navigator.serviceWorker.controller);
    let reloadPending = false;
    let reloadRequested = false;
    const reloadWhenSafe = () => {
      if (!reloadPending || reloadRequested || !canAutoApplyUpdate()) return;
      if (sessionStorage.getItem(UPDATE_RELOAD_GUARD_KEY) === '1') return;
      reloadRequested = true;
      sessionStorage.setItem(UPDATE_RELOAD_GUARD_KEY, '1');
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!navigator.serviceWorker.controller) return;
      if (!hadController) {
        hadController = true;
        return;
      }
      // Another tab may activate the update, or typing may start after SKIP_WAITING.
      // Check for unsaved work again at the actual reload boundary.
      reloadPending = true;
      announceUpdateReady();
      reloadWhenSafe();
    });

    void navigator.serviceWorker.register('/sw.js', {
      scope: '/',
      updateViaCache: 'none',
    }).then((registration) => {
      let updatePending = false;
      let applyTimer: number | undefined;

      const activateWaitingWorker = (candidate: ServiceWorkerRegistration) => {
        if (!candidate.waiting || !canAutoApplyUpdate()) return false;
        candidate.waiting.postMessage({ type: 'SKIP_WAITING' });
        return true;
      };

      const scheduleSafeApply = () => {
        if (!updatePending || applyTimer !== undefined) return;
        applyTimer = window.setTimeout(() => {
          applyTimer = undefined;
          if (!updatePending) return;
          if (activateWaitingWorker(registration)) updatePending = false;
        }, SAFE_APPLY_DELAY_MS);
      };

      const checkForUpdate = () => {
        void registration.update().catch(() => {
          // A temporary update-check failure must not interrupt the application.
        });
      };

      const waitingAtLaunch = Boolean(registration.waiting);
      if (waitingAtLaunch && canAutoApplyUpdate()) {
        activateWaitingWorker(registration);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && registration.waiting && hadController) {
            updatePending = true;
            announceUpdateReady();
            scheduleSafeApply();
          }
        });
      });

      const retrySafeApply = () => {
        reloadWhenSafe();
        if (registration.waiting) {
          updatePending = true;
          scheduleSafeApply();
        }
      };
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', retrySafeApply);
      window.addEventListener('focus', retrySafeApply);
      window.addEventListener('origin:pwa-safe-apply', retrySafeApply);

      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);
      window.setInterval(retrySafeApply, SAFE_APPLY_RETRY_INTERVAL_MS);
      checkForUpdate();
    }).catch(() => {
      // PWA registration failure must not interrupt the application UI.
    });
  }, { once: true });
}
