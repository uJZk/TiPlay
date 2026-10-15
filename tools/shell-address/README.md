# Shell address check

`AddAddr` checks whether the ADB shell user can put a 100.64.0.0/10 address on the phone's hotspot interface
through the `network_management` service. Shizuku without root runs as the same user (uid 2000), so this isolates the shell service-call permission. TiPlay authorization,
link-local address support and car-browser reachability need separate checks.

The interface name must carry an alias (`wlan2:tp`). Without it, the system first clears the interface's IPv4
addresses, which cuts every device off the hotspot until it restarts. The tool refuses a name without an alias.

Run the build from `tools/shell-address/` (needs a JDK and the Android SDK build tools):

```sh
javac --release 11 -d out AddAddr.java
"$ANDROID_HOME/build-tools/36.0.0/d8" --min-api 28 --lib "$ANDROID_HOME/platforms/android-37.0/android.jar" --output out out/AddAddr.class
```

Run with the hotspot on (`adb shell ip -4 addr` shows its interface, e.g. `wlan2`). If the address is already
there from a root test, remove it first, or the check can only report "File exists":

```sh
adb push out/classes.dex /data/local/tmp/addaddr.dex
adb shell "su -c 'ip addr del 100.109.220.253/32 dev wlan2'"   # only on a rooted phone, only if present
adb shell CLASSPATH=/data/local/tmp/addaddr.dex app_process /system/bin AddAddr wlan2:tp 100.109.220.253/32
adb shell ip -4 addr show wlan2
```

The CGNAT example is a diagnostic address, not TiPlay's current default. `AddAddr`
accepts only its `100.x.y.z/32` input form; it does not test the app's link-local method
or reproduce its app-process hidden-API restrictions. It reports interface addresses
to the console, so redact captures before sharing.

A completed service-call check prints a final `RESULT:` line; invalid arguments instead print usage and exit 64:

| Output | Meaning |
|---|---|
| `OK`, and `ip` shows both addresses | The shell service call can add the address; app authorization and car reachability still need checks |
| `File exists` | The permission check passed; the address was already there |
| `SecurityException` | The ROM blocks it; the shell user cannot change interface addresses |

The address goes away when the hotspot restarts. The shell user cannot remove it.

TiPlay's Shizuku hotspot address method makes the same call from the app; see
[docs/Hotspot-address.md](../../docs/Hotspot-address.md).
