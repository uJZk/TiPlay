/* SPDX-License-Identifier: GPL-3.0-only */
package com.shilapi.xcertplay.web;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;
import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.net.InetAddress;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import kotlin.Unit;

/** Test-APK-only RPC driver. No Activity, capture device, identity or production routing override. */
public final class NativeAudioProbeInstrumentation extends Instrumentation {
    private final Object outputLock = new Object();
    private final List<String> failures = new CopyOnWriteArrayList<>();
    private BrowserRtcAudioRouter router;
    private PrintWriter output;
    private Bundle arguments;
    private String stage = "instrumentation-start";
    private UdpEchoProbe udpProbe;

    @Override public void onCreate(Bundle values) {
        arguments = values == null ? new Bundle() : new Bundle(values);
        super.onCreate(values);
        start();
    }

    @Override public void onStart() {
        Bundle result = new Bundle();
        int resultCode = Activity.RESULT_CANCELED;
        ExecutorService signaling = Executors.newSingleThreadExecutor();
        try {
            stage = "runtime-proof";
            Map<String, Object> proof = runtimeProof();
            stage = "rpc-listen";
            try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) {
                server.setSoTimeout(60_000);
                Bundle ready = new Bundle();
                ready.putInt("tiplayRpcPort", server.getLocalPort());
                sendStatus(0, ready);
                stage = "rpc-accept";
                try (Socket socket = server.accept();
                     BufferedReader input = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8))) {
                    socket.setSoTimeout(60_000);
                    output = new PrintWriter(new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true);
                    send(map("k", "android-runtime-proof", "proof", proof));
                    // Main libWebRTC is initialized above before this class can create its audio peer.
                    stage = "native-router-create";
                    router = new BrowserRtcAudioRouter(
                        reason -> { nativeFailure(reason); return Unit.INSTANCE; },
                        (slots, failed) -> new NativeRtcAudioPeer(slots, failed, ignored -> Unit.INSTANCE, System::nanoTime),
                        (record, submit) -> { submit.invoke(); return Unit.INSTANCE; }, System::nanoTime);
                    stage = "rpc-commands";
                    String line;
                    while ((line = input.readLine()) != null) {
                        if (line.length() > 192 * 1024) throw new IllegalArgumentException("probe-command-too-large");
                        Map<?, ?> command = (Map<?, ?>) WebJson.INSTANCE.parse(line);
                        String kind = String.valueOf(command.get("k"));
                        if ("offer".equals(kind)) {
                            signaling.submit(() -> {
                                try {
                                    String answer = router.answer((String) command.get("sdp"), ((Number) command.get("generation")).intValue());
                                    Map<String, Object> value = response(command, "answer");
                                    value.put("sdp", answer); value.put("generation", command.get("generation"));
                                    complete(value, new ArrayList<>());
                                } catch (Throwable error) { error(command, error); }
                            });
                            continue;
                        }
                        try {
                            Map<String, Object> value;
                            List<byte[]> records = new ArrayList<>(router.drainMetadata());
                            switch (kind) {
                                case "udp-probe-start":
                                    if (udpProbe != null) throw new IllegalStateException("probe-udp-already-started");
                                    udpProbe = new UdpEchoProbe();
                                    value = response(command, "udp-probe-start");
                                    value.put("port", udpProbe.port());
                                    break;
                                case "udp-probe-result":
                                    if (udpProbe == null) throw new IllegalStateException("probe-udp-not-started");
                                    udpProbe.close();
                                    value = response(command, "udp-probe-result");
                                    value.put("udpProbe", udpProbe.snapshot());
                                    break;
                                case "ready":
                                    value = response(command, "readyok");
                                    Object fields = command.get("fields");
                                    value.put("readyok", router.readyTrack(fields instanceof Map<?, ?> ? (Map<?, ?>) fields : command));
                                    break;
                                case "route":
                                    value = response(command, "route");
                                    Object batchValue = command.get("records");
                                    List<?> batch = batchValue instanceof List<?> ? (List<?>) batchValue : Collections.singletonList(command.get("record"));
                                    for (Object encoded : batch) {
                                        records.addAll(router.drainMetadata());
                                        byte[] routed = router.route(Base64.getDecoder().decode((String) encoded));
                                        if (routed != null) records.add(routed);
                                        records.addAll(router.drainMetadata());
                                    }
                                    value.put("admitted", batch.size());
                                    break;
                                case "snapshot": value = response(command, "snapshot"); break;
                                case "reset": router.reset(); value = response(command, "reset"); break;
                                case "close":
                                    router.close(); complete(response(command, "closed"), records);
                                    resultCode = Activity.RESULT_OK;
                                    result.putBoolean("tiplayProbeCompleted", true);
                                    return;
                                default: throw new IllegalArgumentException("unknown-command");
                            }
                            complete(value, records);
                        } catch (Throwable error) { error(command, error); }
                    }
                    throw new IllegalStateException("probe-closed-before-completion");
                }
            }
        } catch (Throwable error) {
            recordFailure(result, error);
        } finally {
            // Each owned cleanup is attempted, and failure cannot skip finish().
            try {
                if (udpProbe != null) {
                    udpProbe.close();
                    if (!udpProbe.terminated()) throw new IllegalStateException("probe-udp-stop-timeout");
                }
            } catch (Throwable error) {
                if (error instanceof InterruptedException) Thread.currentThread().interrupt();
                stage = "udp-probe-close"; recordFailure(result, error);
                resultCode = Activity.RESULT_CANCELED; result.remove("tiplayProbeCompleted");
            }
            try { if (router != null) router.close(); }
            catch (Throwable error) {
                stage = "native-router-close"; recordFailure(result, error);
                resultCode = Activity.RESULT_CANCELED; result.remove("tiplayProbeCompleted");
            }
            try {
                signaling.shutdownNow();
                if (!signaling.awaitTermination(5, TimeUnit.SECONDS))
                    throw new IllegalStateException("probe-signaling-stop-timeout");
            } catch (Throwable error) {
                if (error instanceof InterruptedException) Thread.currentThread().interrupt();
                stage = "signaling-close"; recordFailure(result, error);
                resultCode = Activity.RESULT_CANCELED; result.remove("tiplayProbeCompleted");
            }
            finish(resultCode, result);
        }
    }

    private Map<String, Object> runtimeProof() throws Exception {
        stage = "target-context";
        Context target = getTargetContext();
        ApplicationInfo application = target.getApplicationInfo();
        if (!"com.ujzk.tiplay.hudtest".equals(target.getPackageName())) throw new IllegalStateException("probe-target-package");
        if (Process.myUid() < 10000 || Process.myUid() != application.uid) throw new IllegalStateException("probe-target-uid");
        if ((application.flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) throw new IllegalStateException("probe-target-not-debuggable");
        String context;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream("/proc/self/attr/current"), StandardCharsets.UTF_8))) {
            context = reader.readLine();
        }
        String[] parts = context == null ? new String[0] : context.split(":");
        String type = parts.length > 2 ? parts[2] : "unknown";
        if (!type.startsWith("untrusted_app")) throw new IllegalStateException("probe-target-domain");
        if (Build.VERSION.SDK_INT != 35 || !"x86_64".equals(Build.SUPPORTED_ABIS[0]) || !Process.is64Bit())
            throw new IllegalStateException("probe-target-runtime");
        stage = "packaged-libraries";
        Map<String, Object> libraries = new LinkedHashMap<>();
        try (ZipFile apk = new ZipFile(application.sourceDir)) {
            java.util.Enumeration<? extends ZipEntry> entries = apk.entries();
            while (entries.hasMoreElements()) {
                if (entries.nextElement().getName().startsWith("assets/offline-mfi/")) throw new IllegalStateException("probe-identity-not-source-only");
            }
            for (String name : new String[]{"libjingle_peerconnection_so.so", "libdatachannel.so", "libtiplay_rtc_audio.so"}) {
                ZipEntry entry = apk.getEntry("lib/x86_64/" + name);
                if (entry == null) throw new IllegalStateException("probe-packaged-library-missing");
                try (InputStream input = apk.getInputStream(entry)) {
                    libraries.put(name, map("sha256", digest(input), "bytes", entry.getSize()));
                }
            }
        }
        stage = "target-apk-hash";
        String apkHash;
        try (InputStream input = new FileInputStream(application.sourceDir)) { apkHash = digest(input); }
        if (!apkHash.equals(arguments.getString("expectedApkSha256"))) throw new IllegalStateException("probe-target-apk-hash");
        // Same entry point and target application context used by BrowserRtcPeer.initialize().
        // WebRTC is a runtime implementation dependency of :shared. Resolve its
        // public initialization API from this exact target APK, without a second AAR.
        stage = "main-webrtc-classes";
        ClassLoader loader = target.getClassLoader();
        Class<?> factory = Class.forName("org.webrtc.PeerConnectionFactory", true, loader);
        Class<?> options = Class.forName("org.webrtc.PeerConnectionFactory$InitializationOptions", true, loader);
        Object builder = options.getMethod("builder", Context.class).invoke(null, target);
        builder.getClass().getMethod("setEnableInternalTracer", boolean.class).invoke(builder, false);
        Object initializedOptions = builder.getClass().getMethod("createInitializationOptions").invoke(builder);
        stage = "main-webrtc-initialize";
        factory.getMethod("initialize", options).invoke(null, initializedOptions);
        stage = "product-classloader";
        if (loader.loadClass(NativeRtcAudioPeer.class.getName()) != NativeRtcAudioPeer.class ||
            loader.loadClass(BrowserRtcAudioRouter.class.getName()) != BrowserRtcAudioRouter.class)
            throw new IllegalStateException("probe-product-classloader-mismatch");
        PackageInfo info = target.getPackageManager().getPackageInfo(target.getPackageName(), 0);
        // The fixture supplies a numeric address for one explicit SLIRP netdev.
        // Keep it in memory; export only whether this app sees that address.
        String configuredGuestAddress = arguments.getString("expectedGuestAddress");
        if (configuredGuestAddress == null ||
            !configuredGuestAddress.matches("(?:(?:0|[1-9][0-9]{0,2})\\.){3}(?:0|[1-9][0-9]{0,2})"))
            throw new IllegalStateException("probe-configured-guest-not-ipv4");
        for (String octet : configuredGuestAddress.split("\\.")) {
            if (Integer.parseInt(octet) > 255) throw new IllegalStateException("probe-configured-guest-not-ipv4");
        }
        boolean qemuDefaultIpv4Present = false;
        boolean configuredGuestIpv4Present = false;
        java.util.Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        while (interfaces != null && interfaces.hasMoreElements()) {
            java.util.Enumeration<InetAddress> addresses = interfaces.nextElement().getInetAddresses();
            while (addresses.hasMoreElements()) {
                String address = addresses.nextElement().getHostAddress();
                if ("10.0.2.15".equals(address)) qemuDefaultIpv4Present = true;
                if (configuredGuestAddress.equals(address)) configuredGuestIpv4Present = true;
            }
        }
        return map("runtime", map("uid", Process.myUid(), "applicationUid", application.uid,
                "selinuxType", type, "api", Build.VERSION.SDK_INT, "abi", Build.SUPPORTED_ABIS[0],
                "mainWebRtcInitialized", true, "mainPeerCreatedByProbe", false,
                "qemuDefaultIpv4Present", qemuDefaultIpv4Present,
                "configuredGuestIpv4Present", configuredGuestIpv4Present),
            "packageName", target.getPackageName(), "versionName", info.versionName,
            "versionCode", info.getLongVersionCode(), "apkSha256", apkHash, "libraries", libraries);
    }

    private static Throwable unwrapped(Throwable error) {
        for (int depth = 0; depth < 8 && error instanceof java.lang.reflect.InvocationTargetException; depth++) {
            Throwable cause = ((java.lang.reflect.InvocationTargetException) error).getTargetException();
            if (cause == null || cause == error) break;
            error = cause;
        }
        return error;
    }

    private static String safeCode(Throwable error) {
        // These are our own fixed failures, never arbitrary native/SDK messages.
        String message = error.getMessage();
        if (message == null) return "probe-runtime-failure";
        switch (message) {
            case "probe-target-package": case "probe-target-uid": case "probe-target-not-debuggable":
            case "probe-target-domain": case "probe-target-runtime": case "probe-identity-not-source-only":
            case "probe-packaged-library-missing": case "probe-target-apk-hash":
            case "probe-product-classloader-mismatch": case "probe-command-too-large":
            case "probe-closed-before-completion": case "probe-rpc-write-failed":
            case "probe-signaling-stop-timeout": case "probe-udp-stop-timeout":
            case "probe-udp-already-started": case "probe-udp-not-started":
            case "probe-configured-guest-not-ipv4": return message;
            default: return "probe-runtime-failure";
        }
    }

    private void recordFailure(Bundle result, Throwable error) {
        if (result.containsKey("tiplayProbeErrorClass")) return;
        Throwable cause = unwrapped(error);
        // No raw message, stack, SDP or endpoint is returned to the controller.
        result.putString("tiplayProbeErrorStage", stage);
        result.putString("tiplayProbeErrorCode", safeCode(cause));
        result.putString("tiplayProbeErrorClass", cause.getClass().getSimpleName());
    }

    /** Bounded app-UID socket control, independent of the product's native peer. */
    private static final class UdpEchoProbe implements AutoCloseable {
        private final DatagramSocket socket;
        private final Thread worker;
        private final AtomicInteger received = new AtomicInteger();
        private final AtomicInteger echoed = new AtomicInteger();
        private final AtomicInteger errors = new AtomicInteger();
        private volatile boolean stopping;

        UdpEchoProbe() throws Exception {
            socket = new DatagramSocket(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), 0));
            try {
                socket.setSoTimeout(500);
                worker = new Thread(() -> {
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(7);
                    try {
                        while (!stopping && received.get() < 8 && System.nanoTime() < deadline) {
                            DatagramPacket packet = new DatagramPacket(new byte[64], 64);
                            try { socket.receive(packet); }
                            catch (SocketTimeoutException ignored) { continue; }
                            received.incrementAndGet();
                            if (packet.getLength() != 32) { errors.incrementAndGet(); continue; }
                            socket.send(packet); echoed.incrementAndGet();
                        }
                    } catch (Exception error) { if (!stopping) errors.incrementAndGet(); }
                    finally { socket.close(); }
                }, "TiPlay-UDP-control");
                worker.start();
            } catch (Exception | Error error) {
                stopping = true; socket.close(); throw error;
            }
        }

        int port() { return socket.getLocalPort(); }
        boolean terminated() { return !worker.isAlive(); }
        Map<String, Object> snapshot() {
            return map("receivedDatagrams", received.get(), "echoedDatagrams", echoed.get(),
                "errors", errors.get(), "closed", socket.isClosed(), "workerTerminated", terminated());
        }
        @Override public void close() {
            stopping = true; socket.close();
            try { worker.join(2_000); }
            catch (InterruptedException error) { Thread.currentThread().interrupt(); }
        }
    }

    private static String digest(InputStream input) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[65536];
        for (int count; (count = input.read(buffer)) != -1;) digest.update(buffer, 0, count);
        StringBuilder text = new StringBuilder();
        for (byte value : digest.digest()) text.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return text.toString();
    }

    private void nativeFailure(String reason) {
        failures.add(reason);
        int generation = Math.max(1, ((Number) router.snapshot().get("generation")).intValue());
        String event = "audio-slots-exhausted".equals(reason) || "audio-new-demand".equals(reason) ? "audio-restart-required" : "audio-error";
        send(map("event", event, "k", event, "reason", reason, "generation", generation));
    }

    private Map<String, Object> response(Map<?, ?> command, String kind) { return map("q", command.get("q"), "ok", true, "k", kind); }

    private void complete(Map<String, Object> value, List<byte[]> records) {
        records.addAll(router.drainMetadata());
        List<String> encoded = new ArrayList<>();
        for (byte[] record : records) encoded.add(Base64.getEncoder().encodeToString(record));
        value.put("records", encoded); value.put("snapshot", router.snapshot()); value.put("failures", new ArrayList<>(failures));
        send(value);
    }

    private void error(Map<?, ?> command, Throwable failure) {
        Map<String, Object> value = response(command, "error");
        value.put("ok", false);
        Throwable cause = unwrapped(failure);
        value.put("error", safeCode(cause)); value.put("errorClass", cause.getClass().getSimpleName());
        complete(value, new ArrayList<>());
    }

    private void send(Map<String, Object> value) {
        synchronized (outputLock) {
            output.println(WebJson.INSTANCE.write(value));
            if (output.checkError()) throw new IllegalStateException("probe-rpc-write-failed");
        }
    }

    private static Map<String, Object> map(Object... values) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (int index = 0; index < values.length; index += 2) result.put((String) values[index], values[index + 1]);
        return result;
    }
}
