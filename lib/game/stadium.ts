import type { HsdArchive } from '../hsd/archive.ts';
import { parseStageGameplay, type StageGameplayData } from './data.ts';
import type { MeleePhysics } from './physics.ts';

/** Pokémon Stadium transformation forms. Original ids (grpstadium.c): 5 normal,
 * 3 fire, 4 grass, 9 water, 6 rock; this adapter uses names, same cycle rules. */
export const STADIUM_FORMS = ['normal', 'fire', 'grass', 'water', 'rock'] as const;
export type StadiumForm = typeof STADIUM_FORMS[number];
export const STADIUM_VARIANTS = ['fire', 'grass', 'water', 'rock'] as const;
/** Verified coll_data areas per form. Area 6 (outer aprons with both grab edges,
 * ceilings and walls' floors) is always active; each terrain owns one area range:
 * normal 34–36, fire 0–16 + branch one-ways 17–18, grass 19–33 (windmill),
 * rock 37–50 (cliff), water 55–70 (pond). All five GrPs archives share this table. */
export const STADIUM_AREAS: Readonly<Record<StadiumForm, readonly number[]>> = {
  normal: [6, 4], fire: [6, 1, 2], grass: [6, 3], water: [6, 7], rock: [6, 5],
};
/** Terrain model sources: the base archive's root 3 is the normal center terrain
 * (with both floating platforms); each variant terrain is its own archive. */
export const STADIUM_VARIANT_ARCHIVES: Readonly<Record<typeof STADIUM_VARIANTS[number], string>> = {
  fire: 'GrPs1.dat', grass: 'GrPs2.dat', water: 'GrPs3.dat', rock: 'GrPs4.dat',
};
export const STADIUM_NORMAL_TERRAIN_ROOT = 3;

export interface StadiumTiming { normalMin: number; normalMax: number; variantMin: number; variantMax: number; warning: number; shrink: number; pause: number }
export interface StadiumData {
  forms: Readonly<Record<StadiumForm, StageGameplayData>>; timing: StadiumTiming;
  /** Line ids of the permanent stadium body (area 6); every other line belongs to a terrain that transforms. */
  body: ReadonlySet<number>;
}
/** yakumono_param x0..x18 of GrPs.dat: normal min/max, variant min/max frame
 * counts, monitor warning delay, shrink/grow duration and the pause between. */
export function parseStadium(arc: HsdArchive): StadiumData {
  const y = arc.symbol('yakumono_param');
  const u = (offset: number, label: string) => {
    const value = arc.u32(y + offset);
    if (!Number.isInteger(value) || value < 1 || value > 36000) throw new Error(`Unsupported original stadium ${label}.`);
    return value;
  };
  const timing: StadiumTiming = {
    normalMin: u(0, 'normal duration'), normalMax: u(4, 'normal duration'),
    variantMin: u(8, 'variant duration'), variantMax: u(0xc, 'variant duration'),
    warning: u(0x10, 'warning delay'), shrink: u(0x14, 'transform duration'), pause: u(0x18, 'transform pause'),
  };
  if (timing.normalMax < timing.normalMin || timing.variantMax < timing.variantMin) throw new Error('Unsupported original stadium schedule.');
  const forms = Object.fromEntries(STADIUM_FORMS.map((form) => [form, parseStageGameplay(arc, STADIUM_AREAS[form])])) as Record<StadiumForm, StageGameplayData>;
  for (const form of STADIUM_FORMS) {
    if (forms[form].floors.length < 5) throw new Error('Unsupported original stadium form collision.');
    if (!forms[form].ledges.some((ledge) => ledge.facing === 1) || !forms[form].ledges.some((ledge) => ledge.facing === -1)) throw new Error('Stadium form lost its outer grab edges.');
  }
  const bodyOnly = parseStageGameplay(arc, [6]);
  const body = new Set<number>([...bodyOnly.floors.map((floor) => floor.id), ...(bodyOnly.surfaces ?? []).map((surface) => surface.id)]);
  return { forms, timing, body };
}

/** Terrain lines scaled about y = 0 and shifted, like the original's HSD_JObj scaleY/translateY on the terrain root. */
function transformTerrain(form: StageGameplayData, body: ReadonlySet<number>, scaleY: number, translateY: number, includeBody: boolean, ledges: boolean): { floors: StageGameplayData['floors']; surfaces: NonNullable<StageGameplayData['surfaces']>; ledges: StageGameplayData['ledges'] } {
  const y = (value: number) => Math.fround(value * scaleY + translateY);
  const move = <T extends { id: number; a: [number, number]; b: [number, number] }>(line: T): T => body.has(line.id) ? line : { ...line, a: [line.a[0], y(line.a[1])], b: [line.b[0], y(line.b[1])] };
  const keep = (id: number) => includeBody || !body.has(id);
  return {
    floors: form.floors.filter((floor) => keep(floor.id)).map(move),
    surfaces: (form.surfaces ?? []).filter((surface) => keep(surface.id)).map(move),
    ledges: ledges ? form.ledges.filter((ledge) => keep(ledge.floor)).map((ledge) => body.has(ledge.floor) ? ledge : { ...ledge, y: y(ledge.y) }) : [],
  };
}
const stageCache = new WeakMap<StadiumData, Map<string, StageGameplayData>>();
/** Collision for this frame of the transformation clock (grStadium_801D4548 states 4–5):
 * the sinking terrain collapses to 5 % of its height over `shrink` frames and waits flattened;
 * the rising terrain is live from the first rise frame at 5 % height and −10 units, climbs to
 * 0 during the first half while growing to full height, and the flattened old plate stays
 * live through the rise, sinking to −10 during the second half before it disappears. */
