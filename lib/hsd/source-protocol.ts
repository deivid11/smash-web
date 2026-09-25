import { ACE_20, MELEE_102, type DiscEntry } from '../disc.ts';

/** The server exposes these viewer inputs only, never a general ISO reader. */
export const VIEWER_ASSETS = [
  'GrNBa.dat', 'GrNLa.dat', 'GrSt.dat', 'GrCn.dat', 'GrSh.dat', 'GrPs.dat', 'GrPs1.dat', 'GrPs2.dat', 'GrPs3.dat', 'GrPs4.dat', 'TyMario.dat',
  'GrOp.dat', 'GrCs.dat', 'GrOt.dat', 'GrMc.dat', 'GrYt.dat', 'GrGr.dat', 'GrVe.dat', 'GrGd.dat', 'GrFs.dat',
  'GrZe.dat', 'GrOk.dat', 'GrIz.dat', 'GrI1.dat',
  'PlFxNr.dat', 'PlMrNr.dat', 'PlKbNr.dat', 'PlFx.dat', 'PlMr.dat', 'PlKb.dat', 'PlFxAJ.dat', 'PlMrAJ.dat', 'PlKbAJ.dat',
  'PlSsNr.dat', 'PlSs.dat', 'PlSsAJ.dat',
  'PlPkNr.dat', 'PlPk.dat', 'PlPkAJ.dat',
  'PlFeNr.dat', 'PlFe.dat', 'PlFeAJ.dat',
  'PlMtNr.dat', 'PlMt.dat', 'PlMtAJ.dat',
  'PlLkNr.dat', 'PlLk.dat', 'PlLkAJ.dat',
  'PlCaNr.dat', 'PlCa.dat', 'PlCaAJ.dat',
  'PlDkNr.dat', 'PlDk.dat', 'PlDkAJ.dat',
  'PlClNr.dat', 'PlCl.dat', 'PlClAJ.dat',
  'PlPrNr.dat', 'PlPr.dat', 'PlPrAJ.dat',
  'PlNsNr.dat', 'PlNs.dat', 'PlNsAJ.dat',
  'PlKpNr.dat', 'PlKp.dat', 'PlKpAJ.dat',
  'PlPeNr.dat', 'PlPe.dat', 'PlPeAJ.dat',
  'PlFcNr.dat', 'PlFc.dat', 'PlFcAJ.dat',
  'PlDrNr.dat', 'PlDr.dat', 'PlDrAJ.dat',
  'PlGnNr.dat', 'PlGn.dat', 'PlGnAJ.dat',
  'PlPcNr.dat', 'PlPc.dat', 'PlPcAJ.dat',
  'PlMsNr.dat', 'PlMs.dat', 'PlMsAJ.dat',
  'PlLgNr.dat', 'PlLg.dat', 'PlLgAJ.dat',
  'PlPpNr.dat', 'PlPp.dat', 'PlPpAJ.dat',
  'PlNnNr.dat',
  'PlZdNr.dat', 'PlZd.dat', 'PlZdAJ.dat',
  'PlSkNr.dat', 'PlSk.dat', 'PlSkAJ.dat',
  'PlGwNr.dat', 'PlGw.dat', 'PlGwAJ.dat',
  'PlYsNr.dat', 'PlYs.dat', 'PlYsAJ.dat',
] as const;
/** Alternate original costumes (`Pl<kind><suffix>.dat`): every entry verified
 * present on the USA v1.02 disc. Skins are visual-only (shared skeletons,
 * scripts and articles); Zelda/Sheik share the same five-suffix order so a
 * Transform keeps the costume index. Game & Watch ships one model. */
