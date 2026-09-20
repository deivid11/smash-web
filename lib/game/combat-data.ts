import type { HsdArchive } from '../hsd/archive.ts';

export const COMBAT_MOTIONS = ['GuardOn','Guard','GuardOff','GuardDamage','EscapeN','EscapeF','EscapeB','EscapeAir',
  'Catch','CatchDash','CatchWait','CatchAttack','CatchCut','CapturePulledHi','CaptureWaitHi','CaptureDamageHi','CaptureCut',
  'ThrowF','ThrowB','ThrowHi','ThrowLw','DownWaitU','FuraFura','FuraSleepStart','FuraSleepLoop','FuraSleepEnd','CliffCatch','CliffWait',
  ...['Climb','Attack','Escape'].flatMap(n=>['Quick','Slow'].map(s=>`Cliff${n}${s}`)),
  ...['Quick','Slow'].flatMap(s=>[1,2].map(n=>`CliffJump${s}${n}`))];
export interface CombatData {
  passiveShield?:{stunScale:number;analogMin:number;analogMax:number;push:number};
  shield: { maximum:number; minimumScale:number; sizeScale:number; drain:number; regen:number; restored:number;
    damageScale:number; damageBase:number; stunScale:number; stunBase:number; pushScale:number; pushMaximum:number; minimumHold:number; dizzyBase:number; dizzyMinimum:number };
  /** `sideFrames` is ftCommonData x320: how fresh the sideways stick tilt must be (x670) for
   * ftCo_8009917C to roll, including straight out of a charging special. */
  dodge: { down:number; side:number; sideFrames:number; deadX:number; deadY:number; speed:number; decay:number; mobility:number; landing:number };
  grab: { base:number; percentScale:number; decay:number; mash:number; weightScale:number };
  /** ftCo_800C0D0C: ground-element burial. Sink over x5F4 frames; escape timer is the grab
   * formula family x5F8–x60C with per-frame decay x610 and mash bonus x614. */
  bury: { sinkFrames:number; base:number; percentScale:number; decay:number; mash:number };
  ledge: { down:number; input:number; slowPercent:number; quickWait:number; slowWait:number; cooldown:number; invincibility:number };
  /** ftCo_DamageIce (ftCommonData x77C-x7A4): the frozen block's size, its fall gravity multiplier
   * and spin range, the mash-out timer (the hit's own damage x `timerScale`, `decay` a frame,
   * `mash` a press, `damageScale` per point of damage taken while frozen), and how long the
   * pop-out hop locks the fighter. `minKnockback` is ftCo_Damage's second knockback tier
   * (x154 scale against x15C): a weaker ice hit launches normally instead of freezing. */
  ice: { size:number; gravity:number; timerScale:number; decay:number; mash:number; damageScale:number; spinMin:number; spinMax:number; jumpFrames:number; knockbackScale:number; minKnockback:number };
}
export function parseCombatData(arc:HsdArchive):CombatData {
  const base=arc.pointer(arc.symbol('ftLoadCommonData'));
  const f=(o:number)=>{const v=arc.f32(base+o);if(!Number.isFinite(v)||Math.abs(v)>10000)throw Error('Invalid common combat parameter.');return v;};
  const i=(o:number)=>{const v=arc.u32(base+o);if(v>10000)throw Error('Invalid common combat timer.');return v;};
  // Digital/full shield: original lightshield_amount = 1. No analog/light shield here.
  return {passiveShield:{stunScale:f(0x28c),analogMin:f(0x2e4),analogMax:f(0x2e8),push:f(0x294)},shield:{maximum:f(0x260),minimumScale:f(0x264),sizeScale:f(0x2d8),drain:f(0x278)*f(0x2f0),regen:f(0x27c),restored:f(0x280),
    damageScale:f(0x284)*(1-f(0x2e0)),damageBase:f(0x288),stunScale:f(0x28c)*(1-f(0x2e8)),stunBase:f(0x290),
    pushScale:f(0x294)*f(0x2bc),pushMaximum:f(0x298),minimumHold:f(0x268),dizzyBase:f(0x2f8),dizzyMinimum:f(0x2fc)},
    dodge:{down:f(0x314),side:f(0x31c),sideFrames:i(0x320),deadX:f(0x32c),deadY:f(0x330),speed:f(0x338),decay:f(0x33c),mobility:f(0x340),landing:f(0x344)},
    // Normal handicap 9 and tied first place, as in this local slice.
    grab:{base:f(0x354)+f(0x358)*(f(0x35c)-9)+f(0x360)*(f(0x364)-1),percentScale:f(0x368),decay:f(0x3a4),mash:f(0x3a8),weightScale:f(0x37c)},
    bury:{sinkFrames:Math.max(1,Math.round(f(0x5f4))),base:f(0x5f8)+f(0x5fc)*(f(0x600)-9)+f(0x604)*(f(0x608)-1),percentScale:f(0x60c),decay:f(0x610),mash:f(0x614)},
    ledge:{down:f(0x480),input:f(0x494),slowPercent:i(0x488),quickWait:f(0x48c),slowWait:f(0x490),cooldown:i(0x498),invincibility:i(0x49c)},
    ice:{size:f(0x7a0),gravity:f(0x77c),timerScale:f(0x790),decay:f(0x794),mash:f(0x798),damageScale:f(0x79c),spinMin:f(0x788),spinMax:f(0x78c),jumpFrames:f(0x7a4),knockbackScale:f(0x154),minKnockback:f(0x15c)}};
}
