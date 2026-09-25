import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { connectCachedSource, connectServerSource, storedCopyGaps } from '../../../lib/hsd/server-source.ts';
import { chooseLook, loadLookPreference, ORIGINAL_LOOK, saveLookPreference } from './look-setting.ts';
import { openLocalSource, saveLocalCopy, type LocalSource } from '../../../lib/hsd/local-source.ts';
import type { SourceManifest } from '../../../lib/hsd/source-protocol.ts';
import { localDiscReader } from '../lab/local-disc.ts';
import type { HsdAssetSession } from '../../../lib/hsd/session.ts';
import { copySourceKinds, fighterAssetNames, loadGameCore, loadCostumeModel, loadNanaCostumeModel, loadRosterQueue, pendingRosterKinds, prioritizeKinds, selectGameStage, unloadFighters, type GameContent } from '../../../lib/game/load.ts';
import { SUPPORTED_STAGES, stagePlayerLimit, type StageId } from '../../../lib/game/stages.ts';
import { LocalMatch, neutralInput, type MatchEvent, type PlayerInput } from '../../../lib/game/match.ts';
import { rosterPlayers, selectLineup, ROSTER_CHOICES, MENU_FIGHTER_ORDER, pickRandomKind } from '../../../lib/game/roster.ts';
import { activeSeats, defaultSeats, type BattleSetup, type PlayerSeat, type PlayerControllerMode, type SeatControl } from '../../../lib/game/setup.ts';
import { HILL_CAPTURE_FRAMES, HILL_TEAM_NAMES, hillClaims, hillTeamOfSlot, hillWinningTeam } from '../../../lib/game/hill.ts';
import { clampCpuLevel, DEFAULT_CPU_LEVEL, isCpuLevel } from '../../../lib/game/cpu.ts';
import { MAX_MATCH_PLAYERS, MIN_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import type { FighterKind } from '../../../lib/game/data.ts';
import type { HsdModel } from '../../../lib/hsd/model.ts';
import { clampCostumeIndex, nanaCostumeFile, nanaCostumeKey, portraitKey } from '../../../lib/game/costumes.ts';
import { contentByteCensus, type ByteCensus } from '../../../lib/game/content-bytes.ts';
import { customCharacter, CUSTOM_PACK_IDENTITIES, CUSTOM_PRESENTATIONS } from '../../../lib/custom/registry.ts';
import { inhaleHoldActive } from '../../../lib/game/kirby.ts';
import { PlayRenderer } from '../render/play-renderer.ts';
import { loadCameraShakeLevel, saveCameraShakeLevel, type CameraShakeLevel } from '../render/camera-shake.ts';
import { loadRumbleLevel, saveRumbleLevel, type RumbleLevel } from '../../../lib/game/rumble.ts';
import { hasNativeBridge } from '../android-bridge.ts';
import { PlayRumble } from '../play-rumble.ts';
import { GRAPHICS_QUALITIES, loadGraphicsQuality, saveGraphicsQuality, loadGraphicsMode, saveGraphicsMode, stepDownQuality, qualityIndex, shouldAutoStepDown, shouldAutoStepUp, isTvClassDevice, capPixelRatioFor1080, chooseInitialQuality, type GraphicsQuality, type GraphicsMode } from '../render/graphics-quality.ts';
import { loadVisualEffectChoices, saveVisualEffectChoices, withVisualEffect, type VisualEffectChoices, type VisualEffectChoice, type VisualEffectId } from '../render/visual-effects.ts';
import { loadTextureUpscale, saveTextureUpscale, setTextureUpscale, type TextureUpscale } from '../render/texture-upscale.ts';
import { cacheStorageStore, cachingFetcher, coalescingFetcher, offlineWholeFileFetcher, WHOLE_FILE_LIMIT } from '../../../lib/hsd/asset-fetch.ts';
import { prepareCustomVisuals, disposeCustomVisuals } from '../render/custom-visuals.ts';
import { PlayInput } from '../play-input.ts';
import { PauseCameraControls, type PauseFocusInfo } from './pause-camera-controls.ts';
import type { LocalControllerCount } from '../input/controller-hub.ts';
import { PlayAudio } from '../play-audio.ts';
import { ANNOUNCER_CUES, MenuAudio, type MenuSound } from '../menu-audio.ts';
import { Store } from './store.ts';
import { captureCostumePortrait, captureFighterPortraits, captureItemPortraits, captureStagePreview } from './menu-previews.ts';
import { readPreviewCache, writePreviewCache, type PreviewCacheData } from './preview-cache.ts';
import { summarizeBackgroundLoad, portraitPlaceholderKeys, PORTRAIT_MAX_ATTEMPTS, type BackgroundLoad } from './load-progress.tsx';
import { FrameMonitor, shouldRender } from './frame-monitor.ts';
import { profiler } from '../../../lib/perf/profiler.ts';
import { PerfTelemetry, type PerfFrame, type PerfMatchContext, type PerfScene } from '../perf/telemetry.ts';
import type { EndedMatch } from '../account/game-report.ts';

/** Top-level RAF tick spans (timing only; see lib/perf/profiler.ts). */
const SPAN_INPUT = profiler.span('frame.input'), SPAN_SIM = profiler.span('frame.sim'), SPAN_AUDIO = profiler.span('frame.audio'), SPAN_RENDER = profiler.span('frame.render'),
  SPAN_HUD = profiler.span('frame.hud'), SPAN_HUD_COMMIT = profiler.span('hud.commit'), SPAN_PREVIEW = profiler.span('frame.preview'), SPAN_STEP = profiler.span('sim.step'), SPAN_PRESENT = profiler.span('sim.present');

export type Scene = 'home' | 'characters' | 'stages' | 'arena' | 'online' | 'rogue' | 'roulette' | 'tournament';
export type ClientAcePolicy = 'optional' | 'required' | 'off';
export interface DiscGate { ace: ClientAcePolicy; error: string; verifying: boolean }
/** The host's client-disc marker (server/http.ts), or null when the host streams its own ISO. */
function clientDiscPolicy(): ClientAcePolicy | null {
  const marker = document.querySelector('meta[name="smash-disc"][content="client"]');
  if (!marker) return null;
  const ace = marker.getAttribute('data-ace');
  return ace === 'required' || ace === 'off' ? ace : 'optional';
}
export interface PlayView {
  /** Client-disc mode only: boot is waiting for the player's own ISO(s). Null otherwise. */
  discGate: DiscGate | null;
  /** Client-disc mode only: progress (0-1) of saving the game files in this browser so the disc
   * is not asked for again; 'saved' once done, 'failed' when storage refused. Null otherwise. */
  discSave: number | 'saved' | 'failed' | null;
  /** Client-disc mode, stored partial data: how many game files this browser never received. */
  discGaps: number;
  ready: boolean; loading: boolean; error: string; progress: string; progressFraction: number; audioError: string; visualWarning?: string;
  /** Presentation only: full fighter cards, or minimal overhead damage percents. */
  hudMode: 'cards' | 'overhead';
  mode: 'solo' | 'lan' | null; scene: Scene; setup: BattleSetup; activeSeat: number;
  active: boolean; paused: boolean; ended: boolean; walk: boolean; sound: boolean; music: boolean;
  masterVolume: number; musicVolume: number; debug: boolean; debugCollision: boolean; padNote: string; touch: boolean;
  /** Roulette chaos (local debug toy): rotate every fighter to a random champ
   * every `rouletteSeconds` seconds, no countdown. Never online. */
  roulette: boolean; rouletteSeconds: number;
  portraits: Record<string, string>; itemPortraits: Record<string, string>; stagePreviews: Record<string, string>; presentation: string; graphics: GraphicsQuality;
  /** Effective preset (what the renderer runs) vs the user's mode: `auto`
   * adapts freely within the session, an explicit preset is pinned and the
   * stepper never touches it. */
  graphicsMode: GraphicsMode;
  /** Per-effect choices for the screen-space chain (glow, ambient occlusion,
   * color grade, sharpening, vignette). `auto` follows the effective preset;
   * an explicit on/off is pinned and persisted. Cosmetic only. */
  effects: VisualEffectChoices;
  /** Cosmetic CPU upscale of fighter/stage textures (1 = original); see render/texture-upscale.ts. */
  textureUpscale: TextureUpscale;
  /** Cosmetic looks this host serves (lib/hsd/looks.ts), the stored choice ('original' or a look id)
   * and the look this session actually loaded; a different choice applies on the next load. */
  looks: readonly { id: string; name: string }[];
  look: string;
  activeLook: string;
  /** Cosmetic camera-shake intensity (options menu, persisted): off disables
   * all quake lens shifts, reduced keeps KO + strong hits, full is historical. */
  cameraShake: CameraShakeLevel;
  /** Cosmetic rumble (options menu, persisted): off disables all gamepad
   * dual-rumble + phone vibration, subtle keeps KO + shield-break + strong
   * hits, full mirrors the original hit/grab/shield/KO dispatch. */
  rumble: RumbleLevel;
  /** Toggleable performance tools (options menu, persisted): FPS counter and
   * the extended frame/render stats overlay. */
  showFps: boolean; showPerf: boolean;
  /** Cosmetic high-refresh smoothing (options menu, persisted, default on):
   * forward-extrapolates rendered roots/poses a fraction of a tick so
   * 120/144/165 Hz displays see unique motion every RAF. Sim, snapshots,
   * hashes and rollback stay exact; off restores the stepped 60 Hz look. */
  smoothMotion: boolean;
  /** Melee-style pause camera focus: the fighter the manual pause orbit is
   * centred on (slot + name), or null while framing freely. HUD label only;
   * cleared whenever the match resumes. */
  pauseFocus: PauseFocusInfo | null;
  /** Unified background preparation (fighters + stages + full voice banks),
   * shown as one progress bar on menu screens. Null once everything is ready. */
  background: BackgroundLoad | null;
}
export function announcerCue(kind: FighterKind | undefined): MenuSound {
  return (kind ? ANNOUNCER_CUES[kind] : undefined) ?? 'confirm';
}
export interface FighterHud {
  kind?: FighterKind; costume?: number; seatId?: number; control?: PlayerControllerMode; level?: number; name: string; label: string; tag: string;
  percent: number; stocks: number; shield: number; charge: number; chargeMax: number; charging: boolean; combat: string;
  /** Nana's live state for Ice Climbers (null for solo Popo and everyone else). */
  nana?: { active: boolean; percent: number } | null;
  /** King of the Hill points (free-for-all score and team top-scorer); 0 in stock battles. */
  hillPoints: number;
  /** Team battle side (0 RED, 1 BLUE); null in free-for-all. */
  team: 0 | 1 | null;
  /** PROTOTYPE (zombies): infected side; false in every other mode. */
  infected: boolean;
  /** Results-screen stats (KOs, falls, floored damage dealt). */
  kos: number; falls: number; damage: number;
  position: { x: number; y: number; visible: boolean };
}
export interface HillHudZone {
  id: 'A' | 'B';
  /** Slot (free-for-all) or team that owns the zone; null while unclaimed. */
  holder: number | null;
  /** Everyone building capture progress right now (0–1 each), strongest first. */
  claims: { slot: number; progress: number }[];
}
export interface HillHud {
  teams: boolean; zones: HillHudZone[]; points: number[]; teamPoints: [number, number];
  relocateIn: number; winningTeam: 0 | 1 | null;
}
export interface HudView { frame: number; clock: string; status: string; mode: string; stage?: StageId; phase: string; countdown: number; winner: string; winnerSlot: number | null; banner: string; /** Onett car-crossing warning; false on every other stage. */ onettWarning: boolean; /** Seconds to the next roulette rotation; null when chaos is off. */ rouletteIn: number | null; fighters: FighterHud[]; shieldMax: number; /** King of the Hill scoreboard; null in stock battles. */ hill: HillHud | null; /** Rolling render rate; shown only when debug HUD is on. */ fps?: number; /** Extended frame stats for the Performance tools overlay. */ perf?: PerfStats }
/** Toggleable performance readout (options menu): everything cosmetic, never simulation. */
export interface PerfStats { fps: number; p50: number; p95: number; skip: 0 | 1 | 2; quality: GraphicsQuality; calls: number; triangles: number; programs: number; particles: number; smooth: boolean; /** Camera branch: focus:P1@242, crowd@410, classic@180. */ cam: string }
/** Copyable diagnostic trail for phantom falls; updated with the HUD at ~30 Hz. */
export interface FallLogEntry { frame: number; player: number; name: string; x: number; y: number; floor: number | null; reason: string; stage: string; detail: string }
export interface FallLogView { entries: FallLogEntry[] }
export const formatFallEntry = (entry: FallLogEntry): string => `${entry.stage} f${entry.frame} P${entry.player + 1} ${entry.name} (${entry.x.toFixed(1)},${entry.y.toFixed(1)}) floor ${entry.floor ?? 'none'} -> air [${entry.reason}]`;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
function loadToggle(key: string): boolean {
  try { return globalThis.localStorage?.getItem(key) === '1'; } catch { return false; }
}
function saveToggle(key: string, value: boolean): void {
  try { if (value) globalThis.localStorage?.setItem(key, '1'); else globalThis.localStorage?.removeItem(key); } catch { /* session-only */ }
}
/** Roulette chaos defaults off with a 30 s timer; a stale interval falls back. */
function loadRouletteSeconds(): number {
  try {
    const raw = Number(globalThis.localStorage?.getItem('smash-roulette-seconds'));
    if (raw === 10 || raw === 30 || raw === 60) return raw;
  } catch { /* private mode: session-only */ }
  return 30;
}
function saveRouletteSeconds(seconds: number): void {
  try { globalThis.localStorage?.setItem('smash-roulette-seconds', String(seconds)); } catch { /* private mode: session-only */ }
}
/** Persisted on/off options whose default is on (sound, music): unlike
 * saveToggle, an explicit choice is always stored, so a muted session stays
 * muted instead of reverting to the default on reload. */
function loadEnabled(key: string, fallback: boolean): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw === null || raw === undefined ? fallback : raw === '1';
  } catch { return fallback; }
}
function saveEnabled(key: string, value: boolean): void {
  try { globalThis.localStorage?.setItem(key, value ? '1' : '0'); } catch { /* private mode: session-only */ }
}
/** Music volume persists across launches; garbage in storage falls back to
 * the default instead of silencing or blasting the menu. */
const DEFAULT_MUSIC_VOLUME = 0.3;
function loadMusicVolume(): number {
  try {
    const text = globalThis.localStorage?.getItem('smash-music-volume');
    if (text === null || text === undefined || text === '') return DEFAULT_MUSIC_VOLUME;
    const raw = Number(text);
    if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
  } catch { /* private mode: session-only */ }
  return DEFAULT_MUSIC_VOLUME;
}
function saveMusicVolume(musicVolume: number): void {
  try { globalThis.localStorage?.setItem('smash-music-volume', String(Math.min(1, Math.max(0, musicVolume)))); } catch { /* private mode: session-only */ }
}
/** General volume (all game audio: menu music + SFX and match sound) persists
 * the same way. A fresh launch starts quiet (10%): the original mix is loud,
 * and a first visit should never blast whoever opens the page. */
const DEFAULT_MASTER_VOLUME = 0.1;
function loadMasterVolume(): number {
  try {
    const text = globalThis.localStorage?.getItem('smash-master-volume');
    if (text === null || text === undefined || text === '') return DEFAULT_MASTER_VOLUME;
    const raw = Number(text);
    if (Number.isFinite(raw)) return Math.min(1, Math.max(0, raw));
  } catch { /* private mode: session-only */ }
  return DEFAULT_MASTER_VOLUME;
}
function saveMasterVolume(masterVolume: number): void {
  try { globalThis.localStorage?.setItem('smash-master-volume', String(Math.min(1, Math.max(0, masterVolume)))); } catch { /* private mode: session-only */ }
}
/** An explicit touch-controls choice wins; otherwise the device heuristic
 * applies, so phones still default to touch without locking desktops in. */
function loadTouch(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem('smash-touch');
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch { /* private mode: fall through to the device heuristic */ }
  return typeof innerWidth !== 'undefined' && (innerWidth < 700 || (globalThis.matchMedia?.('(pointer: coarse)').matches ?? false));
}
function loadPresentation(): PlayView['presentation'] {
  try {
    const raw = globalThis.localStorage?.getItem('smash-presentation');
    if (raw && CUSTOM_PRESENTATIONS.some(mode => mode.id === raw)) return raw;
  } catch { /* private mode: session-only */ }
  return CUSTOM_PRESENTATIONS[0]?.id ?? 'default';
}
/** Phase 2.3: SHA-256 via native SubtleCrypto when available (off-main-thread
 * native code), noble fallback for plain-LAN http origins without Web Crypto.
 * Only ever called on small manifests, never on every downloaded asset byte. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  try {
    const subtle = (globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
    if (subtle) {
      const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* fall through to the local software hash */ }
  return bytesToHex(sha256(bytes));
}
/** Phones start on the minimal HUD: the fighter cards need a desktop's width,
 * and at five players they cover the whole arena on a portrait screen. An
 * explicit choice (either way) always wins. */
