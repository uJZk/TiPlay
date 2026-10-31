#!/usr/bin/env python3
"""Verify the publisher warning policy preserves the legacy decoder bytecode."""
import argparse
from pathlib import Path
import subprocess
import tempfile
from build import publisher_inputs

RELATIVE = Path("sdk/android/api/org/webrtc/WrappedVideoDecoderFactory.java")
PATCH = Path(__file__).resolve().with_name("publisher-compat.patch")


def write(root, name, content):
    target = root / name
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    return target


def compile_factory(root, factory, output, *, warnings_as_errors=True):
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
    return subprocess.run(["javac", "-Xlint:unchecked", *(["-Werror"] if warnings_as_errors else []), "-d", str(output),
                           str(media), str(annotation), str(stubs), str(factory)],
                          text=True, capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pristine", type=Path, required=True,
                        help="The exact pinned source file before compatibility patches")
    parser.add_argument("--publisher-build", type=Path, required=True)
    args = parser.parse_args()
    publisher = publisher_inputs(args.publisher_build)
    warnings_as_errors = "treat_warnings_as_errors=true" in publisher["record"]["android_gn_args"]
    with tempfile.TemporaryDirectory(prefix="tiplay-javac-compat-") as directory:
        root = Path(directory)
        factory = root / RELATIVE
        factory.parent.mkdir(parents=True)
        factory.write_bytes(args.pristine.read_bytes())
        unpatched = compile_factory(root, factory, root / "before", warnings_as_errors=warnings_as_errors)
        if unpatched.returncode != 0 or "unchecked" not in unpatched.stderr:
            raise RuntimeError("Publisher warning policy did not compile the original unchecked source:\n" + unpatched.stderr)
        subprocess.run(["git", "apply", "--include=" + str(RELATIVE), str(PATCH)],
                       cwd=root, check=True)
        patched = compile_factory(root, factory, root / "after")
        if patched.returncode != 0:
            raise RuntimeError("Patched decoder factory failed javac:\n" + patched.stderr)
        before = {path.relative_to(root / "before"): path.read_bytes() for path in (root / "before").rglob("*.class")}
        after = {path.relative_to(root / "after"): path.read_bytes() for path in (root / "after").rglob("*.class")}
        if not before or before != after:
            raise RuntimeError("Publisher warning policy changed generated class bytes")
        print(f"Publisher warning policy and legacy generic fix produce identical bytes for all {len(before)} class files")


if __name__ == "__main__":
    main()
