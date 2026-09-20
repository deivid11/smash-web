import type { CommonGameplayData } from './data.ts';
import type { MatchFighter, PlayerInput, PoseProvider } from './match.ts';
import { command } from './specials.ts';

export const isLink = (f: MatchFighter): boolean => f.content.profile.kind === 'Lk' || f.content.profile.kind === 'Cl';
/** Wait/SquatWait install the passive shield only when the item-hand part is visible. */
export function updatePassiveLinkShield(f:MatchFighter):void {
  if(!isLink(f))return;
  const mode=f.state==='idle'||f.state==='crouch'&&f.animation===(f.content.motions?.crouchWait??'SquatWait');
  if(!mode||f.link.bomb!==null)f.link.passiveReady=false;
  else if(!f.link.passiveMode)f.link.passiveReady=true;
  f.link.passiveMode=mode;
}
export function passiveLinkShield(f:MatchFighter,poses:PoseProvider):{center:[number,number,number];radius:number;amount:number}|null {
  const p=f.content.specials.parameters;
  if((p.kind!=='Lk'&&p.kind!=='Cl')||!f.link.passiveReady||!f.grounded||!['idle','crouch'].includes(f.state)||f.link.bomb!==null)return null;
  // ftParts_800753D4 installs item-list slot6 as a virtual child of the shield joint.
  const attachment=f.content.passiveAttachment;if(!attachment)throw Error('Missing native passive shield attachment.');
  const offset:[number,number,number]=[0,1,2].map(i=>attachment.offset[i]!+p.passiveShield.offset[i]!*attachment.scale[i]!) as [number,number,number];
  return {center:poses.point(f,attachment.parent,offset),radius:p.passiveShield.radius*Math.max(...attachment.scale)*f.content.profile.attributes.modelScale,amount:p.passiveShield.amount};
}
/** Native callbacks expose different input sets, not a universal cancel-to-idle. */
export function linkInterruptInput(f: MatchFighter, raw: PlayerInput, previous: PlayerInput, common: CommonGameplayData): PlayerInput | null {
  if (!isLink(f)) return null;
  const catching = f.special?.direction === 'side' && f.special.phase === 'hit';
  const move = f.attackName ? f.content.attacks.get(f.attackName) : undefined;
  if (!catching && (f.state !== 'attack' || move?.interruptFrame == null || f.animationFrame < move.interruptFrame || f.smash?.phase === 'charging')) return null;
  const input = { ...raw };
  const jab = f.attackName === f.content.moves.jab || f.attackName === f.content.moves.jab2;
  if (catching) {
    // ftLk_SpecialS2_IASA: specials, shield, jump and dash (air: special/jump).
    input.attack = false; input.strong = false; input.grab = false;
    if (!f.grounded) input.shield = false;
    else if (Math.abs(input.x) < common.dashThreshold) input.x = 0;
    input.down = false;
  } else if (!f.grounded) {
    // ftCo_AttackAir*_IASA: aerial attack, aerial jump and air catch; not B or air dodge.
    input.special = false;
    if (input.shield && input.attack && !previous.attack) input.grab = true;
    input.shield = false;
  } else if (jab || f.attackName === f.content.moves.downTilt) {
    // ftCo_Attack11/12 and AttackLw3 have restricted normal/movement branches.
    input.special = false; input.shield = false; input.grab = false;
    if (jab && Math.abs(input.x) <= 0.28 && Math.abs(input.y ?? 0) <= 0.5 && !input.down) input.attack = false;
  }
  const requested = (input.attack && !previous.attack) || (input.strong && !previous.strong)
    || (input.jump && !previous.jump) || (input.special && !previous.special)
    || (input.grab && !previous.grab) || (f.grounded && (input.shield || input.x !== 0 || (!catching && (input.down || (input.y ?? 0) < -0.5))));
  return requested ? input : null;
}

/** ftCo_LandingAir_EnterWithLag for every fighter: an aerial keeps its landing lag only while its script
 * holds cmd_vars[0] (outside the auto-cancel windows), and an L/R/Z press within the L-cancel window
 * (`link.shieldAge`, PlCo xE4/xE8) divides it. Otherwise the fighter lands normally. Aerial scripts that
 * never touch cmd_vars[0] (custom fighters) keep their aerial lag. */
export function aerialLanding(f: MatchFighter, common: CommonGameplayData, aerial: boolean, normalLag: number): { lag: number; aerial: boolean } {
  if (!aerial) return { lag: normalLag, aerial };
  const scripted = f.content.timelines.get(f.animation)?.events.some((event) => event.type === 'command' && event.index === 0) ?? false;
  if (scripted && command(f, 0) === 0) return { lag: f.content.profile.attributes.landingLag, aerial: false };
  const cancel = common.lCancel;
  return { lag: cancel && f.link.shieldAge < cancel.window ? Math.max(1, Math.trunc(normalLag / cancel.divisor)) : normalLag, aerial: true };
}
/** ftCo_LandingAir_EnterWithMsidLag: the landing motion plays across the (possibly L-canceled) lag. */
export function retimeAerialLanding(f: MatchFighter): void {
  if (f.state === 'landing') f.animationRate = Math.fround((f.content.clips.get(f.animation)!.endFrame + 0.1) / f.landingFrames);
}
/** Native LandingAir/LandingFallSpecial animation-rate formula; no simulation-frame rescaling. */
export function retimeLinkLanding(f: MatchFighter): void {
  if (isLink(f) && f.state === 'landing') f.animationRate = Math.fround((f.content.clips.get(f.animation)!.endFrame + 0.1) / f.landingFrames);
}