function loadHudMode(): PlayView['hudMode'] {
  try {
    const stored = globalThis.localStorage?.getItem('smash-hud-mode');
    if (stored === 'overhead' || stored === 'cards') return stored;
  } catch { /* private mode: fall through to the device default */ }
  try { return globalThis.matchMedia?.('(max-width: 820px), (max-height: 520px)').matches ? 'overhead' : 'cards'; } catch { return 'cards'; }
}
/** High-refresh smoothing defaults on; only an explicit off sticks. Unlike
 * showFps/showPerf (default off), existing installs get the fix without
 * visiting options, and rollback/equivalence runs can still pin it off. */
function loadSmoothMotion(): boolean {
  try { return globalThis.localStorage?.getItem('smash-smooth-motion') !== '0'; } catch { return true; }
}
function saveSmoothMotion(value: boolean): void {
  try { globalThis.localStorage?.setItem('smash-smooth-motion', value ? '1' : '0'); } catch { /* private mode: session-only */ }
}
const initialSetup = (): BattleSetup => ({ seats: defaultSeats(), stage: 'battlefield', stocks: 3, seconds: 180, items: -1, itemSwitches: null, hill: null, teams: false, zombies: false });

/** One disposable simulation/render runtime. Draft seats are separate from live state. */
export class GameSession {
  readonly ui = new Store<PlayView>({ discGate: null, discSave: null, discGaps: 0, ready: false, loading: true, error: '', progress: 'Connecting to the game source…', progressFraction: 0, hudMode: loadHudMode(), audioError: '', visualWarning: '', mode: null, scene: 'home', setup: initialSetup(), activeSeat: 0, active: false, paused: false, ended: false, walk: false, sound: loadEnabled('smash-sound', true), music: loadEnabled('smash-music', true), masterVolume: loadMasterVolume(), musicVolume: loadMusicVolume(), debug: false, debugCollision: false, touch: loadTouch(), roulette: loadToggle('smash-roulette'), rouletteSeconds: loadRouletteSeconds(), portraits: {}, itemPortraits: {}, stagePreviews: {}, presentation: loadPresentation(), graphics: loadGraphicsQuality(), graphicsMode: loadGraphicsMode(), effects: loadVisualEffectChoices(), textureUpscale: loadTextureUpscale(), looks: [], look: ORIGINAL_LOOK, activeLook: ORIGINAL_LOOK, cameraShake: loadCameraShakeLevel(), rumble: loadRumbleLevel(), background: null, showFps: loadToggle('smash-show-fps'), showPerf: loadToggle('smash-show-perf'), smoothMotion: loadSmoothMotion(), pauseFocus: null, padNote: 'By default the first human uses WASD / Space / J K L U I (T taunts) and the second uses arrows / Enter / N M comma Right Shift period (B taunts); both layouts can be changed in Options → Keyboard. Additional humans use assigned controllers. Menu / Options opens game options.' });
  readonly hud = new Store<HudView>({ frame: 0, clock: '3:00', status: 'LOADING', mode: 'SOLO / LOCAL', stage: 'battlefield', phase: 'ready', countdown: 0, winner: '', winnerSlot: null, banner: '', onettWarning: false, rouletteIn: null, fighters: [], shieldMax: 60, hill: null });
  readonly fallLog = new Store<FallLogView>({ entries: [] });
  /** Presentation taps for confirmed local match events (Rift Descent HUD popups).
   * Called after renderer/audio consume a stepped frame; never part of the sim. */
  readonly eventTaps = new Set<(events: readonly MatchEvent[], match: LocalMatch) => void>();
  content?: GameContent;
  source?: HsdAssetSession;
  renderer?: PlayRenderer;
  input?: PlayInput;
  /** Manual pause camera input (orbit/zoom/pan/focus); enabled only while paused. */
  pauseControls?: PauseCameraControls;
  match?: LocalMatch;
  menu?: MenuAudio;
  readonly audio = new PlayAudio();
  readonly rumblePad = (() => { const pad = new PlayRumble(); try { pad.setLevel(loadRumbleLevel()); } catch { /* session default */ } return pad; })();
  readonly abort = new AbortController();
  fingerprint = { game: `smash-web-battle-seats-v5:${new URL(import.meta.url).pathname.split('/').pop()}`, wasm: '', content: '', packs: CUSTOM_PACK_IDENTITIES };
  /** Phase 2.1: background roster queue (pending kinds in load order) and its
   * in-flight guard. ensureFighters reprioritizes the unprocessed tail. */
  private loadQueue: FighterKind[] = [];
  private loadQueueIndex = 0;
  /** The boot pass's share of the queue: how many fighters it asked for, and which of
   * them it still owes. The progress bar reports THAT pass only. Hover, selection and
   * retry loads reuse the same queue, so counting them reopened a finished bar (and
   * un-settled the roster grid) every time the pointer crossed a fighter card. */
  private bootQueueLength = 0;
  private readonly bootPending = new Set<FighterKind>();
  /** Assets load on demand and only a small warm set stays resident: the live match, the menu
   * draft and the most recently used fighters/stages. Boot used to prefetch the whole roster
   * and every stage and never released any of it (see docs/PERF_TELEMETRY.md). */
  private static readonly warmFighters = 6;
  private static readonly warmStages = 2;
  private readonly fighterUse = new Map<FighterKind, number>();
  private readonly stageUse = new Map<string, number>();
  /** Every seat's pick and the stage of the LAN room this client is in. A room is not a match
   * (`online` only covers the live simulation), so without this the menu-idle passes evict
   * exactly what the room is about to start with and the host's Start bounces everybody back
   * to character select. Pinned against eviction, and re-requested until resident. */
  private roomSelection: { picks: { fighter: FighterKind; costume: number }[]; stage: StageId } | null = null;
  private lastRoomPrepare = 0;
  private useClock = 0;
  private loadInFlight: Promise<void> | null = null;
  /** Thumbnail pass over the extra stages: in flight, and finished for this session.
   * The pass loads one stage at a time, so it stands down whenever it cannot capture
   * (a match, an online match) instead of pulling every stage into memory unseen. */
  private stagePreviewPass: Promise<void> | null = null;
  private stagePreviewsDone = false;
  /** Online transport only: whole files already asked to download ahead of the roster parse. */
  private prefetchAssets = false;
  private readonly prefetched = new Set<string>();
  /** Loaded alternate-costume models by `kind:index` (index 0 needs no fetch). */
  readonly costumeModels = new Map<string, HsdModel>();
  private costumeInFlight: Promise<void> | null = null;
  /** Skins asked for before their fighter was resident, retried once it loads. A LAN peer's
   * pick arrives long before the fighter it dresses, and a skin nobody is loading would hold
   * the match-start gate shut forever. */
  private readonly costumeWaitlist = new Map<string, { fighter: FighterKind; costume: number }>();
  /** Failed on-demand load attempts per fighter (see noteLoadFailure). */
  private readonly loadFailures = new Map<FighterKind, number>();
  private stageLoads = new Map<string, Promise<GameContent>>();
  /** Settled background units for the unified progress bar: stages that
   * failed prefetch (retried on demand) and the full voice-bank rebuild. */
  private stageFailed = new Set<string>();
  /** Stages whose thumbnail has been attempted (captured or not), so a stage that cannot be
   * thumbnailed neither stalls the progress bar nor retries on every idle window. */
  private stagePreviewsAttempted = new Set<string>();
  private soundSettled = false;
  /** Deferred menu-preview work (a load finished mid-match, when the shared
   * renderer belongs to the live fight). The tick drains it in small idle
   * chunks once the player is back in menus. */
  private previewsDirty = false;
  private lastPreviewChunk = 0;
  /** Consecutive menu-idle portrait capture failures per kind. At
   * PORTRAIT_MAX_ATTEMPTS the kind gets a letter-mark placeholder (empty
   * string) instead of retrying forever: playable and selectable. */
  private portraitFailures = new Map<FighterKind, number>();
  private stageContent = new Map<string, GameContent>();
  private frameRequest = 0;
  private last = 0;
  private accumulator = 0;
  private lastHud = 0;
  private lastRender = 0;
  /** Phase 1 telemetry: rolling frame-time window + hysteretic render-skip. */
  readonly frameMonitor = new FrameMonitor();
  /** In-match performance telemetry (uploads to /api/perf; `?perf=off|local|on`). */
  readonly perf = new PerfTelemetry();
  private readonly perfFrame: PerfFrame = { now: 0, delta: 0, work: 0, steps: 0, rendered: false, saturated: false, paused: false, skipLevel: 0 };
  private readonly perfScene: PerfScene = { calls: 0, triangles: 0, particles: 0, projectiles: 0, items: 0, alive: 0 };
  private readonly perfLive = { quality: '', pixelRatio: 1 };
  /** User's graphics mode: `auto` adapts within the session, an explicit
   * preset is pinned and the stepper never touches it. */
  private graphicsMode: GraphicsMode = loadGraphicsMode();
  /** Sustained-evidence windows for auto step-down (~5 s) and step-up (~10 s).
   * Both reset whenever the game leaves arena gameplay, so boot/menu hitch
   * frames can never poison the measurement. */
  private autoDownStart = 0;
  private autoUpStart = 0;
  /** Last applied auto preset, persisted separately from the manual key. */
  private bannerUntil = 0;
  private banner = '';
  private disposed = false;
  private booted = false;
  private humanDenseSlots: number[] = [0];
  private onlineStep?: (input: PlayerInput) => boolean;
  private onlineAbort?: () => void;
  private onlineLocalSlot = 0;
  /** An online match's world is the one on screen. It stays true after the match ends,
   * because the room keeps presenting it (paused) until something local replaces it. */
  private onlineMatchPresented = false;
  get online(): boolean { return !!this.onlineStep; }
  /** Watching an online match read-only (beginOnline with slot -1). */
  get spectating(): boolean { return !!this.onlineStep && this.onlineLocalSlot < 0; }
  get localHumans(): PlayerSeat[] { return activeSeats(this.ui.getSnapshot().setup.seats).filter(seat => seat.control === 'human'); }

  /** Look loaded by this session (null = the disc's own art). */
  private activeLook: string | null = null;
  /** Portraits are renders of the loaded models, so each look keeps its own cached set. */
  private previewKey(): string { return this.activeLook ? `${this.fingerprint.content}:look-${this.activeLook}` : this.fingerprint.content; }
  private contentFingerprint(manifest: SourceManifest): Promise<string> {
    return sha256Hex(new TextEncoder().encode(JSON.stringify({ game: manifest.gameId, revision: manifest.revision, exe: manifest.executableSha1, size: manifest.discSize, files: manifest.files.map((file) => [file.path, file.offset, file.size]), modded: manifest.modded ?? null, packs: CUSTOM_PACK_IDENTITIES })));
  }
  private discOffer: ((discs: { vanilla: File; ace: File | null }) => void) | null = null;
  /** The disc gate's answer: the original ISO and, where the policy allows it, the ACE 2.0 one. */
  provideDiscs(vanilla: File, ace: File | null): void { this.discOffer?.({ vanilla, ace }); }
  /** Holds boot until the player supplies discs that verify; a rejected disc re-opens the gate. */
  private localSource: LocalSource | null = null;
  /** After a boot from the player's own discs: keep the game files in this browser (behind the
   * menus, one file at a time) so later visits and reloads start without the disc screen. */
  private saveDiscsForNextVisit(): void {
    const source = this.localSource, store = cacheStorageStore();
    this.localSource = null;
    if (!source || this.disposed) return;
    if (!store) { this.ui.update({ discSave: 'failed' }); return; }
    this.ui.update({ discSave: 0 });
    void (async () => {
      try {
        // Best effort: ask the browser not to evict the copy under storage pressure.
        await globalThis.navigator?.storage?.persist?.().catch(() => false);
        let shown = 0;
        const saved = await saveLocalCopy(source, store, { signal: this.abort.signal, onProgress: (fraction) => { if (!this.disposed && fraction - shown >= 0.01) { shown = fraction; this.ui.update({ discSave: Math.min(0.99, fraction) }); } } });
        if (!this.disposed) this.ui.update({ discSave: saved ? 'saved' : null });
      } catch { if (!this.disposed) this.ui.update({ discSave: 'failed' }); }
    })();
  }
  private async awaitLocalDiscs(ace: ClientAcePolicy): Promise<Awaited<ReturnType<typeof openLocalSource>>> {
    let error = '';
    for (;;) {
      this.ui.update({ discGate: { ace, error, verifying: false } });
      const discs = await new Promise<{ vanilla: File; ace: File | null }>((resolve, reject) => {
        this.discOffer = resolve;
        this.abort.signal.addEventListener('abort', () => reject(this.abort.signal.reason), { once: true });
      });
      this.discOffer = null;
      this.ui.update({ discGate: { ace, error: '', verifying: true } });
      try {
        if (ace === 'required' && !discs.ace) throw new Error('This host requires the ACE 2.0 disc as well as the original one.');
        const source = await openLocalSource(localDiscReader(discs.vanilla, this.abort.signal), ace !== 'off' && discs.ace ? localDiscReader(discs.ace, this.abort.signal) : undefined);
        this.localSource = source;
        this.ui.update({ discGate: null, progress: `Reading your own disc (${source.manifest.title}${source.manifest.modded ? ' + ACE 2.0' : ''}). Nothing is uploaded.`, progressFraction: 0.02 });
        return source;
      } catch (failure) {
        if (this.abort.signal.aborted) throw failure;
        error = errorText(failure);
      }
    }
  }

