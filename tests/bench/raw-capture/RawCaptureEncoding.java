// SPDX-License-Identifier: GPL-3.0-only
import com.sun.management.ThreadMXBean;
import java.io.*;
import java.lang.management.ManagementFactory;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Host JVM encoding/allocation microbenchmark; deliberately excludes disk and Android runtime claims. */
class RawCaptureEncoding {
    private static final Base64.Encoder ENCODER = Base64.getEncoder();
    private static final ThreadMXBean MEMORY = (ThreadMXBean) ManagementFactory.getThreadMXBean();
    record Sample(double nanos, double bytes) {}

    private static Sample run(boolean bulk, byte[] source, int size, int count) throws IOException {
        try (var chars = new BufferedWriter(new OutputStreamWriter(OutputStream.nullOutputStream(), StandardCharsets.UTF_8));
             var bytes = new BufferedOutputStream(OutputStream.nullOutputStream(), 64 * 1024)) {
            long thread = Thread.currentThread().threadId();
            long allocated = MEMORY.getThreadAllocatedBytes(thread), started = System.nanoTime();
            for (int i = 0; i < count; i++) {
                if (bulk) {
                    bytes.write(("1729000000000\t123456\tiphone/audio/in\t" + size + "\t").getBytes(StandardCharsets.UTF_8));
                    ByteBuffer encoded = ENCODER.encode(ByteBuffer.wrap(source, 5, size));
                    bytes.write(encoded.array(), encoded.arrayOffset() + encoded.position(), encoded.remaining());
                    bytes.write(10); bytes.flush();
                } else {
                    String encoded = ENCODER.encodeToString(Arrays.copyOfRange(source, 5, size + 5));
                    chars.append("1729000000000\t123456\tiphone/audio/in\t" + size + "\t" + encoded + "\n");
                    chars.flush();
                }
            }
            long elapsed = System.nanoTime() - started;
            return new Sample((double) elapsed / count, (double) (MEMORY.getThreadAllocatedBytes(thread) - allocated) / count);
        }
    }

    public static void main(String[] args) throws Exception {
        if (!MEMORY.isThreadAllocatedMemorySupported()) throw new UnsupportedOperationException("Thread allocation counters unavailable");
        if (!MEMORY.isThreadAllocatedMemoryEnabled()) MEMORY.setThreadAllocatedMemoryEnabled(true);
        System.out.println("JVM " + System.getProperty("java.version") + "; median of five trials; encoding + flushed discard sink, no filesystem");
        System.out.println("payloadBytes\tpreviousNs\tbulkNs\tpreviousAllocatedBytes\tbulkAllocatedBytes");
        byte[] source = new byte[48 * 1024 + 5]; new Random(42).nextBytes(source);
        for (int size : new int[]{960, 4096, 48 * 1024}) {
            for (int i = 0; i < 3; i++) { run(false, source, size, 5000); run(true, source, size, 5000); }
            double[] oldTime = new double[5], newTime = new double[5], oldBytes = new double[5], newBytes = new double[5];
            for (int i = 0; i < 5; i++) {
                Sample old = run(false, source, size, 20000), bulk = run(true, source, size, 20000);
                oldTime[i] = old.nanos(); oldBytes[i] = old.bytes(); newTime[i] = bulk.nanos(); newBytes[i] = bulk.bytes();
            }
            for (double[] values : new double[][]{oldTime, newTime, oldBytes, newBytes}) Arrays.sort(values);
            System.out.printf(Locale.ROOT, "%d\t%.0f\t%.0f\t%.0f\t%.0f%n", size, oldTime[2], newTime[2], oldBytes[2], newBytes[2]);
        }
    }
}
