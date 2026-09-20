/** One-shot client description attached to every performance upload: enough to
 * group reports by hardware class without identifying the player. */
import { hasNativeBridge } from '../android-bridge.ts';

export interface PerfDeviceInfo {
  userAgent: string;
  platform: string;
  mobile: boolean | null;
  model: string;
  cores: number | null;
  memoryGb: number | null;
  screen: [number, number];
  viewport: [number, number];
  dpr: number;
  gpuVendor: string;
  gpuRenderer: string;
  webgl: string;
  maxTextureSize: number | null;
  gpuTimer: boolean;
  timerPrecisionMs: number;
  crossOriginIsolated: boolean;
  androidShell: boolean;
  network: string;
  bundle: string;
  language: string;
}

type UaData = { mobile?: boolean; platform?: string; getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platformVersion?: string }> };

/** Smallest nonzero step performance.now() reports (coarse clocks blur short spans). */
function timerPrecision(): number {
  const start = performance.now();
  let best = Infinity, last = start;
  for (let now = start; now - start < 4 && best > 0.001; now = performance.now()) {
    if (now > last) { best = Math.min(best, now - last); last = now; }
  }
  return Number.isFinite(best) ? Math.round(best * 1e4) / 1e4 : 0;
}

export function collectDeviceInfo(gl: WebGLRenderingContext | WebGL2RenderingContext | null, gpuTimer: boolean): PerfDeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: UaData; connection?: { effectiveType?: string; rtt?: number; downlink?: number } };
  let gpuVendor = '', gpuRenderer = '', webgl = '', maxTextureSize: number | null = null;
  if (gl) {
    try {
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      gpuVendor = String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR) ?? '');
      gpuRenderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
      webgl = String(gl.getParameter(gl.VERSION) ?? '');
      maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null;
    } catch { /* lost context: leave blanks */ }
  }
  const connection = nav.connection;
  // The play bundle URL changes with every build (content hash), so it doubles as a build id.
  const bundle = (() => { try { return new URL(import.meta.url).pathname.split('/').pop() ?? ''; } catch { return ''; } })();
  return {
    userAgent: nav.userAgent.slice(0, 300),
    platform: nav.userAgentData?.platform ?? nav.platform ?? '',
    mobile: nav.userAgentData?.mobile ?? null,
    model: '',
    cores: nav.hardwareConcurrency || null,
    memoryGb: nav.deviceMemory ?? null,
    screen: [screen.width, screen.height],
    viewport: [innerWidth, innerHeight],
    dpr: devicePixelRatio,
    gpuVendor: gpuVendor.slice(0, 120), gpuRenderer: gpuRenderer.slice(0, 200), webgl: webgl.slice(0, 80), maxTextureSize,
    gpuTimer,
    timerPrecisionMs: timerPrecision(),
    crossOriginIsolated: globalThis.crossOriginIsolated === true,
    androidShell: hasNativeBridge(),
    network: connection ? `${connection.effectiveType ?? '?'} rtt=${connection.rtt ?? '?'} down=${connection.downlink ?? '?'}` : '',
    bundle,
    language: nav.language ?? '',
  };
}

/** Phone/tablet model name where Client Hints expose it (Chromium on Android). */
export async function refineDeviceModel(info: PerfDeviceInfo): Promise<void> {
  const data = (navigator as Navigator & { userAgentData?: UaData }).userAgentData;
  if (!data?.getHighEntropyValues) return;
  try {
    const values = await data.getHighEntropyValues(['model', 'platformVersion']);
    info.model = [values.model, values.platformVersion].filter(Boolean).join(' ').slice(0, 120);
  } catch { /* hints denied */ }
}
