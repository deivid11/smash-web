import { describe, expect, it } from 'vitest';
import { Color, Vector2 } from 'three';
import { withPreservedSurface } from '../../web/src/play/menu-previews.ts';

/** Stub standing in for the live WebGLRenderer surface state. */
function stubSurface() {
  return {
    ratio: 2,
    size: new Vector2(1280, 720),
    clear: new Color(0x112233),
    alpha: 1,
    calls: [] as string[],
    getSize(target: Vector2): Vector2 { return target.copy(this.size); },
    getPixelRatio(): number { return this.ratio; },
    getClearColor(target: Color): Color { return target.copy(this.clear); },
    getClearAlpha(): number { return this.alpha; },
    setPixelRatio(ratio: number): void { this.calls.push(`ratio:${ratio}`); this.ratio = ratio; },
    setSize(width: number, height: number, _updateStyle: boolean): void { this.calls.push(`size:${width}x${height}`); this.size.set(width, height); },
    setClearColor(color: number, alpha: number): void { this.calls.push(`clear:${color},${alpha}`); this.clear.setHex(color); this.alpha = alpha; },
  };
}

describe('thumbnail captures preserve the live drawing surface', () => {
  it('restores pixel ratio, buffer size and clear color after a capture', () => {
    const graphics = stubSurface();
    const result = withPreservedSurface(graphics, () => {
      graphics.setPixelRatio(1); graphics.setClearColor(0x000000, 0); graphics.setSize(300, 380, false);
      return 'portrait';
    });
    expect(result).toBe('portrait');
    expect(graphics.ratio).toBe(2);
    expect(graphics.size.x).toBe(1280); expect(graphics.size.y).toBe(720);
    expect(graphics.clear.getHex()).toBe(0x112233); expect(graphics.alpha).toBe(1);
  });
  it('restores with a single drawing-buffer reallocation when the renderer supports it', () => {
    const surface = stubSurface();
    const graphics = Object.assign(surface, {
      setDrawingBufferSize(width: number, height: number, ratio: number): void { surface.calls.push(`buffer:${width}x${height}@${ratio}`); surface.size.set(width, height); surface.ratio = ratio; },
    });
    withPreservedSurface(graphics, () => { graphics.setDrawingBufferSize(300, 380, 1); });
    expect(graphics.calls).toEqual(['buffer:300x380@1', 'buffer:1280x720@2', 'clear:1122867,1']);
    expect(graphics.ratio).toBe(2); expect(graphics.size.x).toBe(1280); expect(graphics.size.y).toBe(720);
  });
  it('restores even when the capture throws', () => {
    const graphics = stubSurface();
    expect(() => withPreservedSurface(graphics, () => {
      graphics.setSize(540, 300, false);
      throw new Error('no disc');
    })).toThrow('no disc');
    expect(graphics.ratio).toBe(2);
    expect(graphics.size.x).toBe(1280); expect(graphics.size.y).toBe(720);
  });
});