export const COSTUME_ASSETS = [
  'PlFxGr.dat', 'PlFxLa.dat', 'PlFxOr.dat',
  'PlMrBk.dat', 'PlMrBu.dat', 'PlMrGr.dat', 'PlMrYe.dat',
  'PlKbRe.dat', 'PlKbBu.dat', 'PlKbGr.dat', 'PlKbYe.dat', 'PlKbWh.dat',
  'PlSsBk.dat', 'PlSsGr.dat', 'PlSsLa.dat', 'PlSsPi.dat',
  'PlPkRe.dat', 'PlPkBu.dat', 'PlPkGr.dat',
  'PlMtRe.dat', 'PlMtBu.dat', 'PlMtGr.dat',
  'PlFeRe.dat', 'PlFeBu.dat', 'PlFeGr.dat', 'PlFeYe.dat',
  'PlLkRe.dat', 'PlLkBu.dat', 'PlLkBk.dat', 'PlLkWh.dat',
  'PlCaRe.dat', 'PlCaBu.dat', 'PlCaGr.dat', 'PlCaWh.dat', 'PlCaGy.dat',
  'PlDkRe.dat', 'PlDkBu.dat', 'PlDkGr.dat', 'PlDkBk.dat',
  'PlClRe.dat', 'PlClBu.dat', 'PlClBk.dat', 'PlClWh.dat',
  'PlPrRe.dat', 'PlPrBu.dat', 'PlPrGr.dat', 'PlPrYe.dat',
  'PlNsBu.dat', 'PlNsGr.dat', 'PlNsYe.dat',
  'PlKpRe.dat', 'PlKpBu.dat', 'PlKpBk.dat',
  'PlPeBu.dat', 'PlPeGr.dat', 'PlPeYe.dat', 'PlPeWh.dat',
  'PlFcRe.dat', 'PlFcBu.dat', 'PlFcGr.dat',
  'PlDrRe.dat', 'PlDrBu.dat', 'PlDrGr.dat', 'PlDrBk.dat',
  'PlGnRe.dat', 'PlGnBu.dat', 'PlGnGr.dat', 'PlGnLa.dat',
  'PlPcRe.dat', 'PlPcBu.dat', 'PlPcGr.dat',
  'PlMsRe.dat', 'PlMsGr.dat', 'PlMsBk.dat', 'PlMsWh.dat',
  'PlLgWh.dat', 'PlLgPi.dat', 'PlLgAq.dat',
  'PlPpRe.dat', 'PlPpGr.dat', 'PlPpOr.dat',
  'PlNnAq.dat', 'PlNnWh.dat', 'PlNnYe.dat',
  'PlZdRe.dat', 'PlZdBu.dat', 'PlZdGr.dat', 'PlZdWh.dat',
  'PlSkRe.dat', 'PlSkBu.dat', 'PlSkGr.dat', 'PlSkWh.dat',
  'PlYsRe.dat', 'PlYsBu.dat', 'PlYsYe.dat', 'PlYsPi.dat', 'PlYsAq.dat',
] as const;
/* Per-character effect banks and SSM voice banks; Kirby's roster copy-ability archives (PlKbCp*.dat)
 * are exposed while non-roster hats and EfKb* variant banks stay unexposed. */
