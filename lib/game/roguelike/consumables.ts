/** Pocket consumables (Hades/Slay the Spire potions): earned from doors,
 * flawless floors, bosses, shops and events, spent mid-match in real time
 * through the rogue HUD (keys 1–3). Deliberately engine-light: effects touch
 * plain `percent`/`stocks` numbers, the neutral `rogue` lanes, or the hex
 * status on a structural target — no physics, items or original code paths.
 */
import { createRng } from './seed.ts';

export type ConsumableId = 'draught' | 'smoke' | 'star' | 'feather' | 'storm-jar';
export interface ConsumableDef {
  id: ConsumableId;
  name: string;
  icon: string;
  detail: string;
  price: number;
}
export const CONSUMABLES: readonly ConsumableDef[] = Object.freeze([
  { id: 'draught', name: 'Healing Draught', icon: '🧪', detail: 'Drink: −60% damage right now.', price: 45 },
  { id: 'smoke', name: 'Smoke Bomb', icon: '💣', detail: 'Throw: every rival +25% right now.', price: 45 },
  { id: 'star', name: 'Star Bit', icon: '⭐', detail: 'Wish: restore one spent match stock.', price: 70 },
  { id: 'feather', name: 'Phoenix Feather', icon: '🪶', detail: 'Use: your next KO this floor keeps its stock.', price: 60 },
  { id: 'storm-jar', name: 'Storm in a Jar', icon: '🌩', detail: 'Uncork: every rival takes 12% and deals −30% damage for 5s.', price: 50 },
]);
/** Three pockets, Hades-style: full pockets turn extra rewards into coins. */
export const MAX_CONSUMABLES = 3;
export const CONSUMABLE_OVERFLOW_COINS = 40;

export function consumableById(id: string): ConsumableDef {
  const found = CONSUMABLES.find((entry) => entry.id === id);
  if (!found) throw new Error(`Unknown consumable: ${id}`);
  return found;
}

/** Deterministic reward pick per site key. */
export function offerConsumable(seed: number, key: number): ConsumableId {
  const rng = createRng((seed ^ Math.imul(key + 13, 0x27d4eb2d)) >>> 0);
  return CONSUMABLES[Math.floor(rng() * CONSUMABLES.length)]!.id;
}

interface HexTarget { weakTicks: number; weakMul: number }
/** Minimal structural target: satisfied by a live `LocalMatch` and by tests. */
export interface ConsumableTarget {
  player: { percent: number; stocks: number; rogue: { lastStand: number } };
  foes: Array<{ percent: number; state?: string; hex?: HexTarget | null }>;
  /** Match-stock cap for Star Bit (floor stocks + boon bonus). */
  stockCap: number;
}

/** Apply one consumable to live numbers. Pure arithmetic, no engine calls. */
export function applyConsumable(target: ConsumableTarget, id: ConsumableId): void {
  const living = target.foes.filter((foe) => foe.state !== 'ko' && foe.state !== 'respawn');
  switch (id) {
    case 'draught':
      target.player.percent = Math.max(0, Math.floor(target.player.percent - 60));
      break;
    case 'smoke':
      for (const foe of living) foe.percent = Math.min(999, Math.floor(foe.percent + 25));
      break;
    case 'star':
      if (target.player.stocks >= target.stockCap) throw new Error('Your stocks are already full.');
      target.player.stocks = Math.min(target.stockCap, target.player.stocks + 1);
      break;
    case 'feather':
      target.player.rogue.lastStand += 1;
      break;
    case 'storm-jar':
      for (const foe of living) {
        foe.percent = Math.min(999, Math.floor(foe.percent + 12));
        if ('hex' in foe) {
          const hex = foe.hex ?? { doomTicks: 0, doomAmount: 0, doomBy: -1, weakTicks: 0, weakMul: 1, chillTicks: 0, chillMul: 1, retaliateTicks: 0 };
          hex.weakMul = hex.weakTicks > 0 ? Math.min(hex.weakMul, 0.7) : 0.7;
          hex.weakTicks = 300;
          foe.hex = hex;
        }
      }
      break;
    default:
      throw new Error(`Unknown consumable: ${id as string}`);
  }
}
