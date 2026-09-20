import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetViewer } from '../../web/src/render/viewer.ts';
import { localDiscReader } from '../../web/src/lab/local-disc.ts';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function screenshotFixture() {
  let encoded: ((blob: Blob | null) => void) | undefined;
  const context = { drawImage: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), fillStyle: '', font: '' };
  const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (callback: (blob: Blob | null) => void) => { encoded = callback; } };
  const link = { href: '', download: '', click: vi.fn() };
  vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas' ? canvas : link });
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const draw = vi.fn();
  const viewer = { draw, renderer: { domElement: { width: 640, height: 400 } } } as unknown as AssetViewer;
  return { viewer, draw, create, revoke, link, encode: (blob: Blob | null) => encoded?.(blob) };
}

describe('asset viewer screenshot lifetime', () => {
  it('does not draw or download with an already aborted signal', async () => {
    const fixture = screenshotFixture(), controller = new AbortController(); controller.abort();
    await expect(AssetViewer.prototype.screenshot.call(fixture.viewer, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.draw).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });

  it('cancels a pending encoding and ignores its late callback after unmount', async () => {
    const fixture = screenshotFixture(), controller = new AbortController();
    const promise = AssetViewer.prototype.screenshot.call(fixture.viewer, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    fixture.encode(new Blob(['image'])); await Promise.resolve();
    expect(fixture.create).not.toHaveBeenCalled(); expect(fixture.link.click).not.toHaveBeenCalled();
  });

  it('preserves downloads and revokes their URLs immediately on teardown', async () => {
    vi.useFakeTimers();
    const fixture = screenshotFixture(), controller = new AbortController();
    const promise = AssetViewer.prototype.screenshot.call(fixture.viewer, controller.signal);
    fixture.encode(new Blob(['image'])); await promise;
    expect(fixture.link.download).toBe('smash-web-original-assets.png'); expect(fixture.link.click).toHaveBeenCalledOnce();
    controller.abort(); expect(fixture.revoke).toHaveBeenCalledWith('blob:test'); expect(vi.getTimerCount()).toBe(0);
  });

  it('still supports callers without a signal and releases the download URL', async () => {
    vi.useFakeTimers(); const fixture = screenshotFixture();
    const promise = AssetViewer.prototype.screenshot.call(fixture.viewer);
    fixture.encode(new Blob(['image'])); await promise;
    vi.advanceTimersByTime(10_000); expect(fixture.revoke).toHaveBeenCalledOnce();
  });
});

describe('local disc read lifetime', () => {
  it('aborts an in-flight FileReader and starts no further reads after teardown', async () => {
    const abort = vi.fn(), read = vi.fn();
    vi.stubGlobal('FileReader', class { abort = abort; readAsArrayBuffer = read; });
    const slice = vi.fn().mockReturnValue(new Blob(['disc']));
    const controller = new AbortController();
    const reader = localDiscReader({ size: 128, slice } as unknown as File, controller.signal);
    const pending = reader.read(16, 4);
    expect(slice).toHaveBeenCalledWith(16, 20);
    controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(abort).toHaveBeenCalledOnce();
    expect(() => reader.read(20, 4)).toThrow(); expect(read).toHaveBeenCalledOnce();
  });
});
