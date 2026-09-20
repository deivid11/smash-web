import { hasNativeBridge } from './android-bridge.ts';

/** Offline service-worker registration for https origins.
 *
 * Plain LAN http origins only allow localhost — there this resolves 'skipped'
 * and the game stays online-only. The native Android shell already serves the
 * app shell from the APK, so a worker there could only answer with a different
 * (server-hosted) build: any existing registration is removed instead.
 * Never throws, never blocks boot. */
export type SwStatus = 'registered' | 'updated' | 'skipped' | 'failed';
export async function registerOfflineWorker(): Promise<SwStatus> {
  try {
    const service = globalThis.navigator?.serviceWorker;
    if (!service || typeof service.register !== 'function') return 'skipped';
    if (hasNativeBridge()) {
      if (typeof service.getRegistrations === 'function') {
        for (const registration of await service.getRegistrations()) await registration.unregister();
      }
      return 'skipped';
    }
    const protocol = globalThis.location?.protocol;
    const host = globalThis.location?.hostname ?? '';
    const local = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
    if (protocol !== 'https:' && !local) return 'skipped';
    const registration = await service.register('/sw.js');
    if (registration.waiting) return 'updated';
    return 'registered';
  } catch {
    return 'failed';
  }
}
