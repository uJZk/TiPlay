package com.shilapi.xcertplay.diagnostics

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.Base64

class RawTrafficTest {
    @Test fun fullPayloadSurvivesChunkingDisableAndExportWithoutRedaction() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-test").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            val bytes = ByteArray(131_073) { (it % 256).toByte() }
            RawTraffic.record("iphone/in", bytes)
            RawTraffic.record("browser/in", "password=secret code=1234 http://192.168.1.2".toByteArray())
            RawTraffic.configure(file, false)
            RawTraffic.record("ignored", bytes)
            val output = ByteArrayOutputStream()
            RawTraffic.appendTo(output)
            val lines = output.toString("UTF-8").lineSequence().map { it.split('\t') }.filter { it.size == 5 }.toList()
            val actual = ByteArrayOutputStream()
            for (record in lines.filter { it[2] == "iphone/in" }) {
                val decoded = Base64.getDecoder().decode(record[4])
                assertEquals(record[3].toInt(), decoded.size)
                actual.write(decoded)
            }
            assertArrayEquals(bytes, actual.toByteArray())
            assertEquals("password=secret code=1234 http://192.168.1.2",
                String(Base64.getDecoder().decode(lines.single { it[2] == "browser/in" }[4])))
            assertFalse(lines.any { it[2] == "ignored" })
            assertTrue(output.toString("UTF-8").contains("failures=0"))
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }

    @Test fun wrappingStreamsRetainsOnlyReadRangeAndSuccessfulOutputBytes() {
        val directory = java.nio.file.Files.createTempDirectory("traffic-stream").toFile()
        val file = File(directory, "capture.tsv")
        try {
            RawTraffic.configure(file, true)
            val input = RawTraffic.input("browser/in", ByteArrayInputStream(byteArrayOf(1, 2, 3)))
            val bytes = ByteArray(10) { 99 }
            assertEquals(3, input.read(bytes, 4, 5))
            assertEquals(-1, input.read())
            val sink = ByteArrayOutputStream()
            RawTraffic.output("car/out", sink).write(bytes, 4, 3)
            RawTraffic.configure(file, false)
            val records = file.readLines().map { it.split('\t') }
            assertArrayEquals(byteArrayOf(1, 2, 3), Base64.getDecoder().decode(records.single { it[2] == "browser/in" }[4]))
            assertArrayEquals(sink.toByteArray(), Base64.getDecoder().decode(records.single { it[2] == "car/out/written" }[4]))
        } finally { RawTraffic.configure(file, false); directory.deleteRecursively() }
    }
}
