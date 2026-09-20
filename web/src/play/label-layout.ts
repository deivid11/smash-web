/** Screen anchor of one fighter's head label (bottom-center, in CSS pixels). */
export interface LabelAnchor { readonly x: number; readonly y: number; readonly visible: boolean; readonly priority?: boolean }

/** Vertical lift (px) per label so crowded head labels stack in rows instead of
 * printing over each other. Priority labels (the local player) are placed
 * first and never move; the rest take the lowest free row, up to `maxRows`
 * rows (after that a label keeps its top row and may overlap). Presentation only. */
export function stackLabels(anchors: readonly LabelAnchor[], width: number, height: number, maxRows = 3): number[] {
  const lifts = anchors.map(() => 0);
  const placed: Array<{ left: number; right: number; top: number; bottom: number }> = [];
  const order = anchors.map((anchor, index) => ({ anchor, index }))
    .filter(({ anchor }) => anchor.visible && Number.isFinite(anchor.x) && Number.isFinite(anchor.y))
    .sort((a, b) => Number(!!b.anchor.priority) - Number(!!a.anchor.priority) || b.anchor.y - a.anchor.y || a.index - b.index);
  for (const { anchor, index } of order) {
    let row = 0;
    const box = (lift: number) => ({ left: anchor.x - width / 2, right: anchor.x + width / 2, top: anchor.y - lift - height, bottom: anchor.y - lift });
    const free = (candidate: ReturnType<typeof box>) => placed.every((other) => candidate.right <= other.left || candidate.left >= other.right || candidate.bottom <= other.top || candidate.top >= other.bottom);
    while (row < maxRows - 1 && !free(box(row * height))) row++;
    lifts[index] = row * height;
    placed.push(box(lifts[index]!));
  }
  return lifts;
}
