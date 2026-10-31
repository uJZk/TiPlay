package com.shilapi.xcertplay.diagnostics

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.io.IOException

/** Identifies failure of app-owned staging, never of an original capture descriptor. */
class ArchiveStagingException(cause: IOException) : IOException("Diagnostic staging IO failed", cause)

internal fun archiveStagingDirectory(root: File): File = try {
    java.nio.file.Files.createTempDirectory(root.toPath(), "traffic-export-").toFile()
} catch (error: IOException) { throw ArchiveStagingException(error) }

fun archiveStagingOutput(output: OutputStream): OutputStream = object : java.io.FilterOutputStream(output) {
    override fun write(value: Int) { try { out.write(value) } catch (error: IOException) { throw ArchiveStagingException(error) } }
    override fun write(bytes: ByteArray, offset: Int, length: Int) {
        try { out.write(bytes, offset, length) } catch (error: IOException) { throw ArchiveStagingException(error) }
    }
    override fun flush() { try { out.flush() } catch (error: IOException) { throw ArchiveStagingException(error) } }
    override fun close() { try { out.close() } catch (error: IOException) { throw ArchiveStagingException(error) } }
}

internal fun archiveStagingOutput(file: File, append: Boolean = false): OutputStream = try {
    archiveStagingOutput(java.io.FileOutputStream(file, append))
} catch (error: IOException) { throw ArchiveStagingException(error) }

internal fun archiveStagingInput(file: File): InputStream {
    val input = try { file.inputStream() } catch (error: IOException) { throw ArchiveStagingException(error) }
    return object : java.io.FilterInputStream(input) {
        override fun read(): Int = try { super.read() } catch (error: IOException) { throw ArchiveStagingException(error) }
        override fun read(bytes: ByteArray, offset: Int, length: Int): Int = try {
            super.read(bytes, offset, length)
        } catch (error: IOException) { throw ArchiveStagingException(error) }
        override fun close() { try { super.close() } catch (error: IOException) { throw ArchiveStagingException(error) } }
    }
}
