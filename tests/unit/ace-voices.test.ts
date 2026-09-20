import { describe, expect, it } from 'vitest';
import { ACE_SSM_RANGES, ACE_VOICE_OVERRIDES, resolveAceVoice, type AceVoiceSlot } from '../../lib/game/ace-voices.ts';
import { ACE_ASSETS, SERVER_ASSETS } from '../../lib/hsd/source-protocol.ts';

const SLOTS: AceVoiceSlot[] = ['jump', 'airJump', 'ko'];

describe('ACE voice remap table', () => {
  it('keeps every mapped sample inside its ISO SSM bank range', () => {
    for (const [kind, slots] of Object.entries(ACE_VOICE_OVERRIDES)) {
      const range = ACE_SSM_RANGES[kind];
      expect(range, `${kind} needs an SSM range`).toBeDefined();
      for (const [slot, id] of Object.entries(slots)) {
        expect(id, `${kind}.${slot}`).toBeGreaterThanOrEqual(range!.base);
        expect(id, `${kind}.${slot}`).toBeLessThan(range!.base + range!.count);
      }
    }
  });
  it('only ever replaces the dead 5xxx FtSFX namespace', () => {
    // Vanilla SEM ids, generic bank-0 cues and the 540000 silent sentinel pass through.
    for (const raw of [74, 71, 166, 110070, 180058, 540000, 0, 446, 81, 123]) {
      for (const kind of Object.keys(ACE_VOICE_OVERRIDES)) {
        for (const slot of SLOTS) expect(resolveAceVoice(kind as never, slot, raw)).toBe(raw);
      }
    }
    // Unknown kinds and unmapped slots also pass through.
    expect(resolveAceVoice('Fx' as never, 'jump', 5043)).toBe(5043);
    expect(resolveAceVoice('Zx' as never, 'ko', 110070)).toBe(110070);
  });
  it('maps the documented wave-1 slots into the newly exposed banks', () => {
    expect(resolveAceVoice('Zx' as never, 'jump', 5043)).toBe(2410);
    expect(resolveAceVoice('Td' as never, 'ko', 5079)).toBe(2589);
    expect(resolveAceVoice('Mk' as never, 'airJump', 5052)).toBe(2150);
    expect(resolveAceVoice('Sn' as never, 'ko', 5079)).toBe(1736);
    // Shadow's bank jump2 slot is digital silence: air jump reuses the jump voice.
    expect(resolveAceVoice('Sh' as never, 'airJump', 5061)).toBe(2543);
  });
  it('exposes every mapped bank (including wave 1) on the extension allowlist only', () => {
    for (const [kind, range] of Object.entries(ACE_SSM_RANGES)) {
      const name = `audio/us/${range.file}`;
      expect(ACE_ASSETS, kind).toContain(name);
      expect(SERVER_ASSETS, kind).not.toContain(name);
    }
    for (const name of ['audio/us/zero.ssm', 'audio/us/toad.ssm', 'audio/us/metaknight.ssm', 'audio/us/sonic.ssm', 'audio/us/raichu.ssm', 'audio/us/lizardon.ssm']) {
      expect(ACE_ASSETS).toContain(name); expect(SERVER_ASSETS).not.toContain(name);
    }
  });
});
