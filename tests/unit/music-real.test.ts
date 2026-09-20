import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDisc } from '../../scripts/node-disc.ts';
import { verifyMeleeDisc } from '../../lib/disc.ts';
import { HsdAssetSession } from '../../lib/hsd/session.ts';
import { decodeHps, MUSIC_TRACKS, type MusicId } from '../../lib/game/music.ts';
import { loadGameStage, selectGameStage, type GameContent } from '../../lib/game/load.ts';
import { GameSoundLibrary, SemTable, SsmBank } from '../../lib/game/audio.ts';
import { MENU_SOUND_IDS, MenuAudio, MAX_DECODED_TRACKS } from '../../web/src/menu-audio.ts';
import { SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

const iso = process.env.MELEE_DISC_PATH;
describe.skipIf(!iso)('private original music and selectable stage assets', () => {
  let disc: Awaited<ReturnType<typeof openDisc>>, session: HsdAssetSession, reads = 0;
  beforeAll(async () => {
    disc = await openDisc(iso!);
    session = new HsdAssetSession({ size: disc.size, read: (offset, length) => { reads++; return disc.read(offset, length); } }, await verifyMeleeDisc(disc));
  });
  afterAll(async () => { await disc?.close(); });
  it.each([
    ['menu', 1824051, 229376], ['battlefield', 2751848, 344064], ['final', 2860032, 172032],
    ['yoshi-story', 3801811, 458752], ['dream-land', 2170736, 114688], ['peach-castle', 2877879, 745472],
    ['onett', 3687504, 286720], ['mute-city', 3392121, 401408], ['yoshi-island', 1734331, 573440],
    ['green-greens', 3264148, 516096], ['venom', 2014466, 401408], ['jungle-japes', 7001839, 802816],
    ['fourside', 3783434, 401408], ['brinstar', 5718056, 802816], ['kongo-jungle', 6169270, 860160],
    ['fountain-of-dreams', 5199068, 401408], ['mushroom-kingdom', 2874657, 114688],
  ] as const)('decodes %s with original sample count and loop boundary', async (id, samples, loopStart) => {
    const pcm = decodeHps(await session.bytes(MUSIC_TRACKS[id]));
    expect(pcm.rate).toBe(32000); expect(pcm.channels.map(c => c.length)).toEqual([samples, samples]);
    expect(pcm.loop).toBe(true); expect(pcm.loopStart).toBe(loopStart);
    expect(pcm.channels[0]!.some(value => Math.abs(value) > 1000)).toBe(true);
  });
  it('resolves audible menu cues and genuine Fox/Mario narrator samples', async () => {
    const library = new GameSoundLibrary(new SemTable(await session.bytes('audio/us/smash2.sem')),
      [new SsmBank(await session.bytes('audio/us/main.ssm')), new SsmBank(await session.bytes('audio/us/nr_name.ssm'))]);
    expect(library.cues(MENU_SOUND_IDS.fox)[0]?.sample).toBe(1481);
    expect(library.cues(MENU_SOUND_IDS.mario)[0]?.sample).toBe(1497);
    // CKIND-keyed announcer table (gm_80168C5C): Kirby is 0x7C83F (not G&W's 0x7C83A),
    // plus the five clone calls. Each resolves to its own contiguous bank sample.
    expect(library.cues(MENU_SOUND_IDS.kirby)[0]?.sample).toBe(1491);
    expect(library.cues(MENU_SOUND_IDS.falco)[0]?.sample).toBe(1480);
    expect(library.cues(MENU_SOUND_IDS.drmario)[0]?.sample).toBe(1478);
    expect(library.cues(MENU_SOUND_IDS.ganon)[0]?.sample).toBe(1482);
    expect(library.cues(MENU_SOUND_IDS.marth)[0]?.sample).toBe(1498);
    expect(library.cues(MENU_SOUND_IDS.pichu)[0]?.sample).toBe(1504);
    expect(library.cues(MENU_SOUND_IDS.luigi)[0]?.sample).toBe(1496);
    expect(library.cues(MENU_SOUND_IDS.iceclimbers)[0]?.sample).toBe(1487);
    expect(library.cues(MENU_SOUND_IDS.zelda)[0]?.sample).toBe(1509);
    expect(library.cues(MENU_SOUND_IDS.sheik)[0]?.sample).toBe(1508);
    expect(library.cues(MENU_SOUND_IDS.gamewatch)[0]?.sample).toBe(1486);
    expect(library.cues(MENU_SOUND_IDS.yoshi)[0]?.sample).toBe(1507);
    for (const id of Object.values(MENU_SOUND_IDS)) {
      const cues = library.cues(id); expect(cues.length).toBeGreaterThan(0);
      for (const cue of cues) {
        expect(cue.gain).toBeGreaterThan(0);
        expect(library.sample(cue.sample)!.channels[0]!.some(value => Math.abs(value) > 100)).toBe(true);
      }
    }
  });
  it('prepares only menu music/SFX before gesture, stage tracks on demand, and never refetches prepared transitions', async () => {
    const audio = new MenuAudio(session);
    try {
      await audio.prepare();
      expect(audio.stats.prepared).toEqual(['menu']); expect(audio.stats.sfxReady).toBe(true);
      for (const id of ['battlefield', 'final', 'corneria'] as MusicId[]) await audio.setMusic(id);
      expect(audio.stats.prepared).toEqual(['menu', 'battlefield', 'final', 'corneria']);
      const count = reads;
      for (const id of ['menu', 'battlefield', 'final', 'corneria', 'menu'] as MusicId[]) await audio.setMusic(id);
      audio.play('fox'); audio.play('mario'); expect(reads).toBe(count);
      await audio.prepare(); expect(reads).toBe(count);
      // A fifth track evicts the least recently prepared stage track, never the menu or the new one.
      await audio.setMusic('dream-land');
      expect(audio.stats.prepared).toHaveLength(MAX_DECODED_TRACKS);
      expect(audio.stats.prepared).toEqual(expect.arrayContaining(['menu', 'dream-land']));
      expect(audio.stats.prepared).not.toContain('battlefield');
    } finally { audio.dispose(); }
    expect(audio.stats.prepared).toEqual([]);
  });
  it('loads both model AND collision; returns new selection with existing resources', async () => {
    const battlefield = await loadGameStage(session, 'battlefield');
    const content = { ...battlefield, fighters: [], physics: {}, sound: {}, roster: new Map() } as unknown as GameContent;
    const final = await selectGameStage(content, session, 'final');
    expect(final.stageId).toBe('final'); expect(final.stageModel).not.toBe(content.stageModel);
    expect(final.stage.floors).toHaveLength(3); expect(final.stage.floors.every(f => !f.oneWay)).toBe(true);
    expect(content.stage.floors.some(f => f.oneWay)).toBe(true);
    expect(final.stage.mainRight).toBeCloseTo(85.5657); expect(content.stage.mainRight).toBeCloseTo(68.4);
    expect(final.stage.ledges).toHaveLength(2); expect(final.stage.spawns).toHaveLength(4);
    expect(final.fighters).toBe(content.fighters); expect(final.physics).toBe(content.physics); expect(final.sound).toBe(content.sound);
    expect(await selectGameStage(final, session, 'final')).toBe(final);
  });
  it('uses only exact allowlisted stage/audio resources', async () => {
    for (const path of [...Object.values(MUSIC_TRACKS), 'audio/us/nr_name.ssm', 'GrNBa.dat', 'GrNLa.dat']) expect(SERVER_ASSETS).toContain(path);
    expect(SERVER_ASSETS).not.toContain('audio/us/nr_title.ssm'); expect(SERVER_ASSETS).not.toContain('audio/swm_15min.hps');
    await expect(loadGameStage(session, 'yoshi' as never)).rejects.toThrow('Unsupported');
  });
});
