import { useCallback, useEffect, useState, type RefObject } from 'react';

/** CSS always fills the viewport; native fullscreen is an explicit gesture. */
export function useFullscreen(root: RefObject<HTMLElement | null>) {
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = () => { setFullscreen(document.fullscreenElement === root.current); setError(''); };
    document.addEventListener('fullscreenchange', changed); changed();
    return () => document.removeEventListener('fullscreenchange', changed);
  }, [root]);
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (root.current?.requestFullscreen) {
        await root.current.requestFullscreen();
        // Phones: a landscape lock keeps the stick and buttons at the bottom corners.
        if (matchMedia('(pointer: coarse)').matches) { try { await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'); } catch { /* Not permitted or unsupported; the CSS layout still adapts. */ } }
      }
      else setError('Native fullscreen is unavailable; the game still fills this window.');
    } catch { setError('Fullscreen was not allowed. The game still fills this window.'); }
  }, [root]);
  return { fullscreen, error, toggle };
}
