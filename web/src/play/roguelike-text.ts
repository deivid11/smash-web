/** Rift Descent localization (EN/ES): every user-facing string in
 * `web/src/play/roguelike-scenes.tsx` and `web/src/play/roguelike-hud.tsx`
 * comes from here. Canonical game data (boon/patron/event ids) stays English
 * in `lib/game/roguelike/`; this module only maps presentation text. `EN` is
 * the source of truth — `ES` must match its keys exactly (enforced by `typeof EN`).
 */
import { useSyncExternalStore } from 'react';
import { Store } from './store.ts';
import { boonValue, describeBoon, formatValue, type BoonDef, type BoonKind, type BoonRarity } from '../../../lib/game/roguelike/boons.ts';
import type { FoeAffix } from '../../../lib/game/roguelike/affixes.ts';
import type { FloorModifier, NodeKind, RewardKind } from '../../../lib/game/roguelike/generator.ts';
import type { ConsumableDef } from '../../../lib/game/roguelike/consumables.ts';
import type { EventDef, EventOptionDef } from '../../../lib/game/roguelike/events.ts';
import { mirrorTotal, type BlessingDef, type MirrorDef } from '../../../lib/game/roguelike/meta.ts';
import type { PatronDef } from '../../../lib/game/roguelike/patrons.ts';
import type { AspectDef, RelicDef } from '../../../lib/game/roguelike/unlocks.ts';
import type { BossDef, TreasureDef } from '../../../lib/game/roguelike/bosses.ts';

export type RogueLocale = 'en' | 'es';

const EN = {
  proto: 'PROTOTYPE',
  scopeNote: 'Prototype run map, powers and rift platforms over original fighters, stages, CPU AI and physics. Not Melee, not tournament play.',
  riftNote: 'RIFT PLATFORMS: pass-through platforms shifted; solid ground, blast zones and spawns stay original. Visuals approximate.',
  formatDuel: '1 VS 1',
  formatDuelDetail: 'A straight duel.',
  formatTeam: '{n} VS 1',
  formatTeamDetail: 'Your rivals are a team: they never hit each other.',
  formatFfa: 'FREE-FOR-ALL',
  formatFfaDetail: 'Every fighter for themselves: rivals hit each other too.',
  formatFfaShort: 'FFA',
  setupEyebrow: 'SOLO ROGUELIKE · 1 HUMAN VS THE RIFT',
  setupLede: 'Descend a seeded map of fights, events, shops and bosses. Earn patron boons, build synergies, and spend shards in the Mirror between runs.',
  chooseFighter: 'CHOOSE YOUR FIGHTER',
  soloRulesNote: 'Descent rules apply: seats only choose your fighter.',
  seed: 'SEED',
  seedPlaceholder: 'RIFT-XXXX (blank = random)',
  random: '🎲 RANDOM',
  length: 'LENGTH',
  floorsUnit: 'floors',
  wrath: 'WRATH',
  emberName: 'EMBER',
  flameName: 'FLAME',
  infernoName: 'INFERNO',
  emberBlurb: 'Gentle climb · rookie CPUs',
  flameBlurb: 'True rite · skilled CPUs',
  infernoBlurb: 'No mercy · elite CPUs',
  heatName: 'HEAT · PACT OF PAIN',
  heatNone: 'No pacts. Honest descent.',
  heatLower: 'Lower heat',
  heatRaise: 'Raise heat',
  towerTitle: 'MAP PREVIEW',
  towerHint: 'Type a seed (or roll 🎲) to preview the map.',
  towerPreviewAria: 'map preview',
  best: 'BEST',
  pts: 'pts',
  modes: '◀ MODES',
  enterRift: 'ENTER THE RIFT ▶',
  floor: 'FLOOR',
  you: 'YOU',
  versus: 'VS',
  stocksUnit: 'stocks',
  abandon: 'ABANDON RUN',
  fight: 'FIGHT ▶',
  score: 'SCORE',
  floorsWord: 'FLOORS',
  kos: 'KOs',
  newSeed: '🎲 NEW SEED',
  retrySeed: 'RETRY SEED ▶',
  foeGifts: 'FOE GIFTS',
  languageName: 'Language / Idioma',
  // Mirror
  mirrorTitle: 'MIRROR OF THE RIFT',
  mirrorLede: 'Shards from every run buy permanent talents. Refund any time.',
  mirrorOpen: '🪞 MIRROR',
  mirrorClose: 'CLOSE MIRROR',
  mirrorRefund: '↺ REFUND ALL',
  mirrorMaxed: 'MAXED',
  shards: 'shards',
  runsWord: 'runs',
  winsWord: 'wins',
  // Blessing
  blessingEyebrow: 'BEFORE THE FIRST ROOM',
  blessingTitle: 'A GIFT FROM THE RIFT',
  blessingLede: 'Choose one blessing to carry into the descent.',
  // Map
  mapEyebrow: 'CHOOSE YOUR NEXT ROOM',
  mapTitle: 'THE DESCENT',
  mapHint: 'Glowing rooms are reachable. Plan your route: elites and events pay more, rests and shops keep you alive.',
  enter: 'ENTER ▶',
  bossAhead: 'BOSS AHEAD',
  reward: 'REWARD',
  showBuild: '📜 BUILD',
  hideBuild: '📜 HIDE BUILD',
  // Intro
  preparing: 'OPENING THE RIFT…',
  retrySpent: 'RETRY — 1 LIFE SPENT',
  drawReplay: 'DRAW — REPLAY THE ROOM',
  bossPrefix: '⚔ BOSS — ',
  elitePrefix: '★ ELITE — ',
  curses: 'CURSES',
  // Reward
  rewardEyebrow: 'SPOILS · KEYS 1–3',
  rewardTitleBoon: 'CHOOSE A BOON',
  rewardTitlePom: 'POM OF POWER',
  rewardTitleRemove: 'LET SOMETHING GO',
  rewardTitleChaos: 'CHAOS OFFERS A PACT',
  rewardTitleTreasure: 'RIFT CACHE',
  pickGroup: 'Pick one',
  reroll: 'REROLL',
  rerollsLeft: 'left',
  skip: 'SKIP',
  skipCoins: 'SKIP (+20 🪙)',
  cancel: 'CANCEL (REFUND)',
  newBoon: 'NEW',
  upgrade: 'LEVEL',
  remove: 'REMOVE',
  requiresTwo: 'DUO',
  // Event
  eventEyebrow: '❓ EVENT',
  continue: 'CONTINUE ▶',
  unavailable: 'Not available',
  // Rest
  restEyebrow: '🔥 REST SITE',
  restTitle: 'A QUIET FIRE',
  restLede: 'Catch your breath, or sharpen what you carry.',
  restHeal: 'REST',
  restHealDetail: 'Restore 1 run life (+1 max life if full).',
  restTemper: 'TEMPER',
  restTemperDetail: 'Upgrade one boon by 1 level.',
  // Shop
  shopEyebrow: "CHARON'S TOLL",
  antechamberEyebrow: "CHARON'S TOLL · BOSS AHEAD",
  shopTitle: '⚱ SHOP OF THE STYX',
  buy: 'BUY',
  need: 'NEED',
  soldOut: 'SOLD',
  healName: 'Patch Up',
  healDetail: '+1 run life',
  healFull: 'ALREADY FULL',
  pomName: 'Pom of Power',
  pomDetail: 'Upgrade a boon by 1 level',
  removeName: 'Purge',
  removeDetail: 'Remove a boon from your build',
  pocketsFull: 'POCKETS FULL',
  leave: 'LEAVE ▶',
  // End
  endVictoryEyebrow: 'THE RIFT CLOSES BEHIND YOU',
  endDefeatEyebrow: 'THE RIFT KEEPS YOUR ECHO',
  endVictory: '🏆 DESCENT COMPLETE',
  endDefeat: '💀 RUN OVER',
  finalBuild: 'FINAL BUILD',
  shardsEarned: 'SHARDS EARNED',
  bossesWord: 'BOSSES',
  flawlessWord: 'FLAWLESS',
  // HUD
  stripTitle: 'Rift descent',
  livesAria: 'run lives',
  coinsAria: 'coins',
  rerollsAria: 'rerolls',
  defianceAria: 'run-wide last stands',
  consumablesGroup: 'Pocket items (keys 1–3)',
  buildTitle: 'YOUR BUILD',
  buildEmpty: 'No boons yet — the rift provides.',
  buildStats: 'STATS',
  runStats: 'RUN',
  pausedBuild: 'PAUSED · BUILD',
  enraged: 'ENRAGED',
  noPockets: 'Empty pockets',
  foeLevel: 'LV',
  levelShort: 'Lv',
  // Permanent unlocks
  loadoutTitle: 'LOADOUT · PERMANENT UNLOCKS',
  loadoutLede: 'Relics and aspects you unlock stay yours. Equip them to shape this run.',
  championTitle: 'CHAMPION MASTERY',
  masteryRank: 'RANK',
  masteryMax: 'MAX RANK',
  nextReward: 'NEXT',
  aspectTitle: 'ASPECT',
  relicsTitle: 'RELIC VAULT',
  slotsWord: 'slots',
  equipped: 'EQUIPPED',
  equip: 'EQUIP',
  locked: 'LOCKED',
  unlock: 'UNLOCK',
  keysName: 'Rift Keys',
  relicXpWord: 'XP',
  slotsFull: 'Relic slots full — remove one first (more slots in the Mirror).',
  reportTitle: 'RIFT REWARDS',
  keysEarned: 'KEYS',
  masteryGain: 'MASTERY',
  rankUp: 'RANK UP!',
  levelUp: 'LEVEL UP',
  newUnlock: 'NEW RELIC UNLOCKED',
  loadoutRun: 'LOADOUT',
  perksActive: 'ACTIVE PERKS',
  noPerks: 'Rank up this champion to earn perks.',
  // Pause run screen
  runScreenOpen: 'RUN · BUILD',
  pausedWord: 'PAUSED',
  backToPause: 'BACK TO PAUSE',
  tabBuild: 'BUILD',
  tabRun: 'RUN',
  tabLoadout: 'LOADOUT',
  tabFoes: 'FOES',
  elitesWord: 'ELITES',
  fightsWord: 'FIGHTS WON',
  eventsWord: 'EVENTS',
  spentWord: 'COINS SPENT',
  noGifts: 'No foe gifts this room.',
  // 50-floor descent + bosses
  act: 'ACT',
  descentInfo: '50 FLOORS · 5 ACTS · A BOSS EVERY 10 FLOORS',
  descentLede: 'Every floor is harder than the last. Few ever reach the bottom.',
  spoilsEyebrow: 'BOSS DEFEATED',
  spoilsTitle: 'CLAIM YOUR SPOILS',
  spoilsLede: 'Bounty paid, lives restored. Take one treasure for the rest of the descent — then an EPIC boon.',
  treasuresTitle: 'BOSS TREASURES',
  giga: 'GIGA',
  standIn: 'Giga Bowser needs the ACE disc — a boosted Titan Bowser stands in.',
  bossStocks: 'stocks',
  navBegin: 'BEGIN DESCENT',
  navBeginSub: '50 floors · 5 bosses · no mercy',
  navChampion: 'CHAMPION',
  navLoadout: 'LOADOUT',
  navLoadoutSub: 'Relics and aspects that stay yours',
  navMirror: 'MIRROR',
  navMirrorSub: 'Permanent talents bought with shards',
  navRules: 'DESCENT RULES',
  navRulesSub: 'Seed · wrath · heat · map preview',
  continueRun: 'CONTINUE DESCENT ▶',
  continueSub: 'Saved run',
  newRunReplaces: 'Starts over · replaces your saved run',
  boonsWord: 'boons',
  hubPrompt: 'Prepare your champion, then begin the descent.',
  back: 'BACK',
  confirm: 'CONFIRM ▶',
  fighterHint: 'Pick the champion who descends. Mastery is tracked per fighter.',
  fighterCount: 'FIGHTERS',
  unlockedAspects: 'aspects unlocked',
  relicHint: 'Tap a relic to equip it, or spend keys to unlock it.',
  mirrorHint: 'Tap a talent to buy its next rank.',
  bossesTitle: 'THE FIVE BOSSES',
  actMap: 'ACT',
  close: 'CLOSE',
  more: 'more',
};

