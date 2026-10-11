package com.shilapi.xcertplay.network

/** Each address owns independent mDNS goodbye timers; wait for all without adding their delays. */
internal object BonjourMdnsCleanup {
    fun closeAll(resources: List<AutoCloseable>) {
        if (resources.size <= 1) {
            resources.forEach(::closeBestEffort)
            return
        }
        val workers = mutableListOf<Thread>()
        val fallback = mutableListOf<AutoCloseable>()
        resources.forEachIndexed { index, resource ->
            val worker = Thread({ closeBestEffort(resource) }, "carplay-mdns-close-$index")
            workers += worker
            try {
                worker.start()
            } catch (_: Throwable) {
                workers.remove(worker)
                fallback += resource
            }
        }
        var interrupted = Thread.interrupted()
        try {
            fallback.forEach(::closeBestEffort)
            for (worker in workers) {
                while (worker.isAlive) {
                    try {
                        worker.join()
                    } catch (_: InterruptedException) {
                        interrupted = true
                    }
                }
            }
        } finally {
            if (interrupted) Thread.currentThread().interrupt()
        }
    }

    private fun closeBestEffort(resource: AutoCloseable) {
        try {
            resource.close()
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: Throwable) {
            // Match Bonjour's best-effort close, allowing every other instance to finish.
        }
    }
}
