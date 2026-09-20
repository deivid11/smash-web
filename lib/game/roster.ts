import type { FighterKind } from './data.ts';
import { CUSTOM_FIGHTERS } from '../custom/registry.ts';
import type { HsdModel } from '../hsd/model.ts';
import { clampCostumeIndex, nanaCostumeKey } from './costumes.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from './limits.ts';
import type { GameContent,FighterContent } from './load.ts';

/** Zelda and Sheik occupy one Melee roster slot: two starting forms joined by
 * the Down-B Transform (the engine swaps the moveset in place mid-match). The
 * select screen renders them as one paired card instead of two fighters. */
export const ZELDA_SHEIK_SLOT = ['Zd', 'Sk'] as const;
export function isPairedSlotKind(kind: FighterKind): boolean {
  return (ZELDA_SHEIK_SLOT as readonly string[]).includes(kind);
}
/** Built-in order is independent of installed packs. Sorted custom kinds append. */
export const ROSTER_CHOICES:readonly FighterKind[]=['Fx','Mr','Kb','Ss','Pk','Fe','Lk','Ca','Dk','Mt','Cl','Pr','Ns','Kp','Pe','Zx','Td','Mk','Sn','Rc','Lz','Fc','Dr','Gn','Pc','Ms','Lg','Pp','Zd','Sk','Gw','Ys','Wf','Dd','De','Wr','Sh','Bl','Lc','Nm','Nt','Da','Fy','Sc','Dl','Kx','Lu','Lc2','Sm','Lb','MM','Sd','Cn','Gk','Ts','Bf','WfU',...CUSTOM_FIGHTERS];
/** Character-select menu order (see web/src/play/battle-select.tsx FIGHTERS): same set as
 * ROSTER_CHOICES, but the ACE wave-2/3/4/5/6/7 block sits before Falco instead of after Yoshi.
 * Debug tools cycle in this order so "next" matches what the player sees on screen. */
export const MENU_FIGHTER_ORDER: readonly FighterKind[] = ['Fx','Mr','Kb','Ss','Pk','Fe','Lk','Ca','Dk','Mt','Cl','Pr','Ns','Kp','Pe','Zx','Td','Mk','Sn','Rc','Lz','Wf','Dd','De','Wr','Sh','Bl','Lc','Nm','Nt','Da','Fy','Sc','Dl','Kx','Lu','Lc2','Sm','Lb','MM','Sd','Cn','Gk','Ts','Bf','WfU','Fc','Dr','Gn','Pc','Ms','Lg','Pp','Zd','Sk','Gw','Ys',...CUSTOM_FIGHTERS];
/** Next fighter after `current` in character-select menu order (wraps around).
 * Unknown kinds restart at the head so a stale pick never sticks the cycler. */
export function nextMenuFighter(current: FighterKind): FighterKind {
  const index = MENU_FIGHTER_ORDER.indexOf(current);
  return MENU_FIGHTER_ORDER[(index + 1) % MENU_FIGHTER_ORDER.length]!;
}
/** Uniform random pick from `pool`, excluding `exclude` (null when the pool is
 * empty or holds only the excluded kind). Pure helper for the debug roulette
 * and the character-select RANDOM button. */
export function pickRandomKind(pool: readonly FighterKind[], exclude?: FighterKind | null): FighterKind | null {
  const options = exclude === undefined || exclude === null ? [...pool] : pool.filter(kind => kind !== exclude);
  if (!options.length) return null;
  return options[(Math.random() * options.length) | 0]!;
}
export function rosterPlayers(content: GameContent, kinds: readonly FighterKind[]): GameContent {
  if (kinds.length < MIN_MATCH_PLAYERS || kinds.length > MAX_MATCH_PLAYERS) throw new Error(`Select ${MIN_MATCH_PLAYERS} to ${MAX_MATCH_PLAYERS} fighters.`);
  const fighters = kinds.map(kind => {
    const fighter = content.roster.get(kind);
    if (!fighter) throw new Error('Unknown fighter selection.');
    return fighter;
  }) as [FighterContent, FighterContent, ...FighterContent[]];
  // LocalMatch forks/configures physics; roster selection must not mutate other worlds.
  return {...content, fighters};
}
export function rosterPair(content:GameContent,a:FighterKind,b:FighterKind):GameContent {
  return rosterPlayers(content, [a, b]);
}
/** Per-slot costume lineup: every slot gets its own content object sharing the
 * base fighter's clips, attacks, articles and physics, with only the model
 * (and its costume index) swapped. Mirror matches can wear different skins.
 * `models` maps `kind:index` to the loaded costume model; index 0 (or a
 * missing entry) keeps the roster `Nr` model. A Zelda/Sheik slot also carries
 * the counterpart's same-index model so a Transform keeps the costume. An Ice
 * Climbers slot also carries Nana's same-index model (`Pp:nana:<index>`, see
 * nanaCostumeKey) when it is loaded; without it the slot plays solo Popo. */
export function selectLineup(content: GameContent, picks: readonly { fighter: FighterKind; costume: number }[], models: ReadonlyMap<string, HsdModel> = new Map()): GameContent {
  if (picks.length < MIN_MATCH_PLAYERS || picks.length > MAX_MATCH_PLAYERS) throw new Error(`Select ${MIN_MATCH_PLAYERS} to ${MAX_MATCH_PLAYERS} fighters.`);
  const pair = (kind: FighterKind): FighterKind | null => kind === 'Zd' ? 'Sk' : kind === 'Sk' ? 'Zd' : null;
  const fighters = picks.map(({ fighter: kind, costume }) => {
    const base = content.roster.get(kind);
    if (!base) throw new Error('Unknown fighter selection.');
    const index = clampCostumeIndex(kind, costume);
    if (index === 0) return base;
    const model = models.get(`${kind}:${index}`);
    if (!model) throw new Error(`Costume ${index} for ${kind} is not loaded.`);
    const counterpart = pair(kind);
    const transformModel = counterpart ? models.get(`${counterpart}:${index}`) ?? undefined : undefined;
    // A costumed Nana overrides the roster default; without her loaded skin the
    // slot keeps the base (Nr) partner instead of dropping to solo Popo.
    const nanaModel = kind === 'Pp' && index > 0 ? models.get(nanaCostumeKey(index)) : undefined;
    return { ...base, model, costume: index, transformModel, ...(nanaModel ? { partnerModel: nanaModel } : {}) };
  }) as [FighterContent, FighterContent, ...FighterContent[]];
  return { ...content, fighters };
}
/** Preserve legacy solo Mario's slot so existing P1-key/solo mappings remain
 * compatible; all other combinations, including mirrors, use normal slots. */
export function selectRoster(content:GameContent,choice:number,rival:number|'auto',mode:'bot'|'human'):{content:GameContent;player:0|1} {
  const chosen=ROSTER_CHOICES[choice];if(!chosen)throw Error('Invalid fighter choice.');
  const opponent=rival==='auto'?(chosen==='Fx'?'Mr':'Fx'):ROSTER_CHOICES[rival];if(!opponent)throw Error('Invalid rival choice.');
  if(mode==='bot'&&chosen==='Mr'&&opponent==='Fx')return {content:rosterPair(content,'Fx','Mr'),player:1};
  return {content:rosterPair(content,chosen,opponent),player:0};
}
