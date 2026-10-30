#!/usr/bin/env python3
"""Generate a disposable GitHub workflow for a TEST ONLY overload AAR."""
import argparse
from pathlib import Path


OVERLOAD_STEP = '''      - name: Run TEST ONLY forced-overload sender proof
        shell: bash
        run: |
          set -euo pipefail
          grep -F 'tiplay::QueueLimit{0, 0} /* TEST ONLY: forced overload */' scripts/webrtc/source-rate-video.patch
          root="$RUNNER_TEMP/tiplay-proof"
          aar="$RUNNER_TEMP/tiplay-proof-input/validated/tiplay-source-rate.aar"
          fixture="$RUNNER_TEMP/tiplay-high.h264"
          python3 scripts/webrtc/make_overload_probe.py tests/native/NativeVideoProbe.java "$RUNNER_TEMP/NativeVideoProbe.java"
          cp "$RUNNER_TEMP/NativeVideoProbe.java" tests/native/NativeVideoProbe.java
          python3 tests/native/rtc-video-probe.py build --work-dir "$root/custom" --webrtc-aar "$aar" --abi x86_64 --fixture "$fixture"
          adb shell mkdir -p /data/local/tmp/tiplay-native-probe
          adb push "$root/custom/probe.jar" "$root/custom/fixture.h264" "$root/custom/libjingle_peerconnection_so.so" /data/local/tmp/tiplay-native-probe/
          adb shell 'CLASSPATH=/data/local/tmp/tiplay-native-probe/probe.jar app_process /system/bin com.shilapi.xcertplay.web.NativeVideoProbe bundle 0 0 180 warm info source-rate queue-epoch' > "$root/overload.log" 2>&1 || { tail -n 120 "$root/overload.log"; exit 1; }
          python3 scripts/webrtc/verify_overload_evidence.py "$root/overload.log" "$root/overload.json"
'''


def generate(template):
    start = template.index('      - name: Run custom and stock AAR controls\n')
    end = template.index('      - name: Upload bounded synthetic probe evidence\n', start)
    return template[:start] + OVERLOAD_STEP + template[end:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('template', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    if args.template.resolve() == args.output.resolve():
        parser.error('template and output must differ')
    args.output.write_text(generate(args.template.read_text(encoding='utf-8')), encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
