import type { GameContent } from './load.ts';
import type { MatchFighter, MatchEvent, PoseProvider } from './match.ts';
import { activeHits, type HitDefinition } from './moves.ts';
import type { V3 } from '../hsd/model.ts';
import type { ItemsData } from './item-data.ts';
import { itemKind, POKEMON_BASE, type CommonItemName } from './item-kinds.ts';
import { pointSegmentDistanceSquared, segmentDistanceSquared } from './collision.ts';
import { HurtboxCache, hurtSweepCandidate } from './hurt-cache.ts';
import { shieldBubble } from './combat.ts';
import { ITEM_COMMON } from './item-common.ts';
import { traceStage } from './link-hookshot.ts';
import { floorY } from './data.ts';
import { linkHits } from './link.ts';
import { PokemonDriver, newPokemonState, PK, type PokemonContext, type PokemonState } from './item-pokemon.ts';

/** Plain battering/throwable props: original models, physics and script hitboxes. */
export const GENERIC_SPAWNABLE: readonly CommonItemName[] = ['Dosei', 'Harisen', 'Sword', 'Bat', 'Parasol', 'StarRod', 'LipStick'];
/** Light containers (Wave A): break open and spill from the contents pool. */
export const CONTAINER_SPAWNABLE: readonly CommonItemName[] = ['Capsule', 'Egg', 'Kusudama'];
/** Wave B/D/F batch: consumables, explosives, shells, hazards, shooters, heavies, Poké Ball. */
export const BATCH_SPAWNABLE: readonly CommonItemName[] = ['Box', 'Taru', 'BombHei', 'Heart', 'Tomato', 'Star', 'GShell', 'RShell', 'LGun', 'Freeze', 'Foods', 'MSBomb', 'Flipper', 'SScope', 'FFlower', 'MBall'];
/** Wave E status items: touch mushrooms, auto-equip gear, the Hammer and the Warp Star. */
export const STATUS_SPAWNABLE: readonly CommonItemName[] = ['Kinoko', 'DKinoko', 'Hammer', 'WStar', 'ScBall', 'RabbitC', 'MetalB', 'Spycloak'];
/** Everything the current engine can spawn and the Item Switch menu may enable. */
export const SUPPORTED_MATCH_ITEMS: readonly CommonItemName[] = [...CONTAINER_SPAWNABLE, ...GENERIC_SPAWNABLE, ...BATCH_SPAWNABLE, ...STATUS_SPAWNABLE];
/** ftswing swing-type rows (fn_800CCEC4): battering items and their swing motion prefix. */
const SWING_PREFIXES: Partial<Record<string, string>> = { Sword: 'Sword', Bat: 'Bat', Parasol: 'Parasol', Harisen: 'Harisen', StarRod: 'StarRod', LipStick: 'LipStick' };
export type SwingCategory = 'jab' | 'tilt' | 'smash' | 'dash';
const SWING_SUFFIX: Record<SwingCategory, string> = { jab: 'Swing1', tilt: 'Swing3', smash: 'Swing4', dash: 'SwingDash' };
/** PROTOTYPE tuning defaults for the few values still lacking a transcribed field. */
const PROTO = Object.freeze({
  msbombRadius: 9, shellAccel: 0.03, beamLife: 55,
  gunCooldown: 40,
});

export type ItemBehavior = 'generic' | 'container' | 'heavy' | 'consumable' | 'star' | 'explosive' | 'shell' | 'freezie' | 'flipper' | 'shooter' | 'beam' | 'pokeball' | 'pokemon' | 'touchStatus' | 'equip';
export type ItemStatusKind = 'mushroom' | 'poison' | 'bunny' | 'metal' | 'cloak' | 'hammer' | 'warp';
export type ItemPhase = 'fall' | 'ground' | 'held' | 'flight' | 'rise' | 'explode' | 'act';
/** One live match item. Content is referenced only through `kind`/`stateIndex`, so the whole
 * struct is structuredClone/canonical-safe and needs no resource registry for rollback.
 * `timer`/`mode`/`variant` are per-behavior scratch (fuses, slide latches, food model slot,
 * Pokémon state-entry age); `ammo` is the shooter round counter (Item xD4C). */
export interface MatchItem {
  id: number; kind: number; phase: ItemPhase; stateIndex: number;
  x: number; y: number; vx: number; vy: number; facing: number;
  age: number; life: number; owner: number | null; floor: number | null;
  victims: Set<number>; activation: number;
  damage: number; struckBy: Set<string>; timer: number; mode: number; variant: number; ammo: number;
  /** xDC8 flags.x14: released by a throw (it_80273F34) until picked up or respawned. */
  thrown?: boolean;
  /** Poké Ball Pokémon and their projectiles (lib/game/item-pokemon.ts), absent otherwise. */
  pk?: PokemonState;
}
export interface ItemImpact { item: MatchItem; hit: HitDefinition; direction: number; victim: MatchFighter; point: V3; shield?: boolean }
export interface ItemWorldState { serial: number; countdown: number | null; items: MatchItem[]; pokemon?: { last: number; previous: number; legend: number }; warpLast?: number }
/** Deferred fighter status changes the match applies after the item step (healing, stars). */
export interface ItemEffect { slot: number; heal?: number; invulnerable?: number; status?: { kind: ItemStatusKind; timer: number; health?: number; path?: number } }

/** PROTOTYPE orchestration around original ItCo data (mirrors the Link-bomb precedent):
 * spawn cadence/tuning, script hitboxes, pickup boxes, throw table, hold bones and the
 * container/consumable attribute blocks are the disc's; the state-machine glue, uniform
 * spawn weights and the PROTO tuning block above are prototype code, not item callbacks. */
