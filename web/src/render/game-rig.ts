import type { GameContent, FighterContent } from '../../../lib/game/load.ts';
import { MIN_MATCH_PLAYERS, MAX_MATCH_PLAYERS } from '../../../lib/game/limits.ts';
import { nanaMirrorsLeader } from '../../../lib/game/nana.ts';
import type { MatchFighter, PoseProvider } from '../../../lib/game/match.ts';
import type { V3 } from '../../../lib/hsd/model.ts';
import { ModelInstance } from './model-instance.ts';
import type { CustomSkin } from '../../../lib/custom/types.ts';
import type { CustomVisuals } from './custom-visuals.ts';
import { kirbyPartVisibility, hiddenDrawObjects, inhaleWalking } from '../../../lib/game/kirby.ts';
import { cargoCarrying } from '../../../lib/game/dk.ts';
import { diddyLean } from '../../../lib/game/diddy.ts';
import { bodyFacing, locomotionLoops } from '../../../lib/game/locomotion.ts';
import { raichuAnimationLoops } from '../../../lib/game/raichu.ts';
import { samusPartVisibility } from '../../../lib/game/samus.ts';
import { gamewatchPartVisibility, gamewatchHiddenOutline, gamewatchRim } from '../../../lib/game/gamewatch.ts';
/** Fighters whose part visibility comes straight from their model-part tables. */
const TABLE_VISIBILITY_KINDS = new Set<string>(['Pk', 'Lk', 'Cl', 'Mt', 'Pe', 'Kp', 'Zx', 'Td', 'Mk', 'Sn', 'Rc', 'Lz', 'Wf', 'Dd', 'De', 'Wr', 'Sh', 'Bl', 'Lc', 'Nm', 'Nt', 'Da', 'Fy', 'Sc', 'Dl', 'Kx', 'Lu', 'Lc2', 'Sm', 'Lb', 'MM', 'Sd', 'Cn', 'Gk', 'Ts', 'WfU', 'Fc', 'Dr', 'Gn', 'Pc', 'Ms', 'Lg', 'Pp', 'Zd', 'Sk', 'Gw', 'Ys']);
const HELD_LOOP_STATES = new Set<string>(['dizzy','captured','holding']);
const HELD_LOOP_ANIMATIONS = new Set<string>(['FuraFura','FuraSleepLoop','CaptureWaitHi','CatchWait','DownWaitU']);
/** Shared looping rule for a fighter body and her synced Nana twin. */
function actorLoopFor(fighter: MatchFighter): boolean {
  return HELD_LOOP_STATES.has(fighter.state) && (HELD_LOOP_ANIMATIONS.has(fighter.animation) || fighter.animation === (fighter.content.inhale?.wait ?? '')) || inhaleWalking(fighter) || cargoCarrying(fighter) || fighter.animation==='CliffWait' || (fighter.state === 'crouch' && fighter.animation === (fighter.content.motions?.crouchWait ?? 'SquatWait')) || fighter.state === 'helpless' || locomotionLoops(fighter) || raichuAnimationLoops(fighter) || fighter.state === 'walk' || fighter.state === 'fall' || fighter.state === 'respawn';
}
import { Vector3, type Camera, type Group } from 'three';
import type { LocalMatch } from '../../../lib/game/match.ts';
import { profiler } from '../../../lib/perf/profiler.ts';

/** Pose evaluation spans, shared by simulation and presentation samples (timing only). */
const SPAN_POSE = profiler.span('pose.update'), SPAN_SKIN = profiler.span('pose.prepare');

