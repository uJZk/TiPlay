/* SPDX-License-Identifier: GPL-3.0-only */
/* Bounded marshaling only. All multiple-precision arithmetic is LibTomMath. */
#include "tommath.h"
#include <wasi/api.h>

static char arena[4096];

static mp_err browser_random(void *bytes, size_t length)
{
    return __wasi_random_get(bytes, length) == 0 ? MP_OKAY : MP_ERR;
}

void srp_initialize(void) { mp_rand_source(browser_random); }
int srp_scratch(void) { return (int)(uintptr_t)arena; }

int srp_pow(void)
{
    mp_int base, exponent, modulus, result;
    mp_err error = mp_init_multi(&base, &exponent, &modulus, &result, NULL);
    if (error != MP_OKAY) return error;
    if ((error = mp_read_radix(&base, arena, 16)) != MP_OKAY ||
        (error = mp_read_radix(&exponent, arena + 1024, 16)) != MP_OKAY ||
        (error = mp_read_radix(&modulus, arena + 2048, 16)) != MP_OKAY ||
        (error = mp_exptmod(&base, &exponent, &modulus, &result)) != MP_OKAY) goto done;
    error = mp_to_radix(&result, arena + 3072, 1024, NULL, 16);
done:
    /* Use upstream cleanup; the host also clears the complete heap on disposal. */
    mp_clear_multi(&base, &exponent, &modulus, &result, NULL);
    return error;
}
