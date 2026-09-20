import type { FighterKind } from './data.ts';

/** Original costume suffixes, in fixed selector order (Normal first, then the
 * team red/blue/green, then the extras). Every shipped fighter reuses the
 * exact same skeleton, scripts and articles in every costume: only the
 * `Pl<kind><suffix>.dat` model differs, so costumes are visual-only and never
 * affect simulation, rollback hashes or online determinism. */
export const COSTUME_SUFFIX_ORDER = ['Nr', 'Re', 'Bu', 'Gr', 'Ye', 'Bk', 'Wh', 'La', 'Or', 'Pi', 'Aq', 'Gy'] as const;
export type CostumeSuffix = (typeof COSTUME_SUFFIX_ORDER)[number];
export const COSTUME_NAMES: Record<string, string> = {
  Nr: 'Default', Re: 'Red', Bu: 'Blue', Gr: 'Green', Ye: 'Yellow', Bk: 'Black',
  Wh: 'White', La: 'Lavender', Or: 'Orange', Pi: 'Pink', Aq: 'Aqua', Gy: 'Graphite',
  Pu: 'Purple', Br: 'Brown', Cy: 'Cyan', Ma: 'Magenta', Tn: 'Tan', Yl: 'Yellow',
  Rd: 'Red', Gn: 'Green', Bl: 'Blue', Dark: 'Dark', Iv: 'Ivory', Cr: 'Crimson',
};
/** Verified against the USA v1.02 disc: every listed `Pl<kind><suffix>.dat`
 * exists. Zelda and Sheik share the same five-suffix order so a Transform
 * keeps the costume index on both sides of the pair. */
export const FIGHTER_COSTUMES: Record<string, readonly string[]> = {
  Fx: ['Nr', 'Gr', 'La', 'Or'],
  Mr: ['Nr', 'Bu', 'Gr', 'Ye', 'Bk'],
  Kb: ['Nr', 'Re', 'Bu', 'Gr', 'Ye', 'Wh'],
  Ss: ['Nr', 'Gr', 'Bk', 'La', 'Pi'],
  Pk: ['Nr', 'Re', 'Bu', 'Gr'],
  Mt: ['Nr', 'Re', 'Bu', 'Gr'],
  Fe: ['Nr', 'Re', 'Bu', 'Gr', 'Ye'],
  Lk: ['Nr', 'Re', 'Bu', 'Bk', 'Wh'],
  Ca: ['Nr', 'Re', 'Bu', 'Gr', 'Wh', 'Gy'],
  Dk: ['Nr', 'Re', 'Bu', 'Gr', 'Bk'],
  Cl: ['Nr', 'Re', 'Bu', 'Bk', 'Wh'],
  Pr: ['Nr', 'Re', 'Bu', 'Gr', 'Ye'],
  Ns: ['Nr', 'Bu', 'Gr', 'Ye'],
  Kp: ['Nr', 'Re', 'Bu', 'Bk'],
  Pe: ['Nr', 'Bu', 'Gr', 'Ye', 'Wh'],
  Fc: ['Nr', 'Re', 'Bu', 'Gr'],
  Dr: ['Nr', 'Re', 'Bu', 'Gr', 'Bk'],
  Gn: ['Nr', 'Re', 'Bu', 'Gr', 'La'],
  Pc: ['Nr', 'Re', 'Bu', 'Gr'],
  Ms: ['Nr', 'Re', 'Gr', 'Bk', 'Wh'],
  Lg: ['Nr', 'Wh', 'Pi', 'Aq'],
  Pp: ['Nr', 'Re', 'Gr', 'Or'],
  Zd: ['Nr', 'Re', 'Bu', 'Gr', 'Wh'],
  Sk: ['Nr', 'Re', 'Bu', 'Gr', 'Wh'],
  Gw: ['Nr'],
  Ys: ['Nr', 'Re', 'Bu', 'Ye', 'Pi', 'Aq'],
  // ACE 2.0 extension-disc fighters (mod-authored variants verified on ace-2.0.iso).
  // Exotic suffixes are form/color slots without canonical names (shown raw).
  // Skipped non-skins: *AJ/*DViWaitAJ anims, *HUD art, trophy/effect stubs
  // (SmTr1/3/5), Toad's Et/Fire/Ice/Wt element forms, Sonic's Sw2, Raichu's
  // Cp/Lt, Charizard's Sh, Meta Knight's Dark (pre-existing boundary:
  // ace-fighters-real.test.ts). Wolf's _001 skins dress Wolf SSBU (WfU).
  Zx: ['Nr', 'Bu', 'Gr', 'Bk', 'Wh', 'Pu'],
  Td: ['Nr', 'Re', 'Bu', 'Gr', 'Ye'],
  Mk: ['Nr', 'Gr', 'Bk', 'Wh', 'Gk', 'Mr'],
  Sn: ['Nr', 'Re', 'Gr', 'Ye', 'Bk', 'Wh', 'Or'],
  Rc: ['Nr', 'Re', 'Bu', 'Gr', 'Bk', 'Wh'],
  Lz: ['Nr', 'Re', 'Bu', 'Gr', 'La', 'Ye'],
  Wf: ['Nr', 'Bu', 'Gr', 'Ye', 'Br', 'Rd'],
  Dd: ['Nr', 'Bu', 'Gr', 'Ye', 'Wh', 'Pi'],
  De: ['Nr', 'Bu', 'Gr', 'Wh', 'Bk', 'Ma', 'Or', 'Pi', 'Sh'],
  Wr: ['Nr', 'Re', 'Gr', 'Wh', 'Br', 'La', 'Pi', 'Aq'],
  Sh: ['Nr', 'Bl', 'Gn', 'Yl', 'Mg', 'Mp', 'Tr'],
  Bl: ['Nr', 'Re', 'Bu', 'Gr', 'La', 'Ye'],
  Lc: ['Nr', 'Re', 'Bu', 'Gr', 'Bk', 'Or', 'Pi'],
  Nm: ['Nr', 'Re', 'Gr', 'Ye', 'Bk', 'Gy'],
  Nt: ['Nr', 'Re', 'Bu', 'Gr', 'Pu', 'Aq'],
  Da: ['Nr', 'Re', 'Bu', 'Gr', 'Wh', 'Bk', 'La', 'Pi', 'Tn'],
  Fy: ['Nr', 'Re', 'Bu', 'Gr'],
  Sc: ['Nr', 'Re', 'Gr', 'Wh', 'Bk', 'We'],
  Dl: ['Nr', 'Gr', 'Ye', 'Bk', 'Pi', 'Aq'],
  Kx: ['Nr', 'Gr', 'Ye', 'Wh', 'Bk', 'Bl', 'Cy', 'Og', 'Pr', 'Tk', 'Wr'],
  Lu: ['Nr', 'Re', 'Gr', 'Ye', 'Wh', 'Bk', 'Ms'],
  Lc2: ['Nr', 'Re', 'Bu', 'Gr', 'La', 'Or', 'Cl'],
  Sm: ['Nr', 'Re', 'Bu', 'Gr', 'La', 'Br', 'Iv'],
  Lb: ['Nr', 'Wh', 'Pi', 'Aq', 'St'],
  MM: ['Nr', 'Re', 'Bu', 'Gr', 'Ye', 'Pu', 'Cy', 'Cr', 'Rb'],
  Sd: ['Nr', 'Bu', 'Gr', 'Wh', 'Pu'],
  Gk: ['Nr', 'Re', 'Ye', 'Wh'],
  Ts: ['Nr', 'Re', 'Bu', 'Gr', 'Bk', 'Wh', 'Pr'],
  Bf: ['Nr', 'Bu', 'Gr', 'Ye', 'Pu'],
  WfU: ['Nr', 'Bu', 'Gr', 'Ye', 'Br', 'Rd'],
};
/** Clone slots whose model files do not follow `Pl<kind><suffix>.dat`: Wolf SSBU
 * dresses in Wolf's `_001` variants (verified on ace-2.0.iso). */
