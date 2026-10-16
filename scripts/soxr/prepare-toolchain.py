#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Download pinned toolchains into an explicit work directory; verify before extracting."""
import base64,hashlib,pathlib,tarfile,urllib.request,sys
from build import SDK_URL,SDK_SHA256,BINARYEN_URL,BINARYEN_INTEGRITY
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'work/toolchain').resolve();root.mkdir(parents=True,exist_ok=True)
for name,url,algorithm,digest in [('wasi-sdk.tar.gz',SDK_URL,'sha256',SDK_SHA256),('binaryen.tgz',BINARYEN_URL,'sha512',BINARYEN_INTEGRITY.split('-',1)[1])]:
 archive=root/name
 if not archive.exists():
  with urllib.request.urlopen(url) as response,archive.open('wb') as output:
   while chunk:=response.read(1024*1024):output.write(chunk)
 value=hashlib.new(algorithm,archive.read_bytes()).digest()
 actual=value.hex() if algorithm=='sha256' else base64.b64encode(value).decode()
 if actual!=digest:raise SystemExit('Toolchain checksum mismatch: '+str(archive))
 with tarfile.open(archive) as tar:tar.extractall(root,filter='data')
 print('Verified',archive)
print('WASI SDK:',root/'wasi-sdk-34.0-x86_64-linux')
print('Binaryen:',root/'package')
