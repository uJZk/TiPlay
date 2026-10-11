// SPDX-License-Identifier: GPL-3.0-only
// Run against compiled RealPhone classes; checks blocked stdout and overflow without a browser or phone.
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

class LogCheck {
    public static void main(String[] args) throws Exception {
        PrintStream original = System.out;
        CountDownLatch blocked = new CountDownLatch(1), release = new CountDownLatch(1);
        List<String> output = new ArrayList<>();
        System.setOut(new PrintStream(new ByteArrayOutputStream()) {
            @Override public void println(String line) {
                blocked.countDown();
                try { release.await(); } catch (InterruptedException error) { throw new AssertionError(error); }
                output.add(line);
            }
        });
        RealPhone.AsyncLog log = new RealPhone.AsyncLog();
        var producer = Executors.newSingleThreadExecutor();
        try {
            log.offer("first");
            if (!blocked.await(3, TimeUnit.SECONDS)) throw new AssertionError("writer never reached stdout");
            int count = args.length == 0 ? 2000 : 5000;
            // This must complete while stdout remains blocked: callback producers never wait for I/O.
            producer.submit(() -> {
                for (int i = 0; i < count; i++) log.offer("event-" + i);
            }).get(3, TimeUnit.SECONDS);
            release.countDown();
            log.close();
            if (args.length != 0) throw new AssertionError("overflow must fail the process");
            if (output.size() != 2001 || !output.get(0).equals("first")) throw new AssertionError("missing events");
            for (int i = 0; i < 2000; i++) {
                if (!output.get(i + 1).equals("event-" + i)) throw new AssertionError("reordered events");
            }
        } finally {
            release.countDown();
            producer.shutdownNow();
            System.setOut(original);
        }
        Process overflow = new ProcessBuilder(System.getProperty("java.home") + "/bin/java", "-cp",
            System.getProperty("java.class.path"), "LogCheck", "overflow").start();
        if (!overflow.waitFor(10, TimeUnit.SECONDS)) {
            overflow.destroyForcibly();
            throw new AssertionError("overflow process did not stop");
        }
        if (overflow.exitValue() != 1) throw new AssertionError("overflow did not fail explicitly");
        original.println("log checks passed: nonblocking producer, ordered drain, explicit overflow failure");
    }
}
