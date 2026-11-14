/* SPDX-License-Identifier: GPL-3.0-only */
package com.shilapi.xcertplay.web;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import kotlin.Unit;

/** Host JVM driver for the exact product JNI bridge; signaling is base64 on private stdio. */
public final class EncodedAudioPeerProbe {
    public static void main(String[] args) throws Exception {
        verifyUnstartedDiagnostics();
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String offer = new String(Base64.getDecoder().decode(input.readLine()), StandardCharsets.UTF_8);
        ArrayList<BrowserRtcAudioSlot> slots = new ArrayList<>();
        Matcher mids = Pattern.compile("(?m)^a=mid:([^\\r\\n]+)").matcher(offer);
        while (mids.find()) slots.add(new BrowserRtcAudioSlot(mids.group(1), 111));
        NativeRtcAudioPeer peer = new NativeRtcAudioPeer(slots,
            reason -> { System.err.println("native-audio-failure:" + reason); return Unit.INSTANCE; },
            ignored -> Unit.INSTANCE, System::nanoTime);
        try {
            String answer = peer.answer(offer);
            System.out.println(Base64.getEncoder().encodeToString(answer.getBytes(StandardCharsets.UTF_8)));
            System.out.flush();
            if (!"start".equals(input.readLine())) throw new IllegalStateException("start-required");
            Map<?, ?> fixture = (Map<?, ?>) WebJson.INSTANCE.parse(Files.readString(Path.of(args[0])));
            List<?> packets = (List<?>) fixture.get("packets");
            int total = Math.min(80, packets.size());
            for (int i = 0; i < total; i++) {
                byte[] payload = Base64.getDecoder().decode((String) packets.get(i));
                for (BrowserRtcAudioSlot slot : slots) peer.send(slot.getMid(), payload, i * 20000.0);
                Thread.sleep(20);
            }
            long limit = System.nanoTime() + 2_000_000_000L;
            while (((Number) peer.snapshot().get("queuedBytes")).intValue() != 0 && System.nanoTime() < limit) Thread.sleep(10);
            if (((Number) peer.snapshot().get("queuedBytes")).intValue() != 0) throw new IllegalStateException("native-sender-did-not-drain");
            verifySelectedDiagnostics(peer);
            peer.close();
            Thread.sleep(100);
            verifySelectedDiagnostics(peer); // close retains the last live transport evidence.
            System.out.println("sent:" + total * slots.size()); System.out.flush();
            input.readLine();
        } finally { peer.close(); Thread.sleep(100); }
    }

    private static void verifyUnstartedDiagnostics() throws Exception {
        var create = NativeRtcAudioPeer.class.getDeclaredMethod("nativeCreate", String[].class, int[].class);
        var inspect = NativeRtcAudioPeer.class.getDeclaredMethod("nativeDiagnostics", long.class);
        var answer = NativeRtcAudioPeer.class.getDeclaredMethod("nativeAnswer", long.class, String.class);
        var delete = NativeRtcAudioPeer.class.getDeclaredMethod("nativeDelete", long.class);
        create.setAccessible(true); inspect.setAccessible(true); answer.setAccessible(true); delete.setAccessible(true);
        long handle = (Long) create.invoke(null, new String[]{"diagnostic-probe"}, new int[]{111});
        try {
            int[] raw = (int[]) inspect.invoke(null, handle);
            if (raw.length != 21 || raw[8] != Integer.MIN_VALUE || raw[9] != Integer.MIN_VALUE ||
                raw[10] != 0 || raw[11] != 0 || raw[12] != -3 || raw[16] != 0 || raw[20] != 0)
                throw new IllegalStateException("unstarted-native-diagnostics-invalid");
            try {
                answer.invoke(null, handle, "invalid SDP");
                throw new IllegalStateException("invalid-offer-accepted");
            } catch (java.lang.reflect.InvocationTargetException expected) {
                if (!(expected.getCause() instanceof IllegalStateException)) throw expected;
            }
            raw = (int[]) inspect.invoke(null, handle);
            if (raw[8] >= 0 || raw[8] == Integer.MIN_VALUE || raw[9] != Integer.MIN_VALUE)
                throw new IllegalStateException("description-failure-diagnostics-invalid");
        } finally { delete.invoke(null, handle); }
    }

    private static void verifySelectedDiagnostics(NativeRtcAudioPeer peer) {
        Map<?, ?> details = (Map<?, ?>) peer.snapshot().get("transportDiagnostics");
        if (details == null || !Boolean.TRUE.equals(details.get("available")) ||
            !"selected".equals(details.get("selectedPair")) ||
            !Integer.valueOf(0).equals(details.get("selectedPairResult")) ||
            !"answer".equals(details.get("localDescriptionType")) ||
            !"offer".equals(details.get("remoteDescriptionType")) ||
            !Integer.valueOf(0).equals(details.get("remoteDescriptionSetResult")) ||
            !Integer.valueOf(0).equals(details.get("localDescriptionSetResult")) ||
            !"complete".equals(details.get("gathering")) || !"stable".equals(details.get("signaling")))
            throw new IllegalStateException("connected-native-diagnostics-invalid");
        for (String side : List.of("local", "remote")) {
            if (!Boolean.TRUE.equals(details.get(side + "CandidatePresent")) ||
                !"host".equals(details.get(side + "CandidateType")) ||
                !"udp".equals(details.get(side + "CandidateProtocol")) ||
                !List.of("ipv4", "ipv6").contains(details.get(side + "CandidateFamily")))
                throw new IllegalStateException("native-candidate-classification-invalid");
        }
    }
}
