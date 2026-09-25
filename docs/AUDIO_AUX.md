# Original AX aux buses (stage echo and reverb)

Match SFX now run through the two effect buses the original game installs. Before this, voices went dry into the browser mix. That is why the echo on Final Destination attacks was missing.

## What the original does

- **Setup.** `lbAudioAx_8002838C` in [third_party/melee/src/melee/lb/lbaudio_ax.c](../third_party/melee/src/melee/lb/lbaudio_ax.c) puts AXFX ReverbStd on aux A (`AXDriver_8038E37C` defaults with `time = 1.88F`: 2 ms pre-delay, damping 0.64, coloration 0.5, mix 1.0). It puts AXFX Delay on aux B with the defaults unchanged: left 260 ms, right 310 ms, 24% feedback, 35% output and a silent surround line.
- **Per-voice mix.** AXDriver in [third_party/melee/src/sysdolphin/baselib/axdriver.c](../third_party/melee/src/sysdolphin/baselib/axdriver.c) mixes each voice with send fractions `a = x26·x24[0]/65535` and `b = x27·x24[1]/65535`. The levels are main `(1−a)·√(1−b)`, aux A `√a` and aux B `√b·√(1−a)`, all after the voice's pan.
- **Aux A (reverb) is set per sound.** SEM script opcodes 16/17 set or adjust `x24[0]`, and opcode 20 sets `x26`. On the US disc, 3131 of the 3507 scripts outside bank 0 carry a send. For example, Fox's move sounds use 20–30 and hit sounds use 4–10.
- **Aux B (echo) is set by the program.** `AXDriver_804D603C = 2` locks aux B, so SEM opcodes 18/19/21 are ignored. `fn_80024654` gives AX channels 7/8 the stage's send, and gives crowd channels 5/6 a fixed `0x20`. Channel 7 carries fighter, item, hit and stage SFX.
- **Per-stage table.** The stage send is column 1 of `s32_arr_803BB6B0` ([lbaudio_ax.static.h](../third_party/melee/src/melee/lb/lbaudio_ax.static.h)), indexed by GrKind:

  | Stage | Send |
  |---|---|
  | Final Destination, Battlefield | `0x38` |
  | Hyrule Temple | `0x18` |
  | Brinstar | `0x40` |
  | Every other ported stage | `0x01` |

## Port

- [lib/game/ax-aux.ts](../lib/game/ax-aux.ts) holds the parameters, the mix law, the stage table and the stage→GrKind map. It also ports `HandleReverb` ([reverb_std.c](../third_party/melee/extern/dolphin/src/dolphin/axfx/reverb_std.c)) to a float32 impulse response at 32 kHz. The port includes the SDK's 63-sample pre-delay ring: its asm wraps one element early.
- [lib/game/audio.ts](../lib/game/audio.ts) `SemTable.cues` records each cue's aux-A send.
- [web/src/audio-mix.ts](../web/src/audio-mix.ts) `createAuxBuses` builds the effects in Web Audio:
  - Aux A is a ConvolverNode with that response, resampled to the context rate.
  - Aux B is the delay ring unrolled into a feed-forward chain down to −80 dB. A Web Audio feedback cycle adds one render quantum per pass in Chromium, which would drift the echo timing.
  - Both returns feed the main mix input, so they share its headroom protection.
- [web/src/play-audio.ts](../web/src/play-audio.ts) splits every voice after its panner into dry, reverb and echo sends. It picks the echo send from the match's stage and the event's AX channel (7 by default, 5/6 for crowd events).

## Tests

- [tests/unit/ax-aux.test.ts](../tests/unit/ax-aux.test.ts) checks the table against the decomp header and each stage's GrKind against the archive its `gr*.c` module loads. It also covers the mix law, the delay's integer setup, the reverb onset and decay, and SEM parsing.
- [tests/unit/ax-aux-real.test.ts](../tests/unit/ax-aux-real.test.ts) checks send levels from the real SEM.
- [tests/browser/aux-buses.spec.ts](../tests/browser/aux-buses.spec.ts) renders the graph offline. At 48 kHz the echoes land at exactly 260/515 ms (left) and 310/615 ms (right) with the original gains. It also checks voice routing on FD, Corneria and a crowd channel.

## Not ported / not claimed

- The stage-specific column-2 switches in `grvenom.c` / `grmutecity.c` (tunnel phases).
- Send changes during a voice's playback: opcode 17 with waits. Gain automation has the same limit.
- Menu SFX (web/src/menu-audio.ts) stay dry.
- The AX DSP's fixed-point mixing, integer truncation of aux buffers, and its 32 kHz resampling.
- Aux-return latency is modeled as one 5 ms AX frame (the amount `AXFXDelaySettings` subtracts). The hardware triple-buffers aux, so the real latency may differ by a frame.

This reproduces the original effect topology and parameters. It does not claim sample-identical GameCube output.
