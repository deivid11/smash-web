#ifndef SMASH_WEB_GAMEPLAY_BRIDGE_H
#define SMASH_WEB_GAMEPLAY_BRIDGE_H
/* Private adapter ABI for selected original functions; NOT the full Fighter ABI. */
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <math.h>
typedef uint8_t u8;
typedef uint32_t u32;
typedef int32_t s32;
typedef float f32;
typedef int FtMotionId;
typedef enum { FtWalkType_Slow, FtWalkType_Middle, FtWalkType_Fast } FtWalkType;
typedef enum { SmashState_None, SmashState_PreCharge, SmashState_Charging, SmashState_Release } SmashState;
typedef struct { SmashState state; float x2118_frames, x211C_holdFrame, x2120_damageMul; } SmashAttr;
typedef struct { float x, y, z; } Vec3;
#define PAD_STACK(n)
#define ABS(x) ((x) < 0 ? -(x) : (x))
#define GET_FIGHTER(gobj) ((Fighter*) (gobj)->user_data)
#define MTXDegToRad(x) ((x) * 0.01745329252f)
#define SFX_VOLUME_MAX 127
#define SFX_PAN_MID 64
#define ftCo_MS_Squat 39
#define GA_Ground 0
#define GA_Air 1

typedef struct ftCo_DatAttrs {
    float walk_accel_mul, walk_accel_base, walk_max_vel, slow_walk_max, mid_walk_point, fast_walk_min;
    float ground_friction, dash_initial_velocity, dash_accel_mul, dash_accel_base, dash_max_velocity;
    float run_animation_scaling, max_run_brake_frames, ground_max_horizontal_velocity;
    float jump_startup_time, jump_h_initial_velocity, jump_v_initial_velocity, ground_to_air_jump_momentum_multiplier;
    float jump_h_max_velocity, hop_v_initial_velocity, air_jump_v_multiplier, air_jump_h_multiplier;
    int max_jumps;
    float gravity, terminal_velocity, air_drift_stick_mul, aerial_drift_base, air_drift_max, aerial_friction;
    float fast_fall_velocity, air_max_horizontal_velocity, jab_2_input_window, jab_3_input_window, standing_turn_frames;
    float weight, model_scaling, initial_shield_size, shield_break_initial_velocity;
    int rapid_jab_window;
} ftCo_DatAttrs;
_Static_assert(offsetof(ftCo_DatAttrs, gravity) == 0x5c, "attribute offset mismatch");
_Static_assert(offsetof(ftCo_DatAttrs, weight) == 0x88, "attribute offset mismatch");
_Static_assert(sizeof(ftCo_DatAttrs) == 0x9c, "attribute prefix size mismatch");

typedef struct ftCommonData {
    uint8_t pad0[0x28];
    float walk_middle_animation_stick_threshold, walk_fast_stick_threshold, walk_accel_taper_gain;
    uint8_t pad34[0x5c - 0x34];
    float run_accel_taper_gain, run_dash_turn_friction_multiplier;
    uint8_t pad64[0x6c - 0x64];
    float friction_when_above_walk_speed;
    uint8_t pad70[0xf4 - 0x70];
    float xF4, xF8; int xFC;
    float x100, kb_min, x108, x10C, x110, x114, x118, x11C, x120;
    uint8_t pad124[0x144 - 0x124];
    float x144_radians, x148, x14C, x150, x154;
    uint8_t pad158[0x194 - 0x158];
    float x194_unkHitLagFrames, x198, x19C, x1A0;
    uint8_t pad1a4[0x200 - 0x1a4];
    float x200, x204_knockbackFrameDecay;
    uint8_t pad208[0x438 - 0x208];
    float x438, x43C_unused, x440;
    uint8_t pad444[0x6d4 - 0x444];
    int x6D4; float x6D8[1];
    uint8_t pad6dc[0x7e8 - 0x6dc];
    u32 unk_kb_angle_min, unk_kb_angle_max, x7F0;
} ftCommonData;
_Static_assert(offsetof(ftCommonData, xF4) == 0xf4, "common offset mismatch");
_Static_assert(offsetof(ftCommonData, x144_radians) == 0x144, "common offset mismatch");
_Static_assert(offsetof(ftCommonData, x204_knockbackFrameDecay) == 0x204, "common offset mismatch");
_Static_assert(offsetof(ftCommonData, x438) == 0x438, "common offset mismatch");
_Static_assert(offsetof(ftCommonData, unk_kb_angle_min) == 0x7e8, "common offset mismatch");

