#ifndef SMASH_WEB_RNG_PLATFORM_H
#define SMASH_WEB_RNG_PLATFORM_H

/* Minimal ABI shim for the RNG translation unit ONLY. Not a Dolphin SDK port.
 * Explicit widths also avoid the original unsigned-long / LP64 mismatch. */
#include <stdint.h>
typedef uint32_t u32;
typedef int32_t s32;
typedef float f32;
_Static_assert(sizeof(u32) == 4, "GameCube u32 must be 32 bits");
_Static_assert(sizeof(f32) == 4, "GameCube f32 must be 32 bits");

#endif