export class ItemWorld {
  readonly items: MatchItem[] = [];
  /** Fighter status changes produced this step; drained by LocalMatch. */
  readonly effects: ItemEffect[] = [];
  private serial = 0;
  /** Frames until the next sky drop; null when the item rule is off or ItCo is unavailable. */
  countdown: number | null = null;
  private readonly pool: readonly number[];
  private readonly contentsPool: readonly number[];
  /** Item_804A0E24: last two released Pokémon (repeat exclusion) and the Mew/Celebi latch. */
  private readonly pokemonMemory = { last: -1, previous: -1, legend: 0 };
  /** it_804D6D00: the last Warp Star flight path, never picked twice in a row. */
  private warpLast = -1;
  private readonly pokemon: PokemonDriver;
  constructor(private readonly content: GameContent, private readonly frequency: number, switches: readonly number[] | null) {
    const data = content.items;
    const enabled = (names: readonly CommonItemName[]) => !data ? [] : names.map((name) => itemKind(name)).filter((kind) => data.kinds.has(kind) && (switches === null || switches.includes(kind)));
    this.pool = frequency < 0 ? [] : enabled(SUPPORTED_MATCH_ITEMS);
    // it_8026CD50: container contents cover kinds 6..0x22 (never the containers themselves).
    this.contentsPool = enabled(SUPPORTED_MATCH_ITEMS).filter((kind) => kind >= 6);
    if (this.pool.length && frequency >= 0) this.countdown = this.rollInterval();
    const world = this;
    // it_8026D3CC reads the Item Switch (any healing item on), not the live spawn pool.
    const healingOn = enabled(['Heart', 'Tomato', 'Foods']).length > 0;
    this.pokemon = new PokemonDriver({
      content, get data() { return world.data; }, random: () => world.random(),
      spawn: (kind, x, y) => world.spawnKind(kind, x, y), remove: (item) => world.remove(item, world.lastFighters),
      memory: this.pokemonMemory, alive: (item) => world.items.includes(item),
      commonEgg: data?.kinds.has(itemKind('Egg')) ? itemKind('Egg') : null,
      healingEnabled: () => healingOn,
    });
  }
  private lastFighters: readonly MatchFighter[] = [];
  private get data(): ItemsData {
    const data = this.content.items;
    if (!data) throw new Error('Match items need the ItCo archive.');
    return data;
  }
  behavior(kind: number): ItemBehavior {
    // Chansey's Lucky Egg is an ordinary class-5 healing pickup (it_8026B4F0).
    if (kind >= POKEMON_BASE) return kind === POKEMON_BASE + PK.LuckyEgg ? 'consumable' : 'pokemon';
    switch (this.data.kind(kind).name) {
      case 'Capsule': case 'Egg': case 'Kusudama': return 'container';
      case 'Box': case 'Taru': return 'heavy';
      case 'Foods': case 'Tomato': case 'Heart': return 'consumable';
      case 'Star': return 'star';
      case 'BombHei': case 'MSBomb': return 'explosive';
      case 'GShell': case 'RShell': return 'shell';
      case 'Freeze': return 'freezie';
      case 'Flipper': return 'flipper';
      case 'LGun': case 'SScope': case 'FFlower': return 'shooter';
      case 'LGunRay': case 'LGunBeam': case 'SScopeBeam': case 'FFlowerFlame': case 'StarRodStar': case 'HammerHead': return 'beam';
      case 'MBall': return 'pokeball';
      case 'Kinoko': case 'DKinoko': return 'touchStatus';
      case 'RabbitC': case 'MetalB': case 'Spycloak': case 'Hammer': case 'WStar': return 'equip';
      default: return 'generic';
    }
  }
  /** it_8026C88C: countdown reroll from the frequency-indexed {min,max} pair. The original
   * additionally scales by a per-stage interval multiplier that is not ported. */
  private rollInterval(): number {
    const pair = this.data.common.spawnIntervals[Math.max(0, Math.min(4, this.frequency))]!;
    return Math.max(1, Math.round(Math.fround(pair.min + (pair.max - pair.min) * this.content.physics.random())));
  }
  private random(): number { return this.content.physics.random(); }
  private pick(pool: readonly number[]): number { return pool[Math.min(pool.length - 1, Math.trunc(this.random() * pool.length))]!; }
  /** Special-attribute readers for a kind's ItCo block (0 when the block is absent). */
  private attrU(kind: number, offset: number): number { const special = this.data.kind(kind).special; return special ? this.data.archive.u32(special + offset) : 0; }
  private attrF(kind: number, offset: number): number { const special = this.data.kind(kind).special; return special ? this.data.archive.f32(special + offset) : 0; }
  spawnKind(kind: number, x: number, y: number): MatchItem {
    const item: MatchItem = {
      id: ++this.serial, kind, phase: 'fall', stateIndex: 0, x: Math.fround(x), y: Math.fround(y), vx: 0, vy: 0,
      facing: x >= 0 ? -1 : 1, age: 0, life: this.data.common.lifetime, owner: null, floor: null, victims: new Set(), activation: 0,
      damage: 0, struckBy: new Set(), timer: 0, mode: 0, variant: 0, ammo: 0,
    };
    const behavior = this.behavior(kind);
    const name = this.data.kind(kind).name;
    // Shooter rounds/energy/fuel: ItLGunAttr/itSScopeAttributes/FFlowerAttr +0 (16/­energy/120).
    if (behavior === 'shooter') item.ammo = Math.max(1, Math.min(10000, this.attrU(kind, 0)));
    // Star Rod swings spend xD4C stars (StarRodAttributes +0).
    if (name === 'StarRod') item.ammo = Math.max(0, Math.min(100, this.attrU(kind, 0)));
    // Starman: bounce velocities from its attrs (+0x10/+0x14); short bouncing life.
    // itStar_Logic10_Spawned: a random side, launched at (x10 × dir, x14).
    if (behavior === 'star') { item.facing = Math.trunc(this.random() * 2) ? 1 : -1; item.vx = Math.fround(this.attrF(kind, 0x10) * item.facing); item.vy = this.attrF(kind, 0x14); }
    // itKinoko_Logic26_Spawned: mushrooms face the stage center.
    if (behavior === 'touchStatus') item.facing = x > 0 ? -1 : 1;
    if (name === 'Foods') item.variant = Math.trunc(this.random() * Math.max(1, this.data.foodCount()));
    // Pokémon run their own state tables; lifetimes live in their per-kind timers.
    if (behavior === 'pokemon') { item.phase = 'act'; item.life = 1e9; item.pk = newPokemonState(this.data.kind(kind).attributes.scale); }
    if (behavior === 'beam') item.life = PROTO.beamLife;
    // The loose-item cap never evicts a Pokémon or its projectiles (Lugia alone fires ~60 beams).
    if (kind < POKEMON_BASE && this.items.filter((entry) => entry.kind < POKEMON_BASE).length >= 20) {
      const oldest = this.items.findIndex((entry) => entry.kind < POKEMON_BASE);
      if (oldest >= 0) this.items.splice(oldest, 1);
    }
    this.items.push(item);
    return item;
  }
  /** it_8028FAF4 (Game & Watch's Judgment 7): drops one Food at a point, but only while
   * items are on and Food is switched on (it_8026D324), exactly the random-drop pool. */
  spawnFood(x: number, y: number): MatchItem | null {
    const kind = itemKind('Foods');
    return this.pool.includes(kind) ? this.spawnKind(kind, x, y) : null;
  }
  /** Sky drop inside the main platform span (it_8026CB3C bounds are prototype-approximated). */
  private spawnRandom(events: MatchEvent[]): void {
    const stage = this.content.stage;
    const span = stage.mainRight - stage.mainLeft, margin = Math.min(15, span * 0.1);
    const x = Math.fround(stage.mainLeft + margin + this.random() * (span - 2 * margin));
    const top = Math.max(...stage.floors.filter((floor) => x >= Math.min(floor.a[0], floor.b[0]) && x <= Math.max(floor.a[0], floor.b[0])).map((floor) => Math.max(floor.a[1], floor.b[1])), 0);
    const item = this.spawnKind(this.pick(this.pool), x, Math.min(stage.blast.top - 10, top + 45));
    events.push({ type: 'bounce', player: 0, x: item.x, y: item.y });
  }
  /** Open a Poké Ball at a point: `slot` pins the Pokémon (debug/tests), null rolls the original
   * weighted pick. The temporary ball only supplies its itPokemonSpawn attributes. */
  summonPokemon(slot: number | null, x: number, y: number, owner: number | null, events: MatchEvent[] = []): MatchItem | null {
    const ball = this.spawnKind(itemKind('MBall'), x, y);
    ball.owner = owner;
    this.remove(ball, this.lastFighters);
    return this.pokemon.release(ball, this.lastFighters, events, slot);
  }
  find(id: number | null): MatchItem | undefined { return id === null ? undefined : this.items.find((item) => item.id === id); }
  /** Can this fighter pick the item up? Stars/beams/Pokémon are never carried; heavy
   * containers need the shared HeavyGet motion. */
  pickable(item: MatchItem, fighter: MatchFighter): boolean {
    const behavior = this.behavior(item.kind);
    // Only an armed Electrode is grabbable among the Pokémon (it_8026B390 in its fuse accessory).
    if (behavior === 'pokemon') return item.pk?.grab === true && item.phase !== 'held';
    if (behavior === 'star' || behavior === 'beam' || behavior === 'touchStatus') return false;
    if (behavior === 'heavy' && !fighter.content.clips.has('HeavyGet')) return false;
    return true;
  }
  /** ft_800D2D0C: holding the Screw Attack turns jumps into ItemScrew/ItemScrewAir. */
  screwHeld(fighter: MatchFighter): boolean {
    const item = this.find(fighter.heldItem);
    return !!item && item.phase === 'held' && this.data.kind(item.kind).name === 'ScBall';
  }
  heavyHeld(fighter: MatchFighter): boolean {
    const item = this.find(fighter.heldItem);
    return !!item && item.phase === 'held' && this.behavior(item.kind) === 'heavy';
  }
  shootable(fighter: MatchFighter): boolean {
    const item = this.find(fighter.heldItem);
    return !!item && item.phase === 'held' && this.behavior(item.kind) === 'shooter';
  }
  /** Held battering item? True for action-class-2 kinds (it_8026B30C). */
  swingable(id: number | null): boolean {
    const item = this.find(id);
    return !!item && item.phase === 'held' && this.data.kind(item.kind).attributes.actionClass === 2 && SWING_PREFIXES[this.data.kind(item.kind).name] !== undefined;
  }
  /** The swing attack replacing a grounded normal while holding a battering item
   * (ftCo_Attack_800CCF58 through the ftswing matrix), or null to keep the normal. */
  swingFor(fighter: MatchFighter, category: SwingCategory): string | null {
    const item = this.find(fighter.heldItem);
    if (!item || !this.swingable(item.id)) return null;
    const prefix = SWING_PREFIXES[this.data.kind(item.kind).name];
    const name = `${prefix}${SWING_SUFFIX[category]}`;
    return fighter.content.clips.has(name) && fighter.content.attacks.has(name) ? name : null;
  }
  /** Fire the held shooter, spending ammo (Item xD4C) and spawning the original beam kind:
   * Ray Gun → LGunRay (speed/lifetime from ItLGunRayAttr), Super Scope → SScopeBeam level 0
   * ({velocity, scale, lifetime} triple, energy cost xC[0]), Fire Flower → LGunBeam flames
   * (yes: It_Kind_L_Gun_Beam is the flower's flame; direction/speed from ItLGunBeamAttr).
   * Returns the shoot motion to play, or null when nothing fired (empty click). */
  shoot(fighter: MatchFighter, events: MatchEvent[]): string | null {
    const item = this.find(fighter.heldItem);
    if (!item || item.phase !== 'held' || this.behavior(item.kind) !== 'shooter') return null;
    if (item.timer > 0) return null; // refire lockout (it_8028E938)
    const name = this.data.kind(item.kind).name;
    if (item.ammo <= 0) {
      events.push({ type: 'sound', player: fighter.slot, x: item.x, y: item.y, sound: name === 'SScope' ? 0x101 : 0xe6, volume: 110, pan: 64 });
      return null;
    }
    const spawnBeam = (beam: CommonItemName, vx: number, vy: number, life: number) => {
      const shot = this.spawnKind(itemKind(beam), Math.fround(item.x + 3 * fighter.facing), Math.fround(item.y + 1.5));
      shot.phase = 'flight'; shot.owner = fighter.slot; shot.facing = fighter.facing;
      shot.vx = Math.fround(vx * fighter.facing); shot.vy = Math.fround(vy);
      shot.life = Math.max(1, Math.ceil(life));
      return shot;
    };
    if (name === 'LGun') {
      const ray = itemKind('LGunRay');
      item.ammo--; item.timer = PROTO.gunCooldown;
      spawnBeam('LGunRay', this.attrF(ray, 0), 0, this.attrF(ray, 4));
      events.push({ type: 'sound', player: fighter.slot, x: item.x, y: item.y, sound: fighter.facing >= 0 ? 0xe4 : 0xe5, volume: 127, pan: 64 });
    } else if (name === 'SScope') {
      const beam = itemKind('SScopeBeam');
      // it_80291D38: xC[level] is a float cost table (level 0 = 1 energy); xD4C starts at the s32 +0.
      item.ammo = Math.max(0, item.ammo - Math.max(1, Math.trunc(this.attrF(item.kind, 0xc))));
      spawnBeam('SScopeBeam', this.attrF(beam, 0), 0, this.attrF(beam, 8));
      events.push({ type: 'sound', player: fighter.slot, x: item.x, y: item.y, sound: 0xfc, volume: 127, pan: 64 });
    } else {
      // it_80292F14: one fuel unit per flame; ItLGunBeamAttr speed [x4,x8], angle-from-vertical
      // [xC,x10] flipped by facing, lifetime x0. A burst per press approximates the stream.
      const flame = itemKind('LGunBeam');
      const life = this.attrF(flame, 0), speedMin = this.attrF(flame, 4), speedMax = this.attrF(flame, 8);
      const angleMin = this.attrF(flame, 0xc), angleMax = this.attrF(flame, 0x10);
      for (let i = 0; i < 4 && item.ammo > 0; i++) {
        item.ammo--;
        const speed = Math.fround(speedMin + (speedMax - speedMin) * this.random());
        const angle = Math.fround(angleMin + (angleMax - angleMin) * this.random());
        spawnBeam('LGunBeam', Math.fround(speed * Math.sin(angle)), Math.fround(speed * Math.cos(angle)), life);
      }
      events.push({ type: 'sound', player: fighter.slot, x: item.x, y: item.y, sound: 0xef, volume: 110, pan: 64 });
    }
    const motion = fighter.grounded ? 'ItemShoot' : 'ItemShootAir';
    return fighter.content.clips.has(motion) ? motion : fighter.content.clips.has('ItemShoot') ? 'ItemShoot' : null;
  }
  /** it_802742F4: attaching restarts the despawn timer; the holder owns the item.
   * Consumables never reach the hand: they heal and vanish (Foods/Tomato/Heart). */
  pickup(fighter: MatchFighter, item: MatchItem, events?: MatchEvent[]): 'held' | 'consumed' {
    if (this.behavior(item.kind) === 'consumable') {
      // ftpickupitem_8009447C → it_8026B47C: eaten at the grab. Heart/Tomato heal from
      // their attr +0 (100/50); Foods reads its per-type record's +8 heal field.
      const name = this.data.kind(item.kind).name;
      // The Lucky Egg's heal is the s32 at its attr +4 (itEgg_ItemVars::heal_amount).
      const heal = name === 'Foods' ? this.data.foodHeal(item.variant)
        : item.kind === POKEMON_BASE + PK.LuckyEgg ? Math.min(999, this.attrU(item.kind, 4)) : Math.min(999, this.attrU(item.kind, 0));
      this.effects.push({ slot: fighter.slot, heal: Math.max(1, heal) });
      this.remove(item, [fighter]);
      return 'consumed';
    }
    if (this.behavior(item.kind) === 'equip') {
      // Class-5 auto-use gear: the pickup itself applies the timed status (durations from
      // each attr block's +0 field; the Hammer's +0xC swing window).
      const name = this.data.kind(item.kind).name, common = this.content.common.itemStatus;
      if (name === 'WStar') {
        // ftCo_800C4724 + it_80294364: the rider keeps the star; a random path other than the
        // last one drives the 120-frame rise (ftCommonData-free: x1C is a literal 120).
        const paths = this.data.warpPaths();
        const candidates = paths.map((_, index) => index).filter((index) => index !== this.warpLast);
        const path = candidates.length ? candidates[Math.min(candidates.length - 1, Math.trunc(this.random() * candidates.length))]! : 0;
        this.warpLast = path;
        item.phase = 'held'; item.owner = fighter.slot; item.floor = null; item.vx = 0; item.vy = 0; item.mode = 10;
        item.victims.clear(); fighter.heldItem = item.id;
        if (paths[path]) events?.push({ type: 'sound', player: fighter.slot, x: item.x, y: item.y, sound: paths[path]!.sfx, volume: 127, pan: 64 });
        this.effects.push({ slot: fighter.slot, status: { kind: 'warp', timer: 120, path } });
        return 'held';
      }
      if (name === 'Hammer') {
        item.phase = 'held'; item.owner = fighter.slot; item.floor = null; item.vx = 0; item.vy = 0;
        item.life = this.data.common.lifetime; item.victims.clear(); fighter.heldItem = item.id;
        // ftCo_800C5284: the hammer lasts ftCommonData x6AC frames.
        this.effects.push({ slot: fighter.slot, status: { kind: 'hammer', timer: common?.hammerFrames ?? 450 } });
        return 'held';
      }
      // ftpickupitem_8009447C: the hood's float x0 (it_8026B54C), the metal box's floats x0/x4
      // (timer, metal health; ftLib_800871A8) and the cloak's ftCommonData x7CC frames.
      const kind: ItemStatusKind = name === 'RabbitC' ? 'bunny' : name === 'MetalB' ? 'metal' : 'cloak';
      const timer = kind === 'cloak' ? common?.cloakFrames ?? 600 : Math.trunc(this.attrF(item.kind, 0));
      this.effects.push({ slot: fighter.slot, status: { kind, timer, health: kind === 'metal' ? this.attrF(item.kind, 4) : undefined } });
      this.remove(item, [fighter]);
      return 'consumed';
    }
    item.phase = 'held'; item.owner = fighter.slot; item.floor = null; item.vx = 0; item.vy = 0; item.thrown = false;
    item.life = item.pk ? item.life : this.data.common.lifetime; item.victims.clear(); fighter.heldItem = item.id;
    if (item.pk) this.pokemon.pickedUp(item);
    return 'held';
  }
  /** Remove the held item outright (an expired Hammer vanishes rather than dropping). */
  consumeHeld(fighter: MatchFighter): void {
    const item = this.find(fighter.heldItem);
    fighter.heldItem = null;
    if (item) this.remove(item, [fighter]);
  }
  /** Warp Star crash: the star's own giant script blast at the landing point.
   * mode 9 marks an owner-safe blast (the rider is never their own victim). */
  warpCrash(fighter: MatchFighter, events: MatchEvent[]): void {
    const ridden = this.find(fighter.heldItem);
    if (ridden && this.data.kind(ridden.kind).name === 'WStar') { fighter.heldItem = null; this.remove(ridden, [fighter]); }
    const star = this.spawnKind(itemKind('WStar'), fighter.x, Math.fround(fighter.y + 2));
    star.owner = fighter.slot;
    this.explode(star, events);
    star.mode = 9;
  }
  /** Z-drop or forced release (damage/KO): the item leaves the hand with the holder's drift. */
  dropHeld(fighter: MatchFighter): void {
    const item = this.find(fighter.heldItem);
    fighter.heldItem = null;
    if (!item || item.phase !== 'held') return;
    item.phase = 'flight'; item.vx = Math.fround(fighter.velocity.x); item.vy = 0; item.victims.clear(); item.mode = 0;
    if (item.pk) this.pokemon.dropped(item);
  }
  /** Launch at the throw animation's flag-20 release, mirroring the bomb path: the common
   * 22-entry speed/angle table × the fighter's itemThrowVelocity × the item's own multiplier. */
  private launch(item: MatchItem, holder: MatchFighter): void {
    const throwState = holder.link.itemThrow;
    if (!throwState) return;
    const table = this.content.common.itemThrows?.[throwState.throwIndex];
    if (!table) throw new Error('Original item-throw velocity table is missing.');
    const attributes = this.data.kind(item.kind).attributes;
    const speed = Math.fround(table.speed * (holder.content.profile.attributes.itemThrowVelocity ?? 1) * attributes.throwSpeedMul);
    item.vx = Math.fround(Math.cos(table.angle) * speed * throwState.throwFacing);
    item.vy = Math.fround(Math.sin(table.angle) * speed);
    item.phase = 'flight'; item.floor = null; item.facing = throwState.throwFacing; item.victims.clear(); item.activation++; item.mode = 0; item.thrown = true;
    // Flipper flight duration: itFlipper x0 (18) or the smash-throw x4 (25).
    // itFlipper_DatAttrs: s32 x0 throw / x4 smash-throw airborne frames.
    if (this.behavior(item.kind) === 'flipper') item.timer = Math.max(1, this.attrU(item.kind, throwState.throwIndex >= 14 ? 4 : 0));
    if (item.pk) this.pokemon.thrown(item);
    holder.heldItem = null; throwState.bombReady = false;
  }
  /** Containers, tuned by their own ItCo special-attribute blocks (ItCapsuleAttr, the egg's
   * reused var struct, itKusudamaAttributes, itBoxAttributes, itTaruAttributes). */
  private container(kind: number): { tag: 'capsule' | 'egg' | 'party' | 'box' | 'taru'; count: number; explodeDenominator: number; damageThreshold: number | null; landingBreak: number | null; rise: { speed: number; frames: number } | null; openSound: number | null } | null {
    const data = this.data.kind(kind), special = data.special, arc = this.data.archive;
    if (!special) return null;
    if (data.name === 'Capsule') return { tag: 'capsule', count: arc.u32(special), explodeDenominator: arc.u32(special + 4), damageThreshold: null, landingBreak: null, rise: null, openSound: null };
    if (data.name === 'Egg') return { tag: 'egg', count: arc.u32(special), explodeDenominator: arc.u32(special + 4), damageThreshold: null, landingBreak: null, rise: null, openSound: 0xf4 };
    if (data.name === 'Kusudama') return { tag: 'party', count: 0, explodeDenominator: 0, damageThreshold: arc.f32(special + 0x20), landingBreak: arc.f32(special + 0x2c), rise: { speed: arc.f32(special + 0x18), frames: Math.max(1, Math.ceil(arc.f32(special + 0x1c))) }, openSound: 0xf8 };
    if (data.name === 'Box') return { tag: 'box', count: 0, explodeDenominator: 0, damageThreshold: arc.f32(special + 0x14), landingBreak: arc.f32(special + 0x1c), rise: null, openSound: 0xf6 };
    if (data.name === 'Taru') return { tag: 'taru', count: 1, explodeDenominator: 0, damageThreshold: arc.f32(special + 0xc), landingBreak: arc.f32(special + 0x34), rise: null, openSound: 0xfb };
    return null;
  }
  /** The state whose script authors the strongest hit — the explosion for Bob-omb/capsule
   * style items whose per-kind state tables are not transcribed. */
  private explosionState(kind: number): number {
    const states = this.data.kind(kind).states;
    let best = Math.min(1, states.length - 1), bestDamage = -1;
    for (const [index, state] of states.entries()) {
      for (const event of state.script?.events ?? []) {
        if (event.type === 'create' && event.hit.damage > bestDamage) { bestDamage = event.hit.damage; best = index; }
      }
    }
    return best;
  }
  /** Shared container/bomb explosion (it_80272C08): the broken state's own ItCo script
   * carries the damaging hitbox; the common explosion GFX 0x410 / SFX 0x74 announce it. */
  private explode(item: MatchItem, events: MatchEvent[]): void {
    item.phase = 'explode'; item.stateIndex = this.explosionState(item.kind);
    item.timer = Math.ceil(this.data.common.explosionLife); item.life = item.timer + 10;
    item.vx = 0; item.vy = 0; item.victims.clear(); item.activation = -1;
    events.push({ type: 'gfx', player: item.owner ?? 0, x: item.x, y: item.y, effect: 0x410, facing: 1 });
    events.push({ type: 'sound', player: item.owner ?? 0, x: item.x, y: item.y, sound: 0x74, volume: 127, pan: 64 });
  }
  /** Release the ball's Pokémon (it_8027AB64/it_8027A4D4): 1-in-251 Celebi, then Mew, else
   * the ball's own per-Pokémon weights excluding the last two releases (lib/game/item-pokemon.ts). */
  private releasePokemon(item: MatchItem, events: MatchEvent[], ctx: PokemonContext): void {
    this.pokemon.release(item, ctx.fighters, events);
    events.push({ type: 'gfx', player: item.owner ?? 0, x: item.x, y: item.y, effect: 1000, facing: 1 });
    events.push({ type: 'sound', player: item.owner ?? 0, x: item.x, y: item.y, sound: 0xf8, volume: 127, pan: 64 });
  }
  /** Break a container. The Party Ball first rises on its authored velocity/timer and
   * rains from above; capsule/egg roll their original dud chance into an explosion; the
   * crate rolls its 1/2/3/empty weight buckets (it_80286340); the barrel its items/empty
   * pair. Contents spill with the original scatter/pop-up velocities. */
  private breakOpen(item: MatchItem, fighters: readonly MatchFighter[], events: MatchEvent[]): boolean {
    const behavior = this.behavior(item.kind);
    if (behavior === 'pokeball') {
      item.phase = 'ground'; item.mode = 3; item.variant = 0; item.vx = 0; item.vy = 0;
      item.timer = Math.max(30, Math.ceil(this.attrF(item.kind, 0)));
      events.push({ type: 'sound', player: item.owner ?? 0, x: item.x, y: item.y, sound: 0x10c, volume: 127, pan: 64 });
      return false;
    }
    if (behavior === 'freezie' || behavior === 'beam') { this.remove(item, fighters); events.push({ type: 'gfx', player: item.owner ?? 0, x: item.x, y: item.y, effect: 1000, facing: 1 }); return true; }
    if (behavior === 'explosive') { this.explode(item, events); return false; }
    const spec = this.container(item.kind);
    if (!spec || item.phase === 'explode') return false;
    if (spec.tag === 'party' && item.phase !== 'rise') {
      item.phase = 'rise'; item.timer = spec.rise!.frames; item.vx = 0; item.vy = Math.fround(spec.rise!.speed);
      item.victims.clear();
      events.push({ type: 'bounce', player: item.owner ?? 0, x: item.x, y: item.y });
      return false;
    }
    const arc = this.data.archive, special = this.data.kind(item.kind).special;
    let count = spec.count, velocity: 'pop' | 'rain' = 'pop', foods = 0;
    if (spec.tag === 'party') {
      // it_8028A114/it_80289BE8 buckets: special kind (Poké Ball gated), Foods, random, dud.
      const dud = arc.u32(special + 0xc), foodW = arc.u32(special), specialW = arc.u32(special + 4), randomW = arc.u32(special + 8);
      const open = foodW + specialW + randomW;
      const roll = Math.trunc(this.random() * Math.max(1, open + dud));
      if (roll >= open) { this.explode(item, events); return false; }
      if (roll < specialW && this.pool.includes(itemKind('MBall'))) { count = Math.max(1, arc.u32(special + 0x14)); velocity = 'rain'; foods = -1; }
      else if (roll < specialW + foodW && this.contentsPool.includes(itemKind('Foods'))) { foods = 10 + Math.trunc(this.random() * 5); count = foods; velocity = 'rain'; }
      else { count = 3 + Math.trunc(this.random() * 2); velocity = 'rain'; }
    } else if (spec.tag === 'box') {
      // it_80286340 buckets: weights for 1, 2, 3 items or the empty explosion.
      const w = [arc.u32(special), arc.u32(special + 4), arc.u32(special + 8), arc.u32(special + 0xc)] as const;
      const roll = Math.trunc(this.random() * Math.max(1, w[0] + w[1] + w[2] + w[3]));
      if (roll >= w[0] + w[1] + w[2]) { this.explode(item, events); return false; }
      count = roll < w[0] ? 1 : roll < w[0] + w[1] ? 2 : 3;
    } else if (spec.tag === 'taru') {
      // itTaru_RandCheck: items vs empty explosion.
      const items = arc.u32(special), empty = arc.u32(special + 4);
      if (Math.trunc(this.random() * Math.max(1, items + empty)) >= items) { this.explode(item, events); return false; }
    } else if (spec.explodeDenominator > 0 && Math.trunc(this.random() * spec.explodeDenominator) === 0) {
      this.explode(item, events);
      return false;
    }
    const origin = { x: item.x, y: item.y, owner: item.owner };
    this.remove(item, fighters);
    for (let i = 0; i < count && (this.contentsPool.length || foods !== 0); i++) {
      const kind = foods > 0 ? itemKind('Foods') : foods === -1 ? itemKind('MBall') : this.pick(this.contentsPool);
      const child = this.spawnKind(kind, origin.x, origin.y + (velocity === 'rain' ? 2 : 1));
      if (velocity === 'rain') {
        // it_80289BE8_inline with the random-bucket 1.2 scale (1.8 for the food shower).
        const scale = foods > 0 ? 1.8 : 1.2;
        child.vx = Math.fround(scale * this.random() - scale * 0.5); child.vy = Math.fround(scale * 0.5 * this.random() - scale * 0.25);
      } else {
        // it_8026F53C: common x54 horizontal scatter, per-kind x18 pop-up speed.
        child.vx = Math.fround(this.data.common.dropScatter * (2 * (this.random() - 0.5)));
        child.vy = this.data.kind(kind).attributes.popUpSpeed;
      }
    }
    if (spec.openSound !== null) events.push({ type: 'sound', player: origin.owner ?? 0, x: origin.x, y: origin.y, sound: spec.openSound, volume: 127, pan: 64 });
    events.push({ type: 'bounce', player: origin.owner ?? 0, x: origin.x, y: origin.y });
    return true;
  }
  /** Fighter attacks strike loose items through their original hurt capsules (or the ECB
   * as a fallback), accumulating damage; containers break past their threshold, other
   * items get knocked flying (strikeBombs analogue for match items). */
  private strikeItems(fighters: readonly MatchFighter[], poses: PoseProvider, events: MatchEvent[], ctx: PokemonContext, frozen?: readonly boolean[]): void {
    for (const item of [...this.items]) {
      if (item.phase === 'held' || item.phase === 'rise' || item.phase === 'explode') continue;
      // Hurtable Pokémon take hits on their posed article capsules (dmg_received callbacks).
      if (item.pk) { if (item.pk.hurt) this.pokemon.strike(item, ctx, frozen); continue; }
      const behavior = this.behavior(item.kind);
      if (behavior === 'beam' || behavior === 'pokemon' || behavior === 'star') continue;
      const data = this.data.kind(item.kind), scale = data.attributes.scale;
      const ecb = data.attributes.ecb;
      const capsules = data.hurtbones.length ? data.hurtbones : [{ bone: 0, a: [0, ecb.bottom, 0] as V3, b: [0, ecb.top, 0] as V3, radius: Math.max(1.5, (ecb.right - ecb.left) / 2) }];
      for (const f of fighters) {
        if ((frozen?.[f.slot] ?? f.hitlag > 0) || !['attack', 'special'].includes(f.state) || !f.attackName) continue;
        const move = f.content.attacks.get(f.attackName);
        if (!move) continue;
        for (const hit of linkHits(f, activeHits(move, f.animationFrame))) {
          const key = `${f.slot}:${f.attackSerial}:${hit.group}:${hit.activation}`;
          if (hit.damage <= 0 || hit.element === 8 || item.struckBy.has(key)) continue;
          const point = poses.point(f, hit.bone, hit.offset);
          const touched = capsules.some((h) => pointSegmentDistanceSquared(point,
            [item.x + h.a[2] * scale, item.y + h.a[1] * scale, h.a[0] * scale],
            [item.x + h.b[2] * scale, item.y + h.b[1] * scale, h.b[0] * scale]) <= (hit.radius + h.radius * scale) ** 2);
          if (!touched) continue;
          item.struckBy.add(key);
          item.damage = Math.fround(item.damage + hit.damage);
          f.hitlag = Math.max(f.hitlag, this.content.physics.hit(f.slot, 0, hit, false).hitlag);
          events.push({ type: 'gfx', player: f.slot, x: item.x, y: item.y, effect: 1000 });
          // Explosives and fragile items resolve immediately; containers use their thresholds.
          if (behavior === 'explosive') { item.owner = f.slot; this.explode(item, events); break; }
          if (behavior === 'freezie') { this.breakOpen(item, fighters, events); break; }
          if (behavior === 'shell') {
            // it_8028BAD8: launch speed = damage × the shell's damage multiplier, clamped.
            const green = this.data.kind(item.kind).name === 'GShell';
            const max = this.attrF(item.kind, green ? 4 : 0xc) || 2.2;
            if (green) {
              // it_8028BAD8: vx = damage × x14 away from the attacker, clamped to x4; under x8 it
              // stays put (itGshell state 6).
              const speed = Math.min(max, Math.fround(hit.damage * this.attrF(item.kind, 0x14)));
              if (speed < this.attrF(item.kind, 8)) break;
              item.owner = f.slot; item.phase = 'flight'; item.mode = 1; item.timer = 0; item.floor = null; item.victims.clear();
              item.facing = f.facing; item.vy = 0; item.vx = Math.fround(speed * f.facing);
              break;
            }
            item.owner = f.slot; item.phase = 'flight'; item.mode = 1; item.timer = 0; item.floor = null; item.victims.clear();
            item.facing = f.facing; item.vy = 0;
            item.vx = Math.fround(Math.min(max, Math.max(0.8, hit.damage * 0.12)) * f.facing);
            break;
          }
          const spec = this.container(item.kind);
          if (spec && (spec.damageThreshold === null || item.damage >= spec.damageThreshold)) { item.owner = f.slot; this.breakOpen(item, fighters, events); break; }
          if (!spec) {
            // A struck loose item gets knocked flying and can hit others on the way.
            if (item.phase === 'ground') item.phase = 'flight';
            item.owner = f.slot; item.floor = null; item.victims.clear();
            item.vx = Math.fround(f.facing * Math.min(2, 0.4 + hit.damage * 0.1));
            item.vy = Math.fround(Math.max(item.vy, 1));
          }
          break;
        }
        if (!this.items.includes(item)) break;
      }
    }
  }
  /** ftColl_80077C60: a class-4 item (Starman, mushrooms) is collected when its own script
   * hitbox — live from its authored frame — overlaps a fighter's hurt capsules. */
  private touchedBy(item: MatchItem, fighters: readonly MatchFighter[], hurtCache: HurtboxCache): MatchFighter | undefined {
    const script = this.data.kind(item.kind).states[0]?.script;
    const touch = script && activeHits(script, item.age)[0];
    if (!touch) return undefined;
    const scale = this.data.kind(item.kind).attributes.scale, radius = touch.radius * scale;
    const center: V3 = [Math.fround(item.x + touch.offset[2] * scale), Math.fround(item.y + touch.offset[1] * scale), 0];
    for (const f of fighters) {
      if (f.state === 'ko' || f.state === 'respawn') continue;
      const hurts = hurtCache.get(f);
      if (!hurtSweepCandidate(hurts, center, center, radius)) continue;
      if (hurts.capsules.some((hurt) => segmentDistanceSquared(center, center, hurt.a, hurt.b) <= (radius + hurt.radius) ** 2)) return f;
    }
    return undefined;
  }
  /** The flight hit: the first script hitbox the article authors (original damage/angle/
   * element), or a PROTOTYPE light-contact hit for kinds whose scripts carry none. */
  private flightHit(item: MatchItem): HitDefinition {
    for (const state of this.data.kind(item.kind).states) {
      for (const event of state.script?.events ?? []) if (event.type === 'create') return { ...event.hit, bone: 0, angle: Math.min(361, event.hit.angle) };
    }
    if (this.data.kind(item.kind).name === 'FFlowerFlame') return { id: 0, group: 0, bone: 0, damage: 2, radius: 1.6, offset: [0, 0, 0], angle: 45, growth: 30, weightSet: 0, base: 20, grounded: true, airborne: true, element: 1 };
    return { id: 0, group: 0, bone: 0, damage: 6, radius: 2.5, offset: [0, 0, 0], angle: 45, growth: 60, weightSet: 0, base: 50, grounded: true, airborne: true, element: 0 };
  }
  /** Evaluate a state script's active hitboxes at the item's position (explosions and
   * Pokémon): point capsules against shields and hurt capsules, per-activation rehits. */
  private scriptHits(item: MatchItem, elapsed: number, skipOwner: boolean, fighters: readonly MatchFighter[], poses: PoseProvider, hurtCache: HurtboxCache, impacts: ItemImpact[]): void {
    const script = this.data.kind(item.kind).states[item.stateIndex]?.script;
    if (!script) return;
    for (const hit of activeHits(script, elapsed)) {
      if (hit.activation !== item.activation) { item.victims.clear(); item.activation = hit.activation; }
      const center: V3 = [Math.fround(item.x + hit.offset[2] * item.facing), Math.fround(item.y + hit.offset[1]), 0];
      const capped = { ...hit, angle: Math.min(361, hit.angle) };
      for (const victim of fighters) {
        if ((skipOwner && victim.slot === item.owner) || item.victims.has(victim.slot) || victim.invulnerable > 0 || victim.state === 'ko' || victim.state === 'respawn') continue;
        const direction = Math.sign(victim.x - item.x) || 1;
        const shield = shieldBubble(victim, this.content, poses);
        if (shield && pointSegmentDistanceSquared(shield.center, center, center) <= (shield.radius + hit.radius) ** 2) {
          item.victims.add(victim.slot);
          impacts.push({ item, hit: capped, direction, victim, point: center, shield: true });
          continue;
        }
        const hurts = hurtCache.get(victim);
        if (!hurtSweepCandidate(hurts, center, center, hit.radius)) continue;
        for (const hurt of hurts.capsules) {
          if (segmentDistanceSquared(center, center, hurt.a, hurt.b) > (hit.radius + hurt.radius) ** 2) continue;
          item.victims.add(victim.slot);
          impacts.push({ item, hit: capped, direction, victim, point: center });
          break;
        }
      }
    }
  }
  step(fighters: readonly MatchFighter[], poses: PoseProvider, events: MatchEvent[], frozen?: readonly boolean[]): ItemImpact[] {
    const impacts: ItemImpact[] = [], hurtCache = new HurtboxCache(poses);
    const ctx: PokemonContext = { fighters, poses, hurtCache, impacts, events };
    this.lastFighters = fighters;
    if (this.countdown !== null && --this.countdown <= 0) {
      if (this.items.filter((item) => item.phase !== 'held' && item.kind < POKEMON_BASE).length < 14) this.spawnRandom(events);
      this.countdown = this.rollInterval();
    }
    this.strikeItems(fighters, poses, events, ctx, frozen);
    for (const item of [...this.items]) {
      item.age++;
      const behavior = this.behavior(item.kind);
      const attributes = this.data.kind(item.kind).attributes;
      if (item.phase === 'held') {
        const holder = fighters[item.owner ?? -1];
        if (!holder || holder.heldItem !== item.id || ['ko', 'respawn', 'captured'].includes(holder.state)) {
          if (holder?.heldItem === item.id) holder.heldItem = null;
          item.phase = 'flight'; item.vx = 0; item.vy = 0; item.owner = holder?.slot ?? item.owner;
          if (item.pk) this.pokemon.dropped(item);
        } else {
          if (behavior === 'heavy') {
            // Crates carry overhead rather than in the hand.
            item.x = holder.x; item.y = Math.fround(holder.y + 12.5 * holder.content.profile.attributes.modelScale);
          } else {
            const bone = holder.content.profile.itemHoldBone ?? holder.content.profile.boneMap[31]!;
            const point = poses.point(holder, bone, [0, 0, 0]);
            item.x = point[0]; item.y = point[1];
          }
          item.facing = holder.facing;
          // The ridden Warp Star rides with its rider; while diving (item state 3) it carries its
          // own meteor script hitbox, and it leaves with the ride.
          if (item.mode === 10) {
            // The ride status lands after this step on the pickup frame: latch it first.
            if (holder.itemStatus?.kind === 'warp') item.timer = 1;
            else if (item.timer === 1) { this.remove(item, fighters); continue; }
            item.x = holder.x; item.y = Math.fround(holder.y + 4 * holder.content.profile.attributes.modelScale);
            const dive = (holder.itemStatus as { fall?: boolean } | null)?.fall === true;
            if (dive && item.stateIndex !== 2) { item.stateIndex = 2; item.victims.clear(); item.activation = -1; }
            if (dive) this.scriptHits(item, item.age, true, fighters, poses, hurtCache, impacts);
            continue;
          }
          // A grabbed Electrode keeps burning its fuse in the hand (itmarumine state 3).
          if (item.pk) {
            this.pokemon.held(item, ctx);
            if (item.phase !== 'held') continue;
          }
          // Star Rod swings emit their star projectile at the swing's hit frame
          // (ft_800CD914: weak/strong speed and lifetime from StarRodStarAttrs).
          if (this.data.kind(item.kind).name === 'StarRod' && item.ammo > 0 && holder.state === 'attack' && holder.attackName?.startsWith('StarRodSwing')) {
            const key = `star:${holder.attackSerial}`;
            const release = holder.content.attacks.get(holder.attackName)?.events.find((event) => event.type === 'create')?.frame ?? 6;
            if (!item.struckBy.has(key) && holder.animationFrame >= release) {
              item.struckBy.add(key); item.ammo--;
              const strong = holder.attackName === 'StarRodSwing4';
              const star = itemKind('StarRodStar');
              const shot = this.spawnKind(star, Math.fround(item.x + 2 * holder.facing), item.y);
              shot.phase = 'flight'; shot.owner = holder.slot; shot.facing = holder.facing;
              shot.vx = Math.fround(this.attrF(star, 0) * this.attrF(star, strong ? 8 : 4) * holder.facing); shot.vy = 0;
              shot.life = Math.max(1, Math.ceil(this.attrF(star, strong ? 0x10 : 0xc)));
              events.push({ type: 'gfx', player: holder.slot, x: shot.x, y: shot.y, effect: 1000, facing: holder.facing });
            }
          }
          // The active Hammer swings continuously: its own script's hitboxes loop at the
          // hand; the item vanishes when the holder's hammer status expires.
          if (this.data.kind(item.kind).name === 'Hammer') {
            // The pickup's status effect applies after this step; latch it before enforcing.
            if (holder.itemStatus?.kind === 'hammer') item.mode = 8;
            else if (item.mode === 8) { this.remove(item, fighters); continue; }
            const script = this.data.kind(item.kind).states[0]?.script;
            const span = Math.max(20, script?.events.length ? Math.max(...script.events.map((event) => event.frame)) + 1 : 40);
            if (item.age % span === 0) item.victims.clear();
            item.stateIndex = 0;
            const first = script?.events.find((event) => event.type === 'create')?.frame ?? 0;
            this.scriptHits(item, Math.max(first, item.age % span), true, fighters, poses, hurtCache, impacts);
          }
          // Screw Attack: while held, jumps carry its authored spin hit around the holder.
          if (this.data.kind(item.kind).name === 'ScBall') {
            if (holder.grounded) item.victims.clear();
            else if (['jump', 'airjump'].includes(holder.state) && (holder.animation.startsWith('ItemScrew') || !holder.content.clips.has('ItemScrew'))) {
              item.x = holder.x; item.y = Math.fround(holder.y + 7 * holder.content.profile.attributes.modelScale);
              const script = this.data.kind(item.kind).states[0]?.script;
              const first = script?.events.find((event) => event.type === 'create')?.frame ?? 0;
              item.stateIndex = 0;
              this.scriptHits(item, first, true, fighters, poses, hurtCache, impacts);
            }
          }
          const throwState = holder.link.itemThrow;
          if (throwState && !throwState.throwBomb && throwState.item === item.id && throwState.bombReady) this.launch(item, holder);
          continue;
        }
      }
      // Poké Ball Pokémon and their projectiles run their transcribed per-kind state tables.
      if (item.pk) { this.pokemon.tick(item, ctx); continue; }
      // Party Ball drift (itKusudama state 3): authored rise velocity until the timer opens it.
      if (item.phase === 'rise') {
        item.y = Math.fround(item.y + item.vy); item.timer--;
        if (item.timer <= 0) this.breakOpen(item, fighters, events);
        continue;
      }
      // Explosions: the broken state's script timeline drives the multi-frame hitboxes.
      if (item.phase === 'explode') {
        const elapsed = Math.ceil(this.data.common.explosionLife) - item.timer;
        item.timer--;
        if (item.timer <= 0) { this.remove(item, fighters); continue; }
        // Blasts hit their owner too (it_80275444 re-enables all contact), except the
        // owner-safe Warp Star crash (mode 9).
        this.scriptHits(item, elapsed, item.mode === 9, fighters, poses, hurtCache, impacts);
        continue;
      }
      if (--item.life <= 0) {
        // A Bob-omb's fuse runs out with a blast, never a quiet despawn.
        if (behavior === 'explosive' && this.data.kind(item.kind).name === 'BombHei') { this.explode(item, events); continue; }
        this.remove(item, fighters); continue;
      }
      // Bob-omb (itbombhei.c): idle x10 frames, turn x4 frames, walk x14 frames at xC (turning at
      // walls, walking off ledges into a fall), then the x8 flashing fuse and the blast;
      // xDEC = x8 + x4 + x10 + x14 is the whole countdown.
      if (behavior === 'explosive' && item.phase === 'ground' && this.data.kind(item.kind).name === 'BombHei') {
        item.timer++;
        const idle = Math.trunc(this.attrF(item.kind, 0x10)), turn = Math.trunc(this.attrF(item.kind, 4));
        const walk = Math.trunc(this.attrF(item.kind, 0x14)), fuse = Math.trunc(this.attrF(item.kind, 8));
        if (item.timer >= idle + turn + walk + fuse) { this.explode(item, events); continue; }
        if (item.timer >= idle + turn && item.timer < idle + turn + walk) {
          const speed = this.attrF(item.kind, 0xc), next = Math.fround(item.x + speed * item.facing);
          const wall = traceStage(this.content.stage, [item.x, item.y + 2, 0], [next, item.y + 2, 0]);
          const support = this.content.stage.floors.find((floor) => next >= Math.min(floor.a[0], floor.b[0]) && next <= Math.max(floor.a[0], floor.b[0]) && Math.abs(floorY(floor, next) - item.y) < 1);
          if (wall && wall.surface.kind === 'wall') item.facing = -item.facing;
          else if (support) { item.x = next; item.y = floorY(support, next); item.floor = support.id; }
          else { item.phase = 'fall'; item.floor = null; item.vx = Math.fround(speed * item.facing); item.vy = 0; }
        }
      }
      // Planted Motion-Sensor Bomb: armed on stick (it_80290314); the proximity radius is
      // its own inert script hitbox, triggering on anyone — planter included.
      if (behavior === 'explosive' && item.phase === 'ground' && item.mode === 2 && this.data.kind(item.kind).name === 'MSBomb') {
        const radius = this.data.kind(item.kind).states[0]?.script?.events.find((event) => event.type === 'create')?.hit.radius ?? PROTO.msbombRadius;
        if (fighters.some((f) => !['ko', 'respawn'].includes(f.state) && Math.hypot(f.x - item.x, f.y + 6 - item.y) < Math.max(radius, 4) + 2)) { this.explode(item, events); continue; }
      }
      // Opened Poké Ball (itmball states 5/6): counts its x0 window down and releases the
      // Pokémon when the timer crosses the x4 mark, then vanishes.
      if (behavior === 'pokeball' && item.phase === 'ground' && item.mode === 3) {
        item.timer--;
        if (item.variant === 0 && item.timer <= Math.ceil(this.attrF(item.kind, 4))) { item.variant = 1; this.releasePokemon(item, events, ctx); }
        if (item.timer <= 0) { this.remove(item, fighters); continue; }
      }
      // Freezie slides at its authored base speed and drops off the edge (itUnkAttributes +4).
      if (behavior === 'freezie' && item.phase === 'ground') {
        const slide = Math.max(0.05, this.attrF(item.kind, 4));
        const next = Math.fround(item.x + slide * item.facing);
        const floor = this.content.stage.floors.find((entry) => entry.id === item.floor);
        if (floor && next >= Math.min(floor.a[0], floor.b[0]) && next <= Math.max(floor.a[0], floor.b[0])) { item.x = next; }
        else { item.phase = 'flight'; item.mode = 0; item.owner = null; item.vx = Math.fround(slide * item.facing); }
      }
      // Mushrooms (itkinoko.c/itdkinoko.c): on the ground they walk at x0 toward where they
      // face (spawned facing the stage center) and turn at walls; airborne they fall on the
      // item gravity and bleed x4 of horizontal speed per frame. Class 4: their own script
      // hitbox (live from its authored frame) is the touch that applies the size change.
      if (behavior === 'touchStatus') {
        const walk = this.attrF(item.kind, 0), friction = this.attrF(item.kind, 4);
        if (item.phase === 'ground') {
          const next = Math.fround(item.x + walk * item.facing);
          const wall = traceStage(this.content.stage, [item.x, item.y + 2, 0], [next, item.y + 2, 0]);
          // Floors are split into segments; the walk continues onto any joined floor at this height.
          const support = this.content.stage.floors.find((entry) => next >= Math.min(entry.a[0], entry.b[0]) && next <= Math.max(entry.a[0], entry.b[0]) && Math.abs(floorY(entry, next) - item.y) < 1);
          if (wall && wall.surface.kind === 'wall') item.facing = -item.facing;
          else if (support) { item.x = next; item.y = floorY(support, next); item.floor = support.id; }
          else { item.phase = 'fall'; item.floor = null; item.vx = Math.fround(walk * item.facing); item.vy = 0; }
        } else if (item.phase === 'fall' && Math.abs(item.vx) > 0) {
          item.vx = Math.abs(item.vx) < friction ? 0 : Math.fround(item.vx - Math.sign(item.vx) * friction);
        }
        const toucher = this.touchedBy(item, fighters, hurtCache);
        if (toucher) {
          this.effects.push({ slot: toucher.slot, status: { kind: this.data.kind(item.kind).name === 'Kinoko' ? 'mushroom' : 'poison', timer: 0 } });
          events.push({ type: 'sound', player: toucher.slot, x: item.x, y: item.y, sound: 0xf9, volume: 110, pan: 64 });
          this.remove(item, fighters);
          continue;
        }
      }
      // Starman (itstar.c): falls on its item gravity/terminal, re-launches at (x10 × dir, x14)
      // on every floor contact, flips at walls, stops rising at ceilings. Class 4: its own
      // script hitbox is the touch that grants its x0 invincibility frames.
      if (behavior === 'star') {
        const before: V3 = [item.x, item.y, 0];
        item.vy = Math.fround(item.vy < 0 && Math.abs(item.vy) >= attributes.terminal ? item.vy : item.vy - attributes.gravity);
        item.x = Math.fround(item.x + item.vx); item.y = Math.fround(item.y + item.vy);
        const contact = traceStage(this.content.stage, before, [item.x, item.y, 0]);
        if (contact) {
          item.x = contact.point[0]; item.y = contact.point[1];
          if (contact.surface.kind === 'floor') { item.vx = Math.fround(this.attrF(item.kind, 0x10) * item.facing); item.vy = this.attrF(item.kind, 0x14); }
          else if (contact.surface.kind === 'wall') { item.facing = -item.facing; item.vx = -item.vx; item.x = Math.fround(item.x + Math.sign(item.vx) * 0.02); }
          else if (item.vy > 0) item.vy = 0;
          events.push({ type: 'sound', player: 0, x: item.x, y: item.y, sound: 0xfa, volume: 100, pan: 64 });
        }
        const toucher = this.touchedBy(item, fighters, hurtCache);
        if (toucher) {
          this.effects.push({ slot: toucher.slot, invulnerable: Math.max(1, Math.min(3600, this.attrU(item.kind, 0))) });
          events.push({ type: 'sound', player: toucher.slot, x: item.x, y: item.y, sound: 0xf9, volume: 127, pan: 64 });
          this.remove(item, fighters);
        }
        const blast = this.content.stage.blast;
        if (item.x < blast.left || item.x > blast.right || item.y < blast.bottom) this.remove(item, fighters);
        continue;
      }
      const previous: V3 = [item.x, item.y, 0];
      if (item.phase === 'fall' || item.phase === 'flight') {
        // Sliding shells hug their floor at speed; the Flipper flies for its authored
        // duration (itFlipper x0 = 18 frames) then eases into its hover.
        if (behavior === 'shell' && item.mode === 1) {
          const green = this.data.kind(item.kind).name === 'GShell';
          const max = this.attrF(item.kind, green ? 4 : 0xc) || 2.2;
          if (!green) {
            // itRshell homing: accelerate toward the nearest rival on the retarget cadence.
            const accel = this.attrF(item.kind, 8) || PROTO.shellAccel * 3;
            const target = fighters.filter((f) => f.slot !== item.owner && f.stocks > 0 && !['ko', 'respawn'].includes(f.state)).sort((a, b) => Math.abs(a.x - item.x) - Math.abs(b.x - item.x) || a.slot - b.slot)[0];
            if (target && Math.sign(target.x - item.x) !== Math.sign(item.vx)) item.vx = Math.fround(item.vx - Math.sign(item.vx) * accel * 3);
          }
          // Green shells keep their clamped speed for their x0 slide frames (itGshell states 5/7).
          if (green) { if (++item.timer >= Math.trunc(this.attrF(item.kind, 0))) { this.remove(item, fighters); continue; } }
          else item.vx = Math.fround(Math.max(-max, Math.min(max, item.vx + Math.sign(item.vx) * PROTO.shellAccel)));
          const support = this.content.stage.floors.find((floor) => item.x >= Math.min(floor.a[0], floor.b[0]) && item.x <= Math.max(floor.a[0], floor.b[0]) && Math.abs(item.y - Math.max(floor.a[1], floor.b[1])) < 4);
          if (support) { item.y = Math.max(support.a[1], support.b[1]); item.vy = 0; }
          else item.mode = 0; // Off the ledge: ordinary ballistic flight resumes.
        }
        if (behavior === 'flipper' && item.owner !== null && item.phase === 'flight') {
          if (item.timer > 0) {
            item.timer--;
            if (item.timer <= 10) { item.vx = Math.fround(item.vx * 0.8); item.vy = Math.fround(item.vy * 0.8); }
            if (item.timer <= 0) { item.vx = 0; item.vy = 0; item.mode = 1; item.life = Math.max(1, this.attrU(item.kind, 8)); }
          }
        } else if (!(behavior === 'shell' && item.mode === 1)) {
          item.vy = Math.fround(Math.max(-attributes.terminal, item.vy - attributes.gravity));
        }
        item.x = Math.fround(item.x + item.vx); item.y = Math.fround(item.y + item.vy);
        // The Fire Flower's flame (LGunBeam) is particle-only in the original; the common fire
        // hit effect along its path stands in for its generator.
        if (behavior === 'beam' && item.kind === itemKind('LGunBeam') && item.age % 3 === 1) events.push({ type: 'gfx', player: item.owner ?? 0, x: item.x, y: item.y, effect: 1002, facing: item.facing });
        const contact = traceStage(this.content.stage, previous, [item.x, item.y, 0]);
        if (contact) {
          item.x = contact.point[0]; item.y = contact.point[1];
          if (behavior === 'beam') { this.remove(item, fighters); continue; }
          if (behavior === 'pokeball' && item.phase === 'flight' && contact.surface.kind === 'floor') {
            // itMball_80297CC4: land → open in place; the Pokémon releases at lifeTimer x4.
            item.phase = 'ground'; item.floor = contact.surface.id; item.mode = 3; item.variant = 0; item.vx = 0; item.vy = 0;
            item.timer = Math.max(30, Math.ceil(this.attrF(item.kind, 0)));
            events.push({ type: 'sound', player: item.owner ?? 0, x: item.x, y: item.y, sound: 0x10c, volume: 127, pan: 64 });
            continue;
          }
          // A thrown Bob-omb only blows up landing faster than its x20/x24 speeds (fn_8028007C).
          if (behavior === 'explosive' && item.phase === 'flight' && (this.data.kind(item.kind).name !== 'BombHei' || Math.abs(item.vx) > this.attrF(item.kind, 0x20) || Math.abs(item.vy) > this.attrF(item.kind, 0x24))) { this.explode(item, events); continue; }
          if (behavior === 'shell' && item.phase === 'flight') {
            const green = this.data.kind(item.kind).name === 'GShell';
            if (contact.surface.kind === 'floor' && green) {
              // it_8028C898: land sliding at |vx| clamped to x4, or settle idle under x8.
              const max = this.attrF(item.kind, 4), speed = Math.min(max, Math.abs(item.vx));
              item.vy = 0; item.floor = contact.surface.id;
              if (speed < this.attrF(item.kind, 8)) { item.phase = 'ground'; item.vx = 0; item.mode = 0; }
              else { item.mode = 1; item.timer = 0; item.vx = Math.fround(Math.sign(item.vx) * speed); }
            } else if (contact.surface.kind === 'floor') { const max = this.attrF(item.kind, 0xc) || 2.2; item.mode = 1; item.timer = 0; item.vx = Math.fround(Math.sign(item.vx || item.facing) * Math.max(Math.abs(item.vx), max * 0.7)); item.vy = 0; }
            else item.vx = Math.fround(-item.vx); // Wall: the slide reverses.
            continue;
          }
          if (behavior === 'freezie' && item.phase === 'flight') {
            if (contact.surface.kind === 'floor' && item.owner === null) { item.phase = 'ground'; item.floor = contact.surface.id; item.vx = 0; item.vy = 0; }
            else this.breakOpen(item, fighters, events); // Thrown or against a wall: it shatters.
            continue;
          }
          // Thrown containers break on terrain: capsule/egg/crate on any contact, the Party
          // Ball and barrel above their authored landing thresholds.
          const spec = item.phase === 'flight' ? this.container(item.kind) : null;
          if (spec && (spec.landingBreak === null || Math.abs(item.vy) > spec.landingBreak || contact.surface.kind !== 'floor' || spec.tag === 'box')) {
            this.breakOpen(item, fighters, events);
            continue;
          }
          if (contact.surface.kind === 'floor') {
            const speed = Math.hypot(item.vx, item.vy);
            if (item.phase === 'fall' || speed < 1.2) {
              item.phase = 'ground'; item.floor = contact.surface.id; item.vx = 0; item.vy = 0;
              // A landed Motion-Sensor Bomb that was thrown plants and arms itself.
              // A thrown Motion-Sensor Bomb plants and arms immediately (it_80290314).
              if (behavior === 'explosive' && this.data.kind(item.kind).name === 'MSBomb' && item.owner !== null) { item.mode = 2; item.timer = 0; events.push({ type: 'sound', player: item.owner, x: item.x, y: item.y, sound: 0xf3, volume: 110, pan: 64 }); }
              events.push({ type: 'bounce', player: item.owner ?? 0, x: item.x, y: item.y });
            } else {
              item.vx = Math.fround(item.vx * Math.abs(attributes.bounce)); item.vy = Math.fround(-item.vy * Math.abs(attributes.bounce));
              item.y = Math.fround(item.y + 0.02);
              events.push({ type: 'bounce', player: item.owner ?? 0, x: item.x, y: item.y });
            }
          } else { item.vx = Math.fround(-item.vx * Math.abs(attributes.bounce)); item.x = Math.fround(item.x + Math.sign(item.vx) * 0.02); }
        }
      }
      // The hovering Flipper bumps whoever touches it, re-arming on its authored
      // hitbox interval (itFlipper x14 = 10 frames).
      if (behavior === 'flipper' && item.mode === 1) {
        const interval = Math.max(1, this.attrU(item.kind, 0x14));
        if (item.age % interval === 0) item.victims.clear();
        this.scriptHits(item, 10, false, fighters, poses, hurtCache, impacts);
      }
      // Flight damage through a swept capsule against shields and hurtboxes.
      const flying = item.phase === 'flight' && item.owner !== null && (Math.hypot(item.vx, item.vy) >= 1 || (behavior === 'shell' && item.mode === 1));
      if (flying) {
        const authored = this.flightHit(item), end: V3 = [item.x, item.y, 0];
        // it_8026B1D4: a thrown item's hit grows with its speed (x94 per unit, x98 offset, min 1).
        const hit = item.thrown ? { ...authored, damage: Math.max(1, Math.fround(authored.damage + Math.hypot(item.vx, item.vy) * this.data.common.thrownSpeedDamage + this.data.common.thrownDamageOffset)) } : authored;
        for (const victim of fighters) {
          // Shells hit their owner too once they have slid x24 frames (it_80275444 in state 6/8).
          if (victim.slot === item.owner && !(behavior === 'shell' && (this.data.kind(item.kind).name !== 'GShell' || (item.mode === 1 && item.timer >= Math.trunc(this.attrF(item.kind, 0x24)))))) continue;
          if (item.victims.has(victim.slot) || victim.invulnerable > 0 || victim.state === 'ko' || victim.state === 'respawn') continue;
          const shield = shieldBubble(victim, this.content, poses);
          if (shield && pointSegmentDistanceSquared(shield.center, previous, end) <= (shield.radius + hit.radius) ** 2) {
            item.victims.add(victim.slot);
            impacts.push({ item, hit: { ...hit }, direction: Math.sign(item.vx) || 1, victim, point: end, shield: true });
            if (behavior === 'beam' || behavior === 'freezie') { this.remove(item, fighters); break; }
            if (behavior === 'explosive') { this.explode(item, events); break; }
            if (this.container(item.kind)) { this.breakOpen(item, fighters, events); break; }
            if (behavior === 'shell') { item.vx = Math.fround(-item.vx); break; }
            item.vx = Math.fround(item.vx * ITEM_COMMON.shieldBounceX); item.vy = Math.fround(item.vy * ITEM_COMMON.shieldBounceY + ITEM_COMMON.shieldBounceLift);
            break;
          }
          const hurts = hurtCache.get(victim);
          if (!hurtSweepCandidate(hurts, previous, end, hit.radius)) continue;
          for (const hurt of hurts.capsules) {
            if (segmentDistanceSquared(previous, end, hurt.a, hurt.b) > (hit.radius + hurt.radius) ** 2) continue;
            item.victims.add(victim.slot);
            impacts.push({ item, hit: { ...hit }, direction: Math.sign(item.vx) || 1, victim, point: end });
            if (behavior === 'beam' || behavior === 'freezie') { this.remove(item, fighters); break; }
            if (behavior === 'explosive') { this.explode(item, events); break; }
            if (this.container(item.kind)) { this.breakOpen(item, fighters, events); break; }
            if (behavior !== 'shell' && behavior !== 'pokeball') { item.vx = Math.fround(-item.vx * 0.4); item.vy = Math.fround(Math.max(0.6, item.vy * -0.3)); }
            // shellHit: a green shell pops up at x10 and all but stops (vx × -xC × rand).
            if (behavior === 'shell' && this.data.kind(item.kind).name === 'GShell') {
              item.vx = Math.fround(-item.vx * this.attrF(item.kind, 0xc) * this.random()); item.vy = this.attrF(item.kind, 0x10); item.mode = 0;
            }
            if (behavior === 'pokeball') { item.vx = Math.fround(-item.vx * 0.5); item.vy = Math.fround(Math.max(0.8, item.vy * -0.4)); }
            break;
          }
          if (!this.items.includes(item) || item.victims.has(victim.slot)) break;
        }
      }
      if (!this.items.includes(item)) continue;
      const blast = this.content.stage.blast;
      if (item.x < blast.left - 60 || item.x > blast.right + 60 || item.y < blast.bottom - 20 || item.y > blast.top + 100) this.remove(item, fighters);
    }
    // Held bookkeeping survives every removal path (capacity shift, blast bounds, expiry).
    for (const fighter of fighters) if (fighter.heldItem !== null && !this.items.some((item) => item.id === fighter.heldItem && item.phase === 'held')) fighter.heldItem = null;
    return impacts;
  }
  private remove(item: MatchItem, fighters: readonly MatchFighter[]): void {
    const index = this.items.indexOf(item);
    if (index >= 0) this.items.splice(index, 1);
    for (const fighter of fighters) if (fighter.heldItem === item.id) fighter.heldItem = null;
    if (item.pk) this.pokemon.forget(item.id);
  }
  captureState(): ItemWorldState {
    return structuredClone({ serial: this.serial, countdown: this.countdown, items: this.items, pokemon: this.pokemonMemory, warpLast: this.warpLast });
  }
  restoreState(state: ItemWorldState): void {
    this.serial = state.serial; this.countdown = state.countdown;
    this.items.splice(0, this.items.length, ...structuredClone(state.items));
    Object.assign(this.pokemonMemory, state.pokemon ?? { last: -1, previous: -1, legend: 0 });
    this.warpLast = state.warpLast ?? -1;
  }
}