  async boot(container: HTMLElement): Promise<void> {
    if (this.booted || this.disposed) return;
    this.booted = true;
    try {
      // The native Android shell serves this page from the hosted origin and
      // stamps the meta itself; its SmashPad bridge also authorizes server mode
      // so an unstamped packaged page can never lock the game out.
      if (document.querySelector('meta[name="smash-source"]')?.getAttribute('content') !== 'server' && !hasNativeBridge()) throw new Error('Play mode requires the server ISO source. Start npm run serve, then open the game URL.');
      // Play-mode transport: persistent per-disc cache below, whole-file coalescing above it,
      // and the content hashes taken from the per-range replies the reader sees (unchanged).
      // The bundled TV shell stamps <meta name="smash-offline"> and serves assets through
      // Android WebView interception, where nonzero-start 206 replies never survive;
      // whole-file downloads sliced locally produce byte-identical replies there.
      const baseFetch = (url: string, init?: RequestInit) => fetch(url, { ...init, signal: this.abort.signal });
      const offline = document.querySelector('meta[name="smash-offline"]') !== null;
      // The TV shell's whole-file transport keeps only a few files; warming ahead would evict them.
      this.prefetchAssets = !offline;
      const transport = offline
        ? cachingFetcher(offlineWholeFileFetcher(baseFetch, { retain: 8 }), cacheStorageStore())
        : coalescingFetcher(cachingFetcher(baseFetch, cacheStorageStore()));
      const fetcher = (url: string, init?: RequestInit) => transport(url, init);
      let onlineError: unknown = null;
      // Client-disc mode (SMASH_DISC_SOURCE=client): the host serves no game assets, so the
      // player's own verified ISO is the source and nothing is downloaded or cached.
      const clientAce = clientDiscPolicy();
      if (clientAce) this.prefetchAssets = false;
      // Players who downloaded the game data while this host still served it keep playing from
      // that data: the disc gate only opens when nothing usable is stored (or on ?disc, which
      // lets such a player switch to their own ISO for the fighters they never downloaded).
      const storedFirst = clientAce && !new URLSearchParams(location.search).has('disc') ? await connectCachedSource({ wholeFileLimit: Number.POSITIVE_INFINITY, missHint: 'This host does not stream game data: reload with your own disc to add it.' }).catch(() => null) : null;
      let fromStored = !!storedFirst;
      let connected: { session: HsdAssetSession; manifest: SourceManifest; look?: string | null } | null = storedFirst ?? (clientAce ? await this.awaitLocalDiscs(clientAce) : await connectServerSource(fetcher, this.abort.signal, { look: (manifest) => chooseLook(manifest) }).catch((error: unknown) => { onlineError = error; return null; }));
      if (fromStored) this.ui.update({ progress: `Playing from previously downloaded data (${connected!.manifest.title}).`, progressFraction: 0.02 });
      // Data downloaded while the host still streamed is partial and this host cannot complete it:
      // count the gaps behind the menus so the player is offered their own disc instead of bare misses.
      if (storedFirst) { const store = cacheStorageStore(); if (store) void storedCopyGaps(storedFirst.manifest, store).then((gaps) => { if (!this.disposed && fromStored && gaps.length) this.ui.update({ discGaps: gaps.length }); }, () => undefined); }
      if (!connected) {
        // Offline boot: reuse the persisted manifest + downloaded ranges from an
        // earlier online visit (same disc identity, same hashes). Nothing is
        // re-downloaded; a server update is picked up on the next online visit
        // because the fresh manifest identity retires the old caches.
        connected = await connectCachedSource({ look: (manifest) => chooseLook(manifest) }).catch(() => null);
        if (!connected) {
          // A specific server-side failure (bad manifest, HTTP error) is more
          // useful than the generic offline hint; network/timeout/null (static
          // build with no API) keeps the friendly message instead.
          if (onlineError instanceof Error && /^(The server (manifest|disc)|Unsupported|Invalid|Missing)/.test(onlineError.message)) throw onlineError;
          // Always name the underlying cause: a bare "unreachable" hid every
          // real failure (blocked fetch, DNS, timeout) behind the same text.
          const cause = globalThis.navigator?.onLine === false ? 'no internet connection' : onlineError instanceof Error ? onlineError.message : onlineError ? String(onlineError) : 'no game data API at this address';
          throw new Error(`Game data is unreachable (${cause}). Connect once to download it, then play offline.`);
        }
        this.ui.update({ progress: `Playing offline from downloaded data (${connected.manifest.title}).`, progressFraction: 0.02 });
      }
      this.source = connected.session;
      // Looks are cosmetic: the fingerprint below stays the original disc's, so rooms mix looks freely.
      this.activeLook = connected.look ?? null;
      const lookChoice = loadLookPreference();
      this.ui.update({ looks: connected.manifest.looks?.map(({ id, name }) => ({ id, name })) ?? [], activeLook: this.activeLook ?? ORIGINAL_LOOK,
        look: lookChoice === ORIGINAL_LOOK || connected.manifest.looks?.some((look) => look.id === lookChoice) ? lookChoice! : this.activeLook ?? ORIGINAL_LOOK });
      this.ui.update({ progress: 'Fetching the gameplay engine…', progressFraction: 0.02 });
      const response = await fetch('/wasm/melee-gameplay.wasm', { signal: this.abort.signal });
      if (!response.ok) throw new Error('The gameplay WASM build is unavailable. Run npm run build.');
      const bytes = await response.arrayBuffer(); this.fingerprint.wasm = await sha256Hex(new Uint8Array(bytes));
      // Phase 2.3: the disc fingerprint comes from the small server manifest
      // (native SubtleCrypto when available, noble fallback for plain-LAN
      // http origins without Web Crypto) — never by re-hashing every
      // downloaded asset byte on the main thread.
      this.fingerprint.content = await this.contentFingerprint(connected.manifest);
      // Phase 2.1: blocking boot is the core only (common banks + default
      // stage + default pair). Boot weights: core 3-38%, menu/audio to 45%.
      const coreProgress = (progress: string, fraction = 0) => { if (!this.disposed) this.ui.update({ progress, progressFraction: 0.03 + fraction * 0.35 }); };
      try { this.content = await loadGameCore(this.source, bytes, coreProgress); }
      catch (error) {
        // Stored data too incomplete to boot (the core was never fully downloaded): ask for the disc after all.
        if (!fromStored || !clientAce || this.disposed) throw error;
        fromStored = false; this.ui.update({ discGaps: 0 });
        connected = await this.awaitLocalDiscs(clientAce);
        this.source = connected.session;
        this.fingerprint.content = await this.contentFingerprint(connected.manifest);
        this.content = await loadGameCore(this.source, bytes, coreProgress);
      }
      if (this.disposed) return;
      this.stageContent.set('battlefield', this.content);
      this.audio.configure(this.content.sound);
      this.menu = new MenuAudio(this.source, (error: unknown) => { if (!this.disposed) this.ui.update({ audioError: errorText(error) }); });
      this.ui.update({ progress: 'Preparing menu audio and portraits…', progressFraction: 0.4 });
      // Menu SFX + menu track load in the background: audio never holds the loading
      // screen (a slow or stalled audio download used to freeze boot at 40%), and
      // stage tracks decode on demand when a stage is picked (see MenuAudio.warm).
      void this.menu.prepare(['menu']).catch((error: unknown) => { if (!this.disposed) this.ui.update({ audioError: errorText(error) }); });
      if (this.disposed) return;
      const booted = this.ui.getSnapshot();
      this.menu.masterVolume = booted.masterVolume;
      this.menu.musicVolume = booted.musicVolume;
      this.audio.masterVolume = booted.masterVolume;
      this.menu.sfxMuted = !booted.sound;
      this.menu.musicMuted = !booted.music;
      this.audio.enabled = booted.sound;
      const art = await prepareCustomVisuals();
      if (this.disposed) { disposeCustomVisuals(art); return; }
      this.ui.update({ progress: 'Rendering fighter portraits and stage previews…', progressFraction: 0.44 });
      // Boot preset: pinned modes start exactly there (never touched again
      // unless the user picks otherwise); `auto` starts at the first-launch
      // heuristic and adapts freely within the session.
      const bootMode = loadGraphicsMode();
      const bootEffective = bootMode === 'auto' ? chooseInitialQuality() : bootMode;
      this.graphicsMode = bootMode;
      this.renderer = new PlayRenderer(container, this.content, art, bootEffective, this.ui.getSnapshot().cameraShake);
      this.renderer.customPresentation = this.ui.getSnapshot().presentation;
      this.renderer.smoothMotion = this.ui.getSnapshot().smoothMotion;
      this.renderer.setVisualEffects(this.ui.getSnapshot().effects);
      this.perf.attachRenderer(this.renderer.renderer.getContext());
      if (this.perf.gpu?.supported) this.renderer.gpuTimer = this.perf.gpu;
      this.perf.drawProbe = () => this.renderer?.drawBreakdown() ?? {};
      window.smashPerf = { snapshot: () => this.perf.snapshot(), cut: () => this.perf.cut(), end: (reason = 'manual') => this.perf.endMatch(reason), mode: this.perf.mode };
      this.ui.update({ graphicsMode: bootMode, graphics: bootEffective });
      this.autoDownStart = performance.now(); this.autoUpStart = performance.now();
      // TV-class panels cap the drawing buffer at 1080p regardless of dpr.
      try {
        if (isTvClassDevice()) {
          const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
          const capped = capPixelRatioFor1080(w, h, this.renderer.renderer.getPixelRatio());
          if (capped < this.renderer.renderer.getPixelRatio()) this.renderer.renderer.setPixelRatio(capped);
        }
      } catch { /* layout-only */ }
      // Phase 2.2: warm boot reuses cached portraits and skips the capture
      // block entirely; cold boot captures the core roster only, then fills
      // the rest in idle chunks (never one synchronous block of 33).
      const cached = await readPreviewCache(this.previewKey());
      if (cached && !this.disposed) {
        this.ui.update({ portraits: cached.portraits, itemPortraits: cached.itemPortraits, stagePreviews: cached.stagePreviews });
      } else if (!this.disposed && this.content) {
        const { Scene } = await import('three');
        const scene = new Scene();
        const coreKinds = [...this.content.roster.keys()];
        // Thumbnails must never fail boot: capture errors fall through to
        // empty maps and the idle chunker heals them once content is ready.
        let portraits: Record<string, string> = {};
        let itemPortraits: Record<string, string> = {};
        let stagePreviews: Record<string, string> = {};
        try {
          portraits = captureFighterPortraits(this.renderer, scene, this.content, coreKinds);
          itemPortraits = captureItemPortraits(this.renderer, scene, this.content);
          stagePreviews = captureStagePreview(this.renderer, scene, 'battlefield', this.content);
        } catch { /* healed below by the preview chunker */ }
        this.ui.update({ portraits, itemPortraits, stagePreviews });
        if (!Object.keys(portraits).length) this.previewsDirty = true;
      }
      if (this.disposed) return;
      this.input = new PlayInput(this.renderer.renderer.domElement);
      this.input.onGamepadUnavailable = () => this.ui.update({ padNote: 'Gamepads are unavailable on this origin. Keyboard and touch remain available; open Controllers for help.' });
      // Melee-style manual pause camera: mouse + keyboard drive the renderer's
      // orbit while frozen, standing down whenever the options dialog is open.
      this.pauseControls = new PauseCameraControls(this.renderer.renderer.domElement, this.renderer, {
        onFocusChange: (pauseFocus) => this.ui.update({ pauseFocus }),
        blocked: () => this.disposed || !!document.querySelector('dialog[open]'),
      });
      (window as Window & { smashMenuNavState?: () => unknown }).smashMenuNavState = () => this.input?.controllers.menuState() ?? null;
      this.reset(); this.renderer.prepare();
      this.ui.update({ ready: true, loading: false, progress: 'Original assets ready. Choose Solo / Local or LAN.', progressFraction: 1 });
      document.body.dataset.gameReady = 'true';
      this.saveDiscsForNextVisit();
      window.smashMatchSnapshot = () => this.match ? { ...this.match.snapshot(), paused: this.ui.getSnapshot().paused, stage: this.match.content.stageId, stageFloors: this.match.content.stage.floors.length } : null;
      // ?itemDebug: summon a Poké Ball Pokémon by It_PKind slot into the running local match.
      if (new URLSearchParams(location.search).has('itemDebug')) window.smashSummonPokemon = (slot, x = 0, owner = this.match?.options.player ?? 0) => {
        const world = this.match?.itemWorld;
        if (!world) return null;
        world.items.splice(0);
        return world.summonPokemon(slot, x, 0, owner)?.id ?? null;
      };
      window.smashFallLog = () => this.match ? this.match.groundLossLog.map((entry) => ({ ...entry, text: `${entry.stage} f${entry.frame} P${entry.player + 1} ${entry.name} (${entry.x.toFixed(1)},${entry.y.toFixed(1)}) floor ${entry.floor ?? 'none'} -> air [${entry.reason}]` })) : null;
      window.smashSetupSnapshot = () => { const view = this.ui.getSnapshot(); return { mode: view.mode, scene: view.scene, activeSeat: view.activeSeat, setup: structuredClone(view.setup) }; };
      window.smashEffectsSnapshot = () => this.renderer ? {...this.renderer.effects.common.stats,...this.renderer.presentationSnapshot(),graphics:this.renderer.quality,pixelRatio:this.renderer.renderer.getPixelRatio(),particleLimit:this.renderer.effects.common.particleLimit,warnings:[...this.renderer.effects.common.warnings],frame:{...this.frameMonitor.stats(),fps:this.frameMonitor.stats().frames ? Math.min(120, Math.round(1000 / Math.max(1, this.frameMonitor.stats().p50))) : 0}} : null;
      window.smashAudioSnapshot = () => ({ ...this.audio.stats, recentIds: [...this.audio.stats.recentIds] });
      // Memory census of loaded assets (used vs pinned bytes per category); diagnostics only.
      window.smashMemorySnapshot = () => contentByteCensus(this.content, this.stageContent.values());
      // On-demand loading is invisible from the outside: this reports exactly what is
      // resident, what is queued and what a pending start is still waiting for.
      window.smashAssetSnapshot = () => ({
        roster: [...(this.content?.roster.keys() ?? [])].sort(), stages: [...this.stageContent.keys()].sort(),
        costumes: [...this.costumeModels.keys()].sort(), queued: this.loadQueue.slice(this.loadQueueIndex),
        loadingStages: [...this.stageLoads.keys()], failedStages: [...this.stageFailed], pendingStart: this.pendingStart,
      });
      window.smashMenuSnapshot = () => this.menu ? { ...this.menu.stats, prepared: [...this.menu.stats.prepared], musicMuted: this.menu.musicMuted, sfxMuted: this.menu.sfxMuted, musicVolume: this.menu.musicVolume, masterVolume: this.menu.masterVolume } : null;
      window.addEventListener('keydown', this.keydown, { signal: this.abort.signal });
      window.addEventListener('blur', this.blur, { signal: this.abort.signal });
      document.addEventListener('visibilitychange', this.visibility, { signal: this.abort.signal });
      // Phase 2.1: the menu is interactive on the core set; the rest of the
      // roster and the extra stages prefetch behind idle callbacks.
      void this.persistPreviews();
      this.kickBackgroundLoad();
      this.frameRequest = requestAnimationFrame(this.tick);
    } catch (error) { if (!this.disposed) this.fail(error); }
  }
  /** Extra stages beyond the boot default, prefetched in parallel after the
   * menu is interactive and on demand when picked. */
  private static readonly extraStages = [['final', 'Final Destination'], ['corneria', 'Corneria'], ['temple', 'Hyrule Temple'], ['stadium', 'Pokémon Stadium'], ['yoshi-story', "Yoshi's Story"], ['dream-land', 'Dream Land N64'], ['peach-castle', "Peach's Castle"], ['onett', 'Onett'], ['mute-city', 'Mute City'], ['yoshi-island', "Yoshi's Island"], ['green-greens', 'Green Greens'], ['venom', 'Venom'], ['jungle-japes', 'Jungle Japes'], ['fourside', 'Fourside'], ['brinstar', 'Brinstar'], ['kongo-jungle', 'Kongo Jungle'], ['fountain-of-dreams', 'Fountain of Dreams'], ['mushroom-kingdom', 'Mushroom Kingdom']] as const;
  private kickBackgroundLoad(): void {
    if (!this.content || !this.source || this.disposed) return;
    // Cold visits still need one render per fighter to capture its character-select thumbnail
    // (previews are never published assets), so queue exactly those and let the pass release
    // each fighter afterwards. A warm visit reuses the cached previews and loads nothing until
    // a match asks for it.
    const portraits = this.ui.getSnapshot().portraits;
    this.loadQueue = pendingRosterKinds(this.source, this.content).filter((kind) => !(kind in portraits));
    this.loadQueueIndex = 0;
    this.bootQueueLength = this.loadQueue.length;
    this.bootPending.clear();
    for (const kind of this.loadQueue) this.bootPending.add(kind);
    const idle = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    // Roster sequentially behind idle (menu stays responsive). The bulk stage prefetch waits
    // for the roster so fighters get the bandwidth first; a picked stage still loads on demand.
    this.stagePreviewsDone = false;
    if (idle) idle(() => void this.drainLoadQueue());
    else setTimeout(() => void this.drainLoadQueue(), 50);
    this.publishBackground();
  }
  /** One progress bar over every deferred asset set (fighters + stages +
   * full voice banks). Null once everything settled. */
  private publishBackground(): void {
    if (this.disposed || !this.content) return;
    const summary = summarizeBackgroundLoad({
      fightersDone: this.bootQueueLength - this.bootPending.size,
      fightersTotal: this.bootQueueLength,
      // Attempted stages, not resident ones: stages are released right after their capture.
      stagesDone: new Set([...Object.keys(this.ui.getSnapshot().stagePreviews), ...this.stageFailed, ...this.stagePreviewsAttempted]).size,
      stagesTotal: 1 + GameSession.extraStages.length,
      soundDone: this.soundSettled,
    });
    this.ui.update({ background: summary.loaded < summary.total ? summary : null });
  }
  /** Thumbnail captures borrow the live renderer (they rebuild its stage and rigs), so they
   * may only run while the menus own it: never during a match, never during an online match,
   * and not while a finished online match is still presented — a room back in its lobby keeps
   * showing it, and a capture would dispose the rigs it renders with. Blocked work sets
   * previewsDirty and the menu-idle chunker picks it up later. */
  private get captureBlocked(): boolean {
    return !this.renderer || this.ui.getSnapshot().active || this.online || this.onlineMatchPresented;
  }
  /** Marks assets as used so the warm set keeps them over older ones. */
  private touchFighters(kinds: Iterable<FighterKind>): void { for (const kind of kinds) this.fighterUse.set(kind, ++this.useClock); }
  private touchStage(stage: string): void { this.stageUse.set(stage, ++this.useClock); }
  /** LAN room membership: its picks stay resident until the room is left (see roomSelection). */
  setRoomSelection(selection: { picks: readonly { fighter: FighterKind; costume: number }[]; stage: StageId } | null): void {
    this.roomSelection = selection ? { picks: selection.picks.map((pick) => ({ ...pick })), stage: selection.stage } : null;
    if (!this.roomSelection) return;
    this.touchFighters(this.roomSelection.picks.map((pick) => pick.fighter));
    this.touchStage(this.roomSelection.stage);
    this.prepareRoomSelection();
  }
  /** Asks for whatever the room still misses. Driven by every content change and, at most once
   * a second, by the frame loop: a background eviction or a load that failed must not leave the
   * room waiting forever on something nothing is loading. */
  private prepareRoomSelection(): void {
    const room = this.roomSelection;
    if (!room || !this.content || !this.source || this.disposed) return;
    const status = this.selectionStatus(room.picks, room.stage);
    if (status.missingFighters.length) this.ensureFighters(status.missingFighters);
    // Skins wait for the in-flight batch instead of stacking one retry per second.
    if (status.missingCostumes.length && !this.costumeInFlight) this.ensureCostumes(room.picks);
    if (status.missingStage) this.ensureStage(room.stage);
  }
  /** Releases everything outside the warm set: the live match, every drafted seat and the
   * menu backdrop fallback always stay. Dropped assets reload on demand through the same
   * ensureFighters/selectionStatus path that gates match start. */
  private trimAssets(): void {
    if (!this.content || this.disposed) return;
    const view = this.ui.getSnapshot();
    const keepFighters = new Set<FighterKind>(['Fx']);
    for (const seat of view.setup.seats) keepFighters.add(seat.fighter);
    for (const pick of this.roomSelection?.picks ?? []) keepFighters.add(pick.fighter);
    for (const fighter of this.match?.content.fighters ?? []) keepFighters.add(fighter.profile.kind);
    // A queued fighter parses its copy abilities from these, so they stay until it is loaded.
    for (const source of copySourceKinds(this.loadQueue.slice(this.loadQueueIndex))) keepFighters.add(source);
    const evictable = [...this.content.roster.keys()].filter((kind) => !keepFighters.has(kind))
      .sort((a, b) => (this.fighterUse.get(a) ?? 0) - (this.fighterUse.get(b) ?? 0));
    const dropped = unloadFighters(this.content, evictable.slice(0, Math.max(0, evictable.length - GameSession.warmFighters)));
    for (const kind of dropped) {
      this.fighterUse.delete(kind);
      for (const key of [...this.costumeModels.keys()]) if (key.startsWith(`${kind}:`)) this.costumeModels.delete(key);
    }
    const keepStages = new Set<string>([view.setup.stage]);
    if (this.roomSelection) keepStages.add(this.roomSelection.stage);
    if (this.match) keepStages.add(this.match.content.stageId);
    const stages = [...this.stageContent.keys()].filter((id) => !keepStages.has(id))
      .sort((a, b) => (this.stageUse.get(a) ?? 0) - (this.stageUse.get(b) ?? 0));
    for (const id of stages.slice(0, Math.max(0, stages.length - GameSession.warmStages))) { this.stageContent.delete(id); this.stageUse.delete(id); }
    if (dropped.length || stages.length) this.publishBackground();
  }
  /** Character-select hover/focus: pull these kinds to the front of the
   * background queue and wake the loader. Fire-and-forget from UI events. */
  ensureFighters(kinds: readonly FighterKind[]): void {
    if (!this.content || !this.source || this.disposed || !kinds.length) return;
    this.touchFighters(kinds);
    const pending = [...this.loadQueue.slice(this.loadQueueIndex)];
    const missing = kinds.filter((kind) => !this.content!.roster.has(kind) && !pending.includes(kind));
    const reordered = prioritizeKinds([...pending, ...missing], kinds);
    this.loadQueue = [...this.loadQueue.slice(0, this.loadQueueIndex), ...reordered];
    this.publishBackground();
    void this.drainLoadQueue();
  }
  /** Skin picks: load missing costume models (plus the Zelda/Sheik counterpart
   * so a Transform keeps the skin), capture the new portrait, then resume the
   * menu flow. Fire-and-forget from UI events; match start waits via the
   * costume-aware asset guard. */
  ensureCostumes(picks: readonly { fighter: FighterKind; costume: number }[]): void {
    if (!this.content || !this.source || this.disposed) return;
    const wanted = new Map<string, { kind: FighterKind; index: number; partner?: boolean }>();
    for (const { fighter, costume } of picks) {
      const index = clampCostumeIndex(fighter, costume);
      if (index === 0) continue;
      if (!this.content.roster.has(fighter)) { this.costumeWaitlist.set(`${fighter}:${index}`, { fighter, costume: index }); this.ensureFighters([fighter]); continue; }
      wanted.set(`${fighter}:${index}`, { kind: fighter, index });
      // A Transform swaps to the paired same-index model mid-match; it must
      // be loaded before the match starts, never mid-simulation.
      if (fighter === 'Zd' || fighter === 'Sk') {
        const counterpart = fighter === 'Zd' ? 'Sk' : 'Zd';
        if (this.content.roster.has(counterpart)) wanted.set(`${counterpart}:${index}`, { kind: counterpart, index });
      }
      // Nana dresses in her own same-index skin; sources without her files
      // keep the duo on her default instead of blocking match start.
      if (fighter === 'Pp' && this.source.info.files.some((file) => file.path === nanaCostumeFile(index))) {
        wanted.set(nanaCostumeKey(index), { kind: fighter, index, partner: true });
      }
    }
    for (const key of [...wanted.keys()]) if (this.costumeModels.has(key)) wanted.delete(key);
    if (!wanted.size) return;
    void (async () => {
      if (this.costumeInFlight) { await this.costumeInFlight.catch(() => {}); }
      const run = (async () => {
        if (!this.content || !this.source || this.disposed) return;
        const { Scene } = await import('three');
        const scene = new Scene();
        let captured = false;
        for (const [key, { kind, index, partner }] of wanted) {
          if (this.disposed || !this.content || !this.source) return;
          if (this.costumeModels.has(key)) continue;
          const base = this.content.roster.get(kind);
          if (!base) { this.costumeWaitlist.set(`${kind}:${index}`, { fighter: kind, costume: index }); this.ensureFighters([kind]); continue; }
          try {
            const model = partner ? await loadNanaCostumeModel(this.source, base, index) : await loadCostumeModel(this.source, base, index);
            if (this.disposed) return;
            this.costumeModels.set(key, model);
            // Draft editing is menu-only: capture the skin portrait now so the
            // seat panel updates, then restore the menu backdrop afterwards.
            // Nana skins capture no portrait (she shares Popo's seat panel).
            if (!partner && this.renderer && !this.captureBlocked) {
              const selected = selectLineup(this.content, [{ fighter: kind, costume: index }, { fighter: 'Fx', costume: 0 }], this.costumeModels);
              const dataUrl = captureCostumePortrait(this.renderer, scene, selected, kind);
              if (dataUrl && !this.disposed) {
                this.ui.update({ portraits: { ...this.ui.getSnapshot().portraits, [portraitKey(kind, index)]: dataUrl } });
                void this.persistPreviews();
                captured = true;
              }
            }
          } catch { /* A skin that fails stays on its default; match start retries. */ }
        }
        if (!this.disposed && captured && !this.captureBlocked) this.reset();
        this.assetsSettled();
      })();
      this.costumeInFlight = run;
      try { await run; } finally { if (this.costumeInFlight === run) this.costumeInFlight = null; }
    })();
  }
  /** A fighter whose on-demand load failed goes back on the queue a couple of times: the
   * failure may be a transient read, and the selection gate is waiting for it. Exhausted
   * kinds stay absent (the roster grid shows them as unavailable). */
  private static readonly maxLoadAttempts = 3;
  private noteLoadFailure(kind: FighterKind): void {
    const attempts = (this.loadFailures.get(kind) ?? 0) + 1;
    this.loadFailures.set(kind, attempts);
    if (attempts < GameSession.maxLoadAttempts) this.loadQueue = [...this.loadQueue, kind];
  }
  /** Fighters whose on-demand load failed too many times. The selection gate will never open
   * for them, so a room says so instead of showing an endless "loading". */
  unloadableKinds(kinds: Iterable<FighterKind>): FighterKind[] {
    return [...new Set(kinds)].filter((kind) => (this.loadFailures.get(kind) ?? 0) >= GameSession.maxLoadAttempts);
  }
  /** Re-asks for waitlisted skins whose fighter has since loaded. */
  private flushCostumeWaitlist(): void {
    if (!this.costumeWaitlist.size || !this.content) return;
    const ready = [...this.costumeWaitlist].filter(([, pick]) => this.content!.roster.has(pick.fighter));
    if (!ready.length) return;
    for (const [key] of ready) this.costumeWaitlist.delete(key);
    this.ensureCostumes(ready.map(([, pick]) => pick));
  }
  /** Stage pick: load in the background (or await via ensureStageLoaded). */
  ensureStage(stage: StageId): void {
    this.touchStage(stage);
    if (!this.content || !this.source || this.disposed || this.stageContent.has(stage) || this.stageLoads.has(stage)) return;
    const content = this.content, source = this.source;
    this.stageLoads.set(stage, selectGameStage(content, source, stage).then((loaded) => {
      this.stageContent.set(stage, loaded);
      this.stageFailed.delete(stage);
      this.stageLoads.delete(stage);
      this.assetsSettled();
      this.publishBackground();
      // A preview restored from the cache (warm visits) is never rendered again.
      if (stage in this.ui.getSnapshot().stagePreviews) { /* cached */ }
      else if (!this.disposed && !this.captureBlocked) {
        void (async () => {
          const { Scene } = await import('three');
          if (this.disposed || !this.renderer || this.captureBlocked) return;
          // Some stages cannot be thumbnailed at all (their material animations carry an
          // out-of-range texture palette). That must stay a missing thumbnail, not an
          // unhandled rejection, and must not be retried on every idle window.
          this.stagePreviewsAttempted.add(stage);
          try {
            const preview = captureStagePreview(this.renderer, new Scene(), stage, loaded);
            if (this.disposed) return;
            this.ui.update({ stagePreviews: { ...this.ui.getSnapshot().stagePreviews, ...preview } });
            void this.persistPreviews();
          } catch { /* Keeps the stage's own art instead of a thumbnail. */ }
        })();
      } else this.previewsDirty = true;
      return loaded;
    }));
  }
  /** Stage-select thumbnails: load, capture and release one stage at a time. Previews persist
   * in the preview cache, so a warm visit skips this and no stage but the picked one loads. */
  private kickStagePreviews(): void {
    if (this.stagePreviewPass || this.stagePreviewsDone || this.disposed || !this.content) return;
    const pass = this.captureStagePreviews().finally(() => { if (this.stagePreviewPass === pass) this.stagePreviewPass = null; });
    this.stagePreviewPass = pass;
  }
  private async captureStagePreviews(): Promise<void> {
    if (!this.content || !this.source) return;
    const { Scene } = await import('three');
    const scene = new Scene();
    for (const [stage] of GameSession.extraStages as readonly (readonly [string, string])[]) {
      const id = stage as StageId;
      if (this.disposed) return;
      if (id in this.ui.getSnapshot().stagePreviews || this.stagePreviewsAttempted.has(id)) continue;
      // Capture borrows the live surface, so never during a match or an online match. Loading
      // the stage anyway would pull the whole stage set into memory behind the fight, so the
      // pass stops here; the menu-idle chunker restarts it (see maybeCapturePreviewChunk).
      if (this.captureBlocked) { this.previewsDirty = true; return; }
      this.ensureStage(id);
      try { await this.stageLoads.get(id); }
      catch { if (!this.disposed) { this.stageFailed.add(id); this.publishBackground(); } continue; }
      const content = this.stageContent.get(id);
      if (this.disposed || !content) continue;
      if (!this.renderer || this.captureBlocked) { this.previewsDirty = true; return; }
      this.stagePreviewsAttempted.add(id);
      try {
        const preview = captureStagePreview(this.renderer, scene, id, content);
        if (this.disposed) return;
        this.ui.update({ stagePreviews: { ...this.ui.getSnapshot().stagePreviews, ...preview } });
        void this.persistPreviews();
      } catch { /* A stage that fails to thumbnail keeps its stage art instead. */ }
      this.publishBackground();
      this.trimAssets();
    }
    if (this.disposed) return;
    this.stagePreviewsDone = true;
    if (!this.captureBlocked) this.reset();
  }
  /** Fighters parsed per background portrait batch, and fighters whose files download ahead. */
  private static readonly portraitBatch = 3;
  private static readonly prefetchAhead = 3;
  /** The network runs ahead of the one-at-a-time roster parse: the current and next queued
   * fighters' whole files start downloading in parallel, so each parse finds its bytes ready. */
  private prefetchRosterAhead(): void {
    if (!this.prefetchAssets || !this.source || !this.content) return;
    const names = this.loadQueue.slice(this.loadQueueIndex, this.loadQueueIndex + 1 + GameSession.prefetchAhead)
      .filter((kind) => !this.content!.roster.has(kind))
      .flatMap((kind) => fighterAssetNames(kind))
      .filter((name) => !this.prefetched.has(name));
    for (const name of names) this.prefetched.add(name);
    if (names.length) this.source.prefetch(names, WHOLE_FILE_LIMIT);
  }
  private async drainLoadQueue(): Promise<void> {
    if (this.loadInFlight || !this.content || !this.source || this.disposed) return;
    this.loadInFlight = (async () => {
      const { Scene } = await import('three');
      const scene = new Scene();
      // Portraits render in small batches (one borrow of the live surface each) and a kind with a
      // cached portrait (warm visits) is never rendered again.
      let portraitBatch: FighterKind[] = [];
      const flushPortraits = () => {
        const batch = portraitBatch.filter((loaded) => !(loaded in this.ui.getSnapshot().portraits));
        portraitBatch = [];
        if (!batch.length || this.disposed || !this.content) return;
        if (!this.renderer || this.captureBlocked) { this.previewsDirty = true; return; }
        let portraits: Record<string, string> = {};
        try {
          portraits = captureFighterPortraits(this.renderer, scene, this.content, batch);
        } catch { /* Catastrophic capture failure: the idle chunker retries below. */ }
        if (this.disposed) return;
        this.ui.update({ portraits: { ...this.ui.getSnapshot().portraits, ...portraits } });
        void this.persistPreviews();
        // Loaded but unthumbnailed kinds must not fall through the cracks.
        if (batch.some((loaded) => !(loaded in this.ui.getSnapshot().portraits))) this.previewsDirty = true;
        // Streaming capture: the thumbnail is all this pass needed from these fighters.
        this.trimAssets();
      };
      while (this.loadQueueIndex < this.loadQueue.length && !this.disposed && this.content && this.source) {
        const kind = this.loadQueue[this.loadQueueIndex]!;
        // Resident, loaded or failed, this iteration settles what the boot pass owed for it.
        this.bootPending.delete(kind);
        if (this.content.roster.has(kind)) { this.loadQueueIndex++; if (!this.disposed) this.publishBackground(); continue; }
        this.prefetchRosterAhead();
        try {
          const { kinds } = await loadRosterQueue(this.source, this.content, [kind]);
          for (const loaded of kinds) this.loadFailures.delete(loaded);
          portraitBatch.push(...kinds);
        } catch { this.noteLoadFailure(kind); }
        this.loadQueueIndex++;
        if (portraitBatch.length >= GameSession.portraitBatch || this.loadQueueIndex >= this.loadQueue.length) flushPortraits();
        if (!this.disposed) this.publishBackground();
        this.assetsSettled();
      }
      flushPortraits();
      this.kickStagePreviews();
      if (!this.disposed && this.content) {
        // Full voice banks once the whole roster is in.
        try {
          const { sound } = await loadRosterQueue(this.source!, this.content, [], undefined, true);
          if (!this.disposed && sound) this.audio.configure(sound);
        } catch { /* Partial banks keep playing. */ }
        if (!this.disposed) {
          this.soundSettled = true;
          this.publishBackground();
          // Restore the menu backdrop after portrait/stage captures borrowed it.
          if (!this.captureBlocked) this.reset();
          this.assetsSettled();
        }
      }
    })();
    try { await this.loadInFlight; } finally { this.loadInFlight = null; }
    // A kind queued while the pass was past its loop (e.g. during the voice-bank
    // step) returned early above; drain it now or a pending start waits forever.
    if (!this.disposed && this.loadQueueIndex < this.loadQueue.length) void this.drainLoadQueue();
  }
  /** Notified whenever loaded content settles (a fighter, skin or stage arrived), so a LAN
   * room can publish its readiness only once this client could actually start the match. */
  onAssetsSettled?: () => void;
  /** One choke point for "content changed": retry a pending local start, retry skins whose
   * fighter just arrived, then let the room re-check its readiness. */
  private assetsSettled(): void {
    this.flushCostumeWaitlist();
    this.prepareRoomSelection();
    this.maybeRetryPendingStart();
    this.tryPendingSwap();
    this.onAssetsSettled?.();
  }
  /** If the user pressed Start while assets were still loading, begin the
   * match as soon as the draft resolves. */
  private maybeRetryPendingStart(): void {
    if (!this.pendingStart || this.disposed || !this.content || this.online) return;
    const setup = this.ui.getSnapshot().setup;
    const seats = activeSeats(setup.seats);
    if (!this.matchAssetsReady(seats.map(seat => ({ fighter: seat.fighter, costume: seat.costume ?? 0 })), setup.stage)) return;
    this.pendingStart = false;
    this.reset(true);
  }
  /** Phase 2.2: drain deferred preview captures in small menu-idle chunks
   * (≤4 portraits + 1 stage per ~1.5 s), never mid-match and never one
   * synchronous block. Failures just retry on a later chunk. */
  private maybeCapturePreviewChunk(now: number): void {
    if (!this.previewsDirty || this.disposed || !this.renderer || !this.content) return;
    if (this.captureBlocked || now - this.lastPreviewChunk < 1500) return;
    this.lastPreviewChunk = now;
    void (async () => {
      try {
        if (this.disposed || !this.renderer || !this.content) return;
        if (this.captureBlocked) return;
        const { Scene } = await import('three');
        if (this.disposed || !this.renderer || !this.content) return;
        const stillIdle = this.ui.getSnapshot();
        if (this.captureBlocked) return;
        const scene = new Scene();
        let captured = false;
        // One by one: a poison model fails alone instead of dropping its
        // chunk-mates, and repeated failures earn a letter-mark placeholder
        // (empty string) instead of an endless retry loop.
        const missingFighters = [...this.content.roster.keys()]
          .filter((kind) => !(kind in stillIdle.portraits) && (this.portraitFailures.get(kind) ?? 0) < PORTRAIT_MAX_ATTEMPTS)
          .slice(0, 4);
        for (const kind of missingFighters) {
          if (this.disposed || this.captureBlocked) return;
          try {
            const one = captureFighterPortraits(this.renderer, scene, this.content, [kind]);
            if (this.disposed) return;
            if (one[kind]) {
              this.ui.update({ portraits: { ...this.ui.getSnapshot().portraits, ...one } });
              this.portraitFailures.delete(kind);
              captured = true;
            } else this.notePortraitFailure(kind);
          } catch {
            if (!this.disposed) this.notePortraitFailure(kind);
          }
        }
        if (!this.disposed && this.content) {
          const stillMissing = [...this.content.roster.keys()].filter((kind) => !(kind in this.ui.getSnapshot().portraits));
          const exhausted = portraitPlaceholderKeys(stillMissing, this.portraitFailures);
          if (exhausted.length) {
            this.ui.update({ portraits: { ...this.ui.getSnapshot().portraits, ...Object.fromEntries(exhausted.map((kind) => [kind, ''])) } });
            captured = true;
          }
        }
        const missingStage = [...this.stageContent.keys()].find((id) => !(id in this.ui.getSnapshot().stagePreviews) && !this.stagePreviewsAttempted.has(id));
        if (missingStage) {
          this.stagePreviewsAttempted.add(missingStage);
          try {
            const preview = captureStagePreview(this.renderer, scene, missingStage, this.stageContent.get(missingStage)!);
            if (!this.disposed) { this.ui.update({ stagePreviews: { ...this.ui.getSnapshot().stagePreviews, ...preview } }); captured = true; }
          } catch { /* A stage that cannot be thumbnailed keeps its own art. */ }
        }
        if (!this.disposed) {
          const done = this.content && [...this.content.roster.keys()].every((kind) => kind in this.ui.getSnapshot().portraits)
            && [...this.stageContent.keys()].every((id) => id in this.ui.getSnapshot().stagePreviews || this.stagePreviewsAttempted.has(id));
          if (done) this.previewsDirty = false;
          if (captured) { void this.persistPreviews(); this.trimAssets(); }
          // A stage pass that stood down for a match resumes now that the menu owns the surface.
          this.kickStagePreviews();
        }
      } catch { /* A failed chunk retries on the next idle window. */ }
    })();
  }
  /** One failed menu-idle portrait attempt; the chunker turns triple
   * failures into letter-mark placeholders (see portraitPlaceholderKeys). */
  private notePortraitFailure(kind: FighterKind): void {
    this.portraitFailures.set(kind, (this.portraitFailures.get(kind) ?? 0) + 1);
  }
  private async persistPreviews(): Promise<void> {
    if (this.disposed) return;
    const view = this.ui.getSnapshot();
    // Never persist a worthless payload: an empty cache entry would read
    // back as a hit and skip the cold capture that could have filled it.
    if (!Object.keys(view.portraits).length && !Object.keys(view.stagePreviews).length) return;
    const data: PreviewCacheData = { portraits: view.portraits, itemPortraits: view.itemPortraits, stagePreviews: view.stagePreviews };
    await writePreviewCache(this.previewKey(), data);
  }
  private keydown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable="true"], dialog[open]')) return;
    if (event.code === 'Escape' && !this.online) { event.preventDefault(); this.pause(); return; }
    // Debug: in a live local arena, P hot-swaps P1 to the next fighter in
    // character-select menu order (Shift+P: random loaded fighter) with no
    // restart, so every fighter can be tried without leaving the game.
    // Online / menus / typing are ignored.
    if (event.code === 'KeyP') { event.preventDefault(); if (event.shiftKey) this.randomDebugFighter(); else this.cycleDebugFighter(); }
  };
  private blur = () => { if (!this.online) this.pause(true); };
  private visibility = () => { if (document.hidden) { if (this.online) this.onlineAbort?.(); else this.pause(true); } };
  fail(error: unknown): void {
    // Surface the full error (with stack) in devtools; the overlay only shows
    // error.message, which hid the throw site for every match-start/tick failure.
    console.error('Match failed to start or step:', error);
    this.input?.clear(); if (this.input) this.input.enabled = false; this.audio.stopAll(); this.rumblePad.stop();
    this.ui.update({ error: errorText(error), loading: false, paused: true, active: false }); this.hud.update({ status: 'UNAVAILABLE' });
  }
  chooseMode(mode: 'solo' | 'lan'): void {
    if (this.online || this.ui.getSnapshot().active) return;
    this.rouletteLocked = false;
    this.reset();
    // Classic mode entries always draft stock battles; the hill/zombies drafts live only behind chooseHill/chooseZombies.
    // A fresh mode entry also stands down chaos: roulette starts from its own banner.
    this.setRoulette(false);
    this.ui.update({ setup: { ...this.ui.getSnapshot().setup, hill: null, zombies: false } });
    this.ui.update({ mode, scene: mode === 'solo' ? 'characters' : 'online', paused: false }); this.cue('confirm');
  }
  /** Zombies draft: infection rules on the current stage, teams off. */
  chooseZombies(): void {
    if (this.online || this.ui.getSnapshot().active) return;
    this.rouletteLocked = false;
    this.reset();
    this.setRoulette(false);
    const setup = this.ui.getSnapshot().setup;
    this.ui.update({ setup: { ...setup, zombies: true, hill: null, teams: false }, mode: 'solo', scene: 'characters', paused: false });
    this.cue('confirm');
  }
  /** Roulette draft: a quick players-only setup (humans/CPUs), no fighter or
   * stage picking — those roll on START. Chaos arms for the match. */
  chooseRoulette(): void {
    if (this.online || this.ui.getSnapshot().active) return;
    this.rouletteLocked = false;
    this.reset();
    const setup = this.ui.getSnapshot().setup;
    this.ui.update({ setup: { ...setup, hill: null, zombies: false, teams: false }, mode: 'solo', scene: 'roulette', paused: false });
    this.setRoulette(true);
    this.cue('confirm');
  }
  /** Roulette launch from the quick setup: random fighters, stage pinned or
   * rolled, straight into the match with chaos armed. Missing assets load
   * first via the pending-start guard, then the fight begins on its own. */
  startRoulette(stage: StageId | 'random' = 'random'): void {
    const view = this.ui.getSnapshot();
    if (!view.ready || view.loading || view.error || this.online || view.mode !== 'solo' || (view.scene !== 'roulette' && view.scene !== 'stages')) return;
    if (this.rollRouletteLineup(stage)) this.start();
  }
  /** Random fighters for every active seat; the pinned stage stands when it
   * fits the player count, otherwise a fitting stage rolls. False when fewer
   * than two seats are active. */
  private rollRouletteLineup(stage: StageId | 'random'): boolean {
    const view = this.ui.getSnapshot();
    const seats = [...view.setup.seats];
    const count = activeSeats(seats).length;
    if (count < MIN_MATCH_PLAYERS) return false;
    const rolled = seats.map(seat => seat.control === 'off'
      ? seat
      : { ...seat, fighter: pickRandomKind(MENU_FIGHTER_ORDER) ?? seat.fighter, costume: 0 });
    const pool = SUPPORTED_STAGES.filter(entry => stagePlayerLimit(entry.id) >= count);
    const finalStage = stage !== 'random' && stagePlayerLimit(stage) >= count ? stage : (pool.length ? pool[(Math.random() * pool.length) | 0]!.id : SUPPORTED_STAGES[0]!.id);
    this.ui.update({ setup: { ...view.setup, seats: rolled, stage: finalStage } });
    this.ensureFighters(activeSeats(rolled).map(seat => seat.fighter));
    this.ensureStage(finalStage);
    return true;
  }
  /** King of the Hill draft: Hyrule Temple preselected, zones A+B, infinite lives. */
  chooseHill(): void {
    if (this.online || this.ui.getSnapshot().active) return;
    this.rouletteLocked = false;
    this.reset();
    this.setRoulette(false);
    const setup = this.ui.getSnapshot().setup;
    this.ui.update({ setup: { ...setup, hill: setup.hill ? { zones: setup.hill.zones } : { zones: 2 }, stage: 'temple' }, mode: 'solo', scene: 'characters', paused: false });
    this.ensureStage('temple');
    this.cue('confirm');
  }
  home(): void {
    if (this.online) return;
    this.rouletteLocked = false; this.nextMatchTournament = false;
    this.reset(); this.ui.update({ mode: null, scene: 'home', paused: false }); this.cue('back'); void this.menu?.setMusic('menu');
  }
  /** Rift Descent is a full menu screen (setup, branches, boons, shop),
   * not an overlay: fights still run in the shared arena scene. */
  rogueMenu(): void {
    if (this.online || this.ui.getSnapshot().active) return;
    // A run is one champion's build: roulette chaos (a persisted toggle) must never swap fighters mid-floor.
    this.reset(); this.setRoulette(false); this.rouletteLocked = true; this.ui.update({ mode: 'solo', scene: 'rogue', paused: false }); this.cue('confirm');
  }
  /** Tournaments are a full menu screen (hub, wizard, bracket, set lobby); sets run in the shared arena. */
  tournamentMenu(): void {
    if (this.online || this.ui.getSnapshot().active) return;
    this.reset(); this.setRoulette(false); this.rouletteLocked = true; this.ui.update({ mode: 'solo', scene: 'tournament', paused: false }); this.cue('confirm');
  }
  /** One local tournament set: exactly two seats under the bracket's rules (items off), straight into the arena.
   * Missing assets load first through the pending-start guard. */
  startTournamentSet(set: { sides: readonly [Pick<PlayerSeat, 'fighter' | 'control' | 'level'>, Pick<PlayerSeat, 'fighter' | 'control' | 'level'>]; stage: StageId; stocks: number; seconds: number; hill: BattleSetup['hill'] }): void {
    const view = this.ui.getSnapshot();
    if (!view.ready || view.loading || view.error || this.online || view.active) return;
    this.setRoulette(false);
    this.nextMatchTournament = true;
    const seats = view.setup.seats.map(seat => seat.slot < 2 ? { ...seat, ...set.sides[seat.slot]!, costume: 0 } : { ...seat, control: 'off' as const });
    this.ui.update({ mode: 'solo', setup: { ...view.setup, seats, stage: set.stage, stocks: set.stocks, seconds: set.seconds, hill: set.hill, teams: false, zombies: false, items: -1 } });
    this.start(true);
  }
  scene(scene: Scene): void {
    if (this.ui.getSnapshot().active) return;
    this.ui.update({ scene }); this.cue(scene === 'characters' ? 'back' : 'confirm');
    if (scene === 'stages') this.menu?.warm(this.ui.getSnapshot().setup.stage);
  }
  selectSeat(slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_MATCH_PLAYERS || this.ui.getSnapshot().active) return;
    this.ui.update({ activeSeat: slot }); this.cue('select');
  }
  setSeat(slot: number, patch: Partial<Pick<PlayerSeat, 'fighter' | 'control' | 'level' | 'costume'>>): void {
    if (this.ui.getSnapshot().active || this.online) return;
    if (!Number.isInteger(slot) || slot < 0 || slot >= MAX_MATCH_PLAYERS) throw new Error('Invalid player seat.');
    if (patch.fighter !== undefined && !ROSTER_CHOICES.includes(patch.fighter)) throw new Error('Unsupported fighter.');
    if (patch.control !== undefined && !(['human', 'cpu', 'off'] as SeatControl[]).includes(patch.control)) throw new Error('Invalid seat controller.');
    if (patch.level !== undefined && !isCpuLevel(patch.level)) throw new Error('Invalid CPU level.');
    if (patch.costume !== undefined && (!Number.isInteger(patch.costume) || patch.costume < 0 || patch.costume > 11)) throw new Error('Invalid costume.');
    const view = this.ui.getSnapshot();
    // Switching fighters resets the skin: indices belong to the old fighter.
    const normalized = patch.fighter !== undefined && patch.costume === undefined ? { ...patch, costume: 0 } : patch;
    const seats = view.setup.seats.map(seat => seat.slot === slot ? { ...seat, ...normalized } : seat);
    this.ui.update({ setup: { ...view.setup, seats }, activeSeat: slot });
    this.input?.setLocalPlayerCount(Math.max(1, seats.filter(seat => seat.control === 'human').length) as LocalControllerCount);
    // Draft editing is UI-only: do not rebuild eight render rigs on every selection.
    // A newly picked fighter starts loading now so the match guard rarely waits.
    if (patch.fighter) this.ensureFighters([patch.fighter]);
    // A newly picked skin loads (with its portrait) so the match guard rarely waits.
    if (patch.costume !== undefined && patch.costume > 0) {
      const seat = seats.find(entry => entry.slot === slot);
      if (seat) this.ensureCostumes([{ fighter: seat.fighter, costume: patch.costume }]);
    }
    this.cue(patch.fighter ? announcerCue(patch.fighter) : 'select');
  }
  setRules(patch: Partial<Pick<BattleSetup, 'stocks' | 'seconds' | 'stage' | 'items' | 'itemSwitches' | 'hill' | 'teams' | 'zombies'>>): void {
    if (this.ui.getSnapshot().active || this.online) return;
    if (patch.stocks !== undefined && (!Number.isInteger(patch.stocks) || patch.stocks < 1 || patch.stocks > 9)) throw new Error('Stocks must be between 1 and 9.');
    if (patch.teams !== undefined && typeof patch.teams !== 'boolean') throw new Error('Teams must be a boolean.');
    if (patch.zombies !== undefined && typeof patch.zombies !== 'boolean') throw new Error('Zombies must be a boolean.');
    if (patch.hill !== undefined && patch.hill !== null && (typeof patch.hill !== 'object' || (patch.hill.zones !== 1 && patch.hill.zones !== 2) || Object.keys(patch.hill).length !== 1)) throw new Error('Hill rules must be null or { zones: 1|2 }.');
    if (patch.seconds !== undefined && (!Number.isInteger(patch.seconds) || patch.seconds < 1 || patch.seconds > 600)) throw new Error('Time must be between 1 and 600 seconds.');
    if (patch.items !== undefined && (!Number.isInteger(patch.items) || patch.items < -1 || patch.items > 4)) throw new Error('Invalid item frequency.');
    if (patch.itemSwitches !== undefined && patch.itemSwitches !== null && (!Array.isArray(patch.itemSwitches) || patch.itemSwitches.some(kind => !Number.isInteger(kind) || kind < 0 || kind > 0x22) || new Set(patch.itemSwitches).size !== patch.itemSwitches.length)) throw new Error('Invalid item switches.');
    if (patch.stage !== undefined && !SUPPORTED_STAGES.some((stage) => stage.id === patch.stage)) throw new Error('Unsupported stage.');
    if (patch.stage !== undefined && activeSeats(this.ui.getSnapshot().setup.seats).length > stagePlayerLimit(patch.stage)) throw new Error('This stage supports at most four fighters in the prototype spawn layout.');
    this.ui.update({ setup: { ...this.ui.getSnapshot().setup, ...patch } });
    // A newly picked stage starts loading now so the match guard rarely waits.
    if (patch.stage !== undefined) { this.ensureStage(patch.stage); this.menu?.warm(patch.stage); }
    this.cue('select');
  }
  cue(sound: MenuSound): void {
    if (!this.ui.getSnapshot().sound || !this.menu) return;
    void this.menu.unlock().then(() => { if (!this.disposed) { this.menu?.play(sound); if (!this.ui.getSnapshot().active && this.ui.getSnapshot().music) void this.menu?.setMusic('menu'); } });
  }
  /** Phase 2.1: which of the draft's fighters/stage/skins are still loading. */
  selectionStatus(picks: readonly { fighter: FighterKind; costume: number }[], stage: StageId): { missingFighters: FighterKind[]; missingCostumes: { kind: FighterKind; index: number; partner?: boolean }[]; missingStage: boolean } {
    const missingFighters = this.content ? [...new Set(picks.map(pick => pick.fighter))].filter((kind) => !this.content!.roster.has(kind)) : [...new Set(picks.map(pick => pick.fighter))];
    const missingCostumes: { kind: FighterKind; index: number; partner?: boolean }[] = [];
    if (this.content) for (const { fighter, costume } of picks) {
      const index = clampCostumeIndex(fighter, costume);
      if (index === 0 || !this.content.roster.has(fighter) || this.costumeModels.has(`${fighter}:${index}`)) continue;
      missingCostumes.push({ kind: fighter, index });
      if (fighter === 'Zd' || fighter === 'Sk') {
        const counterpart = fighter === 'Zd' ? 'Sk' : 'Zd';
        if (this.content.roster.has(counterpart) && !this.costumeModels.has(`${counterpart}:${index}`)) missingCostumes.push({ kind: counterpart, index });
      }
      // Nana's same-index skin gates duo-costume readiness like any other skin.
      if (fighter === 'Pp' && this.source?.info.files.some((file) => file.path === nanaCostumeFile(index)) && !this.costumeModels.has(nanaCostumeKey(index))) missingCostumes.push({ kind: fighter, index, partner: true });
    }
    return { missingFighters, missingCostumes, missingStage: !this.stageContent.has(stage) };
  }
  /** True when a match with these fighters on this stage can start now. */
  matchAssetsReady(picks: readonly { fighter: FighterKind; costume: number }[], stage: StageId): boolean {
    const status = this.selectionStatus(picks, stage);
    return !status.missingFighters.length && !status.missingCostumes.length && !status.missingStage;
  }
  private pendingStart = false;
  reset(start = false): void {
    if (!this.content || !this.renderer || !this.input || this.online) return;
    // Leaving (or restarting) a match always drops pause-camera input, e.g.
    // Rematch / Fighters chosen from the pause menu.
    this.pauseControls?.disable();
    const setup = this.ui.getSnapshot().setup, seats = activeSeats(setup.seats);
    if (start && seats.length < MIN_MATCH_PLAYERS) { this.ui.update({ progress: 'Activate at least two human or CPU seats.' }); return; }
    // Incomplete drafts show only a non-playing background preview; cannot start it.
    const preview = seats.length >= 2 ? seats : [seats[0] ?? {slot: 0, fighter: 'Fx' as const, control: 'human' as const, level: DEFAULT_CPU_LEVEL, costume: 0}, {slot: seats[0]?.slot === 1 ? 0 : 1, fighter: 'Mr' as const, control: 'cpu' as const, level: DEFAULT_CPU_LEVEL, costume: 0}];
    const wanted = preview.map(seat => ({ fighter: seat.fighter, costume: seat.costume ?? 0 }));
    const status = this.selectionStatus(wanted, setup.stage);
    if (status.missingFighters.length || status.missingCostumes.length || status.missingStage) {
      // Phase 2.1 guard: match start waits for selected assets with a small
      // loading indicator; menu backdrops fall back to loaded fighters.
      this.ensureFighters(status.missingFighters);
      if (status.missingCostumes.length) this.ensureCostumes(wanted);
      if (status.missingStage) this.ensureStage(setup.stage);
      if (start) {
        this.pendingStart = true;
        const names = [...status.missingFighters.map(kind => kind), ...(status.missingCostumes.length ? [`${status.missingCostumes.length} skins`] : []), ...(status.missingStage ? [`stage ${setup.stage}`] : [])].join(', ');
        this.ui.update({ progress: `Preparing ${names}…` });
      } else {
        const fallback = (kind: FighterKind): FighterKind => this.content!.roster.has(kind) ? kind : 'Fx';
        const stageContent = this.stageContent.get(setup.stage) ?? this.stageContent.get('battlefield');
        if (!stageContent) return;
        const selected = rosterPlayers(stageContent, wanted.map(pick => fallback(pick.fighter)));
        this.presentBackdrop(selected, preview);
      }
      return;
    }
    this.pendingStart = false;
    this.touchFighters(wanted.map(pick => pick.fighter));
    this.touchStage(setup.stage);
    const selected = selectLineup(this.getStageContent(setup.stage), wanted, this.costumeModels);
    this.presentBackdrop(selected, preview, start, setup);
    // Release on the way into menus, never on the way into a match: dropping dozens of
    // fighters at once churns the heap exactly when frame time matters.
    if (!start) this.trimAssets();
  }
  /** Shared match/backdrop presentation for reset(): builds the world from
   * already-resolved content and presents the first frame. */
  private presentBackdrop(selected: GameContent, preview: PlayerSeat[], start = false, setup: BattleSetup = this.ui.getSnapshot().setup): void {
    if (!this.renderer || !this.input) return;
    // A local presentation replaces whatever an online match left on screen.
    this.onlineMatchPresented = false;
    const controllers = preview.map(seat => seat.control === 'cpu' ? 'cpu' as const : 'human' as const);
    this.humanDenseSlots = controllers.flatMap((control, index) => control === 'human' ? [index] : []);
    this.input.setLocalPlayerCount(Math.max(1, this.humanDenseSlots.length) as LocalControllerCount);
    this.input.clear(); this.renderer.reset(); this.audio.stopAll(); this.rumblePad.stop(); this.last = 0; this.accumulator = 0; this.bannerUntil = 0; this.banner = '';
    this.fallLog.set({ entries: [] });
    this.renderer.setFighters(selected);
    this.matchTournament = this.nextMatchTournament; this.nextMatchTournament = false;
    this.match = new LocalMatch(selected, this.renderer.rigs, { opponent: 'human', controllers, seatIds: preview.map(seat => seat.slot), cpuLevels: preview.map(seat => clampCpuLevel(seat.level)), stocks: setup.stocks, seconds: setup.seconds, itemFrequency: setup.items, itemSwitches: setup.itemSwitches, hill: setup.hill, teams: setup.teams, zombies: setup.zombies, seed: setup.hill ? (Math.random() * 0xffffffff) >>> 0 : undefined, player: this.humanDenseSlots[0] ?? 0 });
    this.input.enabled = start;
    if (start) { this.match.start(); this.focus(); }
    if (start && this.match && this.ui.getSnapshot().roulette) this.rouletteNext = this.match.frame + this.rouletteSeconds * 60;
    this.ui.update({ active: start, paused: false, ended: false, ...(start ? { scene: 'arena' as const, mode: 'solo' as const } : {}) });
    this.renderer.render(this.match); this.publishHud();
  }
  /** Start (or restart) a local match. Rematch from the pause menu passes
   * force so it resets instead of merely resuming. */
  start(force = false): void {
    const view = this.ui.getSnapshot();
    if (!view.ready || view.loading || view.error || this.online || view.mode === 'lan') return;
    if (view.paused && view.active && !force) { this.pause(false); return; }
    // A forced start drops pause-camera input before the reset re-arms play.
    if (view.paused) this.pause(false);
    if (activeSeats(view.setup.seats).length < MIN_MATCH_PLAYERS) return;
    // Roulette chaos re-rolls the lineup on every fresh launch (rematch,
    // play-again), never on resume.
    if (view.roulette && (force || view.ended)) this.rollRouletteLineup(view.setup.stage);
    void this.audio.unlock();
    if (this.menu) { void this.menu.unlock().then(() => { if (!this.disposed) this.menu?.play('confirm'); }); void this.menu.setMusic(view.setup.stage); }
    this.reset(true);
  }
  changeFighters(): void { if (!this.online) { this.rouletteLocked = false; this.reset(); this.ui.update({ mode: 'solo', scene: 'characters' }); this.cue('back'); void this.menu?.setMusic('menu'); } }
  /** Visible mid-match callout for the debug cycler (the menu progress line
   * is hidden while the arena owns the screen). */
  private setSwapBanner(text: string, frames = 75): void {
    if (!this.match) return;
    this.banner = text;
    this.bannerUntil = this.match.frame + frames;
  }
  /** Debug helper (P): hot-swap P1 to the next fighter in character-select
   * menu order WITHOUT restarting — timer, stocks, percents, positions and
   * the other fighters keep going, so there is no countdown. Always targets
   * the match slot owned by seat 0 (P1); in a watch match without P1 it takes
   * match slot 0. Fighters whose assets failed to load are skipped, and
   * failures surface as a banner + progress message instead of wedging the
   * cycler. The draft follows the swap (rematch and the char screen show the
   * new P1) with the skin reset to default. A fighter whose assets are still
   * downloading swaps in as soon as they arrive (see pendingSwap). Local
   * arena only: online, menus, ended or inactive matches are no-ops. Returns
   * the new fighter kind, or null when ignored. */
  cycleDebugFighter(): FighterKind | null {
    const match = this.match;
    if (!this.content || !this.renderer || !this.input || !match || this.online) return null;
    const view = this.ui.getSnapshot();
    if (!view.active || view.scene !== 'arena' || view.mode === 'lan') return null;
    if (match.phase !== 'playing' && match.phase !== 'countdown') return null;
    const at = match.fighters.findIndex(fighter => fighter.seatId === 0);
    const slot = at >= 0 ? at : 0;
    const fighter = match.fighters[slot];
    if (!fighter) return null;
    // Advance past fighters whose assets failed to load: one bad file must
    // never wedge the cycler on the fighter before it.
    const current = fighter.content.profile.kind;
    const start = MENU_FIGHTER_ORDER.indexOf(current);
    let next: FighterKind | null = null;
    for (let step = 1; step <= MENU_FIGHTER_ORDER.length; step++) {
      const candidate = MENU_FIGHTER_ORDER[(start + step) % MENU_FIGHTER_ORDER.length]!;
      if (candidate === current) break;
      if (this.unloadableKinds([candidate]).length) continue;
      next = candidate;
      break;
    }
    if (!next) {
      this.ui.update({ progress: 'Debug: no loadable fighters to cycle to.' });
      return null;
    }
    const order = MENU_FIGHTER_ORDER.indexOf(next) + 1;
    const name = this.content.roster.get(next)?.profile.name ?? next;
    return this.swapP1ToKind(match, slot, fighter.seatId, next, `P1 \u2192 ${name.toUpperCase()}`, `Debug: P1 -> ${name} (${order}/${MENU_FIGHTER_ORDER.length}). No restart — press P for the next fighter.`);
  }
  /** Debug helper (Shift+P, 🎲 button): hot-swap P1 to a random LOADED
   * fighter — same no-restart contract as the ordered cycle, but always
   * instant (the pool is what is resident, so it never defers). Local arena
   * only, like the cycler. Returns the new kind, or null when ignored. */
  randomDebugFighter(): FighterKind | null {
    const match = this.match;
    if (!this.content || !this.renderer || !this.input || !match || this.online) return null;
    const view = this.ui.getSnapshot();
    if (!view.active || view.scene !== 'arena' || view.mode === 'lan') return null;
    if (match.phase !== 'playing' && match.phase !== 'countdown') return null;
    const at = match.fighters.findIndex(fighter => fighter.seatId === 0);
    const slot = at >= 0 ? at : 0;
    const fighter = match.fighters[slot];
    if (!fighter) return null;
    const kind = pickRandomKind([...this.content.roster.keys()], fighter.content.profile.kind);
    if (!kind) return null;
    const name = this.content.roster.get(kind)?.profile.name ?? kind;
    return this.swapP1ToKind(match, slot, fighter.seatId, kind, `🎲 P1 \u2192 ${name.toUpperCase()}`, `Debug: P1 -> ${name} (random). No restart — Shift+P rolls again.`);
  }
  /** Shared P1 hot-swap core behind the ordered cycle and the random pick:
   * the draft follows, assets kick off, resident kinds swap immediately and
   * the rest defer (see pendingSwap). Failures surface, never wedge. */
  private swapP1ToKind(match: LocalMatch, slot: number, seatId: number, kind: FighterKind, banner: string, progress: string): FighterKind | null {
    if (!this.content || !this.renderer) return null;
    const view = this.ui.getSnapshot();
    const seats = view.setup.seats.map(seat => seat.slot === seatId ? { ...seat, fighter: kind, costume: 0 } : seat);
    this.ui.update({ setup: { ...view.setup, seats }, activeSeat: seatId });
    this.ensureFighters([kind]);
    this.cue(announcerCue(kind));
    const name = this.content.roster.get(kind)?.profile.name ?? kind;
    if (!this.content.roster.has(kind)) {
      this.pendingSwap = { match, slot, kind };
      this.setSwapBanner(`PREPARING ${name.toUpperCase()}…`);
      this.ui.update({ progress: `Debug: preparing ${name} for P1… it swaps in automatically.` });
      this.publishHud();
      return kind;
    }
    this.pendingSwap = null;
    try {
      match.debugSwapFighter(slot, kind);
      this.renderer.swapFighterRig(slot, this.content.roster.get(kind)!);
    } catch (error) {
      this.setSwapBanner('SWAP FAILED');
      this.ui.update({ progress: `Debug swap to ${name} failed: ${error instanceof Error ? error.message : String(error)}` });
      this.publishHud();
      return null;
    }
    this.setSwapBanner(banner);
    this.ui.update({ progress });
    this.publishHud();
    this.focus();
    return kind;
  }
  /** A P-swap whose fighter was still downloading when P was pressed. Retried
   * on every content settle; dropped when the match it belonged to is gone. */
  private pendingSwap: { match: LocalMatch; slot: number; kind: FighterKind } | null = null;
  private rouletteNext = 0;
  private rouletteSeconds = loadRouletteSeconds();
  private tryPendingSwap(): void {
    const pending = this.pendingSwap;
    const match = this.match;
    if (!pending || !match || !this.content || !this.renderer || this.disposed || this.online) return;
    if (pending.match !== match) { this.pendingSwap = null; return; }
    if (!this.content.roster.has(pending.kind)) return;
    const view = this.ui.getSnapshot();
    if (!view.active || view.scene !== 'arena') return;
    const fighter = match.fighters[pending.slot];
    if (!fighter || fighter.content.profile.kind === pending.kind) { this.pendingSwap = null; return; }
    this.pendingSwap = null;
    try {
      match.debugSwapFighter(pending.slot, pending.kind);
      this.renderer.swapFighterRig(pending.slot, this.content.roster.get(pending.kind)!);
    } catch (error) {
      this.setSwapBanner('SWAP FAILED');
      this.ui.update({ progress: `Debug swap failed: ${error instanceof Error ? error.message : String(error)}` });
      this.publishHud();
      return;
    }
    const name = this.content.roster.get(pending.kind)?.profile.name ?? pending.kind;
    this.setSwapBanner(`P1 \u2192 ${name.toUpperCase()}`);
    this.ui.update({ progress: `Debug: P1 -> ${name}. No restart — press P for the next fighter.` });
    this.publishHud();
  }
  private fireRoulette(): void {
    const match = this.match;
    if (!match || !this.content || !this.renderer || this.online || this.disposed) return;
    const view = this.ui.getSnapshot();
    if (!view.active || view.scene !== 'arena' || !view.roulette || match.phase !== 'playing') return;
    const pool = [...this.content.roster.keys()];
    if (pool.length < 2) return;
    const seats = [...view.setup.seats];
    let first: FighterKind | null = null;
    for (const fighter of match.fighters) {
      const kind = pickRandomKind(pool, fighter.content.profile.kind);
      if (!kind) continue;
      try {
        match.debugSwapFighter(fighter.slot, kind);
        this.renderer.swapFighterRig(fighter.slot, this.content.roster.get(kind)!);
      } catch { continue; }
      const index = seats.findIndex(seat => seat.slot === fighter.seatId);
      if (index >= 0) seats[index] = { ...seats[index]!, fighter: kind, costume: 0 };
      if (!first) first = kind;
    }
    if (!first) return;
    this.pendingSwap = null;
    this.ui.update({ setup: { ...view.setup, seats } });
    this.cue(announcerCue(first));
    this.setSwapBanner('🎲 ROULETTE!', 100);
    this.ui.update({ progress: 'Debug roulette: every fighter is someone new. No restart.' });
    this.publishHud();
    this.rouletteNext = match.frame + this.rouletteSeconds * 60;
  }
  /** Rift Descent and tournament sets own their lineups: chaos cannot be armed (Debug tools checkbox) until another mode is entered. */
  private rouletteLocked = false;
  /** Game history: the next local match is a tournament set; the live one is. */
  private nextMatchTournament = false;
  private matchTournament = false;
  private endedMatch: LocalMatch | null = null;
  private readonly endedListeners = new Set<(ended: EndedMatch) => void>();
  /** Fires once per finished match this browser played in (never for Rift floor fights: the run is the game). */
  onMatchEnded(listener: (ended: EndedMatch) => void): () => void { this.endedListeners.add(listener); return () => this.endedListeners.delete(listener); }
  private announceEnd(): void {
    const match = this.match;
    if (!match || match.phase !== 'ended' || this.endedMatch === match) return;
    this.endedMatch = match;
    if (!this.endedListeners.size || match.fighters.some(fighter => fighter.rogue.essential === true)) return;
    const me = this.online ? this.onlineLocalSlot : match.controllerKinds.indexOf('human');
    if (me < 0) return;
    const rules = [`stocks:${match.options.stocks}`, match.options.teams && 'teams', match.options.zombies && 'zombies', match.hill && 'hill', match.options.itemFrequency >= 0 && 'items'].filter((rule): rule is string => typeof rule === 'string');
    const ended: EndedMatch = {
      mode: this.online ? 'lan' : this.matchTournament ? 'tournament' : 'local', stage: match.content.stageId, seconds: match.frame / 60, winner: match.winner, me, zombies: match.options.zombies, rules,
      fighters: match.fighters.map((fighter, dense) => {
        const seatId = fighter.seatId ?? dense, cpu = match.controllerKinds[dense] === 'cpu';
        return { kind: fighter.content.profile.kind, name: cpu ? 'CPU' : `P${seatId + 1}`, cpu, seatId, team: match.options.teams ? hillTeamOfSlot(seatId) : null, infected: fighter.infected, kos: fighter.kos, falls: fighter.falls, damage: Math.floor(fighter.damageDealt) };
      }),
    };
    for (const listener of this.endedListeners) { try { listener(ended); } catch (error) { console.warn('Match-ended listener failed:', error); } }
  }
  setRoulette(roulette: boolean): void {
    if (roulette && this.rouletteLocked) { this.ui.update({ roulette: false, progress: 'Roulette chaos is off in Rift Descent and tournaments.' }); return; }
    saveToggle('smash-roulette', roulette);
    this.ui.update({ roulette });
    if (roulette && this.match && this.ui.getSnapshot().active && !this.online) this.rouletteNext = this.match.frame + this.rouletteSeconds * 60;
    this.focus();
  }
  setRouletteSeconds(seconds: number): void {
    if (seconds !== 10 && seconds !== 30 && seconds !== 60) throw new Error('Roulette interval must be 10, 30 or 60 seconds.');
    saveRouletteSeconds(seconds);
    this.rouletteSeconds = seconds;
    this.ui.update({ rouletteSeconds: seconds });
    if (this.match && this.ui.getSnapshot().active && !this.online) this.rouletteNext = this.match.frame + seconds * 60;
    this.focus();
  }
  pause(value = !this.ui.getSnapshot().paused): void {
    if (!this.match || !this.input || this.online || this.match.phase === 'ready' || this.match.phase === 'ended') return;
    this.last = 0; this.accumulator = 0; this.input.clear(); this.input.enabled = !value; this.ui.update({ paused: value, pauseFocus: null });
    // Hand the camera to the player while frozen (mouse/keyboard orbit); the
    // renderer re-seeds its orbit from the live shot on the first paused frame.
    if (value) { this.audio.pause(); this.rumblePad.stop(); this.pauseControls?.enable(); this.focus(); }
    else { this.pauseControls?.disable(); void this.audio.unlock(); this.focus(); }
    this.publishHud();
  }
  setWalk(): void { if (this.input) { this.input.walkMode = !this.input.walkMode; this.ui.update({ walk: this.input.walkMode }); this.focus(); } }
  setSound(sound: boolean): void { saveEnabled('smash-sound', sound); this.audio.enabled = sound; if (this.menu) this.menu.sfxMuted = !sound; this.ui.update({ sound }); if (sound) void this.audio.unlock(); else this.audio.stopAll(); }
  setMusic(music: boolean): void { saveEnabled('smash-music', music); if (this.menu) this.menu.musicMuted = !music; this.ui.update({ music }); if (music) { void this.menu?.unlock(); void this.menu?.setMusic(this.ui.getSnapshot().active ? this.match?.content.stageId ?? this.ui.getSnapshot().setup.stage : 'menu'); } }
  setMasterVolume(masterVolume: number): void {
    const level = Number.isFinite(masterVolume) ? Math.min(1, Math.max(0, masterVolume)) : DEFAULT_MASTER_VOLUME;
    saveMasterVolume(level); this.audio.masterVolume = level; if (this.menu) this.menu.masterVolume = level; this.ui.update({ masterVolume: level });
  }
  setMusicVolume(musicVolume: number): void { const level = Number.isFinite(musicVolume) ? Math.min(1, Math.max(0, musicVolume)) : DEFAULT_MUSIC_VOLUME; saveMusicVolume(level); if (this.menu) this.menu.musicVolume = level; this.ui.update({ musicVolume: level }); }
  setTouch(touch: boolean): void { saveEnabled('smash-touch', touch); this.ui.update({ touch }); }
  setHudMode(hudMode: PlayView['hudMode']): void {
    this.ui.update({ hudMode });
    try { globalThis.localStorage?.setItem('smash-hud-mode', hudMode); } catch { /* private mode: session-only */ }
  }
  toggleHud(): void { this.setHudMode(this.ui.getSnapshot().hudMode === 'cards' ? 'overhead' : 'cards'); }
  /** Graphics mode: `auto` adapts the effective preset to measured arena
   * frame times (freely between low and ultra, session-scoped); an explicit
   * preset applies immediately, persists, and is never auto-changed. */
  setGraphicsMode(mode: GraphicsMode): void {
    saveGraphicsMode(mode);
    this.graphicsMode = mode;
    this.autoDownStart = performance.now(); this.autoUpStart = performance.now();
    if (mode === 'auto') {
      // Keep the current picture; the stepper roams from here on evidence.
      this.ui.update({ graphicsMode: mode });
      return;
    }
    this.renderer?.setQuality(mode, mode);
    saveGraphicsQuality(mode);
    this.ui.update({ graphicsMode: mode, graphics: mode });
  }
  /** One screen-space effect: `auto` follows the preset, on/off is pinned and
   * persisted. Cosmetic only, so it applies mid-match without a context rebuild. */
  /** Applies to fighters and stages built after the change: live GPU textures are left alone. */
  /** Stores the look for this browser. Loaded models keep theirs until the page reloads. */
  setLook(value: string): void {
    saveLookPreference(value);
    this.ui.update({ look: value });
  }
  setTextureUpscale(value: TextureUpscale): void {
    saveTextureUpscale(value); setTextureUpscale(value);
    this.ui.update({ textureUpscale: value });
    this.focus();
  }
  setVisualEffect(id: VisualEffectId, choice: VisualEffectChoice): void {
    const effects = withVisualEffect(this.ui.getSnapshot().effects, id, choice);
    saveVisualEffectChoices(effects);
    this.renderer?.setVisualEffects(effects);
    this.ui.update({ effects });
    this.focus();
  }
  setCameraShake(cameraShake: CameraShakeLevel): void { saveCameraShakeLevel(cameraShake); this.renderer?.setShakeLevel(cameraShake); this.ui.update({ cameraShake }); }
  setRumble(rumble: RumbleLevel): void { saveRumbleLevel(rumble); this.rumblePad.setLevel(rumble); if (rumble === 'off') this.rumblePad.stop(); else this.rumblePad.pulse({ strong: 0.8, weak: 0.5, durationMs: 120 }); this.ui.update({ rumble }); this.focus(); }
  /** Auto quality (only in `auto` mode — pinned presets are never touched):
   * step down on sustained slow frames, step back up toward ultra on
   * sustained headroom. Measured on arena gameplay only — boot, menus,
   * pause and non-playing phases reset the windows instead of polluting
   * them. Cosmetic-only, so it runs identically online. */
  private maybeAutoStepQuality(now: number): void {
    if (!this.renderer || this.disposed || this.graphicsMode !== 'auto') return;
    const view = this.ui.getSnapshot();
    const inGame = view.scene === 'arena' && !view.paused && this.match?.phase === 'playing';
    if (!inGame) { this.autoDownStart = now; this.autoUpStart = now; return; }
    const stats = this.frameMonitor.stats();
    if (stats.frames < 60) return;
    const current = this.ui.getSnapshot().graphics;
    if (shouldAutoStepDown(stats.p95)) {
      this.autoUpStart = now;
      if (now - this.autoDownStart >= 5000 && qualityIndex(current) > 0) {
        const next = stepDownQuality(current);
        this.applyAutoQuality(next, now);
      }
    } else if (shouldAutoStepUp(stats.p95) && qualityIndex(current) < qualityIndex('ultra')) {
      this.autoDownStart = now;
      if (now - this.autoUpStart >= 10000) {
        const next = GRAPHICS_QUALITIES[qualityIndex(current) + 1]!;
        this.applyAutoQuality(next, now);
      }
    } else { this.autoDownStart = now; this.autoUpStart = now; }
  }
  private applyAutoQuality(next: GraphicsQuality, now: number): void {
    // Fully adaptive in auto mode: pixels and look roam together.
    // Session-scoped (never persisted): the mode, not the dip, is what
    // the next launch restores.
    this.renderer?.setQuality(next);
    this.ui.update({ graphics: next });
    this.autoDownStart = now; this.autoUpStart = now;
  }
  setPresentation(presentation: string): void { try { globalThis.localStorage?.setItem('smash-presentation', presentation); } catch { /* private mode: session-only */ } if (this.renderer) this.renderer.customPresentation = presentation; this.ui.update({ presentation }); }
  setDebug(debug: boolean): void { if (this.renderer) this.renderer.debugHitboxes = debug; this.ui.update({ debug }); }
  setDebugCollision(debugCollision: boolean): void { if (this.renderer) this.renderer.debugCollision = debugCollision; this.ui.update({ debugCollision }); this.focus(); }
  setShowFps(showFps: boolean): void { saveToggle('smash-show-fps', showFps); this.ui.update({ showFps }); this.publishHud(); }
  setShowPerf(showPerf: boolean): void { saveToggle('smash-show-perf', showPerf); this.ui.update({ showPerf }); this.publishHud(); }
  setSmoothMotion(smoothMotion: boolean): void { saveSmoothMotion(smoothMotion); if (this.renderer) this.renderer.smoothMotion = smoothMotion; this.ui.update({ smoothMotion }); this.publishHud(); this.focus(); }
  clearFallLog(): void { this.match?.groundLossLog.splice(0); this.fallLog.set({ entries: [] }); this.focus(); }
  focus(): void { this.renderer?.renderer.domElement.focus({ preventScroll: true }); }
  stick(x: number, y: number): void { this.input?.setStick(x, y); }
  touch(code: string, id: number, pressed: boolean): void { if (pressed) { this.input?.pressTouch(code, id); this.focus(); } else this.input?.releaseTouch(code, id); }
  getStageContent(stage: StageId): GameContent { const content = this.stageContent.get(stage); if (!content) throw new Error('Stage assets have not loaded.'); return content; }
  present(events: readonly MatchEvent[]): void {
    if (!this.match || !this.renderer) return;
    this.renderer.events(events, this.match);
    this.rumblePad.events(events);
    for (const event of events) { this.audio.event(event, this.match); if (event.type === 'ko') { this.banner = `${this.match.fighters[event.player]?.content.profile.name ?? 'Player'} KO`; this.bannerUntil = this.match.frame + 60; } else if (event.type === 'infect') { this.banner = `${this.match.fighters[event.player]?.content.profile.name ?? 'Player'} IS INFECTED`; this.bannerUntil = this.match.frame + 90; } }
    if (events.length) for (const tap of this.eventTaps) tap(events, this.match);
  }
  /** `slot` is the local dense index, or -1 for a read-only spectator: no pad is read, `step` gets a
   * neutral input it must ignore, and the camera/HUD focus falls back to player 0. `rules.hill` is the
   * relay's King of the Hill zone count; the zones come from the shared `seed` on every peer. */
  beginOnline(content: GameContent, rules: {stage: StageId; stocks: number; timeSeconds: number; hill?: 1 | 2}, seed: number, slot: number, step: (input: PlayerInput) => boolean, abort: () => void, controllers: readonly PlayerControllerMode[] = content.fighters.map(() => 'human'), seatIds: readonly number[] = content.fighters.map((_, index) => index), cpuLevels: readonly number[] = content.fighters.map(() => DEFAULT_CPU_LEVEL)): LocalMatch {
    if (!this.renderer || !this.input) throw new Error('Game is not ready.');
    this.input.clear(); this.renderer.reset(); this.audio.stopAll(); this.rumblePad.stop(); this.last = 0; this.accumulator = 0; this.banner = ''; this.bannerUntil = 0;
    this.fallLog.set({ entries: [] });
    this.renderer.setFighters(content);
    this.match = new LocalMatch(content, this.renderer.rigs, { opponent: 'human', controllers, seatIds, cpuLevels: cpuLevels.map(level => clampCpuLevel(level)), stocks: rules.stocks, seconds: rules.timeSeconds, hill: rules.hill ? { zones: rules.hill } : null, seed, player: Math.max(0, slot) });
    this.onlineStep = step; this.onlineAbort = abort; this.onlineLocalSlot = slot; this.onlineMatchPresented = true;
    this.input.setLocalPlayerCount(1); this.input.enabled = slot >= 0;
    this.ui.update({ mode: 'lan', active: true, paused: false, ended: false, scene: 'arena', error: '' });
    void this.audio.unlock(); void this.menu?.setMusic(rules.stage); this.focus(); this.renderer.render(this.match); this.publishHud(); return this.match;
  }
  finishOnline(): void { if (this.input) this.input.enabled = false; this.rumblePad.stop(); this.ui.update({ active: false, ended: true }); this.publishHud(); this.announceEnd(); }
  stopOnline(message: string): void {
    this.onlineStep = undefined; this.onlineAbort = undefined; this.input?.clear(); if (this.input) { this.input.enabled = false; this.input.setLocalPlayerCount(1); }
    this.audio.stopAll(); this.rumblePad.stop(); this.last = 0; this.accumulator = 0; this.ui.update({ mode: 'lan', active: false, paused: true, ended: false, scene: 'characters', progress: message }); void this.menu?.setMusic('menu');
  }
  private tick = (now: number): void => {
    if (this.disposed) return;
    const tickStart = performance.now();
    try {
      profiler.begin(SPAN_INPUT);
      this.input?.controllers.scan(now);
      if (this.input?.controllers.getSnapshot().status === 'available' && this.ui.getSnapshot().padNote.startsWith('Gamepads are unavailable')) this.ui.update({ padNote: 'Controller access restored. Open Controllers for the detected layout and assignment.' });
      profiler.end(SPAN_INPUT);
      const view = this.ui.getSnapshot();
      if (this.match && this.renderer && this.input && !view.error) {
        const frameDelta = this.last ? Math.max(0, now - this.last) : 16.7;
        this.frameMonitor.beginFrame();
        let saturated = false, steps = 0, rendered = false;
        profiler.begin(SPAN_SIM);
        if (!view.paused && this.match.phase !== 'ready' && this.match.phase !== 'ended') {
          if (this.last) this.accumulator += Math.min(0.1, Math.max(0, (now - this.last) / 1000));
          while (this.accumulator >= 1 / 60 && steps++ < 6) {
            if (this.onlineStep) { if (!this.onlineStep(this.onlineLocalSlot < 0 ? neutralInput() : this.input.poll(false)[0] ?? neutralInput())) { this.accumulator = 0; break; } this.input.consumeLatches(); }
            else {
              const sources = this.input.poll();
              const vector = this.match.fighters.map(() => neutralInput()) as [PlayerInput, PlayerInput, ...PlayerInput[]];
              this.humanDenseSlots.forEach((dense, ordinal) => { vector[dense] = sources[ordinal] ?? neutralInput(); });
              profiler.begin(SPAN_STEP); this.match.step(vector); profiler.end(SPAN_STEP);
              profiler.begin(SPAN_PRESENT); this.present(this.match.events); profiler.end(SPAN_PRESENT);
            }
            this.accumulator -= 1 / 60;
          }
          // Saturated when the cap was hit with time still owed: presentation
          // must drop frames, simulation stays real-time.
          saturated = steps >= 6 && this.accumulator >= 1 / 60;
        } else { this.accumulator = 0; if (view.paused) this.pauseControls?.poll(); }
        profiler.end(SPAN_SIM);
        if (view.roulette && !this.online && this.match && this.match.phase === 'playing' && !view.paused && this.match.frame >= this.rouletteNext) this.fireRoulette();
        this.frameMonitor.endSim();
        this.frameMonitor.pushDelta(frameDelta, saturated);
        this.maybeAutoStepQuality(now);
        profiler.begin(SPAN_AUDIO);
        if (!this.online) this.audio.sync(this.match);
        profiler.end(SPAN_AUDIO);
        // Render-skip under load: skip presentation, never simulation.
        const renderDue = view.scene === 'arena' || now - this.lastRender >= 100;
        // Paused frames always render (never render-skip): the manual camera
        // moves under player input even though the simulation is frozen.
        if (view.paused || (renderDue && shouldRender(this.frameMonitor.skip))) { profiler.begin(SPAN_RENDER); this.renderer.render(this.match, view.paused ? 0 : Math.min(1, this.accumulator * 60), view.paused); profiler.end(SPAN_RENDER); rendered = true; this.lastRender = now; }
        this.frameMonitor.endRender();
        profiler.begin(SPAN_HUD);
        if (now - this.lastHud >= 1000 / 30 || this.match.phase === 'ended') {
          this.publishHud(); this.lastHud = now;
          // React flushes the store update in a microtask queued during publishHud; this
          // one runs right after it, timing the HUD render+commit (lands in the next frame).
          if (profiler.enabled) { const committed = performance.now(); queueMicrotask(() => profiler.add(SPAN_HUD_COMMIT, performance.now() - committed)); }
        }
        profiler.end(SPAN_HUD);
        if (!this.online && this.match.phase === 'ended' && !view.ended) { this.input.enabled = false; this.ui.update({ active: false, ended: true }); this.announceEnd(); }
        profiler.begin(SPAN_PREVIEW);
        this.maybeCapturePreviewChunk(now);
        // Cheap repair beat for a LAN room: one selection check a second while anything it
        // needs is missing (see prepareRoomSelection).
        if (this.roomSelection && now - this.lastRoomPrepare > 1000) { this.lastRoomPrepare = now; this.prepareRoomSelection(); }
        profiler.end(SPAN_PREVIEW);
        this.recordPerf(now, frameDelta, tickStart, Math.min(steps, 6), rendered, saturated, view);
      }
      this.last = now;
    } catch (error) { this.fail(error); }
    this.frameRequest = requestAnimationFrame(this.tick);
  };
  /** Feeds one RAF to the telemetry recorder; a match records from countdown until it
   * ends, is replaced, or the arena is left. Reuses scratch objects (no per-frame garbage). */
  private recordPerf(now: number, delta: number, tickStart: number, steps: number, rendered: boolean, saturated: boolean, view: PlayView): void {
    const perf = this.perf, match = this.match, renderer = this.renderer;
    if (!perf.enabled || !match || !renderer) return;
    const recording = perf.recording(match);
    const live = view.scene === 'arena' && (match.phase === 'countdown' || match.phase === 'playing');
    if (live && !recording) perf.beginMatch(match, this.perfContext(match, view));
    else if (!live && recording) perf.endMatch(match.phase === 'ended' ? 'ended' : `left:${view.scene}`);
    const frame = this.perfFrame;
    frame.now = now; frame.delta = delta; frame.work = performance.now() - tickStart; frame.steps = steps;
    frame.rendered = rendered; frame.saturated = saturated; frame.paused = view.paused; frame.skipLevel = this.frameMonitor.skip.level;
    let scene: PerfScene | null = null;
    if (rendered) {
      scene = this.perfScene;
      const info = renderer.renderer.info.render;
      let alive = 0; for (const fighter of match.fighters) if (fighter.state !== 'ko') alive++;
      scene.calls = info.calls; scene.triangles = info.triangles; scene.particles = renderer.effects.common.stats.particles;
      scene.projectiles = match.projectiles.items.length; scene.items = match.itemWorld.items.length; scene.alive = alive;
    }
    this.perfLive.quality = renderer.quality; this.perfLive.pixelRatio = renderer.renderer.getPixelRatio();
    perf.frame(frame, scene, this.perfLive);
  }
  private perfContext(match: LocalMatch, view: PlayView): PerfMatchContext {
    const renderer = this.renderer!, canvas = renderer.renderer.domElement, presentation = renderer.presentationSnapshot();
    const humans = match.controllerKinds.filter(kind => kind === 'human').length;
    const rules = [match.options.teams && 'teams', match.options.zombies && 'zombies', match.hill && 'hill', match.options.itemFrequency >= 0 && `items:${match.options.itemFrequency}`, match.fighters.some(fighter => fighter.rogue.essential === true) && 'rogue', `stocks:${match.options.stocks}`]
      .filter((rule): rule is string => typeof rule === 'string');
    return {
      mode: this.online ? 'lan' : view.mode ?? 'solo', online: this.online, players: match.fighters.length, humans, cpus: match.fighters.length - humans,
      fighters: match.fighters.map(fighter => fighter.content.profile.kind), cpuLevels: match.fighters.flatMap((_, dense) => match.controllerKinds[dense] === 'cpu' ? [match.cpuLevels[dense] ?? 0] : []),
      stage: match.content.stageId, rules,
      quality: renderer.quality, graphicsMode: this.graphicsMode, pixelRatio: renderer.renderer.getPixelRatio(),
      canvas: [canvas.clientWidth, canvas.clientHeight], buffer: [canvas.width, canvas.height],
      smoothMotion: renderer.smoothMotion, shadows: presentation.shadows, richLight: presentation.richLight,
    };
  }
  publishHud(): void {
    const match = this.match, renderer = this.renderer; if (!match || !renderer) return;
    const view = this.ui.getSnapshot(), seconds = Math.max(0, Math.ceil(match.remainingFrames / 60));
    const humanCount = match.controllerKinds.filter(control => control === 'human').length;
    document.body.dataset.gamePhase = view.paused ? 'paused' : match.phase;
    const frameStats = this.frameMonitor.stats();
    const fps = frameStats.frames ? Math.min(240, Math.round(1000 / Math.max(0.01, frameStats.p50))) : 60;
    const info = renderer.renderer.info;
    const pres = renderer.presentationSnapshot();
    const perf: PerfStats | undefined = view.showPerf ? {
      fps, p50: Math.round(frameStats.p50 * 10) / 10, p95: Math.round(frameStats.p95 * 10) / 10,
      skip: frameStats.skipLevel, quality: renderer.quality,
      calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0,
      particles: renderer.effects.common.stats.particles, smooth: view.smoothMotion,
      cam: pres.camMode === 'focus' ? `focus:${pres.camDetail}@${pres.camDistance}` : `${pres.camMode}:${pres.camDetail}@${pres.camDistance}`,
    } : undefined;
    this.hud.set({ frame: match.frame, clock: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, stage: match.content.stageId, phase: match.phase, countdown: Math.max(1, Math.ceil(match.countdown / 60)), shieldMax: match.content.combat.shield.maximum, fps, perf,
      status: view.paused ? 'PAUSED' : match.phase === 'playing' ? this.online ? 'ONLINE MATCH' : match.hill ? 'KING OF THE HILL' : match.options.zombies ? 'ZOMBIES' : 'LOCAL MATCH' : match.phase === 'ended' ? this.online && !view.ended ? 'VERIFYING RESULT' : 'MATCH OVER' : match.phase === 'countdown' ? 'GET READY' : 'READY TO PLAY',
      mode: match.hill && match.options.hill ? (match.options.teams ? 'KOTH · RED VS BLUE' : `KOTH · ${match.options.hill.zones > 1 ? 'ZONES A+B' : 'ZONE A'}`) : match.options.zombies ? 'ZOMBIES · INFECT OR SURVIVE' : match.options.teams ? 'STOCK TEAMS · RED VS BLUE' : `${this.online ? 'LAN' : humanCount ? 'LOCAL' : 'CPU EXHIBITION'} · ${humanCount} HUMAN / ${match.fighters.length - humanCount} CPU`,
      winner: match.options.zombies ? (() => { if (match.winner === null) return 'Draw.'; const champ = match.fighters[match.winner]!; return champ.infected ? `ZOMBIES WIN — ${champ.content.profile.name} patient zero.` : `${champ.content.profile.name} SURVIVES THE HORDE.`; })() : match.options.teams ? (() => { if (match.winner === null) return 'Draw.'; const champ = match.fighters[match.winner]!; const team = hillTeamOfSlot(champ.seatId ?? match.winner); return `${HILL_TEAM_NAMES[team]} TEAM wins.`; })() : match.winner === null ? 'Draw.' : `${match.fighters[match.winner]!.content.profile.name} wins.`, banner: match.frame < this.bannerUntil ? this.banner : '', winnerSlot: match.winner, onettWarning: !!match.onett && match.onett.warning > 0 && match.phase === 'playing', rouletteIn: view.roulette && !this.online && match.phase === 'playing' ? Math.max(0, Math.ceil((this.rouletteNext - match.frame) / 60)) : null,
      hill: match.hill && match.options.hill ? { teams: match.options.teams, zones: match.hill.zones.map((zone, index) => ({ id: zone.id, holder: match.hill!.holders[index] ?? null, claims: hillClaims(match.hill!, index).map(claim => ({ slot: claim.slot, progress: Math.min(1, claim.progress / HILL_CAPTURE_FRAMES) })) })), points: match.hill.points.map(point => point ?? 0), teamPoints: [...match.hill.teamPoints], relocateIn: match.hill.relocateIn, winningTeam: match.options.teams ? hillWinningTeam(match.hill) : null } : null,
      fighters: match.fighters.map((fighter, dense) => {
        const control = match.controllerKinds[dense]!, seatId = fighter.seatId ?? dense, cpu = control === 'cpu';
        const own = !cpu && (this.online ? dense === this.onlineLocalSlot : humanCount === 1);
        const position = renderer.labelPosition(fighter.x, fighter.y);
        const customStatus = customCharacter(fighter.content.profile.kind)?.status?.(fighter);
        return { kind: fighter.content.profile.kind, costume: fighter.content.costume ?? 0, seatId, control, ...(cpu ? { level: match.cpuLevels[dense] } : {}), name: fighter.content.profile.name, label: cpu ? 'CPU' : own ? 'YOU' : `PLAYER ${seatId + 1}`, tag: cpu ? `CPU${seatId + 1}` : own ? 'YOU' : `P${seatId + 1}`, percent: Math.floor(fighter.percent), stocks: fighter.stocks, nana: fighter.nana ? { active: fighter.nana.active, percent: Math.floor(fighter.nana.percent) } : null, hillPoints: match.hill?.points[dense] ?? 0, team: match.options.teams ? hillTeamOfSlot(seatId) : null, infected: fighter.infected, kos: fighter.kos, falls: fighter.falls, damage: Math.floor(fighter.damageDealt), shield: Math.max(0, fighter.combat.shield), charge: fighter.content.profile.kind === 'Ss' ? fighter.samusCharge : fighter.smash?.frames ?? 0, chargeMax: fighter.content.profile.kind === 'Ss' ? 7 : fighter.smash?.maxFrames ?? 60, charging: fighter.content.profile.kind === 'Ss' ? fighter.samusCharge > 0 || fighter.special?.direction === 'neutral' : fighter.smash?.phase === 'charging', position: { ...position, visible: position.visible && fighter.state !== 'ko' },
          combat: fighter.poison ? 'POISONED ☠' : customStatus ? customStatus : fighter.smash?.phase === 'charging' ? `CHARGE ${fighter.smash.frames}/${fighter.smash.maxFrames}` : fighter.state === 'walk' ? 'WALKING' : fighter.state === 'captured' ? 'MASH TO ESCAPE' : inhaleHoldActive(fighter) ? 'QUICK: SPIT · SPECIAL/DOWN: SWALLOW' : fighter.state === 'holding' ? 'DIRECTION TO THROW' : fighter.state === 'ledge' ? 'HANGING' : fighter.state === 'dizzy' ? 'DIZZY · MASH' : fighter.state === 'bury' ? 'BURIED · MASH' : fighter.state === 'shield' ? `SHIELD ${Math.ceil(fighter.combat.shield)}` : fighter.copyAbility ? `COPY · ${(match.content.roster.get(fighter.copyAbility)?.profile.name ?? fighter.copyAbility).toUpperCase()}` : '' };
      }),
    });
    const entries = match.groundLossLog.map((entry) => ({ ...entry }));
    const previous = this.fallLog.getSnapshot().entries;
    if (entries.length !== previous.length || entries.some((entry, index) => entry.frame !== previous[index]?.frame || entry.player !== previous[index]?.player || entry.floor !== previous[index]?.floor || entry.reason !== previous[index]?.reason)) this.fallLog.set({ entries });
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.onlineAbort?.(); this.abort.abort(); cancelAnimationFrame(this.frameRequest);
    this.perf.dispose(); delete window.smashPerf;
    this.pauseControls?.dispose(); this.input?.dispose(); this.renderer?.dispose(); this.audio.dispose(); this.menu?.dispose();
    delete window.smashEffectsSnapshot; delete window.smashMatchSnapshot; delete window.smashSummonPokemon; delete window.smashFallLog; delete window.smashSetupSnapshot; delete window.smashAudioSnapshot; delete window.smashMenuSnapshot; delete window.smashAssetSnapshot;
    delete document.body.dataset.gameReady; delete document.body.dataset.gamePhase; this.ui.clear(); this.hud.clear(); this.fallLog.clear();
  }
}
declare global { interface Window {
  smashMatchSnapshot?: () => (ReturnType<LocalMatch['snapshot']> & { paused: boolean; stage: string; stageFloors: number }) | null;
  smashSummonPokemon?: (slot: number | null, x?: number, owner?: number | null) => number | null;
  smashFallLog?: () => Array<ReturnType<LocalMatch['snapshot']>['groundLoss'][number] & { text: string }> | null;
  smashSetupSnapshot?: () => { mode: PlayView['mode']; scene: Scene; activeSeat: number; setup: BattleSetup };
  smashEffectsSnapshot?: () => (import('../render/common-effects.ts').CommonEffects['stats'] & {stadiumCaptures:number;graphics:GraphicsQuality;pixelRatio:number;particleLimit:number|null;warnings:readonly string[];koBeams:number;koParticles:number;koWarnings:readonly string[];shake:{x:number;y:number};shakeLevel:CameraShakeLevel;camMode:'focus'|'crowd'|'classic'|'none';camFocus:number|null;camDistance:number;camFallback:boolean;camDetail:string;effects:readonly VisualEffectId[];frame:{frames:number;p50:number;p95:number;avgSimMs:number;avgRenderMs:number;saturatedStreak:number;skipLevel:0|1|2;fps:number}}) | null;
  smashAudioSnapshot?: () => { played: number; unavailable: number; lastError: string; recentIds: number[] };
  smashMemorySnapshot?: () => ByteCensus;
  smashAssetSnapshot?: () => { roster: string[]; stages: string[]; costumes: string[]; queued: string[]; loadingStages: string[]; failedStages: string[]; pendingStart: boolean };
  smashMenuSnapshot?: () => (MenuAudio['stats'] & { musicMuted: boolean; sfxMuted: boolean; musicVolume: number; masterVolume: number }) | null;
} }
