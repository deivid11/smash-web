/** Rift Descent patrons: Hades-style boon families. Each patron owns a small set
 * of boons around one combat idea (arcs, launch power, burn, guard, blood,
 * crits, mobility); room doors show which patron pays out. `rift` and `chaos`
 * never appear on doors — they stock treasure, shops and events.
 * Prototype data only; not Melee.
 */
export type PatronId = 'volt' | 'tide' | 'ember' | 'aegis' | 'blood' | 'hunt' | 'gale' | 'rift' | 'chaos';

export interface PatronDef {
  id: PatronId;
  name: string;
  title: string;
  icon: string;
  /** Card/HUD accent (CSS color). */
  color: string;
  theme: string;
}

export const PATRONS: Readonly<Record<PatronId, PatronDef>> = Object.freeze({
  volt: { id: 'volt', name: 'VOLTRA', title: 'the Storm', icon: '⚡', color: '#6fd3ff', theme: 'Arcs, jolts and thunderclaps.' },
  tide: { id: 'tide', name: 'MAELSTROM', title: 'the Tide', icon: '🌊', color: '#4a8cff', theme: 'Launch power and undertow.' },
  ember: { id: 'ember', name: 'PYRA', title: 'the Blaze', icon: '🔥', color: '#ff7a3a', theme: 'Burns, doom and fury.' },
  aegis: { id: 'aegis', name: 'AEGIS', title: 'the Bulwark', icon: '🛡', color: '#ffd75e', theme: 'Armor, thorns and last stands.' },
  blood: { id: 'blood', name: 'NOCTURNE', title: 'the Blood Moon', icon: '🩸', color: '#ff5470', theme: 'Leech, feast and rage.' },
  hunt: { id: 'hunt', name: 'SAGITTA', title: 'the Huntress', icon: '🎯', color: '#9fe86a', theme: 'Crits and executions.' },
  gale: { id: 'gale', name: 'ZEPHYR', title: 'the Gale', icon: '💨', color: '#c9a6ff', theme: 'Speed, wings and tolls.' },
  rift: { id: 'rift', name: 'THE RIFT', title: 'itself', icon: '◈', color: '#9aa3ff', theme: 'Lives, stocks and score.' },
  chaos: { id: 'chaos', name: 'CHAOS', title: 'the Primordial', icon: '🌀', color: '#d05cff', theme: 'Great power, real price.' },
});

/** Patrons that can sponsor a room door. */
export const DOOR_PATRONS: readonly PatronId[] = ['volt', 'tide', 'ember', 'aegis', 'blood', 'hunt', 'gale'];

export function patronById(id: string): PatronDef {
  const patron = (PATRONS as Record<string, PatronDef | undefined>)[id];
  if (!patron) throw new Error(`Unknown patron: ${id}`);
  return patron;
}