export type RogueStrings = typeof EN;

const ES: RogueStrings = {
  proto: 'PROTOTIPO',
  scopeNote: 'Mapa, poderes y plataformas de la grieta prototipo sobre luchadores, escenarios, CPU y físicas originales. No es Melee ni torneo.',
  riftNote: 'PLATAFORMAS DE GRIETA: plataformas finas desplazadas; suelo, blast zones y spawns originales. Visuales aproximados.',
  formatDuel: '1 CONTRA 1',
  formatDuelDetail: 'Un duelo directo.',
  formatTeam: '{n} CONTRA 1',
  formatTeamDetail: 'Tus rivales son un equipo: nunca se golpean entre ellos.',
  formatFfa: 'TODOS CONTRA TODOS',
  formatFfaDetail: 'Cada quien por su cuenta: los rivales también se golpean.',
  formatFfaShort: 'TODOS',
  setupEyebrow: 'ROGUELIKE SOLO · 1 HUMANO VS LA GRIETA',
  setupLede: 'Desciende por un mapa con semilla de combates, eventos, tiendas y jefes. Gana dones de patronos, crea sinergias y gasta fragmentos en el Espejo entre partidas.',
  chooseFighter: 'ELIGE TU LUCHADOR',
  soloRulesNote: 'Mandan las reglas del descenso: los paneles solo eligen tu luchador.',
  seed: 'SEMILLA',
  seedPlaceholder: 'RIFT-XXXX (vacío = aleatorio)',
  random: '🎲 ALEATORIO',
  length: 'LONGITUD',
  floorsUnit: 'pisos',
  wrath: 'IRA',
  emberName: 'BRASA',
  flameName: 'LLAMA',
  infernoName: 'INFIERNO',
  emberBlurb: 'Subida suave · CPUs novatas',
  flameBlurb: 'Rito verdadero · CPUs hábiles',
  infernoBlurb: 'Sin piedad · CPUs élite',
  heatName: 'CALOR · PACTO DE DOLOR',
  heatNone: 'Sin pactos. Descenso honesto.',
  heatLower: 'Bajar calor',
  heatRaise: 'Subir calor',
  towerTitle: 'VISTA DEL MAPA',
  towerHint: 'Escribe una semilla (o tira 🎲) para ver el mapa.',
  towerPreviewAria: 'vista previa del mapa',
  best: 'RÉCORD',
  pts: 'pts',
  modes: '◀ MODOS',
  enterRift: 'ENTRAR EN LA GRIETA ▶',
  floor: 'PISO',
  you: 'TÚ',
  versus: 'VS',
  stocksUnit: 'vidas',
  abandon: 'ABANDONAR',
  fight: 'LUCHAR ▶',
  score: 'PUNTOS',
  floorsWord: 'PISOS',
  kos: 'KOs',
  newSeed: '🎲 NUEVA SEMILLA',
  retrySeed: 'REINTENTAR ▶',
  foeGifts: 'DONES RIVALES',
  languageName: 'Idioma / Language',
  mirrorTitle: 'ESPEJO DE LA GRIETA',
  mirrorLede: 'Los fragmentos de cada partida compran talentos permanentes. Reembolsa cuando quieras.',
  mirrorOpen: '🪞 ESPEJO',
  mirrorClose: 'CERRAR ESPEJO',
  mirrorRefund: '↺ REEMBOLSAR TODO',
  mirrorMaxed: 'MÁXIMO',
  shards: 'fragmentos',
  runsWord: 'partidas',
  winsWord: 'victorias',
  blessingEyebrow: 'ANTES DE LA PRIMERA SALA',
  blessingTitle: 'UN REGALO DE LA GRIETA',
  blessingLede: 'Elige una bendición para llevar al descenso.',
  mapEyebrow: 'ELIGE TU SIGUIENTE SALA',
  mapTitle: 'EL DESCENSO',
  mapHint: 'Las salas brillantes están a tu alcance. Planea tu ruta: élites y eventos pagan más, descansos y tiendas te mantienen vivo.',
  enter: 'ENTRAR ▶',
  bossAhead: 'JEFE AL FRENTE',
  reward: 'RECOMPENSA',
  showBuild: '📜 CONJUNTO',
  hideBuild: '📜 OCULTAR',
  preparing: 'ABRIENDO LA GRIETA…',
  retrySpent: 'REINTENTO — 1 INTENTO MENOS',
  drawReplay: 'EMPATE — REPITE LA SALA',
  bossPrefix: '⚔ JEFE — ',
  elitePrefix: '★ ÉLITE — ',
  curses: 'MALDICIONES',
  rewardEyebrow: 'BOTÍN · TECLAS 1–3',
  rewardTitleBoon: 'ELIGE UN DON',
  rewardTitlePom: 'GRANADA DE PODER',
  rewardTitleRemove: 'DEJA ALGO ATRÁS',
  rewardTitleChaos: 'EL CAOS OFRECE UN PACTO',
  rewardTitleTreasure: 'ALIJO DE LA GRIETA',
  pickGroup: 'Elige uno',
  reroll: 'CAMBIAR',
  rerollsLeft: 'quedan',
  skip: 'SALTAR',
  skipCoins: 'SALTAR (+20 🪙)',
  cancel: 'CANCELAR (REEMBOLSO)',
  newBoon: 'NUEVO',
  upgrade: 'NIVEL',
  remove: 'QUITAR',
  requiresTwo: 'DÚO',
  eventEyebrow: '❓ EVENTO',
  continue: 'CONTINUAR ▶',
  unavailable: 'No disponible',
  restEyebrow: '🔥 DESCANSO',
  restTitle: 'UN FUEGO TRANQUILO',
  restLede: 'Recupera el aliento o afila lo que llevas.',
  restHeal: 'DESCANSAR',
  restHealDetail: 'Recupera 1 intento (+1 intento máximo si estás lleno).',
  restTemper: 'TEMPLAR',
  restTemperDetail: 'Sube 1 nivel a uno de tus dones.',
  shopEyebrow: 'ÓBOLO DE CARONTE',
  antechamberEyebrow: 'ÓBOLO DE CARONTE · JEFE AL FRENTE',
  shopTitle: '⚱ TIENDA DE LA ESTIGIA',
  buy: 'COMPRAR',
  need: 'FALTAN',
  soldOut: 'VENDIDO',
  healName: 'Cura',
  healDetail: '+1 intento',
  healFull: 'INTENTOS AL MÁXIMO',
  pomName: 'Granada de poder',
  pomDetail: 'Sube 1 nivel a un don',
  removeName: 'Purga',
  removeDetail: 'Quita un don de tu conjunto',
  pocketsFull: 'BOLSILLOS LLENOS',
  leave: 'SALIR ▶',
  endVictoryEyebrow: 'LA GRIETA SE CIERRA TRAS DE TI',
  endDefeatEyebrow: 'LA GRIETA GUARDA TU ECO',
  endVictory: '🏆 DESCENSO COMPLETO',
  endDefeat: '💀 FIN DE LA PARTIDA',
  finalBuild: 'CONJUNTO FINAL',
  shardsEarned: 'FRAGMENTOS GANADOS',
  bossesWord: 'JEFES',
  flawlessWord: 'PERFECTOS',
  stripTitle: 'Descenso de la grieta',
  livesAria: 'intentos',
  coinsAria: 'monedas',
  rerollsAria: 'cambios',
  defianceAria: 'últimas resistencias de la partida',
  consumablesGroup: 'Objetos de bolsillo (teclas 1–3)',
  buildTitle: 'TU CONJUNTO',
  buildEmpty: 'Sin dones aún — la grieta proveerá.',
  buildStats: 'ESTADÍSTICAS',
  runStats: 'PARTIDA',
  pausedBuild: 'PAUSA · CONJUNTO',
  enraged: 'ENFURECIDO',
  noPockets: 'Bolsillos vacíos',
  foeLevel: 'NV',
  levelShort: 'Nv',
  loadoutTitle: 'EQUIPO · DESBLOQUEOS PERMANENTES',
  loadoutLede: 'Las reliquias y aspectos que desbloqueas son tuyos para siempre. Equípalos para moldear esta partida.',
  championTitle: 'MAESTRÍA DEL CAMPEÓN',
  masteryRank: 'RANGO',
  masteryMax: 'RANGO MÁXIMO',
  nextReward: 'SIGUIENTE',
  aspectTitle: 'ASPECTO',
  relicsTitle: 'BÓVEDA DE RELIQUIAS',
  slotsWord: 'espacios',
  equipped: 'EQUIPADA',
  equip: 'EQUIPAR',
  locked: 'BLOQUEADA',
  unlock: 'DESBLOQUEAR',
  keysName: 'Llaves de la grieta',
  relicXpWord: 'XP',
  slotsFull: 'Espacios llenos — quita una reliquia primero (más espacios en el Espejo).',
  reportTitle: 'RECOMPENSAS DE LA GRIETA',
  keysEarned: 'LLAVES',
  masteryGain: 'MAESTRÍA',
  rankUp: '¡SUBES DE RANGO!',
  levelUp: 'SUBE DE NIVEL',
  newUnlock: 'NUEVA RELIQUIA DESBLOQUEADA',
  loadoutRun: 'EQUIPO',
  perksActive: 'VENTAJAS ACTIVAS',
  noPerks: 'Sube de rango a este campeón para ganar ventajas.',
  runScreenOpen: 'PARTIDA · CONJUNTO',
  pausedWord: 'PAUSA',
  backToPause: 'VOLVER A LA PAUSA',
  tabBuild: 'CONJUNTO',
  tabRun: 'PARTIDA',
  tabLoadout: 'EQUIPO',
  tabFoes: 'RIVALES',
  elitesWord: 'ÉLITES',
  fightsWord: 'COMBATES GANADOS',
  eventsWord: 'EVENTOS',
  spentWord: 'MONEDAS GASTADAS',
  noGifts: 'Sin dones rivales en esta sala.',
  act: 'ACTO',
  descentInfo: '50 PISOS · 5 ACTOS · UN JEFE CADA 10 PISOS',
  descentLede: 'Cada piso es más difícil que el anterior. Muy pocos llegan al fondo.',
  spoilsEyebrow: 'JEFE DERROTADO',
  spoilsTitle: 'RECLAMA TU BOTÍN',
  spoilsLede: 'Recompensa pagada, intentos restaurados. Toma un tesoro para el resto del descenso — y luego un don ÉPICO.',
  treasuresTitle: 'TESOROS DE JEFE',
  giga: 'GIGA',
  standIn: 'Giga Bowser necesita el disco ACE — un Bowser Titán potenciado ocupa su lugar.',
  bossStocks: 'vidas',
  navBegin: 'INICIAR DESCENSO',
  navBeginSub: '50 pisos · 5 jefes · sin piedad',
  navChampion: 'CAMPEÓN',
  navLoadout: 'EQUIPO',
  navLoadoutSub: 'Reliquias y aspectos que conservas',
  navMirror: 'ESPEJO',
  navMirrorSub: 'Talentos permanentes con fragmentos',
  navRules: 'REGLAS DEL DESCENSO',
  navRulesSub: 'Semilla · ira · calor · vista del mapa',
  continueRun: 'CONTINUAR DESCENSO ▶',
  continueSub: 'Partida guardada',
  newRunReplaces: 'Empieza de cero · reemplaza tu partida guardada',
  boonsWord: 'dones',
  hubPrompt: 'Prepara a tu campeón y comienza el descenso.',
  back: 'VOLVER',
  confirm: 'CONFIRMAR ▶',
  fighterHint: 'Elige al campeón que desciende. La maestría es por luchador.',
  fighterCount: 'LUCHADORES',
  unlockedAspects: 'aspectos desbloqueados',
  relicHint: 'Toca una reliquia para equiparla o gasta llaves para desbloquearla.',
  mirrorHint: 'Toca un talento para comprar su siguiente rango.',
  bossesTitle: 'LOS CINCO JEFES',
  actMap: 'ACTO',
  close: 'CERRAR',
  more: 'más',
};