const COSTUME_FILE_PATTERNS: Record<string, (suffix: string) => string> = {
  WfU: (suffix) => `PlWf${suffix}_001.dat`,
};
/** Costumes per roster fighter (custom/modded fighters ship one model). */
export function fighterCostumes(kind: FighterKind): readonly string[] {
  return FIGHTER_COSTUMES[kind as string] ?? (['Nr'] as const);
}
export function costumeCount(kind: FighterKind): number {
  return fighterCostumes(kind).length;
}
/** Out-of-range picks clamp (never wrap): a stale saved index stays selectable. */
export function clampCostumeIndex(kind: FighterKind, index: number): number {
  if (!Number.isInteger(index)) return 0;
  return Math.min(Math.max(index, 0), costumeCount(kind) - 1);
}
/** Exact disc model file for a fighter costume (index 0 is the `Nr` default). */
export function costumeModelFile(kind: FighterKind, index: number): string {
  const suffix = fighterCostumes(kind)[clampCostumeIndex(kind, index)]!;
  return COSTUME_FILE_PATTERNS[kind as string]?.(suffix) ?? `Pl${kind}${suffix}.dat`;
}
/** Nana's own costume suffixes in skin-index order. Popo wears Nr/Re/Gr/Or
 * but the USA v1.02 disc holds NO PlNnRe/Gr/Or files — Nana's four skins
 * are Nr/Aq/Wh/Ye (verified against the disc file table). Never derive her
 * filenames from Popo's suffix list. */
export const NANA_COSTUMES = ['Nr', 'Aq', 'Wh', 'Ye'] as const;
/** Nana's disc model file in her own suffix order (`PlNn*.dat`): the duo
 * shares one skin index, so a costume pick dresses both climbers. There is
 * never an `Nn` roster kind — she rides Popo's slot as the partner model. */
export function nanaCostumeFile(index: number): string {
  const clamped = Number.isInteger(index) ? Math.min(Math.max(index, 0), NANA_COSTUMES.length - 1) : 0;
  return `PlNn${NANA_COSTUMES[clamped]}.dat`;
}
/** Costume-model map key for Nana's skin (Popo's own skins keep `Pp:<index>`). */
export function nanaCostumeKey(index: number): string {
  return `Pp:nana:${clampCostumeIndex('Pp', index)}`;
}
export function costumeName(kind: FighterKind, index: number): string {
  const suffix = fighterCostumes(kind)[clampCostumeIndex(kind, index)]!;
  return COSTUME_NAMES[suffix] ?? suffix;
}
/** Portrait cache key: index 0 keeps the bare kind so every existing lookup,
 * cached thumbnail and fallback keeps working unchanged. */
export function portraitKey(kind: FighterKind, costume: number): string {
  return costume > 0 ? `${kind}:${clampCostumeIndex(kind, costume)}` : kind;
}
export function portraitFor(portraits: Readonly<Record<string, string>>, kind: FighterKind, costume: number): string | undefined {
  return portraits[portraitKey(kind, costume)] ?? portraits[kind];
}