typedef struct HSD_GObj { void* user_data; } HSD_GObj;
typedef HSD_GObj Fighter_GObj;
typedef struct { int x10; } SoundData;
typedef struct { SoundData* x4C_sfx; } FighterData;
typedef struct Fighter {
    ftCo_DatAttrs co_attrs;
    SmashAttr smash_attrs;
    Vec3 self_vel, x74_anim_vel, x6A4_transNOffset;
    float facing_dir, lstick_angle;
    float gr_vel, xE4_ground_accel_1;
    struct { struct { float x, y; } lstick[1]; } input;
    struct { struct { Vec3 normal; } floor; } coll_data;
    struct { struct {
        struct { bool x0, x4; float jump_mul; } jump;
        struct { float x0, x4; } run;
        struct { float x0; int x4; } dash;
        struct { float accel_mul; } turnrun;
        struct { float accel_mul, x0; } walk;
        struct { u32 x1A, x1B; } damage;
    } co; } mv;
    struct { float x1830_percent, x1838_percentTemp; u32 x1848_kb_angle; } dmg;
    FighterData* ft_data;
    HSD_GObj* x197C;
    u32 x671_timer_lstick_tilt_y;
    int ground_or_air;
    bool x2225_b7, x2224_b2;
} Fighter;
typedef struct HitCapsule { u32 x24, x28, x2C; } HitCapsule;
extern ftCommonData* p_ftCommonData;
float ft_GetGroundFrictionMultiplier(Fighter* fp);
void ft_800881D8(Fighter* fp, int sound, int volume, int pan);
void ft_PlaySFX(Fighter* fp, int sound, int volume, int pan);
void ftCommon_ApplyFrictionGround(Fighter*, float);
void ftCommon_ApplyGroundMovement(HSD_GObj*);
void ft_80084F3C(Fighter_GObj*);
void ftCommon_8007C98C(Fighter*, float, float, float);
void ftCommon_ApplyFrictionAir(Fighter*, float);
void ftCommon_8007D174(Fighter*, float, float, float, float);
void ftCommon_8007D28C(Fighter*, float);
void ftCommon_Fall(Fighter*, float, float);
void ftCommon_FallFast(Fighter*);
void ftCommon_Ascend(Fighter*, float, float);
void ftCommon_8007D2E8(Fighter*, float, float, float);
void ftCommon_8007D3A8(Fighter*, float, float, float);
void ftCommon_8007D140(Fighter*, float, float, float);
void ftCommon_8007D344(Fighter*, float, float, float);
void ft_80085134(Fighter_GObj*);
void ft_80085154(Fighter_GObj*);
float ftCommon_8007CD6C(float, float);
float ftCommon_CalcHitlag(int, FtMotionId, float);
void ftCo_Run_Phys(Fighter_GObj*);
void ftCo_Dash_Phys(Fighter_GObj*);
void ftCo_TurnRun_Phys(Fighter_GObj*);
void ftWalkCommon_800E0060(HSD_GObj*);
FtWalkType ftWalkCommon_GetWalkType(HSD_GObj*);
f32 ftCo_800DEEB8(Fighter*, f32);
void ftCo_800CB110(Fighter_GObj*, bool, float);
float ftColl_80079AB0(Fighter*, HitCapsule*, u32, float, float, float, float);
bool ftColl_8007AC68(u32);
float ftCo_Damage_CalcAngle(Fighter*, float);
float ftCo_ScaleBy154(float);
#endif