export const SPECIAL_ASSETS = ['EfPrData.dat', 'audio/us/purin.ssm', 'EfNsData.dat', 'audio/us/ness.ssm', 'EfKpData.dat', 'audio/us/koopa.ssm', 'EfPeData.dat', 'audio/us/peach.ssm', 'EfFeData.dat', 'audio/us/emblem.ssm', 'EfCaData.dat', 'audio/us/captain.ssm', 'EfDkData.dat', 'audio/us/dk.ssm','EfPkData.dat', 'audio/us/pikachu.ssm', 'EfMtData.dat', 'audio/us/mewtwo.ssm', 'EfSsData.dat', 'audio/us/samus.ssm', 'EfLkData.dat', 'audio/us/link.ssm', 'audio/us/clink.ssm', 'EfFxData.dat', 'EfMrData.dat', 'EfKbData.dat', 'EfGnData.dat', 'EfMsData.dat', 'EfLgData.dat', 'EfIcData.dat', 'EfZdData.dat', 'EfYsData.dat', 'PlKbCpFx.dat', 'PlKbCpMr.dat', 'PlKbCpLk.dat', 'PlKbCpCl.dat', 'PlKbCpSs.dat', 'PlKbCpPk.dat', 'PlKbCpCa.dat', 'PlKbCpDk.dat', 'PlKbCpMt.dat', 'PlKbCpFe.dat', 'audio/us/smash2.sem', 'audio/us/main.ssm', 'audio/us/fox.ssm', 'audio/us/mario.ssm', 'audio/us/kirby.ssm', 'audio/us/falco.ssm', 'audio/us/drmario.ssm', 'audio/us/ganon.ssm', 'audio/us/pichu.ssm', 'audio/us/mars.ssm', 'audio/us/luigi.ssm', 'audio/us/ice.ssm', 'audio/us/zs.ssm', 'audio/us/gw.ssm', 'audio/us/yoshi.ssm', 'audio/us/onett.ssm'] as const;
/** Exact original menu/stage music and character announcements; no wildcard audio access. */
export const MENU_AUDIO_ASSETS = ['audio/menu01.hps', 'audio/sp_zako.hps', 'audio/sp_end.hps', 'audio/corneria.hps', 'audio/shrine.hps', 'audio/pokesta.hps', 'audio/ystory.hps', 'audio/old_kb.hps', 'audio/castle.hps', 'audio/onetto.hps', 'audio/mutecity.hps', 'audio/yorster.hps', 'audio/greens.hps', 'audio/venom.hps', 'audio/garden.hps', 'audio/fourside.hps', 'audio/zebes.hps', 'audio/kongo.hps', 'audio/izumi.hps', 'audio/inis1_01.hps', 'audio/us/nr_name.ssm'] as const;
/** One exact common-effect bank for the native KO beam plus the common item archive
 * (ItCo.dat: itPublicData tuning/articles for match items); never wildcard disc access. */
export const SERVER_ASSETS = [...VIEWER_ASSETS, ...COSTUME_ASSETS, 'PlCo.dat', 'EfCoData.dat', 'ItCo.dat', ...SPECIAL_ASSETS, ...MENU_AUDIO_ASSETS] as const;
/** Zero (ACE 2.0 modded build): the only assets a registered extension disc may expose.
 * They ride the same named-range transport; there is still no wildcard access.
 * Wave 2 adds Wolf/Diddy/Dedede/Wario/Shadow with their effect banks and voice banks. */
/** Exposed ACE names that live on the extension disc under another path. The ACE
 * `smash2.sem` cannot replace the vanilla one (ACE renumbers the vanilla banks' samples),
 * so it is served beside it for the extension banks only (lib/game/audio.ts). */