export const ROGUE_TEXT: Record<RogueLocale, RogueStrings> = { en: EN, es: ES };

function detectRogueLocale(): RogueLocale {
  try {
    const saved = globalThis.localStorage?.getItem('smash-rogue-locale');
    if (saved === 'es' || saved === 'en') return saved;
    if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('es')) return 'es';
  } catch {
    /* private mode: English until told otherwise */
  }
  return 'en';
}

export const rogueLocale = new Store<RogueLocale>(detectRogueLocale());

export function useRogueStrings(): { locale: RogueLocale; setLocale: (locale: RogueLocale) => void; t: RogueStrings } {
  const locale = useSyncExternalStore(rogueLocale.subscribe, rogueLocale.getSnapshot);
  return {
    locale,
    setLocale: (next: RogueLocale) => {
      try {
        globalThis.localStorage?.setItem('smash-rogue-locale', next);
      } catch {
        /* session-only */
      }
      rogueLocale.set(next);
    },
    t: ROGUE_TEXT[locale],
  };
}

// ——— Boons ———

export interface BoonText {
  name: string;
  flavor: string;
  gains: string[];
  costs: string[];
}
const BOON_TEXT_ES: Record<string, { name: string; flavor: string; gains: string[]; costs: string[] }> = {
  'volt-arc': { name: 'Golpe de arco', flavor: 'El rayo nunca golpea una sola vez.', gains: ['Tus golpes saltan {v}% al luchador más cercano (a su alcance)'], costs: [] },
  'volt-static': { name: 'Descarga estática', flavor: 'Manos entumidas golpean suave.', gains: ['Rivales golpeados quedan debilitados: hacen −{v}% de daño durante 3 s'], costs: [] },
  'volt-clap': { name: 'Trueno', flavor: 'Cada caída resuena.', gains: ['Al conseguir un KO, los demás rivales reciben {v}%'], costs: [] },
  'volt-conduit': { name: 'Conducto', flavor: 'La tormenta llega más lejos.', gains: ['Alcance del arco +{v}%', 'Los arcos hacen +1%'], costs: [] },
  'tide-riptide': { name: 'Resaca', flavor: 'La corriente se los lleva.', gains: ['+{v}% de poder de lanzamiento'], costs: [] },
  'tide-breaker': { name: 'Rompeolas', flavor: 'Las olas grandes rematan.', gains: ['+{v}% de lanzamiento contra rivales con 100%+'], costs: [] },
  'tide-anchor': { name: 'Ancla', flavor: 'Arráigate al fondo del mar.', gains: ['−{v}% de lanzamiento recibido'], costs: [] },
  'tide-undertow': { name: 'Contracorriente', flavor: 'Caminar por lo profundo.', gains: ['Rivales golpeados: −{v}% de velocidad de movimiento durante 2 s'], costs: [] },
  'ember-brand': { name: 'Marca ardiente', flavor: 'Cada corte sigue ardiendo.', gains: ['Tus golpes queman: +1% cada 1,25 s durante {v} s', 'La quemadura nunca noquea sola'], costs: [] },
  'ember-doom': { name: 'Marca de condena', flavor: 'Una promesa que llega tarde.', gains: ['Tus golpes marcan; 1 s después reciben {v}%'], costs: [] },
  'ember-fury': { name: 'Furia', flavor: 'Manos calientes, golpes pesados.', gains: ['+{v}% de daño en tus golpes'], costs: [] },
  'ember-wildfire': { name: 'Incendio', flavor: 'Leña para el fuego.', gains: ['+{v}% de daño contra rivales quemados'], costs: [] },
  'aegis-plate': { name: 'Placa de bronce', flavor: 'Forjada con viejos trofeos.', gains: ['−{v}% de daño recibido'], costs: [] },
  'aegis-thorns': { name: 'Malla de espinas', flavor: 'Abraza bajo tu riesgo.', gains: ['Quien te golpee cuerpo a cuerpo recibe {v}%'], costs: [] },
  'aegis-defiance': { name: 'Última resistencia', flavor: 'Hoy no.', gains: ['Una vez por piso, un KO no te quita vida'], costs: [] },
  'aegis-retaliate': { name: 'Represalia', flavor: 'Responde a cada golpe.', gains: ['Tras recibir un golpe, tu siguiente golpe en 2 s hace +{v}%'], costs: [] },
  'blood-leech': { name: 'Sanguijuela', flavor: 'Recupera un poco.', gains: ['Te curas {v}% del daño que haces'], costs: [] },
  'blood-feast': { name: 'Festín', flavor: 'Su última vida es tu merienda.', gains: ['Te curas {v}% cuando un rival pierde una vida'], costs: [] },
  'blood-rage': { name: 'Furia de sangre', flavor: 'El dolor pega más fuerte.', gains: ['+{v}% de daño por cada 50% que tengas', 'Hasta cinco acumulaciones'], costs: [] },
  'blood-pact': { name: 'Pacto carmesí', flavor: 'Firmado en algo rojo.', gains: ['+{v}% de daño en tus golpes'], costs: ['+10% de daño recibido'] },
  'hunt-aim': { name: 'Puntería letal', flavor: 'Respira. Suelta.', gains: ['{v}% de probabilidad de crítico (daño doble)'], costs: [] },
  'hunt-lethal': { name: 'Precisión letal', flavor: 'Justo entre los porcentajes.', gains: ['Los críticos hacen +{v}% del golpe además del daño doble'], costs: [] },
  'hunt-execute': { name: 'Verdugo', flavor: 'Termina la cacería.', gains: ['+{v}% de daño contra rivales con 100%+'], costs: [] },
  'hunt-opener': { name: 'Primer disparo', flavor: 'La primera sangre importa.', gains: ['+{v}% de daño contra rivales al 0%'], costs: [] },
  'gale-stride': { name: 'Paso veloz', flavor: 'El stick llega más lejos.', gains: ['+{v}% de velocidad de movimiento, en suelo y aire'], costs: [] },
  'gale-wings': { name: 'Alas de pluma', flavor: 'Un aleteo más.', gains: ['+1 salto en el aire'], costs: [] },
  'gale-toll': { name: 'Peaje del viento', flavor: 'Cada caída paga al barquero.', gains: ['+{v} monedas por cada KO tuyo'], costs: [] },
  'gale-time': { name: 'Tiempo prestado', flavor: 'Sin prisa. Agota.', gains: ['+{v} s en cada reloj', '+{v10} puntos por piso superado'], costs: [] },
  'rift-heart': { name: 'Guiso sustancioso', flavor: 'Caldo para el camino.', gains: ['+1 intento (repite un piso perdido)'], costs: [] },
  'rift-stock': { name: 'Reserva extra', flavor: 'Otro tú por piso.', gains: ['+1 vida de combate cada piso'], costs: [] },
  'rift-warmup': { name: 'Calentamiento', flavor: 'Ya te adoran.', gains: ['Los rivales empiezan cada piso con +{v}%'], costs: [] },
  'rift-underdog': { name: 'Amuleto del débil', flavor: 'Luchan a tu nivel.', gains: ['Niveles de CPU −1 (mín. 1)'], costs: [] },
  'rift-showboat': { name: 'Lucimiento', flavor: 'La grada mira.', gains: ['+{v} puntos por piso superado'], costs: [] },
  'chaos-glass': { name: 'Cañón de cristal', flavor: 'Pega como camión. Aguanta como jarrón.', gains: ['+{v}% de daño en tus golpes'], costs: ['+30% de daño recibido'] },
  'chaos-adrenaline': { name: 'Adrenalina', flavor: 'Rápido. Frágil. Divertido.', gains: ['+{v}% de velocidad de movimiento', '+10% de lanzamiento'], costs: ['+12% de daño recibido'] },
  'chaos-lead': { name: 'Puños de plomo', flavor: 'Manos de piedra, pies de piedra.', gains: ['+{v}% de poder de lanzamiento'], costs: ['−8% de velocidad de movimiento'] },
  'chaos-gambler': { name: 'Pacto del jugador', flavor: 'Doble o nada, cada piso.', gains: ['Rivales empiezan al +40%', '+{v} puntos por piso superado'], costs: ['Empiezas cada piso con +30%'] },
  'chaos-blood-price': { name: 'Precio de sangre', flavor: 'Ojos agudos, piel fina.', gains: ['+{v}% de probabilidad de crítico'], costs: ['Empiezas cada piso con +20%'] },
  'chaos-frenzy': { name: 'Frenesí de la grieta', flavor: 'Ellos se enfadan. Tú también.', gains: ['+{v}% de daño en tus golpes'], costs: ['Los rivales hacen +15% de daño', 'Los rivales son 8% más rápidos'] },
  'duo-surge': { name: 'Oleada de trueno', flavor: 'Tormenta sobre mar abierto.', gains: ['Tus golpes saltan +4% al luchador más cercano', '+10% de lanzamiento'], costs: [] },
  'duo-pyre-shot': { name: 'Disparo de pira', flavor: 'Apuntado, encendido, entregado.', gains: ['Los críticos marcan con condena: 1 s después reciben 6%'], costs: [] },
  'duo-boiling-blood': { name: 'Sangre hirviente', flavor: 'Furia a punto de ebullición.', gains: ['Furia de sangre acumula hasta diez', '+10% de daño contra quemados'], costs: [] },
  'duo-static-crit': { name: 'Crítico estático', flavor: 'La flecha lleva la tormenta.', gains: ['Los críticos saltan al luchador más cercano por el doble de tu arco (mínimo 8%)'], costs: [] },
  'duo-tidal-wall': { name: 'Muro de marea', flavor: 'El mar no se mueve.', gains: ['−20% de lanzamiento recibido', 'Quien te golpee cuerpo a cuerpo recibe 3%'], costs: [] },
  'duo-hunting-wind': { name: 'Viento cazador', flavor: 'Ataca desde arriba.', gains: ['+15% de crítico en el aire'], costs: [] },
  'duo-sanguine-aegis': { name: 'Égida sanguina', flavor: 'Sangre por el escudo.', gains: ['+1 Última resistencia por piso', 'Te curas 6% con cada KO rival'], costs: [] },
  'duo-eye-of-storm': { name: 'Ojo de la tormenta', flavor: 'Calma en el centro.', gains: ['+10% de velocidad de movimiento', 'Alcance de arco doble'], costs: [] },
  'duo-steam-burst': { name: 'Estallido de vapor', flavor: 'Agua y fuego. Gana la presión.', gains: ['Tus golpes marcan con condena +5% (1 s después)', '+15% de lanzamiento contra 100%+'], costs: [] },
};

