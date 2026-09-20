import type { OriginalFighterKind } from './data.ts';

/** ACE 2.0 fighter voices.
 *
 * The ACE extension disc ships per-fighter SSM voice banks, and its own
 * `smash2.sem` does script them: banks 55+ past the vanilla table (Raichu =
 * bank 80). m-ex plays a fighter's `5000 + n` as script n of that bank, so
 * the faithful route is `routeAceSound` below (the ACE sem is served as
 * `audio/us/smash2.ace.sem`; the vanilla sem cannot be swapped, ACE renumbers
 * the vanilla samples). Fighters not yet moved to that route keep the older
 * slot remap: without either, their 5xxx ids are silent.
 *
 * Mapping rule (slot semantics, not id arithmetic): each fighter's SSM bank
 * lists its samples in the order of the mexproj `data/sounds/<bank>.json`
 * sound list (pinned commit `7a5c107cf1` of Chri222k/ACE-BUILD-PUBLIC-;
 * list length always equals the SSM sample count on the ISO). The vanilla
 * convention pins the slots: Mario/Fox `ko` resolve through the vanilla
 * SEM to their banks' `*_rakka4` samples, `jump`/`airJump` to
 * `*_jump1`/`*_jump2`. The overrides below pick the same slots in each
 * ACE bank, so `resolveAceVoice` translates a dead 5xxx FtSFX id into the
 * bank sample the slot names (verified against the ISO sample counts).
 * Sample contents are the mod's as shipped (several wave-1 banks clone
 * Link/Mario SFX names with custom audio); this wires the right slots,
 * it does not recast the voices.
 *
 * Only 5xxx-range FtSFX ids are ever replaced: vanilla ids, generic
 * bank-0 cues (71/74 jump whooshes several ACE fighters share) and the
 * 540000 silent sentinel pass through untouched. Banks whose mexproj
 * sound list carries no semantic names (wolf/diddy/lizardon/raichu/
 * blastoise/fay/bmsonic/skullkid: `Untitled`/`Sound_NNN`) keep their
 * FtSFX ids unresolved here — their hand-mapped special-move voices in
 * `*-data.ts` (direct sample ids, audible through the play-audio
 * fallback) are unaffected. Damage grunts (`x1C`/`x20` arrays), ledge,
 * grab and passive voices stay unwired for every fighter; see
 * docs/characters/ACE_FIGHTERS.md. */

export type AceVoiceSlot = 'jump' | 'airJump' | 'ko';

/** SSM bank ranges read from the ACE 2.0 ISO (`audio/us/<file>`). */
export const ACE_SSM_RANGES: Record<string, { file: string; base: number; count: number }> = {
  Zx: { file: 'zero.ssm', base: 2393, count: 37 },
  Td: { file: 'toad.ssm', base: 2562, count: 36 },
  Mk: { file: 'metaknight.ssm', base: 2133, count: 40 },
  Sn: { file: 'sonic.ssm', base: 1709, count: 40 },
  Rc: { file: 'raichu.ssm', base: 1978, count: 36 },
  Lz: { file: 'lizardon.ssm', base: 1632, count: 38 },
  Wf: { file: 'wolf.ssm', base: 1566, count: 35 },
  Dd: { file: 'diddy.ssm', base: 1601, count: 31 },
  De: { file: 'dedede.ssm', base: 1812, count: 33 },
  Wr: { file: 'wario.ssm', base: 1916, count: 32 },
  Sh: { file: 'shadow.ssm', base: 2523, count: 39 },
  Bl: { file: 'blastoise.ssm', base: 2471, count: 26 },
  Lc: { file: 'lucas.ssm', base: 1670, count: 39 },
  Nm: { file: 'metal_sonic.ssm', base: 2320, count: 40 },
  Nt: { file: 'ninten.ssm', base: 2281, count: 39 },
  Da: { file: 'daisy.ssm', base: 1948, count: 30 },
  Fy: { file: 'fay.ssm', base: 2083, count: 50 },
  Sc: { file: 'bmsonic.ssm', base: 2173, count: 33 },
  Dl: { file: 'drluigi.ssm', base: 2246, count: 35 },
  Kx: { file: 'knuckles.ssm', base: 2360, count: 33 },
  Lu: { file: 'lucina.ssm', base: 2430, count: 41 },
  Lc2: { file: 'lucas_001.ssm', base: 2730, count: 41 },
  Sm: { file: 'smewtwo.ssm', base: 2014, count: 34 },
  Lb: { file: 'luigiandboo.ssm', base: 2206, count: 40 },
  Sd: { file: 'skullkid.ssm', base: 2048, count: 35 },
  Cn: { file: 'chun-li.ssm', base: 2497, count: 26 },
  Ts: { file: 'tails.ssm', base: 1854, count: 32 },
  WfU: { file: 'wolf_001.ssm', base: 2694, count: 36 },
};

