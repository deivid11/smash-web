import { MAX_MATCH_PLAYERS } from './limits.ts';

/** Stable slot colors shared by lobby, HUD, tags and supplemental effects. */
export const PLAYER_PRESENTATIONS = [
  { key: 'one', color: 0xff5367, ink: '#ffffff' },
  { key: 'two', color: 0x72a7ff, ink: '#071126' },
  { key: 'three', color: 0xffdc67, ink: '#281b02' },
  { key: 'four', color: 0x74e6c6, ink: '#052219' },
  { key: 'five', color: 0xc391ff, ink: '#17052d' },
  { key: 'six', color: 0xffad66, ink: '#291303' },
  { key: 'seven', color: 0xf88fd0, ink: '#290c23' },
  { key: 'eight', color: 0x7ce5ff, ink: '#051e27' },
] as const;
export function playerPresentation(slot: number) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_MATCH_PLAYERS) throw new Error('Invalid player presentation slot.');
  const presentation = PLAYER_PRESENTATIONS[slot]!;
  return { ...presentation, css: `#${presentation.color.toString(16).padStart(6, '0')}` };
}
