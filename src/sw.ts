/// <reference lib="webworker" />

export const ORIGIN_SERVICE_WORKER_PATH = '/sw.js';

export function registerUniversalServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(undefined);
  return navigator.serviceWorker.register(ORIGIN_SERVICE_WORKER_PATH, { scope: '/', updateViaCache: 'none' });
}