export const ACE_ASSET_ALIASES: Readonly<Record<string, string>> = { 'audio/us/smash2.ace.sem': 'audio/us/smash2.sem' };
/** Path of an exposed ACE asset on the extension disc itself. */
export const aceDiscPath = (name: string): string => ACE_ASSET_ALIASES[name] ?? name;
const ACE_BASE_ASSETS = ['audio/us/smash2.ace.sem', 'PlZx.dat', 'PlZxNr.dat', 'PlZxAJ.dat', 'EfZxData.dat', 'audio/us/zero.ssm',
  'PlTd.dat', 'PlTdNr.dat', 'PlTdAJ.dat', 'EfTdData.dat', 'audio/us/toad.ssm',
  'PlMk.dat', 'PlMkNr.dat', 'PlMkAJ.dat', 'EfMkData.dat', 'audio/us/metaknight.ssm',
  'PlSn.dat', 'PlSnNr.dat', 'PlSnAJ.dat', 'EfSnData.dat', 'audio/us/sonic.ssm',
  'PlRc.dat', 'PlRcNr.dat', 'PlRcAJ.dat', 'EfRcData.dat', 'audio/us/raichu.ssm',
  'PlLz.dat', 'PlLzNr.dat', 'PlLzAJ.dat', 'EfLzData.dat', 'audio/us/lizardon.ssm',
  'PlWf.dat', 'PlWfNr.dat', 'PlWfAJ.dat', 'EfWfData.dat', 'audio/us/wolf.ssm',
  'PlDd.dat', 'PlDdNr.dat', 'PlDdAJ.dat', 'EfDdData.dat', 'audio/us/diddy.ssm',
  'PlDe.dat', 'PlDeNr.dat', 'PlDeAJ.dat', 'EfDeData.dat', 'audio/us/dedede.ssm',
  'PlWr.dat', 'PlWrNr.dat', 'PlWrAJ.dat', 'EfWrData.dat', 'audio/us/wario.ssm',
  'PlSh.dat', 'PlShNr.dat', 'PlShAJ.dat', 'EfShData.dat', 'audio/us/shadow.ssm',
  'PlBl.dat', 'PlBlNr.dat', 'PlBlAJ.dat', 'EfBlData.dat', 'audio/us/blastoise.ssm',
  'PlLc.dat', 'PlLcNr.dat', 'PlLcAJ.dat', 'EfLcData.dat', 'audio/us/lucas.ssm',
  'PlNm.dat', 'PlNmNr.dat', 'PlNmAJ.dat', 'EfNmData.dat', 'audio/us/metal_sonic.ssm',
  'PlNt.dat', 'PlNtNr.dat', 'PlNtAJ.dat', 'EfNtData.dat', 'audio/us/ninten.ssm',
  'PlDa.dat', 'PlDaNr.dat', 'PlDaAJ.dat', 'audio/us/daisy.ssm',
  'PlFy.dat', 'PlFyNr.dat', 'PlFyAJ.dat', 'audio/us/fay.ssm',
  'PlSc.dat', 'PlScNr.dat', 'PlScAJ.dat', 'EfScData.dat', 'audio/us/bmsonic.ssm',
  'PlDl.dat', 'PlDlNr.dat', 'PlDlAJ.dat', 'audio/us/drluigi.ssm',
  'PlKx.dat', 'PlKxNr.dat', 'PlKxAJ.dat', 'EfKxData.dat', 'audio/us/knuckles.ssm',
  'PlLu.dat', 'PlLuNr.dat', 'PlLuAJ.dat', 'audio/us/lucina.ssm',
  'PlLc2.dat', 'PlLc2Nr.dat', 'PlLc2AJ.dat', 'EfLc2Data.dat', 'audio/us/lucas_001.ssm',
  'PlSm.dat', 'PlSmNr.dat', 'PlSmAJ.dat', 'audio/us/smewtwo.ssm',
  'PlLb.dat', 'PlLbNr.dat', 'PlLbAJ.dat', 'audio/us/luigiandboo.ssm',
  'PlMM.dat', 'PlMMNr.dat', 'PlMMAJ.dat',
  'PlSd.dat', 'PlSdNr.dat', 'PlSdAJ.dat', 'audio/us/skullkid.ssm',
  'PlCn.dat', 'PlCnNr.dat', 'PlCnAJ.dat', 'audio/us/chun-li.ssm',
  'PlGk.dat', 'PlGkNr.dat', 'PlGkAJ.dat', 'audio/us/gkoopa.ssm',
  // Wave 8: Tails, Blood Falcon (PlCa.dat clone: only his models/effects are ACE
  // files) and Wolf SSBU (the formerly excluded U/UAJ moveset with the _001
  // models and the rebased wolf_001 bank).
  'PlTs.dat', 'PlTsNr.dat', 'PlTsAJ.dat', 'EfTsData.dat', 'audio/us/tails.ssm',
  'PlBfNr.dat', 'EfBfData.dat',
  'PlWfU.dat', 'PlWfUAJ.dat', 'PlWfNr_001.dat', 'audio/us/wolf_001.ssm'] as const;
/** Alternate ACE 2.0 costumes: every entry verified present on ace-2.0.iso.
 * Skins are visual-only (shared skeletons, scripts and articles). Excluded:
 * anims (*AJ/*DViWaitAJ), *HUD art, trophy stubs (SmTr1/3/5), Toad Et/Fire/
 * Ice/Wt forms, Sonic Sw2, Raichu Cp/Lt, Charizard Sh, Meta Knight Dark
 * (pre-existing boundary). Wolf's _001 skins dress the Wolf SSBU slot and
 * PlGkRe/Ye/Wh dress Giga Bowser (wave 8). */