export function boonText(boon: BoonDef, rarity: BoonRarity, level: number, locale: RogueLocale): BoonText {
  const english = describeBoon(boon, rarity, level);
  if (locale === 'en') return { name: boon.name, flavor: boon.flavor, gains: english.gains, costs: english.costs };
  const table = BOON_TEXT_ES[boon.id];
  if (!table) return { name: boon.name, flavor: boon.flavor, gains: english.gains, costs: english.costs };
  const raw = boonValue(boon, rarity, level);
  const fill = (line: string): string => line.replaceAll('{v10}', formatValue(Math.round(raw) * 10)).replaceAll('{v}', formatValue(raw).replace('.', ','));
  return { name: table.name, flavor: table.flavor, gains: table.gains.map(fill), costs: table.costs.map(fill) };
}
export function boonKindText(kind: BoonKind, locale: RogueLocale): string {
  const en: Record<BoonKind, string> = { attack: 'ATTACK', defense: 'DEFENSE', utility: 'UTILITY', pact: 'PACT · power for a price', duo: 'DUO · two patrons' };
  const es: Record<BoonKind, string> = { attack: 'ATAQUE', defense: 'DEFENSA', utility: 'UTILIDAD', pact: 'PACTO · poder con precio', duo: 'DÚO · dos patronos' };
  return (locale === 'en' ? en : es)[kind];
}
export function boonRarityText(rarity: BoonRarity, locale: RogueLocale): string {
  if (locale === 'en') return rarity.toUpperCase();
  return { common: 'COMÚN', rare: 'RARO', epic: 'ÉPICO', legendary: 'LEGENDARIO' }[rarity];
}

