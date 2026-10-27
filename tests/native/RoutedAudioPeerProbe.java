/* SPDX-License-Identifier: GPL-3.0-only */
package com.shilapi.xcertplay.web;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import kotlin.Unit;

/** Exact product router and JNI sender driven by private line-oriented test commands. */
public final class RoutedAudioPeerProbe {
    private static final List<String> failures = new CopyOnWriteArrayList<>();
    private static final Object outputLock = new Object();
    private static final BrowserRtcAudioRouter router = new BrowserRtcAudioRouter(
        reason -> { nativeFailure(reason); return Unit.INSTANCE; },
        (slots, failed) -> new NativeRtcAudioPeer(slots, failed, System::nanoTime),
        (record, submit) -> { submit.invoke(); return Unit.INSTANCE; },
        System::nanoTime);

    private static String encoded(byte[] bytes) { return Base64.getEncoder().encodeToString(bytes); }
    private static byte[] decoded(Object value) { return Base64.getDecoder().decode((String)value); }
    private static Map<String,Object> response(Map<?,?> command, String kind) {
        LinkedHashMap<String,Object> response = new LinkedHashMap<>();
        response.put("q", command.get("q")); response.put("ok", true); response.put("k", kind);
        return response;
    }
    private static void nativeFailure(String reason) {
        failures.add(reason);
        int generation = Math.max(1, ((Number)router.snapshot().get("generation")).intValue());
        String event = reason.equals("audio-slots-exhausted") ? "audio-restart-required" : "audio-error";
        synchronized(outputLock) {
            System.out.println(WebJson.INSTANCE.write(Map.of("event", event, "k", event, "reason", reason, "generation", generation)));
            System.out.flush();
        }
    }
    private static void finish(Map<String,Object> result, List<byte[]> records) {
      synchronized(outputLock) {
        records.addAll(router.drainMetadata());
        result.put("records", records.stream().map(RoutedAudioPeerProbe::encoded).toList());
        result.put("snapshot", router.snapshot()); result.put("failures", new ArrayList<>(failures));
        synchronized(outputLock) {
            System.out.println(WebJson.INSTANCE.write(result)); System.out.flush();
        }
      }
    }
    private static void error(Map<?,?> command, Throwable failure) {
        Map<String,Object> result = response(command, "error");
        result.put("ok", false);
        result.put("error", failure.getClass().getSimpleName() + ": " + failure.getMessage());
        finish(result, new ArrayList<>());
    }
    public static void main(String[] args) throws Exception {
        ExecutorService signaling = Executors.newSingleThreadExecutor();
        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = input.readLine()) != null) {
                Map<?,?> command;
                try { command = (Map<?,?>)WebJson.INSTANCE.parse(line); }
                catch (Throwable failure) { error(Map.of(), failure); continue; }
                String kind = String.valueOf(command.get("k"));
                if (kind.equals("offer")) {
                    signaling.submit(() -> {
                        try {
                            String answer = router.answer((String)command.get("sdp"), ((Number)command.get("generation")).intValue());
                            Map<String,Object> result = response(command, "answer");
                            result.put("sdp", answer); result.put("generation", command.get("generation"));
                            finish(result, new ArrayList<>());
                        } catch (Throwable failure) { error(command, failure); }
                    });
                    continue;
                }
                synchronized(outputLock) {
                  try {
                    List<byte[]> records = new ArrayList<>(router.drainMetadata());
                    Map<String,Object> result;
                    switch (kind) {
                        case "ready":
                            result = response(command, "readyok");
                            result.put("readyok", router.readyTrack(command.get("fields") instanceof Map<?,?> fields ? fields : command));
                            break;
                        case "route":
                            result = response(command, "route");
                            List<?> batch = command.get("records") instanceof List<?> list ? list : List.of(command.get("record"));
                            int admitted = 0;
                            for (Object source : batch) {
                                records.addAll(router.drainMetadata());
                                byte[] routed = router.route(decoded(source));
                                if (routed != null) records.add(routed);
                                records.addAll(router.drainMetadata());
                                admitted++;
                            }
                            result.put("admitted", admitted);
                            break;
                        case "snapshot": result = response(command, "snapshot"); break;
                        case "reset": router.reset(); result = response(command, "reset"); break;
                        case "close":
                            router.close(); result = response(command, "closed"); finish(result, records); return;
                        default: throw new IllegalArgumentException("unknown-command");
                    }
                    finish(result, records);
                  } catch (Throwable failure) { error(command, failure); }
                }
            }
        } finally {
            router.close(); signaling.shutdownNow(); signaling.awaitTermination(5, TimeUnit.SECONDS);
        }
    }
}
