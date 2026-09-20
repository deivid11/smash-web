/* This wrapper exercises only Melee's original RNG, not gameplay. */
#include <sysdolphin/baselib/random.h>

void probe_set_seed(u32 value) { *seed_ptr = value; }
u32 probe_get_seed(void) { return *seed_ptr; }
