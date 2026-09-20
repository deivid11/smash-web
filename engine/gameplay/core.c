#include "bridge.h"
/* This glue deliberately implements only a two-to-eight-fighter porting prototype.
 * Original functions live in the generated translation unit; state orchestration
 * and collision resolution are not claimed to be the original complete engine. */
static ftCommonData common;
ftCommonData* p_ftCommonData = &common;
/* Keep aligned with lib/game/limits.ts; adapter ABI tests check both boundaries. */
#define CORE_MAX_FIGHTERS 8
static Fighter fighters[CORE_MAX_FIGHTERS];
static float results[5];
extern u32* seed_ptr;

float ft_GetGroundFrictionMultiplier(Fighter* fp) { (void) fp; return 1.0f; }
/* The selected jump routine is called with its audio flag FALSE. These traps
 * prevent an unsupported original audio path from silently becoming a no-op. */
void ft_800881D8(Fighter* fp, int sound, int volume, int pan) {
    (void) fp; (void) sound; (void) volume; (void) pan; __builtin_trap();
}
void ft_PlaySFX(Fighter* fp, int sound, int volume, int pan) {
    (void) fp; (void) sound; (void) volume; (void) pan; __builtin_trap();
}
uintptr_t core_common_ptr(void) { return (uintptr_t) &common; }
u32 core_common_size(void) { return sizeof(common); }
uintptr_t core_attrs_ptr(int slot) { return slot >= 0 && slot < CORE_MAX_FIGHTERS ? (uintptr_t) &fighters[slot].co_attrs : 0; }
u32 core_attrs_size(void) { return sizeof(ftCo_DatAttrs); }
void core_seed(u32 value) { *seed_ptr = value; }
void core_set_velocity(int slot, float x, float y, int grounded) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot];
    fp->self_vel = (Vec3) { x, y, 0 }; fp->gr_vel = x;
    fp->ground_or_air = grounded ? GA_Ground : GA_Air;
    fp->coll_data.floor.normal = (Vec3) { 0, 1, 0 };
}
float core_velocity(int slot, int axis) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    return axis == 0 ? fighters[slot].self_vel.x : fighters[slot].self_vel.y;
}
float core_ground(int slot, float stick) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick;
    HSD_GObj gobj = { fp };
    if (stick == 0.0f) ftCommon_ApplyFrictionGround(fp, fp->co_attrs.ground_friction);
    else ftCo_Run_Phys(&gobj);
    fp->gr_vel += fp->xE4_ground_accel_1;
    fp->self_vel.x = fp->gr_vel;
    return fp->self_vel.x;
}
/* ftCo_Dash_Phys after its entry frame (mv.co.dash.x0 already cleared). */
float core_dash(int slot, float stick) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick; fp->mv.co.dash.x0 = 0.0f;
    HSD_GObj gobj = { fp };
    ftCo_Dash_Phys(&gobj);
    fp->gr_vel += fp->xE4_ground_accel_1; fp->self_vel.x = fp->gr_vel;
    return fp->self_vel.x;
}
/* ftCo_TurnRun_Phys: `facing` is the direction the run had when the turn began. */
float core_turn_run(int slot, float stick, float facing) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick; fp->mv.co.turnrun.accel_mul = facing;
    HSD_GObj gobj = { fp };
    ftCo_TurnRun_Phys(&gobj);
    fp->gr_vel += fp->xE4_ground_accel_1; fp->self_vel.x = fp->gr_vel;
    return fp->self_vel.x;
}
float core_stationary_ground(int slot) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; HSD_GObj gobj = { fp };
    ft_80084F3C(&gobj); fp->gr_vel += fp->xE4_ground_accel_1;
    fp->self_vel.x = fp->gr_vel; return fp->self_vel.x;
}
float core_walk(int slot, float stick) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; HSD_GObj gobj = { fp };
    fp->input.lstick[0].x = stick; fp->mv.co.walk.accel_mul = 1.0f;
    if (stick == 0.0f) ftCommon_ApplyFrictionGround(fp, fp->co_attrs.ground_friction);
    else ftWalkCommon_800E0060(&gobj);
    fp->gr_vel += fp->xE4_ground_accel_1; fp->self_vel.x = fp->gr_vel;
    return fp->self_vel.x;
}
int core_walk_type(int slot, float velocity) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; HSD_GObj gobj = { fp };
    fp->gr_vel = velocity; fp->mv.co.walk.accel_mul = 1.0f;
    return ftWalkCommon_GetWalkType(&gobj);
}
float core_smash_damage(int slot, float damage, float frames, float limit, float multiplier) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS || !(limit > 0) || frames < 0 || frames > limit) __builtin_trap();
    Fighter* fp = &fighters[slot];
    fp->smash_attrs = (SmashAttr) { SmashState_Release, frames, limit, multiplier };
    return ftCo_800DEEB8(fp, damage);
}
void core_air(int slot, float stick, int fast_fall) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick;
    ftCommon_8007D28C(fp, fp->self_vel.x);
    fp->self_vel.x += fp->x74_anim_vel.x;
    if (fast_fall) ftCommon_FallFast(fp);
    else ftCommon_Fall(fp, fp->co_attrs.gravity, fp->co_attrs.terminal_velocity);
}
void core_jump(int slot, float stick, int short_hop) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick;
    fp->mv.co.jump.x0 = short_hop != 0;
    HSD_GObj gobj = { fp };
    ftCo_800CB110(&gobj, false, 1.0f);
}
void core_air_jump(int slot, float stick) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot];
    /* Velocity initialization from ftCo_JumpAerial_Enter_Basic, without its
       unported motion-state, object, and audio callbacks. */
    fp->self_vel.x = stick * fp->co_attrs.air_jump_h_multiplier;
    fp->self_vel.y = fp->co_attrs.jump_v_initial_velocity * fp->co_attrs.air_jump_v_multiplier;
}
void core_hit(int slot, float percent_before, float damage, u32 growth, u32 base, u32 weight_set, u32 angle, int airborne, float knockback_multiplier) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS || !(knockback_multiplier > 0) || knockback_multiplier > 2) __builtin_trap();
    Fighter* fp = &fighters[slot];
    fp->dmg.x1830_percent = percent_before; fp->dmg.x1838_percentTemp = damage;
    fp->dmg.x1848_kb_angle = angle; fp->ground_or_air = airborne ? GA_Air : GA_Ground;
    HitCapsule hit = { growth, weight_set, base };
    /* ftCo_Damage_CalcKnockback applies kb_smashcharge_mul before the
       angle/speed/hitstun calculation when the victim is charging. */
    const float kb = ftColl_80079AB0(fp, &hit, (u32) damage, 1.0f, 1.0f, 1.0f, fp->co_attrs.weight) * knockback_multiplier;
    results[0] = kb; results[1] = ftCo_Damage_CalcAngle(fp, kb);
    results[2] = kb * common.x100; results[3] = ftCo_ScaleBy154(kb);
    const float lag = ftCommon_CalcHitlag((int) damage, 0, 1.0f);
    results[4] = lag < common.x194_unkHitLagFrames ? lag : common.x194_unkHitLagFrames;
}
void core_decay(float x, float y, int grounded, float friction) {
    if (grounded) { results[0] = ftCommon_8007CD6C(x, friction * common.x200); results[1] = 0; return; }
    /* Adapted from Fighter's airborne knockback decay block. Emscripten libc
       trig is used here, not a claim of Gekko floating-point equivalence. */
    if (x == 0 && y == 0) { results[0] = results[1] = 0; return; }
    const float angle = atan2f(y, x);
    if (sqrtf(x * x + y * y) < common.x204_knockbackFrameDecay) results[0] = results[1] = 0;
    else { results[0] = x - common.x204_knockbackFrameDecay * cosf(angle); results[1] = y - common.x204_knockbackFrameDecay * sinf(angle); }
}
float core_result(int index) { if ((unsigned) index >= 5) __builtin_trap(); return results[index]; }
void core_custom_air(int slot, float gravity, float terminal, float friction) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; ftCommon_Fall(fp, gravity, terminal);
    ftCommon_ApplyFrictionAir(fp, friction); fp->self_vel.x += fp->x74_anim_vel.x;
}
void core_ascend(int slot, float amount, float maximum) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    ftCommon_Ascend(&fighters[slot], amount, maximum);
}
void core_drift(int slot, float stick, float accel, float maximum) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick;
    ftCommon_8007D3A8(fp, 0, accel, maximum); fp->self_vel.x += fp->x74_anim_vel.x;
}
void core_controlled_drift(int slot, float stick, float accel, float maximum) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; fp->input.lstick[0].x = stick;
    ftCommon_8007D344(fp, 0, accel, maximum); fp->self_vel.x += fp->x74_anim_vel.x;
}
void core_motion(int slot, float z, float y, float facing, float angle, float multiplier) {
    if ((unsigned) slot >= CORE_MAX_FIGHTERS) __builtin_trap();
    Fighter* fp = &fighters[slot]; HSD_GObj gobj = { fp };
    fp->x6A4_transNOffset = (Vec3) { 0, y, z }; fp->facing_dir = facing; fp->lstick_angle = angle;
    if (angle == 0.0f) ft_80085134(&gobj); else ft_80085154(&gobj);
    fp->self_vel.x *= multiplier; fp->self_vel.y *= multiplier;
}
