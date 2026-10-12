# WSLC build supplement

This file supplements [BUILD.md](BUILD.md) for Windows builds through `wslc`.
Use BUILD.md for source selection, checks, signing, runtime identity and APK update
contracts. Tool versions and required tasks come from the linked CI workflow.

## Reuse the container and separate filesystems

WSLC and a WSL distribution's Podman have separate container inventories. An empty
`podman ps` in WSL does not establish that no WSLC build container exists. Inspect
`wslc list` and the selected container's mounts before creating another environment.
Use `wslc exec --help` for supported options; its inspect formatting need not match
Docker or Podman templates.

Use the Windows repository mount to exchange inputs and deliver APKs. Prefer a
container Linux filesystem for compilation and Gradle caches: Windows/OneDrive
mounts impose extra metadata I/O and can expose different file permissions or
line endings. Copy the intended source using the source-selection rules in BUILD.md,
then return only the verified output to the host. Keep toolchain paths, container
names and mounts in local configuration rather than assuming another machine's layout.

Windows paths are host inputs. Gradle environment variables inside the container
must reference Linux paths visible to that container. Configure `JAVA_HOME`,
`ANDROID_HOME` and `PATH` together so Gradle and subprocesses use the same toolchain.

If a wrapper copied from Windows has CRLF line endings, normalize the shell script
in the disposable build copy. `sh ./gradlew` handles a missing executable bit but
does not repair CRLF. Preserve the selected source's wrapper JAR and distribution
properties; replacing them with a cached wrapper can select a different Gradle build.

## Pass signing inputs without logging them

A host vault does not need to be mounted into the container. A local PowerShell
driver can read the selected keystore and password file, encode them as a JSON
payload and pipe it to a container-side helper with `wslc exec -i`. Base64 preserves
binary data across the text pipe; it is not encryption. Never print the payload,
put it in command arguments or save it in the repository.

The helper should read standard input, decode the keystore into a private temporary
directory and remove that directory even if the build fails. Restrict the keystore
file permissions. Decode password text using the file's encoding; account for a
UTF-8 BOM and a trailing file newline without stripping intentional password characters.
Pass passwords to Gradle through its documented environment variables and to
keytool with `-storepass:env`. Capture keytool output to select the signing alias;
keep the selected entry type check separate from assumptions about alias names.

The APK's runtime assets and the signing keystore need separate input directories.
Use the artifact verification in BUILD.md before copying the APK back to Windows.
Do not rely on a successful signing task to prove that the packaged runtime identity
matches the intended inputs.

## Keep USB ADB on the Windows host

Use Windows ADB for a phone already attached to Windows. Container USB access or
another ADB server is unnecessary for building the APK and introduces a separate
device-access problem. The container builds and verifies; Windows ADB pulls the
installed APK for comparison, installs the returned APK and verifies startup.

Run ADB in a context with access to its user configuration directory. In a restricted
agent sandbox, a permission failure while creating `.android` can precede any device
communication; it does not mean the phone is disconnected. Use an authorized host
execution context or configure a writable ADB user directory, preserving the existing
host pairing keys when reuse is intended. Follow BUILD.md for update verification.
