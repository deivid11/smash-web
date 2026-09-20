/** Rift Descent "?" rooms: Slay the Spire-style events with trade-off choices.
 * Pure data. Outcomes are resolved by `chooseEventOption` in
 * `lib/game/roguelike/run-state.ts`; this module only declares the menu and
 * the requirements each option checks. English text is the source of truth;
 * `web/src/play/roguelike-text.ts` carries the Spanish table.
 */
export type EventId = 'charon-well' | 'chaos-gate' | 'fountain' | 'trophy' | 'blood-altar' | 'hat' | 'sparring' | 'storm' | 'merchant' | 'echo';

export const EVENT_IDS: readonly EventId[] = ['charon-well', 'chaos-gate', 'fountain', 'trophy', 'blood-altar', 'hat', 'sparring', 'storm', 'merchant', 'echo'];

export interface EventOptionDef {
  id: string;
  label: string;
  detail: string;
  /** Coins spent on pick. */
  coins?: number;
  /** Run lives spent on pick (never the last one). */
  lives?: number;
  /** Max run lives spent on pick (never below 1). */
  maxLives?: number;
  /** Needs at least one owned boon / an upgradable boon. */
  needsBoons?: boolean;
  needsUpgradable?: boolean;
}

export interface EventDef {
  id: EventId;
  icon: string;
  title: string;
  text: string;
  options: readonly EventOptionDef[];
}

const LEAVE: EventOptionDef = { id: 'leave', label: 'Walk on', detail: 'Nothing gained, nothing lost.' };

export const EVENTS: Readonly<Record<EventId, EventDef>> = Object.freeze({
  'charon-well': {
    id: 'charon-well', icon: '🪙', title: 'Well of Charon',
    text: 'A coin-choked well hums with old wishes. Something glints at the bottom.',
    options: [
      { id: 'toss', label: 'Toss a coin', detail: 'Pay 50 coins: gain a random pocket item.', coins: 50 },
      { id: 'dive', label: 'Dive for the glint', detail: 'Lose 1 run life: gain 160 coins.', lives: 1 },
      LEAVE,
    ],
  },
  'chaos-gate': {
    id: 'chaos-gate', icon: '🌀', title: 'Chaos Gate',
    text: 'A swirling gate whispers of power with strings attached.',
    options: [
      { id: 'enter', label: 'Step through', detail: 'Choose 1 of 3 Chaos pacts: great power, a real price.' },
      LEAVE,
    ],
  },
  fountain: {
    id: 'fountain', icon: '⛲', title: 'Fountain of Dreams',
    text: 'Clear water hums a lullaby. It remembers every fighter who rested here.',
    options: [
      { id: 'drink', label: 'Drink', detail: 'Restore 1 run life (or +1 max life if full).' },
      { id: 'bathe', label: 'Bathe your gear', detail: 'Upgrade one of your boons by 1 level.', needsUpgradable: true },
      LEAVE,
    ],
  },
  trophy: {
    id: 'trophy', icon: '🏆', title: 'Golden Trophy',
    text: 'A trophy of a fighter you almost remember. The pedestal has a pressure plate.',
    options: [
      { id: 'take', label: 'Grab it', detail: 'Gain 160 coins. Your next fight: rivals +1 level and ENRAGED.' },
      LEAVE,
    ],
  },
  'blood-altar': {
    id: 'blood-altar', icon: '🩸', title: 'Blood Altar',
    text: 'A basin carved from a shield. It asks for something you cannot get back.',
    options: [
      { id: 'offer', label: 'Offer your blood', detail: 'Lose 1 max run life: choose 1 of 3 EPIC boons.', maxLives: 1 },
      LEAVE,
    ],
  },
  hat: {
    id: 'hat', icon: '🎩', title: 'Mysterious Hat',
    text: 'A floppy pink hat sits on a rock. It clearly wants a head.',
    options: [
      { id: 'wear', label: 'Put it on', detail: 'Gain a random boon from a random patron.' },
      { id: 'sell', label: 'Sell it', detail: 'Gain 90 coins.' },
    ],
  },
  sparring: {
    id: 'sparring', icon: '🥋', title: 'Sparring Hall',
    text: 'Quiet mats and old lessons. A sensei nods at your gear.',
    options: [
      { id: 'meditate', label: 'Meditate', detail: 'Remove one boon from your build and gain 60 coins.', needsBoons: true },
      { id: 'drill', label: 'Drill', detail: 'Pay 60 coins: upgrade one boon by 2 levels.', coins: 60, needsUpgradable: true },
      LEAVE,
    ],
  },
  storm: {
    id: 'storm', icon: '⛈', title: 'Rift Storm',
    text: 'The sky splits open. Power rains down on anyone reckless enough to stand in it.',
    options: [
      { id: 'embrace', label: 'Embrace the storm', detail: 'Choose 1 of 3 RARE+ boons now. Your next 2 fights: rivals +1 level and STORMBORN.' },
      { id: 'shelter', label: 'Take shelter', detail: 'Gain a Storm in a Jar.' },
    ],
  },
  merchant: {
    id: 'merchant', icon: '🎒', title: 'Wandering Merchant',
    text: 'A cloaked traveler opens a heavy pack. "No refunds."',
    options: [
      { id: 'mystery', label: 'Mystery power', detail: 'Pay 100 coins: choose 1 of 3 RARE+ boons.', coins: 100 },
      { id: 'supplies', label: 'Supplies', detail: 'Pay 40 coins: gain a random pocket item.', coins: 40 },
      LEAVE,
    ],
  },
  echo: {
    id: 'echo', icon: '👻', title: 'Echo of Yourself',
    text: 'Your own silhouette steps out of the rift and raises its fists.',
    options: [
      { id: 'face', label: 'Face your echo', detail: 'Your next fight adds a mirror of you (+1 level). Its reward is upgraded and pays +200 score.' },
      LEAVE,
    ],
  },
});

export function eventById(id: string): EventDef {
  const found = (EVENTS as Record<string, EventDef | undefined>)[id];
  if (!found) throw new Error(`Unknown event: ${id}`);
  return found;
}