export const ACE_COSTUME_ASSETS = [
  'PlZxBk.dat', 'PlZxBu.dat', 'PlZxGr.dat', 'PlZxPu.dat', 'PlZxWh.dat',
  'PlTdBu.dat', 'PlTdGr.dat', 'PlTdRe.dat', 'PlTdYe.dat',
  'PlMkBk.dat', 'PlMkGk.dat', 'PlMkGr.dat', 'PlMkMr.dat', 'PlMkWh.dat',
  'PlSnBk.dat', 'PlSnGr.dat', 'PlSnOr.dat', 'PlSnRe.dat', 'PlSnWh.dat', 'PlSnYe.dat',
  'PlRcBk.dat', 'PlRcBu.dat', 'PlRcGr.dat', 'PlRcRe.dat', 'PlRcWh.dat',
  'PlLzBu.dat', 'PlLzGr.dat', 'PlLzLa.dat', 'PlLzRe.dat', 'PlLzYe.dat',
  'PlWfBr.dat', 'PlWfBu.dat', 'PlWfGr.dat', 'PlWfRd.dat', 'PlWfYe.dat',
  'PlDdBu.dat', 'PlDdGr.dat', 'PlDdPi.dat', 'PlDdWh.dat', 'PlDdYe.dat',
  'PlDeBk.dat', 'PlDeBu.dat', 'PlDeGr.dat', 'PlDeMa.dat', 'PlDeOr.dat', 'PlDePi.dat', 'PlDeSh.dat', 'PlDeWh.dat',
  'PlWrAq.dat', 'PlWrBr.dat', 'PlWrGr.dat', 'PlWrLa.dat', 'PlWrPi.dat', 'PlWrRe.dat', 'PlWrWh.dat',
  'PlShBl.dat', 'PlShGn.dat', 'PlShMg.dat', 'PlShMp.dat', 'PlShTr.dat', 'PlShYl.dat',
  'PlBlBu.dat', 'PlBlGr.dat', 'PlBlLa.dat', 'PlBlRe.dat', 'PlBlYe.dat',
  'PlLcBk.dat', 'PlLcBu.dat', 'PlLcGr.dat', 'PlLcOr.dat', 'PlLcPi.dat', 'PlLcRe.dat',
  'PlNmBk.dat', 'PlNmGr.dat', 'PlNmGy.dat', 'PlNmRe.dat', 'PlNmYe.dat',
  'PlNtAq.dat', 'PlNtBu.dat', 'PlNtGr.dat', 'PlNtPu.dat', 'PlNtRe.dat',
  'PlDaBk.dat', 'PlDaBu.dat', 'PlDaGr.dat', 'PlDaLa.dat', 'PlDaPi.dat', 'PlDaRe.dat', 'PlDaTn.dat', 'PlDaWh.dat',
  'PlFyBu.dat', 'PlFyGr.dat', 'PlFyRe.dat',
  'PlScBk.dat', 'PlScGr.dat', 'PlScRe.dat', 'PlScWe.dat', 'PlScWh.dat',
  'PlDlAq.dat', 'PlDlBk.dat', 'PlDlGr.dat', 'PlDlPi.dat', 'PlDlYe.dat',
  'PlKxBk.dat', 'PlKxBl.dat', 'PlKxCy.dat', 'PlKxGr.dat', 'PlKxOg.dat', 'PlKxPr.dat', 'PlKxTk.dat', 'PlKxWh.dat', 'PlKxWr.dat', 'PlKxYe.dat',
  'PlLuBk.dat', 'PlLuGr.dat', 'PlLuMs.dat', 'PlLuRe.dat', 'PlLuWh.dat', 'PlLuYe.dat',
  'PlLc2Bu.dat', 'PlLc2Cl.dat', 'PlLc2Gr.dat', 'PlLc2La.dat', 'PlLc2Or.dat', 'PlLc2Re.dat',
  'PlSmBr.dat', 'PlSmBu.dat', 'PlSmGr.dat', 'PlSmIv.dat', 'PlSmLa.dat', 'PlSmRe.dat',
  'PlLbAq.dat', 'PlLbPi.dat', 'PlLbSt.dat', 'PlLbWh.dat',
  'PlMMBu.dat', 'PlMMCr.dat', 'PlMMCy.dat', 'PlMMGr.dat', 'PlMMPu.dat', 'PlMMRb.dat', 'PlMMRe.dat', 'PlMMYe.dat',
  'PlSdBu.dat', 'PlSdGr.dat', 'PlSdPu.dat', 'PlSdWh.dat',
  'PlTsRe.dat', 'PlTsBu.dat', 'PlTsGr.dat', 'PlTsBk.dat', 'PlTsWh.dat', 'PlTsPr.dat',
  'PlBfBu.dat', 'PlBfGr.dat', 'PlBfYe.dat', 'PlBfPu.dat',
  'PlWfBu_001.dat', 'PlWfGr_001.dat', 'PlWfYe_001.dat', 'PlWfBr_001.dat', 'PlWfRd_001.dat',
  'PlGkRe.dat', 'PlGkYe.dat', 'PlGkWh.dat',
] as const;
export const ACE_ASSETS = [...ACE_BASE_ASSETS, ...ACE_COSTUME_ASSETS] as const;
export const MAX_ASSET_RESPONSE_BYTES = 16 * 1024 * 1024;

