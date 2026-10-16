#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
from pathlib import Path
import sys
raw=Path(sys.argv[1]).read_text().split('\n',1)[1].split('var retasmFunc = asmFunc(')[0]
header='// SPDX-License-Identifier: GPL-3.0-only\n// libsoxr LGPL-2.1-or-later; generated wasm2js (asm.js-like; not validated asm.js).\nexport default function createSoxr() {\n'
footer="\nconst wasi_snapshot_preview1 = {\n random_get: () => 52, // ENOSYS: libc uses its non-cryptographic stack-guard fallback.\n environ_get: () => 0,\n environ_sizes_get: (count, size) => { const heap = new Int32Array(bufferView.buffer); heap[count >> 2] = 0; heap[size >> 2] = 0; return 0; },\n clock_time_get: (_clock, _low, _high, pointer) => { new Uint8Array(bufferView.buffer, pointer, 8).fill(0); return 0; },\n proc_exit: code => { throw new Error(`libsoxr exited (${code})`); }\n};\nconst api = asmFunc({ wasi_snapshot_preview1 });\napi._initialize();\nconst module = { exports: api };\nfor (const name of ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done', 'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']) module['_' + name] = api[name];\nmodule.HEAPU8 = new Uint8Array(api.memory.buffer);\nmodule.HEAPF32 = new Float32Array(api.memory.buffer);\nreturn module;\n}\n"
Path(sys.argv[2]).write_text(header+raw+footer)