// ——— Patrons ———

const PATRON_TITLE_ES: Record<string, string> = {
  volt: 'la Tormenta', tide: 'la Marea', ember: 'la Llama', aegis: 'el Baluarte', blood: 'la Luna de Sangre',
  hunt: 'la Cazadora', gale: 'el Vendaval', rift: 'en persona', chaos: 'el Primordial',
};
const PATRON_THEME_ES: Record<string, string> = {
  volt: 'Arcos, descargas y truenos.', tide: 'Lanzamiento y resaca.', ember: 'Quemaduras, condena y furia.',
  aegis: 'Armadura, espinas y resistencia.', blood: 'Sanguijuela, festín y furia.', hunt: 'Críticos y ejecuciones.',
  gale: 'Velocidad, alas y peajes.', rift: 'Intentos, vidas y puntos.', chaos: 'Gran poder, precio real.',
};
export function patronText(patron: PatronDef, locale: RogueLocale): { name: string; title: string; theme: string } {
  if (locale === 'en') return { name: patron.name, title: patron.title, theme: patron.theme };
  return { name: patron.name === 'THE RIFT' ? 'LA GRIETA' : patron.name === 'CHAOS' ? 'CAOS' : patron.name, title: PATRON_TITLE_ES[patron.id] ?? patron.title, theme: PATRON_THEME_ES[patron.id] ?? patron.theme };
}

// ——— Map rooms, rewards, floors ———

