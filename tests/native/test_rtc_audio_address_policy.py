#!/usr/bin/env python3
"""Compile actual libjuice addr.c and check the host-candidate address policy.

Run after preparing the pinned, patched native sources, for example:
  python3 tests/native/test_rtc_audio_address_policy.py \
    --source-dir /tmp/tiplay-rtc-audio/src/libdatachannel/deps/libjuice

No sources are downloaded. Exit 0 means all compiled cases pass, 1 means a policy
regression, and 2 means the check could not run (including missing prerequisites).
This is a classification check, not an ICE, Android, or vehicle playback proof.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile


# True means addr_is_local excludes the address from wildcard host gathering.
# These are synthetic literals; none come from a device or diagnostic capture.
CASES = (
    ("127.0.0.0", True),
    ("127.0.0.1", True),
    ("127.255.255.255", True),
    ("126.255.255.255", False),
    ("128.0.0.0", False),
    ("169.254.0.0", False),
    ("169.254.0.1", False),
    ("169.254.111.111", False),
    ("169.254.255.254", False),
    ("169.254.255.255", False),
    ("169.253.255.255", False),
    ("169.255.0.0", False),
    ("0.0.0.0", False),
    ("10.0.0.1", False),
    ("192.0.2.1", False),
    ("255.255.255.255", False),
    ("::ffff:127.0.0.0", True),
    ("::ffff:127.0.0.1", True),
    ("::ffff:127.255.255.255", True),
    ("::ffff:126.255.255.255", False),
    ("::ffff:128.0.0.0", False),
    ("::ffff:169.254.0.0", False),
    ("::ffff:169.254.0.1", False),
    ("::ffff:169.254.111.111", False),
    ("::ffff:169.254.255.254", False),
    ("::ffff:169.254.255.255", False),
    ("::ffff:169.253.255.255", False),
    ("::ffff:169.255.0.0", False),
    ("::ffff:192.0.2.1", False),
    ("::1", True),
    ("fe80::", True),
    ("fe80::1", True),
    ("febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", True),
    ("fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff", False),
    ("fec0::", False),
    ("fec0::1", False),
    ("fc00::1", False),
    ("2001:db8::1", False),
    ("::", False),
)


def driver_source():
    literals = ",\n".join("    " + json.dumps(address) for address, _ in CASES)
    return r'''
#include "addr.h"
#include "log.h"
#include <stdio.h>
#include <string.h>

/* Only unrelated logging is stubbed. addr_is_local comes from actual addr.c. */
bool juice_log_is_enabled(juice_log_level_t level) {
    (void)level;
    return false;
}
void juice_log_write(juice_log_level_t level, const char *file, int line,
                     const char *fmt, ...) {
    (void)level; (void)file; (void)line; (void)fmt;
}

int main(void) {
    const char *addresses[] = {
''' + literals + r'''
    };
    for (size_t i = 0; i < sizeof(addresses) / sizeof(addresses[0]); ++i) {
        struct sockaddr_storage storage;
        memset(&storage, 0, sizeof(storage));
        int family = strchr(addresses[i], ':') ? AF_INET6 : AF_INET;
        void *address;
        if (family == AF_INET6) {
            struct sockaddr_in6 *sa = (struct sockaddr_in6 *)&storage;
            sa->sin6_family = AF_INET6;
            address = &sa->sin6_addr;
        } else {
            struct sockaddr_in *sa = (struct sockaddr_in *)&storage;
            sa->sin_family = AF_INET;
            address = &sa->sin_addr;
        }
        if (inet_pton(family, addresses[i], address) != 1)
            return 2;
        printf("%zu %d\n", i, addr_is_local((struct sockaddr *)&storage));
    }
    struct sockaddr unspecified;
    memset(&unspecified, 0, sizeof(unspecified));
    unspecified.sa_family = AF_UNSPEC;
    printf("%zu %d\n", sizeof(addresses) / sizeof(addresses[0]),
           addr_is_local(&unspecified));
    return 0;
}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir", type=Path,
        default=Path("/tmp/tiplay-rtc-audio/src/libdatachannel/deps/libjuice"),
        help="prepared libjuice root containing src/addr.c; never downloaded")
    parser.add_argument("--cc", default=os.environ.get("CC", "cc"),
                        help="host C compiler command (default: CC or cc)")
    args = parser.parse_args()
    source = args.source_dir.resolve()
    evidence = {"source_dir": str(source), "cases": len(CASES) + 1}
    try:
        required = ("src/addr.c", "src/addr.h", "src/log.h", "src/socket.h",
                    "include/juice/juice.h")
        missing = [name for name in required if not (source / name).is_file()]
        if missing:
            raise RuntimeError("missing prepared libjuice files: " + ", ".join(missing)
                               + "; supply --source-dir pointing to prepared sources")
        evidence["addr_c_sha256"] = hashlib.sha256(
            (source / "src/addr.c").read_bytes()).hexdigest()
        compiler = shlex.split(args.cc)
        if not compiler or not shutil.which(compiler[0]):
            raise RuntimeError("host C compiler unavailable; supply --cc")
        version = subprocess.run(compiler + ["--version"], check=True,
                                 capture_output=True, text=True, timeout=15)
        evidence["compiler"] = version.stdout.splitlines()[0]
        with tempfile.TemporaryDirectory(prefix="tiplay-addr-policy-") as temporary:
            temporary = Path(temporary)
            driver = temporary / "address_policy.c"
            driver.write_text(driver_source(), encoding="utf-8")
            binary = temporary / "address_policy"
            subprocess.run(
                compiler + ["-std=c11", "-D_GNU_SOURCE", "-DJUICE_STATIC",
                            "-Wall", "-Wextra", "-Werror",
                            "-I" + str(source / "src"),
                            "-I" + str(source / "include/juice"),
                            str(source / "src/addr.c"), str(driver),
                            "-o", str(binary)],
                check=True, capture_output=True, text=True, timeout=60)
            run = subprocess.run([str(binary)], check=True, capture_output=True,
                                 text=True, timeout=15)
        rows = run.stdout.splitlines()
        if len(rows) != len(CASES) + 1:
            raise RuntimeError("compiled driver returned an incomplete result set")
        failures = []
        for index, ((address, expected), row) in enumerate(zip(
                (*CASES, ("AF_UNSPEC", False)), rows, strict=True)):
            fields = row.split()
            if fields not in ([str(index), "0"], [str(index), "1"]):
                raise RuntimeError("compiled driver returned an invalid result row")
            actual = fields[1] == "1"
            if actual != expected:
                failures.append({"address": address, "expected_local": expected,
                                 "actual_local": actual})
        evidence.update(status="fail" if failures else "pass",
                        passed=len(rows) - len(failures), failures=failures)
        print(json.dumps(evidence, sort_keys=True))
        return 1 if failures else 0
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        evidence.update(status="blocked", error=str(error))
        if isinstance(error, subprocess.CalledProcessError):
            evidence["stderr"] = error.stderr[-8192:] if error.stderr else ""
        print(json.dumps(evidence, sort_keys=True))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
