package com.shilapi.xcertplay.network

import java.io.File
import java.io.IOException

/**
 * Optional kernel receive counters sampled by the existing wireless observer, never a media thread.
 * Android/OEM policy may hide individual files; failed reads retry at a bounded interval.
 * UDP counters cover the device network namespace, not a particular interface, app or RTP stream.
 */
internal class WirelessReceiveDiagnostics(
    interfaceName: String?,
    private val read: (String, Int) -> String = ::readBoundedDiagnosticFile,
    private val nowNs: () -> Long = System::nanoTime,
) {
    private val interfaceSource = InterfaceSource(interfaceName, read)
    private val udp4Source = CounterSource("udp4") {
        parseUdp4Partial(read("/proc/net/snmp", MAX_PROC_BYTES))
    }
    private val udp6Source = CounterSource("udp6") {
        parseUdp6Partial(read("/proc/net/snmp6", MAX_PROC_BYTES))
    }
    private var previousSampleNs: Long? = null

    fun snapshot(): String {
        val now = nowNs()
        val elapsed = previousSampleNs?.let { ((now - it).coerceAtLeast(0)) / 1_000_000 }
        previousSampleNs = now
        val prefix = "receiveCounters windowMs=${elapsed ?: "baseline"} udpScope=device "
        // Keep every source on its own short exported line, including full-width Long deltas.
        return listOf(interfaceSource, udp4Source, udp6Source).joinToString("\n") {
            prefix + it.snapshot(now)
        }
    }

    private interface Source { fun snapshot(now: Long): String }

    private class InterfaceSource(
        private val name: String?, private val read: (String, Int) -> String,
    ) : Source {
        private val retries = mutableMapOf<String, Long>()
        private val failures = mutableMapOf<String, String>()
        private var previous: Map<String, Long>? = null

        override fun snapshot(now: Long): String {
            if (name == null || !INTERFACE_NAME.matches(name)) return "ifaceRx=unavailable failureClass=IOException"
            val values = linkedMapOf<String, Long>()
            INTERFACE_COUNTERS.forEach { (file, field) ->
                val failedAt = retries[field]
                if (failedAt != null && now - failedAt in 0 until RETRY_NANOS) return@forEach
                try {
                    values[field] = counter(read("/sys/class/net/$name/statistics/$file", 32).trim())
                    retries.remove(field); failures.remove(field)
                } catch (error: Exception) {
                    retries[field] = now; failures[field] = safeFailure(error)
                }
            }
            val prior = previous
            previous = values
            val unavailable = INTERFACE_COUNTERS.values.filter { it in failures }
            val failureDetail = unavailable.joinToString(",") { "$it:${failures.getValue(it)}" }
            if (values.isEmpty()) return "ifaceRx=unavailable fields=$failureDetail"
            val suffix = if (unavailable.isEmpty()) "" else " unavailableFields=$failureDetail"
            if (prior == null) return "ifaceRx=baseline$suffix"
            val comparable = values.keys.intersect(prior.keys)
            if (comparable.any { values.getValue(it) < prior.getValue(it) }) return "ifaceRx=reset$suffix"
            val deltas = values.entries.filter { it.key in comparable }.joinToString(" ") { (field, value) ->
                "ifaceRx${field}Delta=${value - prior.getValue(field)}"
            }
            val baselineFields = values.keys.filter { it !in comparable }
            val baseline = if (baselineFields.isEmpty()) "" else " baselineFields=${baselineFields.joinToString(",")}"
            return "ifaceRx=sampled" + (if (deltas.isEmpty()) "" else " $deltas") + baseline + suffix
        }
    }

    private class CounterSource(private val label: String, private val sample: () -> Map<String, Long>) : Source {
        private var previous: Map<String, Long>? = null
        private var unavailable: String? = null
        private var failedAt: Long? = null

        override fun snapshot(now: Long): String {
            if (failedAt?.let { now - it in 0 until RETRY_NANOS } == true)
                return "$label=unavailable failureClass=$unavailable"
            val current = try { sample() } catch (error: Exception) {
                unavailable = safeFailure(error); failedAt = now; previous = null
                return "$label=unavailable failureClass=$unavailable"
            }
            unavailable = null; failedAt = null
            val before = previous
            previous = current
            val missing = UDP_COUNTERS.filter { it !in current }
            val suffix = if (missing.isEmpty()) "" else " unavailableFields=${missing.joinToString(",")}"
            if (current.isEmpty()) return "$label=unavailable fields=all"
            if (before == null) return "$label=baseline$suffix"
            // Interface recreation or counter wrap must never appear as a negative loss count.
            val comparable = current.keys.intersect(before.keys)
            if (comparable.any { current.getValue(it) < before.getValue(it) }) {
                return "$label=reset$suffix"
            }
            val deltas = current.entries.filter { it.key in comparable }.joinToString(" ") { (key, value) ->
                "$label${key}Delta=${value - before.getValue(key)}"
            }
            val baselineFields = current.keys.filter { it !in comparable }
            val baseline = if (baselineFields.isEmpty()) "" else " baselineFields=${baselineFields.joinToString(",")}"
            return "$label=sampled" + (if (deltas.isEmpty()) "" else " $deltas") + baseline + suffix
        }
    }

    companion object {
        private const val MAX_PROC_BYTES = 16 * 1024
        private const val RETRY_NANOS = 60_000_000_000L
        private fun safeFailure(error: Exception) = when (error) {
            is SecurityException -> "SecurityException"
            is java.io.FileNotFoundException -> "FileNotFoundException"
            is IOException -> "IOException"
            else -> "Other"
        }
        private val INTERFACE_NAME = Regex("[A-Za-z0-9_.-]{1,15}")
        private val INTERFACE_COUNTERS = linkedMapOf(
            "rx_packets" to "Packets", "rx_bytes" to "Bytes", "rx_dropped" to "Dropped",
            "rx_errors" to "Errors", "rx_missed_errors" to "MissedErrors",
        )
        private val UDP_COUNTERS = listOf("InDatagrams", "InErrors", "RcvbufErrors", "InCsumErrors")

        internal fun parseUdp4(text: String): Map<String, Long> = selectedUdpCounters(udp4Values(text))
        private fun parseUdp4Partial(text: String): Map<String, Long> = partialUdpCounters(udp4Values(text))

        private fun udp4Values(text: String): Map<String, String> {
            if (text.length > MAX_PROC_BYTES) throw IOException()
            val rows = text.lineSequence().filter { it.startsWith("Udp:") }.take(3).toList()
            if (rows.size != 2) throw IOException()
            val names = rows[0].trim().split(Regex("\\s+")).drop(1)
            val values = rows[1].trim().split(Regex("\\s+")).drop(1)
            if (names.size != values.size || names.distinct().size != names.size) throw IOException()
            return names.zip(values).toMap()
        }

        internal fun parseUdp6(text: String): Map<String, Long> = selectedUdpCounters(udp6Values(text))
        private fun parseUdp6Partial(text: String): Map<String, Long> = partialUdpCounters(udp6Values(text))

        private fun udp6Values(text: String): Map<String, String> {
            if (text.length > MAX_PROC_BYTES) throw IOException()
            val values = linkedMapOf<String, String>()
            text.lineSequence().filter { it.startsWith("Udp6") }.forEach { row ->
                val parts = row.trim().split(Regex("\\s+"))
                if (parts.size != 2 || values.put(parts[0].removePrefix("Udp6"), parts[1]) != null) {
                    throw IOException()
                }
            }
            return values
        }

        private fun partialUdpCounters(values: Map<String, String>): Map<String, Long> =
            linkedMapOf<String, Long>().apply {
                UDP_COUNTERS.forEach { key ->
                    values[key]?.toLongOrNull()?.takeIf { it >= 0 }?.let { put(key, it) }
                }
            }

        private fun selectedUdpCounters(values: Map<String, String>): Map<String, Long> =
            linkedMapOf<String, Long>().apply {
                UDP_COUNTERS.forEach { key ->
                    val value = values[key]
                    // Older kernels may omit checksum-specific accounting.
                    if (value == null && key == "InCsumErrors") return@forEach
                    put(key, counter(value ?: throw IOException()))
                }
            }

        private fun counter(value: String): Long =
            value.toLongOrNull()?.takeIf { it >= 0 } ?: throw IOException()
    }
}

/** Read only a small, fixed diagnostic file; never export its content or a read exception message. */
internal fun readBoundedDiagnosticFile(path: String, maxBytes: Int): String = File(path).inputStream().use { input ->
    val bytes = ByteArray(maxBytes + 1)
    var count = 0
    while (count < bytes.size) {
        val read = input.read(bytes, count, bytes.size - count)
        if (read < 0) break
        if (read == 0) throw IOException()
        count += read
    }
    if (count > maxBytes) throw IOException()
    String(bytes, 0, count, Charsets.US_ASCII)
}
