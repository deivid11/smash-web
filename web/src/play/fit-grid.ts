import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** Columns that make `count` tiles of `aspect` (w/h) fill a box without
 * overflowing it: the grid picks the column count giving the biggest tile, so
 * a no-scroll screen shows every choice at once (Rift champion grid, battle
 * roster, stage select). Measured before paint so the first frame is laid out. */
export function useFitColumns<T extends HTMLElement>(count: number, aspect = 1, gap = 6): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [columns, setColumns] = useState(Math.max(1, Math.ceil(Math.sqrt(count))));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || count <= 0) return;
    const measure = (): void => {
      const { width, height } = element.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      let best = 1;
      let bestSize = 0;
      for (let cols = 1; cols <= count; cols++) {
        const rows = Math.ceil(count / cols);
        const tileW = (width - gap * (cols - 1)) / cols;
        const tileH = (height - gap * (rows - 1)) / rows;
        const size = Math.min(tileW, tileH * aspect);
        if (size > bestSize) { bestSize = size; best = cols; }
      }
      setColumns(best);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count, aspect, gap]);
  return [ref, columns];
}
