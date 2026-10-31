package com.shilapi.xcertplay

import android.content.ContextWrapper
import com.shilapi.xcertplay.diagnostics.RawTraffic
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FilterOutputStream
import java.io.IOException
import java.util.Random
import java.nio.file.Files
import java.util.zip.ZipInputStream
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class DiagnosticPreparationReliabilityTest {
    @Test fun aMidWriteFailureRetriesAnotherRootWithTheSameOriginalCaptureDescriptor() {
        val root = Files.createTempDirectory("diagnostic-retry-test-").toFile()
        val first = object : File(root, "first-cache") {
            override fun getUsableSpace(): Long = Long.MAX_VALUE
        }.apply { mkdirs() }
        val second = root.resolve("second-cache").apply { mkdirs() }
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getCacheDir(): File = first
            override fun getExternalCacheDirs(): Array<File> = arrayOf(second)
        }
        val raw = root.resolve("raw-traffic-original.tsv.zst")
        var attempts = 0
        try {
            RawTraffic.configure(raw, true, compressed = true)
            RawTraffic.record("iphone/test/in", ByteArray(96 * 1024).also { Random(7).nextBytes(it) })
            RawTraffic.configure(raw, false, compressed = true)
            val original = raw.readBytes()
            DiagnosticReportContent.prepare(context, "test.zip", "report", true, openArchive = { file ->
                attempts++
                if (file.parentFile.absolutePath != first.absolutePath) file.outputStream()
                else object : FilterOutputStream(file.outputStream()) {
                    private var remaining = 4096
                    override fun write(value: Int) = write(byteArrayOf(value.toByte()), 0, 1)
                    override fun write(bytes: ByteArray, offset: Int, length: Int) {
                        val count = minOf(remaining, length)
                        if (count > 0) { out.write(bytes, offset, count); remaining -= count }
                        if (count < length) {
                            raw.delete(); raw.writeText("different inode at the same pathname")
                            throw IOException("injected staging write failure")
                        }
                    }
                    override fun close() = out.close()
                }
            }).use { content ->
                val bytes = ByteArrayOutputStream().also(content::writeTo).toByteArray()
                var payload: ByteArray? = null
                ZipInputStream(bytes.inputStream()).use { zip ->
                    while (true) { val entry = zip.nextEntry ?: break
                        if (entry.name == "captures/${raw.name}") payload = zip.readBytes()
                    }
                }
                assertArrayEquals(original, payload)
                assertEquals(2, attempts)
                assertTrue(first.listFiles().orEmpty().isEmpty())
                assertTrue(second.listFiles().orEmpty().any { it.name.startsWith("diagnostic-export-") })
            }
            assertTrue(second.listFiles().orEmpty().isEmpty())
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }

    @Test fun insufficientPrivateStagingSpaceIsDistinctAndPreservesTheJournal() {
        val root = Files.createTempDirectory("diagnostic-full-test-").toFile()
        val staging = object : File(root, "full-cache") {
            override fun getUsableSpace(): Long = 0
        }.apply { mkdirs() }
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getCacheDir(): File = staging
            override fun getExternalCacheDirs(): Array<File> = emptyArray()
        }
        val raw = root.resolve("raw-traffic-test.tsv.zst")
        try {
            RawTraffic.configure(raw, true, compressed = true)
            RawTraffic.record("iphone/test/in", byteArrayOf(1, 2, 3))
            RawTraffic.configure(raw, false, compressed = true)
            val before = raw.readBytes()
            assertThrows(DiagnosticArchiveUnavailable::class.java) {
                DiagnosticReportContent.prepare(context, "test.zip", "report", true)
            }
            assertArrayEquals(before, raw.readBytes())
            assertTrue(staging.listFiles().orEmpty().isEmpty())
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }

    @Test fun anUnusableInternalCacheCanUseExternalPrivateStagingAndReuseThePreparedZip() {
        val root = Files.createTempDirectory("diagnostic-staging-test-").toFile()
        val bad = root.resolve("internal-cache").apply { writeText("not a directory") }
        val external = root.resolve("external-cache").apply { mkdirs() }
        val context = object : ContextWrapper(RuntimeEnvironment.getApplication()) {
            override fun getCacheDir(): File = bad
            override fun getExternalCacheDirs(): Array<File> = arrayOf(external)
        }
        val raw = root.resolve("raw-traffic-test.tsv.zst")
        try {
            RawTraffic.configure(raw, true, compressed = true)
            RawTraffic.record("iphone/test/in", byteArrayOf(1, 2, 3))
            RawTraffic.configure(raw, false, compressed = true)
            DiagnosticReportContent.prepare(context, "test.zip", "report", true).use { content ->
                assertTrue(external.listFiles().orEmpty().any { it.name.startsWith("diagnostic-export-") })
                val first = ByteArrayOutputStream().also(content::writeTo).toByteArray()
                val second = ByteArrayOutputStream().also(content::writeTo).toByteArray()
                assertArrayEquals(first, second)
                ZipInputStream(first.inputStream()).use { zip ->
                    val names = mutableListOf<String>()
                    while (true) { val entry = zip.nextEntry ?: break; names.add(entry.name) }
                    assertTrue(names.contains("captures/${raw.name}"))
                }
                assertTrue(raw.isFile)
            }
            assertTrue(external.listFiles().orEmpty().isEmpty())
        } finally { RawTraffic.configure(raw, false); root.deleteRecursively() }
    }
}
