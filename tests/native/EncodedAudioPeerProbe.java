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
        BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String offer = new String(Base64.getDecoder().decode(input.readLine()), StandardCharsets.UTF_8);
        ArrayList<BrowserRtcAudioSlot> slots = new ArrayList<>();
        Matcher mids = Pattern.compile("(?m)^a=mid:([^\\r\\n]+)").matcher(offer);
        while (mids.find()) slots.add(new BrowserRtcAudioSlot(mids.group(1), 111));
        NativeRtcAudioPeer peer = new NativeRtcAudioPeer(slots,
            reason -> { System.err.println("native-audio-failure:" + reason); return Unit.INSTANCE; }, System::nanoTime);
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
            while (((Number) peer.snapshot().get("queuedPackets")).intValue() != 0 && System.nanoTime() < limit) Thread.sleep(10);
            System.out.println("sent:" + total * slots.size()); System.out.flush();
            input.readLine();
        } finally { peer.close(); Thread.sleep(100); }
    }
}
