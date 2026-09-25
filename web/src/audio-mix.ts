import { AUX_RETURN_LATENCY, AX_RATE, delayLine, resampleImpulse, reverbImpulse } from '../../lib/game/ax-aux.ts';

/** Browser headroom protection, not an emulation of the GameCube AX mixer. */
/** `output` (default: the speakers) receives the limited mix, e.g. a master volume gain. */
export function createSoundMix(context: BaseAudioContext, output: AudioNode = context.destination): { input: GainNode; compressor: DynamicsCompressorNode } {
  const input = context.createGain(), compressor = context.createDynamicsCompressor();
  input.gain.value = 0.35;
  compressor.threshold.value = -6; compressor.knee.value = 3; compressor.ratio.value = 20;
  compressor.attack.value = 0.001; compressor.release.value = 0.08;
  input.connect(compressor); compressor.connect(output);
  return { input, compressor };
}

const reverbResponses = new Map<number, Float32Array>();
/** The ReverbStd response at `rate`, computed once per context rate. */
function reverbResponse(rate: number): Float32Array {
  let response = reverbResponses.get(rate);
  if (!response) { response = resampleImpulse(reverbImpulse(), AX_RATE, rate); reverbResponses.set(rate, response); }
  return response;
}

/** The original aux buses (lib/game/ax-aux.ts): stereo sends in, effect returns into
 * `output` (the main mix input, so returns share its headroom protection like AX
 * mixes them into the main bus). Aux A convolves with the ported ReverbStd response.
 * Aux B is the AXFX Delay's per-channel ring with its recirculation unrolled into a
 * feed-forward chain of equal delays down to -80 dB: a Web Audio feedback cycle adds
 * a render quantum per pass in Chromium. The delay's silent surround line is dropped.
 * Web Audio runs both at the context rate, not the AX DSP's 32 kHz. */
export function createAuxBuses(context: BaseAudioContext, output: AudioNode): { reverb: GainNode; delay: GainNode } {
  const stereo = (node: AudioNode) => { node.channelCount = 2; node.channelCountMode = 'explicit'; node.channelInterpretation = 'speakers'; return node; };
  const reverb = stereo(context.createGain()) as GainNode, convolver = context.createConvolver();
  const response = reverbResponse(context.sampleRate), buffer = context.createBuffer(1, response.length, context.sampleRate);
  buffer.getChannelData(0).set(response);
  convolver.normalize = false; convolver.buffer = buffer;
  reverb.connect(convolver); convolver.connect(output);
  const delay = stereo(context.createGain()) as GainNode, split = context.createChannelSplitter(2), merge = context.createChannelMerger(2);
  delay.connect(split);
  for (const index of [0, 1] as const) {
    // Chromium renders a splitter output past 0 fed straight into a DelayNode as silence.
    const line = delayLine(index), side = context.createGain();
    split.connect(side, index);
    let previous: AudioNode = side;
    // Echo n arrives n rings (plus the aux-return frame) late at output·feedback^(n-1).
    for (let gain = line.output; gain >= 1e-4; gain *= line.feedback) {
      const ring = context.createDelay(1), level = context.createGain();
      ring.delayTime.value = line.seconds + (previous === side ? AUX_RETURN_LATENCY : 0); level.gain.value = gain;
      previous.connect(ring); ring.connect(level); level.connect(merge, 0, index); previous = ring;
    }
  }
  merge.connect(output);
  return { reverb, delay };
}
