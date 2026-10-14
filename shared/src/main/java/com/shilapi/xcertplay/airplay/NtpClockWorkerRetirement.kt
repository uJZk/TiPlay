package com.shilapi.xcertplay.airplay

/** Native datagram I/O may retain the closed descriptor until its worker returns. */
internal fun retireNtpClockWorkers(vararg workers: Thread?) {
    val caller = Thread.currentThread()
    workers.filterNotNull().filter { it !== caller }.forEach(Thread::interrupt)
    var interrupted = Thread.interrupted()
    try {
        for (worker in workers) {
            if (worker == null || worker === caller) continue
            try {
                worker.join(1_000)
            } catch (_: InterruptedException) {
                interrupted = true
            }
        }
    } finally {
        if (interrupted) caller.interrupt()
    }
}
