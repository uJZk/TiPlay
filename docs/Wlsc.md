# Windows container builds

Use [Build](Build.md) for toolchain versions, source checks, signing/runtime identity and APK updates. This supplement covers Windows builds through `wslc`.

## Source and toolchain

Inspect `wslc list` and the selected container's mounts before creating another environment. WSLC and a WSL distribution's Podman have separate inventories; use `wslc exec --help` for supported options.

Exchange inputs and verified APKs through the Windows repository mount, but compile and cache on the container's Linux filesystem where practical. Copy the intended source according to Build's source-selection rules. Keep container names, mounts and tool paths in local configuration.

Container `JAVA_HOME`, `ANDROID_HOME` and `PATH` must use container-visible Linux paths. Repair CRLF/executable-bit problems only in the disposable source copy; `sh ./gradlew` does not fix CRLF. Preserve the selected wrapper JAR and distribution properties.

## Resource limits

For constrained hosts, enforce and verify a container cgroup memory limit. JVM heap limits alone do not bound native graphics/test memory. Run Gradle serially with bounded workers, no persistent daemon and Kotlin in-process; bound test heaps/forks and retire test workers periodically. Keep machine-specific settings outside application source.

Before restoring temporary limits, verify build JVMs have stopped. If VM caches retain memory, end only the relevant WSLC session, preserving container storage and unrelated WSL distributions. After restart, check network prerequisites such as IPv6 before diagnosing socket-test failures.

## Signing inputs

A local PowerShell driver can pipe a JSON payload to a container helper through `wslc exec -i`, without mounting the host vault. Base64 preserves binary keystore bytes; it is not encryption. Never print payloads, pass them in command arguments or save them in Git.

The helper should decode inputs into a private temporary directory, restrict permissions and remove it on success/failure. Handle password-file encoding, BOM and trailing newline without stripping intentional password characters. Pass passwords through the documented signing environment variables; use `keytool -storepass:env` and verify the selected alias is a `PrivateKeyEntry`.

Keep runtime assets separate from the signing keystore. Verify signatures, application identity and packaged runtime bytes as described in Build before returning the APK to Windows.

## Device updates

Use Windows ADB for a phone attached to Windows; container USB access is unnecessary for compilation. Windows ADB pulls the installed APK for comparison, installs the verified result and checks startup.

ADB needs a writable user configuration directory. A sandbox failure creating `.android` can occur before device communication. Use the authorized host context or a writable ADB user directory, preserving host pairing keys when intended. Follow Build's same-package/same-signing-key update checks to retain settings.