export function floorKindText(kind: string, locale: RogueLocale): string {
  if (locale === 'en') return kind.toUpperCase();
  return kind === 'boss' ? 'JEFE' : kind === 'elite' ? 'ÉLITE' : 'BATALLA';
}
export const NODE_ICONS: Readonly<Record<NodeKind, string>> = Object.freeze({ battle: '⚔', elite: '★', boss: '👑', event: '❓', rest: '🔥', shop: '🪙', treasure: '🎁' });
export function nodeKindText(kind: NodeKind, locale: RogueLocale): string {
  const en: Record<NodeKind, string> = { battle: 'BATTLE', elite: 'ELITE', boss: 'BOSS', event: 'EVENT', rest: 'REST SITE', shop: 'SHOP', treasure: 'TREASURE' };
  const es: Record<NodeKind, string> = { battle: 'BATALLA', elite: 'ÉLITE', boss: 'JEFE', event: 'EVENTO', rest: 'DESCANSO', shop: 'TIENDA', treasure: 'TESORO' };
  return (locale === 'en' ? en : es)[kind];
}
export function nodeKindDetail(kind: NodeKind, locale: RogueLocale): string {
  const en: Record<NodeKind, string> = {
    battle: 'A fight. Clear it for its door reward.',
    elite: 'A tougher foe with gifts. Rewards are at least RARE.',
    boss: 'A gifted champion that enrages on its last stock. EPIC reward, +1 life.',
    event: 'Something strange. Choices, trade-offs, surprises.',
    rest: 'Rest for a life, or temper a boon.',
    shop: 'Charon sells boons, poms, purges and pocket items.',
    treasure: 'A free RARE+ boon and some coins.',
  };
  const es: Record<NodeKind, string> = {
    battle: 'Un combate. Supéralo por su recompensa.',
    elite: 'Un rival duro con dones. Recompensa al menos RARA.',
    boss: 'Un campeón con dones que se enfurece en su última vida. Recompensa ÉPICA, +1 intento.',
    event: 'Algo extraño. Decisiones, riesgos y sorpresas.',
    rest: 'Descansa por un intento, o templa un don.',
    shop: 'Caronte vende dones, granadas, purgas y objetos.',
    treasure: 'Un don RARO+ gratis y algunas monedas.',
  };
  return (locale === 'en' ? en : es)[kind];
}
export const REWARD_ICONS: Readonly<Record<RewardKind, string>> = Object.freeze({ boon: '✦', pom: '🍎', coins: '🪙', heart: '💗', pocket: '🎒' });
export function rewardText(reward: RewardKind, locale: RogueLocale): string {
  const en: Record<RewardKind, string> = { boon: 'BOON', pom: 'POM OF POWER', coins: "CHARON'S OBOL", heart: 'HEART (+1 MAX LIFE)', pocket: 'POCKET ITEM' };
  const es: Record<RewardKind, string> = { boon: 'DON', pom: 'GRANADA DE PODER', coins: 'ÓBOLO DE CARONTE', heart: 'CORAZÓN (+1 INTENTO MÁX.)', pocket: 'OBJETO DE BOLSILLO' };
  return (locale === 'en' ? en : es)[reward];
}
export function modText(mod: FloorModifier, locale: RogueLocale): { label: string; detail: string } {
  if (locale === 'en') return { label: mod.label, detail: mod.detail };
  const table: Record<string, { label: string; detail: string }> = {
    frenzy: { label: 'FRENESÍ', detail: 'Los rivales empiezan con +30% de daño. KOs rápidos, piso rápido.' },
    showdown: { label: 'DUELO', detail: 'Reloj de 60 segundos. +100 puntos por superar.' },
    endurance: { label: 'RESISTENCIA', detail: 'Luchas con 2 vidas. La recompensa mejora.' },
    gauntlet: { label: 'GUANTELETE', detail: 'Un rival extra a −2 niveles.' },
    horde: { label: 'HORDA', detail: 'De cinco a siete novatos al +40%. Sobrevive y la recompensa mejora.' },
    swarm: { label: 'ENJAMBRE', detail: 'Siete novatos de nivel bajo al +40%. Sobrevive y la recompensa mejora.' },
  };
  return table[mod.id] ?? { label: mod.label, detail: mod.detail };
}
export function consumableText(def: ConsumableDef, locale: RogueLocale): { name: string; detail: string } {
  if (locale === 'en') return { name: def.name, detail: def.detail };
  const table: Record<string, { name: string; detail: string }> = {
    draught: { name: 'Brebaje curativo', detail: 'Bebe: −60% de daño ahora mismo.' },
    smoke: { name: 'Bomba de humo', detail: 'Lanza: +25% a todos los rivales ahora mismo.' },
    star: { name: 'Fragmento estelar', detail: 'Desea: recupera una vida de combate gastada.' },
    feather: { name: 'Pluma de fénix', detail: 'Usa: tu próximo KO en este piso no quita vida.' },
    'storm-jar': { name: 'Tormenta en frasco', detail: 'Destapa: cada rival recibe 12% y hace −30% de daño durante 5 s.' },
  };
  return table[def.id] ?? { name: def.name, detail: def.detail };
}
/** `label` keeps the emoji prefix (plain-text contexts); `name` is the bare word for painted-icon chips. */
export function affixText(affix: FoeAffix, locale: RogueLocale): { label: string; name: string; detail: string } {
  const text = affixTextRaw(affix, locale);
  return { ...text, name: text.label.slice(text.label.indexOf(' ') + 1) };
}
function affixTextRaw(affix: FoeAffix, locale: RogueLocale): { label: string; detail: string } {
  if (locale === 'en') return { label: `${affix.icon} ${affix.label}`, detail: affix.detail };
  const table: Record<string, { label: string; detail: string }> = {
    vampiric: { label: '🩸 VAMPÍRICO', detail: 'Los rivales se curan 6% con cada KO.' },
    venomous: { label: '☠ VENENOSO', detail: 'Sus golpes te envenenan 6 s (+1% cada 1,25 s, nunca noquea).' },
    enraged: { label: '😡 ENFURECIDO', detail: 'Los rivales hacen +25% de daño.' },
    swift: { label: '💨 VELOZ', detail: 'Los rivales se mueven 12% más rápido.' },
    bulwark: { label: '🛡 MURALLA', detail: 'Los rivales reciben −20% de daño.' },
    infernal: { label: '👹 INFERNAL', detail: 'Los rivales hacen +15% de daño y envenenan 4 s.' },
    thorned: { label: '🌵 ESPINOSO', detail: 'Golpearlos de cerca te pincha por 2%.' },
    titan: { label: '🗿 TITÁN', detail: 'Los rivales reciben −25% de lanzamiento.' },
    deadeye: { label: '🎯 CERTERO', detail: 'Sus golpes hacen crítico el 12% de las veces (daño doble).' },
    stormborn: { label: '⚡ HIJO DE LA TORMENTA', detail: 'Sus golpes saltan 3% al luchador más cercano.' },
    undying: { label: '✝ IMPERECEDERO', detail: 'Cada rival ignora su primer KO.' },
  };
  return table[affix.id] ?? { label: `${affix.icon} ${affix.label}`, detail: affix.detail };
}

// ——— Events ———

