#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Reproduce TiPlay's standalone, no-runtime-WASM libsoxr typed-JS backend.
Requires Python 3.12+, patch, Node 22, pinned WASI SDK34 and binaryen npm132.
Compilation uses an intermediate .wasm; shipped playback uses only static JS.
"""
import argparse,hashlib,pathlib,re,subprocess,tarfile,tempfile
COMMIT='945b592b70470e29f917f4de89b4281fbbd540c0'
SOURCE_SHA256='ae970b44833c7dd2b088d5928b27c7f1796198ff5bc5386b90393aaf33e53d51'
SDK_SHA256='b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4'
SDK_URL='https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-x86_64-linux.tar.gz'
BINARYEN_URL='https://registry.npmjs.org/binaryen/-/binaryen-132.0.0.tgz'
BINARYEN_INTEGRITY='sha512-4Usg7yEvwO3FMso3Oov6qkOOHSod1IEv+boKkh77kTljM+eNBouqCTbqWswGzbG+vDNO/b/v2C4gfEh1WgB9Lg=='
EXPORTS=['tiplay_create','tiplay_process','tiplay_ratio','tiplay_input_done','tiplay_output_done','tiplay_delete','malloc','free']
FEATURES=['--enable-bulk-memory','--enable-bulk-memory-opt','--enable-nontrapping-float-to-int','--enable-sign-ext','--enable-mutable-globals']
def main():
 a=argparse.ArgumentParser(description=__doc__)
 a.add_argument('--sdk',type=pathlib.Path,required=True)
 a.add_argument('--binaryen',type=pathlib.Path,required=True,help='binaryen npm package directory (containing bin/)')
 root=pathlib.Path(__file__).resolve().parents[2]
 a.add_argument('--output',type=pathlib.Path,default=root/'site/play/vendor/soxr/soxr.asm.js')
 a.add_argument('--source-dir',type=pathlib.Path,default=root/'site/play/vendor/soxr/source')
 args=a.parse_args();src=args.source_dir.resolve();sdk=args.sdk.resolve();bin=args.binaryen.resolve()/'bin'
 archive=src/'soxr-source.tar.gz'
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=SOURCE_SHA256:raise SystemExit('source checksum mismatch')
 if subprocess.check_output([str(bin/'wasm-opt'),'--version'],text=True).strip()!='wasm-opt version 132 (version_132)':raise SystemExit('expected binaryen version 132')
 with tempfile.TemporaryDirectory(prefix='tiplay-js-build-') as tmp:
  b=pathlib.Path(tmp)
  with tarfile.open(archive) as tar:tar.extractall(b,filter='data')
  s=b/('soxr-'+COMMIT)
  subprocess.run(['patch','-p1','--batch','--forward','-i',str(src/'tiplay.patch')],cwd=s,check=True)
  enabled={'HAVE_FENV_H','HAVE_STDBOOL_H','HAVE_STDINT_H','HAVE_LRINT','WITH_VR32','WITH_HI_PREC_CLOCK'}
  (b/'soxr-config.h').write_text(re.sub(r'#cmakedefine01 (\w+)',lambda m:'#define '+m[1]+' '+str(int(m[1] in enabled)),(s/'soxr-config.h.in').read_text()))
  subprocess.run([str(sdk/'bin/clang'),'-O3','-flto','-DNDEBUG','-DSOXR_LIB','-I'+str(s/'src'),'-I'+str(b),str(s/'src/soxr.c'),str(s/'src/data-io.c'),str(s/'src/vr32.c'),str(src/'soxr-wrapper.c'),'-mexec-model=reactor','-Wl,--initial-memory=16777216','-Wl,--max-memory=16777216',*['-Wl,--export='+n for n in EXPORTS],'-Wl,--strip-all','-lm','-o',str(b/'engine.wasm')],check=True)
  subprocess.run([str(bin/'wasm-opt'),str(b/'engine.wasm'),*FEATURES,'--llvm-nontrapping-fptoint-lowering','--llvm-memory-copy-fill-lowering','-O3','-o',str(b/'lowered.wasm')],check=True)
  subprocess.run([str(bin/'wasm2js'),str(b/'lowered.wasm'),'--enable-sign-ext','--enable-mutable-globals','-o',str(b/'raw.mjs')],check=True)
  args.output.parent.mkdir(parents=True,exist_ok=True)
  subprocess.run(['python3',str(src/'wrap.py'),str(b/'raw.mjs'),str(args.output.resolve())],check=True)
 print(hashlib.sha256(args.output.read_bytes()).hexdigest(),args.output)
if __name__=='__main__':main()
