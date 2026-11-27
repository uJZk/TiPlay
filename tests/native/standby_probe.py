"""Measure a published build on an owned API 36 emulator, in ticks per elapsed second."""
import re
import subprocess
import time

PACKAGE = "com.ujzk.tiplay"
def shell(command):
    return subprocess.check_output(["adb", "shell", command], text=True).strip()

def snapshot():
    pid = shell(f"pidof {PACKAGE} || true")
    if not pid:
        raise RuntimeError("App process absent")
    raw = shell(f"cat /proc/{pid}/stat /proc/{pid}/task/*/stat 2>/dev/null || true")
    rows = []
    for line in raw.splitlines():
        tid, name, fields = re.fullmatch(r"(\d+) \((.*)\) (.*)", line).groups()
        fields = fields.split()
        rows.append(((tid, fields[19], name), int(fields[11]) + int(fields[12])))
    return time.monotonic(), rows[0], dict(rows[1:])

def measure(label):
    time.sleep(12)
    print("STAGE", label, flush=True)
    print(shell("dumpsys activity activities | grep -m 1 mResumedActivity || dumpsys window | grep -m 1 mCurrentFocus"), flush=True)
    print(shell("dumpsys power | grep -m 1 mWakefulness="))
    print(shell(f"dumpsys activity services {PACKAGE} | grep 'ServiceRecord' | head -10"))
    a, proc, threads = snapshot()
    time.sleep(60)
    b, end, current = snapshot()
    if proc[0] != end[0]:
        raise RuntimeError("Process restarted during sample")
    unit = 100 / (hz * (b - a))
    top = sorted(((v - threads[k], k[2]) for k, v in current.items() if k in threads), reverse=True)[:8]
    print("RESULT", label, "one_core_pct", round((end[1]-proc[1])*unit, 2),
          "threads", [(name, round(delta*unit, 2)) for delta, name in top], flush=True)

hz = int(shell("getconf CLK_TCK"))
shell("settings put system screen_off_timeout 900000")
shell("dumpsys battery unplug")
shell(f"am start -W -n {PACKAGE}/com.shilapi.xcertplay.CarPlayHostActivity")
measure("foreground")
shell("input keyevent KEYCODE_HOME")
measure("background")
shell("input keyevent KEYCODE_SLEEP")
measure("screen-off")
shell("svc wifi disable")
measure("screen-off-no-wifi")
shell(f"am force-stop {PACKAGE}")
print("CONTROL app_pid_after_force_stop", shell(f"pidof {PACKAGE} || echo absent"))
