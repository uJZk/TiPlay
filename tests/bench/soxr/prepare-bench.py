#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Prepare historical measurement references in work/, never in production vendor.
No network, C compiler or tracked legacy binary is needed.
Example: python3 tests/bench/soxr/prepare-bench.py --repo . --binaryen /tool/binaryen --output work/soxr-bench
"""
import argparse,hashlib,json,pathlib,shutil,subprocess,tempfile
REVISION='16c8c32fa920822d3faf3090f3b80d616a8b09c3'
WASM_SHA='544a26559464116514d5fd0d217ff59fa07410d0980fbeeebae05fa4dc0c8ffa'
WRAPPER_SHA='1a8e92963da1a1b10f9aec9a4549d72cc7aaec190334a9a8c9b0c71f79eaef18'
BASELINE_JS_SHA='e789e9446692081755763c924b26d79ca18f1e05b3f58cfc515a46ed80fbb04f'
FEATURES=['--enable-bulk-memory','--enable-bulk-memory-opt','--enable-nontrapping-float-to-int','--enable-sign-ext','--enable-mutable-globals']
def digest(data):return hashlib.sha256(data).hexdigest()
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--repo',type=pathlib.Path,default=pathlib.Path('.'))
 parser.add_argument('--binaryen',type=pathlib.Path,required=True,help='Pinned npm binaryen 132.0.0 package root')
 parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('work/soxr-bench'))
 parser.add_argument('--revision',default=REVISION,help='Historical revision; extracted file checksums remain mandatory')
 args=parser.parse_args();repo=args.repo.resolve();output=args.output.resolve();binaryen=args.binaryen.resolve()/'bin'
 # This purposefully rejects production/test tree destinations.
 if 'work' not in output.parts:raise SystemExit('--output must be inside an explicit work/ directory')
 output.mkdir(parents=True,exist_ok=True)
 if subprocess.check_output([str(binaryen/'wasm-opt'),'--version'],text=True).strip()!='wasm-opt version 132 (version_132)':raise SystemExit('Expected binaryen132')
 revision=subprocess.check_output(['git','-C',str(repo),'rev-parse',args.revision+'^{commit}'],text=True).strip()
 for old,new,expected in [('site/play/vendor/soxr/soxr.wasm','Existing.wasm',WASM_SHA),('site/play/streaming-resampler.js','Pinned-streaming-resampler.mjs',WRAPPER_SHA)]:
  data=subprocess.check_output(['git','-C',str(repo),'show',revision+':'+old])
  if digest(data)!=expected:raise SystemExit('Historical reference checksum mismatch: '+old)
  (output/new).write_bytes(data)
 with tempfile.TemporaryDirectory(prefix='soxr-bench-') as tmp:
  temp=pathlib.Path(tmp)
  subprocess.run([str(binaryen/'wasm-opt'),str(output/'Existing.wasm'),*FEATURES,'--llvm-nontrapping-fptoint-lowering','--llvm-memory-copy-fill-lowering','-o',str(temp/'lowered.wasm')],check=True)
  subprocess.run([str(binaryen/'wasm2js'),str(temp/'lowered.wasm'),'--enable-sign-ext','--enable-mutable-globals','-o',str(temp/'raw.mjs')],check=True)
  raw=(temp/'raw.mjs').read_text().split('\n',1)[1].split('var retasmFunc = asmFunc(')[0]
  source=HEADER+raw+FOOTER
  if digest(source.encode())!=BASELINE_JS_SHA:raise SystemExit('Generated historical JS baseline checksum mismatch')
  (output/'baseline.mjs').write_text(source)
 # Copy executable probes alongside their prepared references; production remains untouched.
 for name in ['Benchmark.mjs','Dsp-probe.mjs','Repeated.mjs','Csp-worklet.mjs','production-csp.txt']:
  source=pathlib.Path(__file__).resolve().parent/name
  if source.exists():shutil.copy(source,output/name)
 metadata={'revision':revision,'wasmSha256':WASM_SHA,'wrapperSha256':WRAPPER_SHA,'baselineJsSha256':BASELINE_JS_SHA,'binaryen':'132.0.0','scope':'Historical references for benchmarks only; never a production fallback'}
 (output/'references.json').write_text(json.dumps(metadata,indent=2)+'\n')
 print('Prepared verified benchmark references:',output)
 print('Restore the preceding shipped candidate as described in tests/bench/soxr/README.md:', repo/'work/soxr-before.mjs')
 print('Run:', 'node --disallow-code-generation-from-strings', output/'Benchmark.mjs', repo/'work/soxr-before.mjs', '4000 500')

HEADER='// SPDX-License-Identifier: GPL-3.0-only\n// libsoxr LGPL-2.1-or-later; generated wasm2js (asm.js-like; not validated asm.js).\nexport default function createSoxr() {\n'
FOOTER="\nconst wasi_snapshot_preview1 = {\n environ_get: () => 0,\n environ_sizes_get: (count, size) => { const heap = new Int32Array(bufferView.buffer); heap[count >> 2] = 0; heap[size >> 2] = 0; return 0; },\n clock_time_get: (_clock, _low, _high, pointer) => { new Uint8Array(bufferView.buffer, pointer, 8).fill(0); return 0; },\n proc_exit: code => { throw new Error(`libsoxr exited (${code})`); }\n};\nconst api = asmFunc({ wasi_snapshot_preview1 });\napi._initialize();\nconst module = { exports: api };\nfor (const name of ['tiplay_create', 'tiplay_process', 'tiplay_ratio', 'tiplay_input_done', 'tiplay_output_done', 'tiplay_delete', 'malloc', 'free']) module['_' + name] = api[name];\nObject.defineProperties(module, { HEAPU8: { get: () => new Uint8Array(api.memory.buffer) }, HEAPF32: { get: () => new Float32Array(api.memory.buffer) } });\nreturn module;\n}\n"
if __name__=='__main__':main()