const EVENT_TEXT_ES: Record<string, { title: string; text: string; options: Record<string, { label: string; detail: string }> }> = {
  'charon-well': { title: 'Pozo de Caronte', text: 'Un pozo repleto de monedas zumba con viejos deseos. Algo brilla en el fondo.', options: {
    toss: { label: 'Lanzar una moneda', detail: 'Paga 50 monedas: un objeto de bolsillo aleatorio.' },
    dive: { label: 'Bucear por el brillo', detail: 'Pierde 1 intento: gana 160 monedas.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  'chaos-gate': { title: 'Portal del Caos', text: 'Un portal giratorio susurra poder con condiciones.', options: {
    enter: { label: 'Cruzar', detail: 'Elige 1 de 3 pactos del Caos: gran poder, precio real.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  fountain: { title: 'Fuente de los Sueños', text: 'Agua clara que tararea una nana. Recuerda a cada luchador que descansó aquí.', options: {
    drink: { label: 'Beber', detail: 'Recupera 1 intento (o +1 intento máximo si estás lleno).' },
    bathe: { label: 'Bañar tu equipo', detail: 'Sube 1 nivel a uno de tus dones.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  trophy: { title: 'Trofeo dorado', text: 'El trofeo de un luchador que casi recuerdas. El pedestal tiene una placa de presión.', options: {
    take: { label: 'Tomarlo', detail: 'Gana 160 monedas. Próximo combate: rivales +1 nivel y ENFURECIDOS.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  'blood-altar': { title: 'Altar de sangre', text: 'Una pila tallada en un escudo. Pide algo que no podrás recuperar.', options: {
    offer: { label: 'Ofrecer tu sangre', detail: 'Pierde 1 intento máximo: elige 1 de 3 dones ÉPICOS.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  hat: { title: 'Sombrero misterioso', text: 'Un sombrero rosa y blando sobre una roca. Claramente quiere una cabeza.', options: {
    wear: { label: 'Ponérselo', detail: 'Gana un don aleatorio de un patrono aleatorio.' },
    sell: { label: 'Venderlo', detail: 'Gana 90 monedas.' } } },
  sparring: { title: 'Sala de entrenamiento', text: 'Tatamis silenciosos y viejas lecciones. Un sensei mira tu equipo.', options: {
    meditate: { label: 'Meditar', detail: 'Quita un don de tu conjunto y gana 60 monedas.' },
    drill: { label: 'Entrenar', detail: 'Paga 60 monedas: sube 2 niveles a un don.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  storm: { title: 'Tormenta de la grieta', text: 'El cielo se abre. Llueve poder sobre quien sea tan temerario como para quedarse.', options: {
    embrace: { label: 'Abrazar la tormenta', detail: 'Elige 1 de 3 dones RAROS+ ahora. Próximos 2 combates: rivales +1 nivel e HIJOS DE LA TORMENTA.' },
    shelter: { label: 'Refugiarse', detail: 'Gana una Tormenta en frasco.' } } },
  merchant: { title: 'Mercader errante', text: 'Un viajero encapuchado abre una mochila pesada. «Sin devoluciones.»', options: {
    mystery: { label: 'Poder misterioso', detail: 'Paga 100 monedas: elige 1 de 3 dones RAROS+.' },
    supplies: { label: 'Provisiones', detail: 'Paga 40 monedas: un objeto de bolsillo aleatorio.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
  echo: { title: 'Eco de ti mismo', text: 'Tu propia silueta sale de la grieta y levanta los puños.', options: {
    face: { label: 'Enfrentar a tu eco', detail: 'Tu próximo combate añade un espejo tuyo (+1 nivel). Su recompensa mejora y paga +200 puntos.' },
    leave: { label: 'Seguir', detail: 'Nada ganado, nada perdido.' } } },
};
export function eventText(event: EventDef, locale: RogueLocale): { title: string; text: string } {
  if (locale === 'en') return { title: event.title, text: event.text };
  const table = EVENT_TEXT_ES[event.id];
  return table ? { title: table.title, text: table.text } : { title: event.title, text: event.text };
}
export function eventOptionText(event: EventDef, option: EventOptionDef, locale: RogueLocale): { label: string; detail: string } {
  if (locale === 'en') return { label: option.label, detail: option.detail };
  return EVENT_TEXT_ES[event.id]?.options[option.id] ?? { label: option.label, detail: option.detail };
}

// ——— Blessings and Mirror ———

const BLESSING_ES: Record<string, { name: string; detail: string }> = {
  'coin-purse': { name: 'Monedero', detail: 'Empiezas con +120 monedas.' },
  'lucky-tooth': { name: 'Diente de la suerte', detail: '+1 Última resistencia para toda la partida.' },
  'patron-sigil': { name: 'Sello de patrono', detail: 'Empiezas con un don RARO+ aleatorio.' },
  'pocket-kit': { name: 'Kit de bolsillo', detail: 'Empiezas con 2 objetos de bolsillo aleatorios.' },
  'second-heart': { name: 'Segundo corazón', detail: '+1 intento máximo y +1 intento.' },
  'reroll-dice': { name: 'Dados cargados', detail: '+2 cambios de dones.' },
  'chaos-seed': { name: 'Semilla del Caos', detail: 'Empiezas con un pacto del Caos ÉPICO aleatorio.' },
  sharpened: { name: 'Filo afilado', detail: 'Empiezas con Furia, Puntería letal o Resaca ÉPICA.' },
};
export function blessingText(def: BlessingDef, locale: RogueLocale): { name: string; detail: string } {
  if (locale === 'en') return { name: def.name, detail: def.detail };
  return BLESSING_ES[def.id] ?? { name: def.name, detail: def.detail };
}
const MIRROR_ES: Record<string, { name: string; detail: string }> = {
  resilience: { name: 'Resiliencia', detail: '+{n} intentos iniciales' },
  defiance: { name: 'Desafío a la muerte', detail: '{n} Última resistencia para toda la partida' },
  greed: { name: 'Toque dorado', detail: '+{n} monedas iniciales' },
  authority: { name: 'Autoridad del destino', detail: '+{n} cambios de dones por partida' },
  pockets: { name: 'Bolsillos hondos', detail: '+{n} espacio de bolsillo' },
  satchel: { name: 'Morral de reliquias', detail: '+{n} espacio de reliquia en tu equipo' },
  favor: { name: 'Favor del patrono', detail: '+{n}% de probabilidad de dones RAROS+ y ÉPICOS' },
  skin: { name: 'Piel gruesa', detail: '−{n}% de daño recibido' },
};
export function mirrorText(def: MirrorDef, rank: number, locale: RogueLocale): { name: string; detail: string } {
  const base = locale === 'en' ? { name: def.name, detail: def.detail } : (MIRROR_ES[def.id] ?? { name: def.name, detail: def.detail });
  return { name: base.name, detail: base.detail.replaceAll('{n}', String(mirrorTotal(def.id, Math.max(1, rank)))) };
}

// ——— In-fight popups and banners ———

export type FxTextKey = 'crit' | 'jolt' | 'lastStand' | 'standKept' | 'rivalDefies' | 'enraged' | 'koCoins';
export function fxText(key: FxTextKey, locale: RogueLocale, name = ''): string {
  const es = locale === 'es';
  switch (key) {
    case 'crit': return es ? '¡CRÍTICO!' : 'CRIT!';
    case 'jolt': return es ? 'DEBILITADO' : 'JOLTED';
    case 'lastStand': return es ? 'ÚLTIMA RESISTENCIA' : 'LAST STAND';
    case 'standKept': return es ? 'ÚLTIMA RESISTENCIA · CONSERVAS LA VIDA' : 'LAST STAND · STOCK KEPT';
    case 'rivalDefies': return es ? 'EL RIVAL DESAFÍA A LA MUERTE' : 'RIVAL DEFIES DEATH';
    case 'enraged': return es ? `${name} SE ENFURECE` : `${name} ENRAGED`;
    case 'koCoins': return es ? `+${name} al superar` : `+${name} on clear`;
  }
}

// ——— Toasts ———

/** Human text for a run toast code (`coins:120`, `pocket:star`, `boon:ember-fury`…). */
export function toastText(code: string | null, locale: RogueLocale, names: { boon: (id: string) => string; pocket: (id: string) => string }): string | null {
  if (!code) return null;
  const [kind, detail = ''] = code.split(':');
  const es = locale === 'es';
  switch (kind) {
    case 'coins': return `🪙 +${detail}`;
    case 'heart': return es ? '💗 +1 intento máximo' : '💗 +1 max life';
    case 'life': return es ? '❤ +1 intento' : '❤ +1 run life';
    case 'pocket': return `🎒 ${names.pocket(detail)}`;
    case 'overflow': return es ? '🎒 Bolsillos llenos: +40 🪙' : '🎒 Pockets full: +40 🪙';
    case 'boon': return `✦ ${names.boon(detail)}`;
    case 'pom': return `🍎 ${names.boon(detail)} ▲`;
    case 'remove': return es ? `✂ ${names.boon(detail)} eliminado` : `✂ ${names.boon(detail)} removed`;
    case 'retry': return es ? '💔 −1 intento: repite la sala' : '💔 −1 run life: retry the room';
    case 'draw': return es ? '⏱ Empate: repite la sala sin coste' : '⏱ Draw: replay the room for free';
    case 'echo': return es ? '👻 Tu eco te espera en el próximo combate' : '👻 Your echo waits in the next fight';
    case 'leave': return es ? 'Sigues adelante.' : 'You walk on.';
    case 'bounty': return es ? `👑 Recompensa del jefe: +${detail} 🪙 · intentos restaurados` : `👑 Boss bounty: +${detail} 🪙 · lives restored`;
    case 'treasure': return `🏆 ${names.boon(detail)}`;
    case 'nothing': return es ? 'No pasó nada.' : 'Nothing happened.';
    default: return null;
  }
}

// ——— Permanent unlocks ———

const RELIC_ES: Record<string, { name: string; flavor: string; levels: [string, string, string]; condition?: string }> = {
  'spiked-collar': { name: 'Collar de púas viejo', flavor: 'Aún huele al último campeón.', levels: ['−6% de daño recibido', '−10% de daño recibido', '−14% de daño recibido'] },
  'lucky-coin': { name: 'Moneda de la suerte', flavor: 'Cara ganas. Cruz también.', levels: ['Empiezas con +60 monedas', 'Empiezas con +110 monedas', 'Empiezas con +160 monedas'] },
  'hunter-eye': { name: 'Ojo del cazador', flavor: 'Siempre mirando el porcentaje.', levels: ['+5% de crítico', '+8% de crítico', '+12% de crítico'], condition: 'Derrota a tu primer jefe' },
  'titan-belt': { name: 'Cinturón del titán', flavor: 'Pesada es la cintura.', levels: ['−8% de lanzamiento recibido', '−12% de lanzamiento recibido', '−16% de lanzamiento recibido'], condition: 'Derrota 3 élites' },
  'harpy-feather': { name: 'Pluma de arpía', flavor: 'Arrancada en plena caída.', levels: ['Empiezas con una Pluma de fénix', 'Empiezas con una Pluma de fénix · +1 bolsillo', 'Empiezas con 2 Plumas de fénix · +1 bolsillo'], condition: 'Termina 5 partidas' },
  'blood-vial': { name: 'Vial de sangre', flavor: 'Aún tibio.', levels: ['Te curas 4% con cada KO rival', 'Te curas 6% con cada KO rival', 'Te curas 8% con cada KO rival'], condition: 'Derrota 3 jefes' },
  'thunder-idol': { name: 'Ídolo del trueno', flavor: 'Zumba antes de las tormentas.', levels: ['Tus golpes saltan 2%', 'Tus golpes saltan 3%', 'Tus golpes saltan 4%'], condition: 'Termina una partida con 3 dones de un patrono' },
  'wanderer-map': { name: 'Mapa del errante', flavor: 'Alguien marcó las buenas salas.', levels: ['+1 cambio de dones', '+2 cambios de dones', '+3 cambios de dones'], condition: 'Visita 8 eventos' },
  ledger: { name: 'Libro del mercader', flavor: 'Caronte te debe un favor.', levels: ['Precios de tienda −10%', 'Precios de tienda −20%', 'Precios de tienda −30%'], condition: 'Gasta 600 monedas' },
  'chaos-shard': { name: 'Fragmento del Caos', flavor: 'Susurra con dos voces.', levels: ['Empiezas con un pacto del Caos RARO+', 'Empiezas con un pacto del Caos ÉPICO', 'Empiezas con un pacto del Caos ÉPICO · +1 cambio'], condition: 'Termina una partida con un pacto del Caos' },
  compass: { name: 'Brújula del favor', flavor: 'Apunta a dioses generosos.', levels: ['+5% de probabilidad de dones RAROS+ y ÉPICOS', '+10% de probabilidad de dones RAROS+ y ÉPICOS', '+15% de probabilidad de dones RAROS+ y ÉPICOS'], condition: 'Termina una partida con un don dúo' },
  hourglass: { name: 'Arena de las eras', flavor: 'El tiempo se dobla para el paciente.', levels: ['+20 s de reloj · +50 puntos por piso', '+40 s de reloj · +100 puntos por piso', '+60 s de reloj · +150 puntos por piso'], condition: 'Completa un descenso' },
  'phoenix-heart': { name: 'Corazón de fénix', flavor: 'Late dos veces.', levels: ['+1 Última resistencia de partida', '+1 Última resistencia de partida · +1 intento', '+2 Últimas resistencias de partida · +1 intento'], condition: 'Completa un descenso con Calor 1+' },
};
export function relicText(def: RelicDef, locale: RogueLocale): { name: string; flavor: string; levels: readonly [string, string, string]; condition: string | null } {
  if (locale === 'en') return { name: def.name, flavor: def.flavor, levels: def.levels, condition: def.condition?.text ?? null };
  const es = RELIC_ES[def.id];
  if (!es) return { name: def.name, flavor: def.flavor, levels: def.levels, condition: def.condition?.text ?? null };
  return { name: es.name, flavor: es.flavor, levels: es.levels, condition: es.condition ?? def.condition?.text ?? null };
}

const ASPECT_ES: Record<string, { name: string; flavor: string; levels: [string, string, string] }> = {
  vanguard: { name: 'Aspecto de la Vanguardia', flavor: 'Adelante con el puño.', levels: ['+8% de daño · +4% de lanzamiento', '+12% de daño · +6% de lanzamiento', '+16% de daño · +8% de lanzamiento'] },
  tempest: { name: 'Aspecto de la Tempestad', flavor: 'Nunca donde apuntan.', levels: ['+8% de velocidad · +4% de crítico', '+11% de velocidad · +6% de crítico', '+14% de velocidad · +8% de crítico'] },
  bastion: { name: 'Aspecto del Bastión', flavor: 'La grieta se rompe contra ti.', levels: ['−10% de daño recibido · −8% de lanzamiento recibido · −4% de velocidad', '−14% de daño recibido · −11% de lanzamiento recibido · −4% de velocidad', '−18% de daño recibido · −14% de lanzamiento recibido · −4% de velocidad'] },
  reaper: { name: 'Aspecto del Segador', flavor: 'Cosecha los porcentajes altos.', levels: ['+15% de daño contra 100%+ · cura 3% por KO · empiezas pisos con +10%', '+22% de daño contra 100%+ · cura 4% por KO · empiezas pisos con +10%', '+30% de daño contra 100%+ · cura 5% por KO · empiezas pisos con +10%'] },
};
export function aspectText(def: AspectDef, locale: RogueLocale): { name: string; flavor: string; levels: readonly [string, string, string] } {
  if (locale === 'en') return { name: def.name, flavor: def.flavor, levels: def.levels };
  return ASPECT_ES[def.id] ?? { name: def.name, flavor: def.flavor, levels: def.levels };
}

const MASTERY_REWARD_ES: Record<string, string> = {
  tempest: 'Desbloquea Aspecto de la Tempestad',
  reroll: '+1 cambio de dones cada partida',
  bastion: 'Desbloquea Aspecto del Bastión',
  aspect2: 'Aspectos Nv2 · +40 monedas iniciales',
  reaper: 'Desbloquea Aspecto del Segador',
  life: '+1 intento inicial',
  aspect3: 'Aspectos Nv3 · Campeón de la grieta',
};
export function masteryRewardText(reward: { key: string; text: string }, locale: RogueLocale): string {
  return locale === 'en' ? reward.text : (MASTERY_REWARD_ES[reward.key] ?? reward.text);
}

// ——— Bosses + treasures ———

const BOSS_ES: Record<string, { name: string; title: string }> = {
  warlord: { name: 'El Señor de la Guerra', title: 'Guardián de la Primera Puerta' },
  'twin-terrors': { name: 'Terrores Gemelos', title: 'Dos filos, una voluntad' },
  titan: { name: 'El Titán', title: 'Corazón de la Grieta' },
  'giga-koopa': { name: 'GIGA BOWSER', title: 'Rey del Abismo' },
  'rift-sovereign': { name: 'Soberano de la Grieta', title: 'El final del descenso' },
};
export function bossText(boss: BossDef, locale: RogueLocale): { name: string; title: string } {
  return locale === 'en' ? { name: boss.name, title: boss.title } : (BOSS_ES[boss.id] ?? { name: boss.name, title: boss.title });
}
const TREASURE_ES: Record<string, { name: string; detail: string }> = {
  'titan-heart': { name: 'Corazón de titán', detail: '+2 intentos máximos y restaura todos los intentos.' },
  'war-crown': { name: 'Corona de guerra', detail: '+1 vida de combate en cada piso.' },
  'patron-blessing': { name: 'Bendición de patronos', detail: 'Todos tus dones suben +1 nivel.' },
  'executioner-edge': { name: 'Filo del verdugo', detail: '+30% de daño y +15% de lanzamiento.' },
  'aegis-core': { name: 'Núcleo de égida', detail: '−25% de daño recibido y −20% de lanzamiento recibido.' },
  'golden-idol': { name: 'Ídolo dorado', detail: '+50% de monedas por pisos y KOs; precios de tienda −25%.' },
  'phoenix-crown': { name: 'Corona de fénix', detail: '+1 Última resistencia en cada piso.' },
  'storm-eye': { name: 'Ojo de la tempestad', detail: '+15% de crítico, los críticos hacen +50% del golpe, tus golpes saltan 4%.' },
  'rift-compass': { name: 'Brújula de la grieta', detail: '+3 cambios de dones y +20% de probabilidad de dones RAROS+ y ÉPICOS.' },
};
export function treasureText(def: TreasureDef, locale: RogueLocale): { name: string; detail: string } {
  return locale === 'en' ? { name: def.name, detail: def.detail } : (TREASURE_ES[def.id] ?? { name: def.name, detail: def.detail });
}
