import type { ModelTexture, TextureTev } from '../../../lib/hsd/model.ts';

/** Phase 3.3 cache key: per-draw ShaderMaterials share compiled programs.
 * The only source variation is the TEV snippet, so identical TEVs (the
 * common case) compile once across N fighters x parts. Pure for tests. */
export function programCacheKey(source: ModelTexture | undefined, effectCombiners: boolean): string {
  if (!effectCombiners || !source?.tev) return 'smash:plain';
  return `smash:tev:${textureTevShader(source.tev)}`;
}

/** TObj-local ADD/SUB combiner only, not the complete GX TEV graph. All GLSL
 * tokens are selected from fixed enum mappings, never archive-provided text. */
export function textureTevShader(tev?: TextureTev): string {
  if (!tev) return '';
  const colors: Record<number, string> = { 8:'t.rgb', 9:'vec3(t.a)', 12:'vec3(1.0)', 13:'vec3(0.5)', 15:'vec3(0.0)',
    128:'tevConstant.rgb',129:'tevConstant.rrr',130:'tevConstant.ggg',131:'tevConstant.bbb',132:'tevConstant.aaa',
    133:'tevRegister0.rgb',134:'tevRegister0.aaa',135:'tevRegister1.rgb',136:'tevRegister1.aaa' };
  const alphas: Record<number, string> = { 4:'t.a',7:'0.0',64:'tevConstant.r',65:'tevConstant.g',66:'tevConstant.b',67:'tevConstant.a',68:'tevRegister0.a',69:'tevRegister1.a' };
  const stage = (inputs: number[], mapping: Record<number,string>, op: number, bias: number, scale: number, clamp: boolean, rgb: boolean): string => {
    if (op > 1 || bias > 2 || scale > 3 || inputs.some(i => mapping[i] === undefined)) return rgb ? 't.rgb' : 't.a';
    const [a,b,c,d] = inputs.map(i => mapping[i]!);
    let expression = `((${d} ${op === 0 ? '+' : '-'} mix(${a}, ${b}, ${c})) + ${['0.0','0.5','-0.5'][bias]}) * ${['1.0','2.0','4.0','0.5'][scale]}`;
    if (clamp) expression = `clamp(${expression}, ${rgb ? 'vec3(0.0), vec3(1.0)' : '0.0, 1.0'})`;
    return expression;
  };
  return `${tev.active & 0x40000000 ? `t.rgb = ${stage(tev.colorIn, colors, tev.colorOp, tev.colorBias, tev.colorScale, tev.colorClamp, true)};` : ''}
    ${tev.active & 0x80000000 ? `t.a = ${stage(tev.alphaIn, alphas, tev.alphaOp, tev.alphaBias, tev.alphaScale, tev.alphaClamp, false)};` : ''}`;
}