/** CPU pose evaluation shared by rendered meshes and original hit/hurt definitions. */
export class GameRigs implements PoseProvider {
  readonly actors: [ModelInstance, ModelInstance, ...ModelInstance[]];
  /** Nana partner bodies, keyed by fighter slot (only Pp slots with a partner model). */
  readonly partners = new Map<number, ModelInstance>();
  private partnerAnims = new Map<number, string>();
  private activeNames: string[] = [];
  private skins=new Map<number,CustomSkin>();
  private poseStamps=new Map<number,{animation:string;frame:number;loop:boolean;root:number|null;bone:number;x:number;version:number}>();
  /** Last collision-sample pose per slot. The render pass re-poses actors at interpolated
   * frames; the next simulation sample of the same key restores this exact snapshot
   * instead of re-evaluating every track. `epoch` invalidates it on external evaluation. */
  private poseCaches=new Map<number,{animation:string;frame:number;loop:boolean;root:number|null;bone:number;x:number;epoch:number;data:Float64Array}>();
  private poseEpochs:number[]=[];
  /** actor.poseVersion right after this rig last touched the pose (setAnimation/update/restore). */
  private rigVersions:number[]=[];
  private pointResult=new Vector3();
  private revisions:number[]=[];
  revision(fighter:MatchFighter):number{return this.revisions[fighter.slot]??0;}
  constructor(content: GameContent, visuals: CustomVisuals = new Map()) {
    if (content.fighters.length < MIN_MATCH_PLAYERS || content.fighters.length > MAX_MATCH_PLAYERS) throw new Error('Invalid fighter rig count.');
    this.visuals = visuals;
    this.actors = content.fighters.map((fighter,slot) => {
      const built = GameRigs.constructRig(fighter, this.visuals);
      if (built.skin) this.skins.set(slot, built.skin);
      if (built.partner) this.partners.set(slot, built.partner);
      return built.actor;
    }) as [ModelInstance, ModelInstance, ...ModelInstance[]];
  }
  /** Debug hot-swap (P key): replace one slot's actor in place, disposing the
   * old body, Nana twin and skin. Pose caches for the slot reset so the next
   * sample binds the new clips; the caller re-adds the scene groups. */
  replaceSlot(slot: number, fighter: FighterContent): void {
    if (!this.actors[slot]) throw new Error('Invalid fighter slot.');
    // Build BEFORE disposing: a poison model fails without taking the live rig down.
    const built = GameRigs.constructRig(fighter, this.visuals);
    this.actors[slot]!.dispose();
    this.skins.get(slot)?.dispose(); this.partners.get(slot)?.dispose();
    this.actors[slot] = built.actor;
    if (built.skin) this.skins.set(slot, built.skin); else this.skins.delete(slot);
    if (built.partner) this.partners.set(slot, built.partner); else this.partners.delete(slot);
    this.activeNames[slot] = '';
    this.poseCaches.delete(slot); this.poseStamps.delete(slot);
    this.poseEpochs[slot] = (this.poseEpochs[slot] ?? 0) + 1;
    this.revisions[slot] = (this.revisions[slot] ?? 0) + 1;
    this.rigVersions[slot] = this.actors[slot]!.poseVersion;
  }
  /** Scene groups owned by one slot (actor plus Nana twin when present). */
  slotGroups(slot: number): Group[] {
    const groups = [this.actors[slot]!.group];
    const partner = this.partners.get(slot);
    if (partner) groups.push(partner.group);
    return groups;
  }
  private visuals: CustomVisuals;
  /** Pure per-slot construction (no live-state writes): the constructor and
   * replaceSlot commit the parts to their maps themselves. */
  private static constructRig(fighter: FighterContent, visuals: CustomVisuals): { actor: ModelInstance; skin?: CustomSkin; partner?: ModelInstance } {
      const model = new ModelInstance(fighter.model, true);
      model.motionRootIndex = fighter.profile.motionRoot;
      // ftGw_Init_OnLoad/ftMaterial_800BFB4C: Game & Watch spawns with the
      // ftDataGamewatch costume color as every mobj's diffuse (the file ships
      // white, which otherwise renders the whole fighter white). Costume index
      // selects the slot; the single shipped costume is the default black.
      const parameters = fighter.specials.parameters;
      if (parameters?.kind === 'Gw') {
        const costume = Math.min(Math.max(fighter.costume ?? 0, 0), parameters.costumes.length - 1);
        model.setDiffuseOverride(parameters.costumes[costume]!);
        // Fighter_UpdateModelScale: root scale.x is the absolute width (0.01), the
        // other axes keep the model scale the group already carries. Flat means
        // every normal faces the camera, so shading is uniform: draw him unlit.
        model.setDepthScale(parameters.width / fighter.profile.attributes.modelScale);
        model.setLightingEnabled(false);
        // Outline TEV stage: lerp(body colour, GAMEWATCH_OUTLINE.rgb, its alpha), alpha untouched.
        model.setOutlineHull(parameters.outline.groups.flat(2), gamewatchRim(fighter)!);
      }
      model.group.scale.setScalar(fighter.profile.attributes.modelScale);
      const skin = fighter.custom ? visuals.get(fighter.custom)?.createSkin(model) : undefined;
      let partner: ModelInstance | undefined;
      if (fighter.profile.kind === 'Pp' && fighter.partnerModel) {
        partner = new ModelInstance(fighter.partnerModel, true);
        partner.motionRootIndex = fighter.profile.motionRoot;
        partner.group.scale.setScalar(fighter.profile.attributes.modelScale);
      }
      return { actor: model, skin, partner };
  }
  sample(fighter: MatchFighter, prepareDraws = true): void {
    const actor = this.actors[fighter.slot]!;
    // Any pose change this rig did not make (a direct update, a new clip binding) retires cached poses.
    const rigVersion=this.rigVersions[fighter.slot];
    if(rigVersion!==undefined&&rigVersion!==actor.poseVersion)this.poseEpochs[fighter.slot]=(this.poseEpochs[fighter.slot]??0)+1;
    if (this.activeNames[fighter.slot] !== fighter.animation) {
      actor.setAnimation(fighter.content.clips.get(fighter.animation)!,false); this.activeNames[fighter.slot] = fighter.animation;
    }
    actor.rotationOverrides.clear();
    // Firefox / Fire Wolf: Fighter_SetBoneRotX(XRotN, 2π − rotateModel) while travelling.
    if (fighter.special?.direction === 'up' && fighter.special.phase === 'travel' && (fighter.content.profile.kind === 'Fx' || fighter.content.profile.kind === 'Fc' || fighter.content.profile.kind === 'Wf' || fighter.content.profile.kind === 'WfU')) {
      const angle = Math.atan2(Math.sin(fighter.special.aim), Math.cos(fighter.special.aim) * fighter.facing);
      actor.rotationOverrides.set(fighter.content.profile.boneMap[2]!, { x: -angle });
    }
    // PlDd SpecialAirHiJump_Phys: ftPartSetRotX(fp, 2, lean) lays Diddy along the Rocketbarrel flight.
    const lean = fighter.content.profile.kind === 'Dd' ? diddyLean(fighter) : null;
    if (lean !== null) actor.rotationOverrides.set(fighter.content.profile.partJoints[2]!, { x: lean });
    if (fighter.content.profile.kind === 'Pr' && fighter.special?.direction === 'neutral' && fighter.special.purin && ['loop', 'travel', 'hit'].includes(fighter.special.phase)) {
      // ftPartSetRotX(fp, FtPart_YRotN, x14): the Rollout spin is a joint rotation, not a clip.
      actor.rotationOverrides.set(fighter.content.profile.partJoints[1]!, { x: fighter.special.purin.roll * fighter.facing });
    }
    if (fighter.ice) {
      // ftCo_DamageIce_Anim: HSD_JObjAddRotationX on FtPart_XRotN turns the frozen fighter, and the
      // block hangs off that same joint, so the two tumble together. The sim owns the angle.
      actor.rotationOverrides.set(fighter.content.profile.partJoints[2]!, { x: fighter.ice.angle });
    }
    if (fighter.content.profile.kind === 'Ns' && fighter.special?.direction === 'up' && fighter.special.phase === 'hit') {
      // ftNs_SpecialAirHi_Enter: ftPartSetRotX(fp, FtPart_TopN, facing·atan2(vx, vy) − π/2)
      // aims the whole body along the PK Thunder 2 launch for the length of the flight.
      actor.rotationOverrides.set(fighter.content.profile.partJoints[0]!, { x: fighter.facing * Math.atan2(fighter.velocity.x, fighter.velocity.y) - Math.PI / 2 });
    }
    const pk = fighter.content.specials.parameters;
    if ((pk?.kind === 'Pk' || pk?.kind === 'Rc') && fighter.special?.direction === 'up' && fighter.special.phase === 'travel') {
      // ftPk_SpecialHi_8012642C: XRotN aim shared by rendering and collision poses.
      actor.rotationOverrides.set(fighter.content.profile.boneMap[2]!, { x: fighter.grounded ? pk.up.pitch : fighter.facing * Math.atan2(fighter.velocity.x, fighter.velocity.y) + pk.up.pitch - Math.PI / 2 });
    }
    actor.animationLoop = actorLoopFor(fighter);
    // Original draw-set alternatives (Kirby's stone shapes); other fighters keep every draw object.
    if(prepareDraws){
    actor.hiddenDobjs.clear();
    const visible = fighter.content.profile.kind === 'Gw' ? gamewatchPartVisibility(fighter) : TABLE_VISIBILITY_KINDS.has(fighter.content.profile.kind) ? fighter.content.profile.partVisibility.groups.map((_, group) => fighter.content.partDefaults?.[group] ?? 0) : fighter.content.profile.kind === 'Ss' ? samusPartVisibility(fighter) : kirbyPartVisibility(fighter);
    if(visible&&(fighter.content.profile.kind==='Lk'||fighter.content.profile.kind==='Cl'||fighter.content.profile.kind==='Pe'||fighter.content.profile.kind==='Zx'||fighter.content.profile.kind==='Td'||fighter.content.profile.kind==='Mk'||fighter.content.profile.kind==='Sn'||fighter.content.profile.kind==='Rc'||fighter.content.profile.kind==='Lz'||fighter.content.profile.kind==='Wf'||fighter.content.profile.kind==='Dd'||fighter.content.profile.kind==='De'||fighter.content.profile.kind==='Wr'||fighter.content.profile.kind==='Sh'||fighter.content.profile.kind==='Bl'||fighter.content.profile.kind==='Lc'||fighter.content.profile.kind==='Nm'||fighter.content.profile.kind==='Nt'||fighter.content.profile.kind==='Da'||fighter.content.profile.kind==='Fy'||fighter.content.profile.kind==='Sc'||fighter.content.profile.kind==='Dl'||fighter.content.profile.kind==='Kx'||fighter.content.profile.kind==='Lu'||fighter.content.profile.kind==='Lc2'||fighter.content.profile.kind==='Sm'||fighter.content.profile.kind==='Lb'||fighter.content.profile.kind==='MM'||fighter.content.profile.kind==='Sd'||fighter.content.profile.kind==='Cn'||fighter.content.profile.kind==='Ts'||fighter.content.profile.kind==='WfU')){
      for(const event of fighter.content.timelines.get(fighter.animation)?.events??[]){
        if(event.frame>fighter.animationFrame)break;
        if(event.type==='model-part'&&event.group>=0&&event.group<visible.length)visible[event.group]=event.alternative;
      }
      if(fighter.link.bomb!==null&&visible.length>2)visible[2]=1;
    }
    if (visible) for (const dobj of hiddenDrawObjects(fighter.content.profile.partVisibility, visible)) actor.hiddenDobjs.add(dobj);
    if (visible && fighter.content.profile.kind === 'Gw') for (const dobj of gamewatchHiddenOutline(fighter, visible)) actor.hiddenDobjs.add(dobj);
    }
    actor.group.position.set(fighter.x, fighter.y, 0);
    actor.group.rotation.y = bodyFacing(fighter) > 0 ? Math.PI / 2 : -Math.PI / 2;
    // Mushroom statuses scale the whole actor (render plus pose-derived hit/hurt geometry);
    // the Cloaking Device fades it. Both restore only their own values.
    // Mushroom size (fighter x34_scale): the simulated scale, ramps included (lib/game/item-status.ts).
    const sizeMul = fighter.itemFx?.scale ?? 1;
    actor.group.scale.setScalar(fighter.content.profile.attributes.modelScale * sizeMul);
    if ((fighter.itemFx?.cloak ?? 0) > 0) actor.opacityMultiplier = 0.15;
    else if (actor.opacityMultiplier === 0.15) actor.opacityMultiplier = 1;

    // Mewtwo's Teleport zoom is invisible for its whole duration (ftMewtwo_SpecialHi_SetVars).
    // Shadow's Chaos Control is the same Teleport code (SetVars sets fp->invisible for the zoom).
    actor.group.visible = fighter.state !== 'ko' && !((fighter.content.profile.kind === 'Mt' || fighter.content.profile.kind === 'Sm' || fighter.content.profile.kind === 'Sh') && fighter.special?.direction === 'up' && fighter.special.phase === 'travel') && !((fighter.content.profile.kind === 'Zd' || fighter.content.profile.kind === 'Sk') && fighter.special?.direction === 'up' && fighter.special.phase === 'travel');
    const bone=actor.rotationOverrides.keys().next().value??-1,x=actor.rotationOverrides.get(bone)?.x??0;
    const stamp=this.poseStamps.get(fighter.slot);
    if(!stamp||stamp.animation!==fighter.animation||!Object.is(stamp.frame,fighter.animationFrame)||stamp.loop!==actor.animationLoop||stamp.root!==actor.motionRootIndex||stamp.bone!==bone||!Object.is(stamp.x,x)||stamp.version!==actor.poseVersion){
      profiler.begin(SPAN_POSE);
      // Pose snapshots are optional: unit-test doubles of ModelInstance implement update() only.
      const cache=this.poseCaches.get(fighter.slot),epoch=this.poseEpochs[fighter.slot]??0;
      if(cache&&cache.epoch===epoch&&cache.animation===fighter.animation&&Object.is(cache.frame,fighter.animationFrame)&&cache.loop===actor.animationLoop&&cache.root===actor.motionRootIndex&&cache.bone===bone&&Object.is(cache.x,x)&&typeof actor.restorePoseState==='function'){
        actor.restorePoseState(cache.data);
      }else{
        actor.update(fighter.animationFrame,false);
        if(!prepareDraws&&typeof actor.capturePoseState==='function')this.cachePose(fighter,actor,bone,x,epoch);
      }
      profiler.end(SPAN_POSE);
      const next=stamp??{animation:'',frame:0,loop:false,root:null,bone:-1,x:0,version:0};
      next.animation=fighter.animation;next.frame=fighter.animationFrame;next.loop=actor.animationLoop;next.root=actor.motionRootIndex;next.bone=bone;next.x=x;next.version=actor.poseVersion;this.poseStamps.set(fighter.slot,next);
    }
    if(prepareDraws){profiler.begin(SPAN_SKIN);actor.prepare(fighter.animationFrame);profiler.end(SPAN_SKIN);}
    // Queries need the actor transform, not a recursive update of every draw mesh.
    actor.group.updateWorldMatrix(true,false);
    this.revisions[fighter.slot]=(this.revisions[fighter.slot]??0)+1;
    this.rigVersions[fighter.slot]=actor.poseVersion;
    this.samplePartner(fighter, actor.hiddenDobjs, prepareDraws);
  }
  private cachePose(fighter:MatchFighter,actor:ModelInstance,bone:number,x:number,epoch:number):void{
    let cache=this.poseCaches.get(fighter.slot);
    const length=actor.poseStateLength;
    if(!cache||cache.data.length!==length){cache={animation:'',frame:0,loop:false,root:null,bone:-1,x:0,epoch:-1,data:new Float64Array(length)};this.poseCaches.set(fighter.slot,cache);}
    actor.capturePoseState(cache.data);
    cache.animation=fighter.animation;cache.frame=fighter.animationFrame;cache.loop=actor.animationLoop;cache.root=actor.motionRootIndex;cache.bone=bone;cache.x=x;cache.epoch=epoch;
  }
  /** Positions Nana's body from the simulated partner state: she mirrors
   * Popo's clip/frame while synced, flinches through DamageFlyN while
   * tumbling, and idles (Wait1/Fall) where mirroring would duplicate a grab
   * victim or float (see nanaMirrorsLeader). */
  private samplePartner(fighter: MatchFighter, hiddenDobjs: Set<number>, prepareDraws: boolean): void {
    const nana = fighter.nana, partner = this.partners.get(fighter.slot);
    if (!partner) return;
    if (!nana?.active || fighter.state === 'ko') { partner.group.visible = false; return; }
    const mirror = nanaMirrorsLeader(fighter.state) && nana.tumble <= 0;
    const clipName = !mirror && nana.tumble > 0 ? 'DamageFlyN' : mirror ? fighter.animation : nana.grounded ? 'Wait1' : 'Fall';
    const clip = fighter.content.clips.get(clipName);
    if (clip && this.partnerAnims.get(fighter.slot) !== clipName) {
      partner.setAnimation(clip, false); this.partnerAnims.set(fighter.slot, clipName);
    }
    const endFrame = Math.max(1, clip?.endFrame ?? 1);
    // A tumbling Nana holds a flinch pose; an idling one loops her wait
    // inside Popo's frame cursor; a mirroring one shares it exactly.
    const frame = nana.tumble > 0 ? Math.min(4, endFrame - 1) : mirror ? fighter.animationFrame : ((fighter.animationFrame % endFrame) + endFrame) % endFrame;
    partner.animationLoop = mirror ? actorLoopFor(fighter) : clipName !== 'DamageFlyN';
    partner.rotationOverrides.clear();
    partner.group.position.set(nana.x, nana.y, 0);
    // A mirroring Nana plays Popo's Turn/TurnRun clip too, so she keeps his entry yaw as well.
    const nanaFacing = mirror && bodyFacing(fighter) !== fighter.facing ? -nana.facing : nana.facing;
    partner.group.rotation.y = nanaFacing > 0 ? Math.PI / 2 : -Math.PI / 2;
    partner.group.visible = true;
    partner.update(frame, false);
    if (prepareDraws) {
      // Same draw-object set as Popo: the twin model shares the layout, and
      // her skin only differs by palette (see load.ts skeleton validation).
      partner.hiddenDobjs.clear();
      for (const dobj of hiddenDobjs) partner.hiddenDobjs.add(dobj);
      partner.prepare(frame);
    }
    partner.group.updateWorldMatrix(true, false);
  }
  /** Every body the scene must hold: fighter actors plus Nana twins. */
  sceneGroups(): Group[] {
    const groups = this.actors.map((actor) => actor.group);
    for (const partner of this.partners.values()) groups.push(partner.group);
    return groups;
  }
  partnerPoint(fighter: MatchFighter, bone: number, offset: V3): V3 {    const partner = this.partners.get(fighter.slot);
    if (!partner) throw new Error('No Nana partner body for this fighter.');
    const position = partner.jointPoint(bone, offset, this.pointResult);
    return [position.x, position.y, position.z];
  }
  point(fighter: MatchFighter, bone: number, offset: V3): V3 {
    if(bone===139&&fighter.content.hookshot){
      const tip=fighter.link.hook?.tip;
      if(!tip)throw Error('Hookshot attachment has no authoritative tip.');
      return [tip[0]+offset[2]*fighter.facing,tip[1]+offset[1],tip[2]+offset[0]];
    }
    const position = this.actors[fighter.slot]!.jointPoint(bone, offset,this.pointResult);
    return [position.x, position.y, position.z];
  }
  renderSkins(match:LocalMatch,camera:Camera,presentation:string='default',alpha=0,paused=false):void{for(const [slot,skin]of this.skins)skin.render(match.fighters[slot]!,camera,match.phase==='ended'&&match.winner===slot,presentation,alpha,paused);}
  dispose(): void { for(const skin of this.skins.values())skin.dispose();this.skins.clear();this.actors.forEach((actor) => actor.dispose()); for (const partner of this.partners.values()) partner.dispose(); this.partners.clear(); this.partnerAnims.clear(); }
}