export function stadiumStageAt(data: StadiumData, runtime: StadiumRuntime): StageGameplayData {
  const current = data.forms[runtime.form];
  if (runtime.phase === 'wait' || runtime.phase === 'warn') return current;
  const key = `${runtime.form}:${runtime.phase}:${runtime.timer}:${runtime.lastVariant ?? ''}`;
  let cache = stageCache.get(data);
  if (!cache) { cache = new Map(); stageCache.set(data, cache); }
  const cached = cache.get(key);
  if (cached) return cached;
  const { shrink } = data.timing, half = Math.floor(shrink / 2);
  let stage: StageGameplayData;
  if (runtime.phase === 'shrink' || runtime.phase === 'pause') {
    const scaleY = runtime.phase === 'pause' ? 0.05 : Math.max(0.05, Math.min(1, 0.05 + 0.95 * runtime.timer / shrink));
    stage = { ...current, ...transformTerrain(current, data.body, scaleY, 0, true, true) };
  } else {
    const t = Math.max(1, Math.min(shrink, shrink - runtime.timer));
    const scaleY = 0.05 + 0.95 * t / shrink, translateY = t < half ? -10 * (1 - t / half) : 0;
    const fresh = transformTerrain(current, data.body, scaleY, translateY, true, true);
    const oldForm: StadiumForm | null = runtime.form === 'normal' ? runtime.lastVariant : 'normal';
    const oldTranslate = t <= half ? 0 : -10 * (1 - (shrink - t) / (shrink - half));
    const old = oldForm ? transformTerrain(data.forms[oldForm], data.body, 0.05, oldTranslate, false, false) : { floors: [], surfaces: [], ledges: [] };
    stage = { ...current, floors: [...fresh.floors, ...old.floors], surfaces: [...fresh.surfaces, ...old.surfaces], ledges: fresh.ledges };
  }
  if (cache.size > 2048) cache.clear();
  cache.set(key, stage);
  return stage;
}

/** Authoritative transformation clock; snapshot-owned and driven only by the
 * simulation RNG, so rollback re-simulation reproduces the schedule exactly.
 * `form` is always the form whose collision is active; it advances when the
 * grown terrain takes over (pause → grow edge), like the original mpLib toggles. */
export interface StadiumRuntime { form: StadiumForm; next: StadiumForm | null; lastVariant: StadiumForm | null; phase: 'wait' | 'warn' | 'shrink' | 'pause' | 'grow'; timer: number }
const between = (physics: MeleePhysics, minimum: number, maximum: number): number =>
  minimum + (maximum > minimum ? Math.floor(physics.random() * (maximum - minimum)) : 0);
export function createStadiumRuntime(physics: MeleePhysics, timing: StadiumTiming): StadiumRuntime {
  return { form: 'normal', next: null, lastVariant: null, phase: 'wait', timer: between(physics, timing.normalMin, timing.normalMax) };
}
/** Advances one frame; returns the form whose collision must become active now, if it changed. */
export function stepStadium(runtime: StadiumRuntime, physics: MeleePhysics, timing: StadiumTiming): StadiumForm | null {
  if (--runtime.timer > 0) return null;
  switch (runtime.phase) {
    case 'wait': {
      if (runtime.form === 'normal') {
        // grStadium_801D4548 case 0: reroll so the same variant never repeats back to back.
        let pick = STADIUM_VARIANTS[Math.floor(physics.random() * STADIUM_VARIANTS.length)]!;
        while (pick === runtime.lastVariant) pick = STADIUM_VARIANTS[Math.floor(physics.random() * STADIUM_VARIANTS.length)]!;
        runtime.next = pick;
      } else runtime.next = 'normal';
      runtime.phase = 'warn'; runtime.timer = timing.warning;
      return null;
    }
    case 'warn': runtime.phase = 'shrink'; runtime.timer = timing.shrink; return null;
    case 'shrink': runtime.phase = 'pause'; runtime.timer = timing.pause; return null;
    case 'pause': {
      // The rising terrain owns the ground from here (original mpLib group toggles).
      runtime.form = runtime.next!; runtime.next = null;
      if (runtime.form !== 'normal') runtime.lastVariant = runtime.form;
      runtime.phase = 'grow'; runtime.timer = timing.shrink;
      return runtime.form;
    }
    case 'grow': {
      runtime.phase = 'wait';
      runtime.timer = runtime.form === 'normal' ? between(physics, timing.normalMin, timing.normalMax) : between(physics, timing.variantMin, timing.variantMax);
      return null;
    }
  }
}