/** One exposed asset. `sha256` (lowercase hex of the whole file) lets clients cache
 * and version each asset by content: unchanged files survive disc/identity changes
 * and whole-file downloads are verified. Optional for older servers. */
export type SourceFile = DiscEntry & { sha256?: string; /** Served asset name when it differs from `path` (a look layer). */ asset?: string };
/** Optional cosmetic layer (see lib/hsd/looks.ts): alternate bytes for allowlisted assets, served
 * as `look/<id>/<path>` and addressed in the look disc's own space (0..discSize). */
export interface SourceLook { id: string; name: string; discSize: number; files: SourceFile[] }
export const lookAssetName = (id: string, path: string): string => `look/${id}/${path}`;
export interface SourceManifest {
  version: 1;
  mode: 'server';
  gameId: string;
  revision: number;
  title: string;
  discSize: number;
  executableSha1: string;
  files: SourceFile[];
  /** Registered extension disc (ACE 2.0). Its assets are listed in `files` with offsets
   * rebased past the vanilla disc, so one flat reader address space serves both discs. */
  modded?: { id: string; executableSha1: string; discSize: number };
  /** Host-vetted cosmetic layers a player may pick; the file table above stays the original disc. */
  looks?: SourceLook[];
}

/** Every asset the host serves, by request name: the disc table plus each look's `look/<id>/…` files. */
export function servedAssets(manifest: SourceManifest): SourceFile[] {
  return [...manifest.files, ...(manifest.looks ?? []).flatMap((look) => look.files.map((file) => ({ ...file, path: lookAssetName(look.id, file.path) })))];
}

/** The manifest a session reads with look `id` applied: its files replace the same-named entries,
 * rebased past the disc so one flat reader address space covers both, and fetched by look name.
 * Identity, fingerprints and caches keep using the original manifest. */
export function applyLook(manifest: SourceManifest, id: string | null): SourceManifest {
  const look = id === null ? undefined : manifest.looks?.find((entry) => entry.id === id);
  if (!look) return manifest;
  const swaps = new Map(look.files.map((file) => [file.path, file]));
  return {
    ...manifest, discSize: manifest.discSize + look.discSize,
    files: manifest.files.map((file) => {
      const swap = swaps.get(file.path);
      return swap ? { path: file.path, offset: manifest.discSize + swap.offset, size: swap.size, ...(swap.sha256 ? { sha256: swap.sha256 } : {}), asset: lookAssetName(look.id, file.path) } : file;
    }),
  };
}