/** Dead-5xxx FtSFX slot -> direct SSM sample id (base + mexproj sound-list
 * index). Comment cites the slot name; indices verified against
 * `data/sounds/<bank>.json` at the pinned mexproj commit. Absent slots
 * keep whatever the FtSFX table carries (generic cue, silent sentinel,
 * or an unmapped bank without semantic names). */
export const ACE_VOICE_OVERRIDES: Partial<Record<OriginalFighterKind, Partial<Record<AceVoiceSlot, number>>>> = {
  // Zero: v_link_jump1(17)/jump2(18)/rakka4(21).
  Zx: { jump: 2410, airJump: 2411, ko: 2414 },
  // Toad: v_mario_jump(20)/jump2(21)/rakka4(27).
  Td: { jump: 2582, airJump: 2583, ko: 2589 },
  // Meta Knight: v_metaknight_jump(16)/jump2(17)/rakka4(24).
  Mk: { jump: 2149, airJump: 2150, ko: 2157 },
  // Sonic: ko v_sonic_rakka4(27). Jump slots stay silent as shipped (FtSFX 540000;
  // the bank's jump2 slot is digital silence anyway).
  Sn: { ko: 1736 },
  // Dedede keeps the generic jump whoosh (71); airJump v_dedede_jump(20), ko v_dedede_die(25).
  De: { airJump: 1832, ko: 1837 },
  // Wario's bank holds jump SFX rather than jump voices: se_wario_jump(10)/jump2(11)/rakka4(17).
  Wr: { jump: 1926, airJump: 1927, ko: 1933 },
  // Shadow: air jump reuses v_shadow_jump(20) — the bank's jump2 slot is digital
  // silence — and ko v_shadow_rakka4(27). Ground jump stays silent (540000 in FtSFX).
  Sh: { airJump: 2543, ko: 2550 },
  // Lucas: v_lucas_rakka4(18); ground jump is the generic whoosh, air jump has no voice slot.
  Lc: { ko: 1688 },
  // Metal Sonic: se_metalsonic_jump0(1)/jump1(2); ko stays Fox's 110070 as shipped.
  Nm: { jump: 2321, airJump: 2322 },
  // Ninten: v_lucas_rakka4(18).
  Nt: { ko: 2299 },
  // Daisy: se_daisy_jump(18)/rakka4(15).
  Da: { jump: 1966, ko: 1963 },
  // Dr. Luigi: v_drluigi_jump(24)/jump2(25)/rakka4(31).
  Dl: { jump: 2270, airJump: 2271, ko: 2277 },
  // Knuckles: v_knuckles_rakka4(22); jumps stay silent.
  Kx: { ko: 2382 },
  // Lucina: v_lucina_jump(22)/rakka4(29).
  Lu: { jump: 2452, ko: 2459 },
  // Lucas TDX: v_lucas_rakka4(18).
  Lc2: { ko: 2748 },
  // Shadow Mewtwo: v-smewtwo-rakka4(23).
  Sm: { ko: 2037 },
  // Luigi & Boo: v_luigi_jump(24)/jump2(25)/rakka4(31).
  Lb: { jump: 2230, airJump: 2231, ko: 2237 },
  // Chun-Li: v_chun_li_rakka4(19).
  Cn: { ko: 2516 },
  // Tails: v_tails_rakka4(18); jump slots stay silent as shipped (FtSFX 540000).
  Ts: { ko: 1872 },
  // Wolf / Wolf SSBU / Diddy: routed through their SEM banks (SEM_ROUTED_ACE_KINDS).
};

/** Translate one FtSFX voice id into a playable sample id. Only ids in the
 * modded 5xxx namespace with a mapped slot are replaced; everything else
 * (vanilla SEM ids, generic bank-0 cues, the 540000 sentinel, unmapped
 * banks) passes through so vanilla behavior never changes. */
export function resolveAceVoice(kind: OriginalFighterKind, slot: AceVoiceSlot, rawId: number): number {
  if (!Number.isInteger(rawId) || rawId < 5000 || rawId >= 6000) return rawId;
  return ACE_VOICE_OVERRIDES[kind]?.[slot] ?? rawId;
}

/** m-ex fighter-relative sound ids: `5000 + n` plays script `n` of the fighter's own
 * SEM bank (`bank * 10000 + n`), exactly how PlRc's scripts mirror Pikachu's
 * `240000 + n`. The bank's scripts live in the ACE disc's own smash2.sem (exposed as
 * `audio/us/smash2.ace.sem`, bank found by its first SSM sample). Enabled per fighter
 * as each port is verified; the others keep the slot overrides above. */
export const SEM_ROUTED_ACE_KINDS: ReadonlySet<OriginalFighterKind> = new Set<OriginalFighterKind>(['Rc', 'Sd', 'Wf', 'WfU', 'Dd']);
export function routeAceSound(bank: number | undefined, id: number): number {
  return bank !== undefined && Number.isInteger(id) && id >= 5000 && id < 6000 ? bank * 10000 + (id - 5000) : id;
}
