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