function parseLooks(value: unknown, names: ReadonlySet<string>): SourceLook[] {
  if (!Array.isArray(value) || value.length > 4) throw new Error('Invalid look list in server manifest.');
  const ids = new Set<string>();
  return value.map((entry: Partial<SourceLook> | null) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-z0-9-]{1,32}$/u.test(entry.id) || ids.has(entry.id) ||
        typeof entry.name !== 'string' || !entry.name || entry.name.length > 64 || !Number.isSafeInteger(entry.discSize) || entry.discSize! <= 0 ||
        !Array.isArray(entry.files) || !entry.files.length || entry.files.length > names.size) {
      throw new Error('Invalid look in server manifest.');
    }
    ids.add(entry.id);
    const paths = new Set<string>();
    for (const file of entry.files) {
      // A look only replaces assets the disc table already exposes, and every file is content-addressed.
      if (!file || !names.has(file.path) || paths.has(file.path) || file.asset !== undefined ||
          !Number.isSafeInteger(file.offset) || !Number.isSafeInteger(file.size) || file.offset < 0 || file.size <= 0 ||
          file.offset > entry.discSize! || file.size > entry.discSize! - file.offset ||
          typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
        throw new Error('Invalid look asset entry in server manifest.');
      }
      paths.add(file.path);
    }
    return entry as SourceLook;
  });
}

export function parseSourceManifest(value: unknown): SourceManifest {
  if (!value || typeof value !== 'object') throw new Error('Invalid server disc manifest.');
  const source = value as Partial<SourceManifest>;
  const modded = source.modded;
  if (modded !== undefined && (typeof modded !== 'object' || !modded || modded.id !== ACE_20.id ||
      modded.executableSha1 !== ACE_20.mainDolSha1 || !Number.isSafeInteger(modded.discSize) || modded.discSize <= 0)) {
    throw new Error('Unsupported modded extension disc in server manifest.');
  }
  const maxFiles = SERVER_ASSETS.length + (modded ? ACE_ASSETS.length : 0);
  if (source.version !== 1 || source.mode !== 'server' || source.gameId !== MELEE_102.gameId ||
      source.revision !== MELEE_102.discRevision || source.executableSha1 !== MELEE_102.mainDolSha1 ||
      typeof source.title !== 'string' || source.title.length > 256 ||
      !Number.isSafeInteger(source.discSize) || source.discSize! <= 0 ||
      !Array.isArray(source.files) || source.files.length < VIEWER_ASSETS.length || source.files.length > maxFiles) {
    throw new Error('Unsupported or incomplete server disc manifest.');
  }
  const names = new Set<string>();
  for (const file of source.files) {
    const allowed = SERVER_ASSETS.some((name) => name === file?.path) || (modded !== undefined && ACE_ASSETS.some((name) => name === file?.path));
    if (!file || !allowed || names.has(file.path) || file.asset !== undefined ||
        !Number.isSafeInteger(file.offset) || !Number.isSafeInteger(file.size) || file.offset < 0 ||
        file.size <= 0 || file.offset > source.discSize! || file.size > source.discSize! - file.offset ||
        (file.sha256 !== undefined && (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(file.sha256)))) {
      throw new Error('Invalid asset entry in server disc manifest.');
    }
    names.add(file.path);
  }
  if (!VIEWER_ASSETS.every((name) => names.has(name))) throw new Error('Missing required viewer assets.');
  if (source.looks !== undefined) source.looks = parseLooks(source.looks, names);
  // ACE fighters load optionally (FIGHTER_SPECS `optional`: the loader skips whatever the
  // extension disc does not supply, and chooser portraits gate on the loaded roster), so
  // in-progress declarations whose files are not on the disc yet stay absent instead of
  // bricking the boot for every other stage and fighter. Per-file allowlisting above
  // still constrains every served entry to a declared name.
  return source as SourceManifest;
}
