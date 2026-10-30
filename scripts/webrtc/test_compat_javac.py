#!/usr/bin/env python3
"""Compile the exact pinned decoder factory with and without our patch."""
import argparse
from pathlib import Path
import subprocess
import tempfile

RELATIVE = Path("sdk/android/api/org/webrtc/WrappedVideoDecoderFactory.java")
PATCH = Path(__file__).resolve().with_name("publisher-compat.patch")


def write(root, name, content):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def compile_factory(root, factory, output):
    media = write(root, "android/media/MediaCodecInfo.java",
                  "package android.media; public class MediaCodecInfo {}\n")
    annotation = write(root, "androidx/annotation/Nullable.java",
                       "package androidx.annotation; public @interface Nullable {}\n")
    stubs = write(root, "org/webrtc/Stubs.java", """\
package org.webrtc;
class EglBase { static class Context {} }
class VideoCodecInfo {}
interface VideoDecoder { String getImplementationName(); void release(); }
interface VideoDecoderFactory { VideoDecoder createDecoder(VideoCodecInfo c); VideoCodecInfo[] getSupportedCodecs(); }
class HardwareVideoDecoderFactory implements VideoDecoderFactory {
  HardwareVideoDecoderFactory(EglBase.Context c) {}
  public VideoDecoder createDecoder(VideoCodecInfo c) { return null; }
  public VideoCodecInfo[] getSupportedCodecs() { return new VideoCodecInfo[0]; }
}
class SoftwareVideoDecoderFactory extends HardwareVideoDecoderFactory {
  SoftwareVideoDecoderFactory() { super(null); }
}
class PlatformSoftwareVideoDecoderFactory extends HardwareVideoDecoderFactory {
  PlatformSoftwareVideoDecoderFactory(EglBase.Context c) { super(c); }
}
class VideoDecoderFallback implements VideoDecoder {
  VideoDecoderFallback(VideoDecoder a, VideoDecoder b) {}
  public String getImplementationName() { return ""; }
  public void release() {}
}
""")
    output.mkdir()
    return subprocess.run(["javac", "-Xlint:unchecked", "-Werror", "-d", str(output),
                           str(media), str(annotation), str(stubs), str(factory)],
                          text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pristine", type=Path, required=True,
                        help="The exact pinned source file before compatibility patches")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="tiplay-javac-compat-") as directory:
        root = Path(directory)
        factory = root / RELATIVE
        factory.parent.mkdir(parents=True)
        factory.write_bytes(args.pristine.read_bytes())
        unpatched = compile_factory(root, factory, root / "before")
        if unpatched.returncode == 0 or "unchecked" not in unpatched.stderr:
            raise RuntimeError("Expected the original unchecked warning to fail javac")
        subprocess.run(["git", "apply", "--include=" + str(RELATIVE), str(PATCH)],
                       cwd=root, check=True)
        patched = compile_factory(root, factory, root / "after")
        if patched.returncode != 0:
            raise RuntimeError("Patched decoder factory failed javac:\n" + patched.stderr)
        print("Pinned decoder factory: unchecked warning rejected before patch; patched compilation passed")


if __name__ == "__main__":
    main()
