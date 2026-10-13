package com.shilapi.xcertplay

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/** Source scan for the "Settings layout" rules in AGENTS.md. */
class SettingsLayoutSourceRulesTest {
    private val sources = File("src/main/java/com/shilapi/xcertplay").listFiles { f -> f.extension == "kt" }!!

    @Test fun blockGapsUseTheNamedConstant() {
        val literal = Regex("""(bottom|top)Margin = dp\((16|18|20)\)""")
        assertEquals(emptyList<String>(), hits(File(sources.first().parentFile, "DiPlayActivity.kt"), literal))
    }

    // The packaged CarPlay icon has a fixed wire size; Android pixel-unit APIs are not literal layout sizes.
    @Test fun sizesAreNotPixelConstants() {
        val pixelConstant = Regex("""\bconst val [A-Z][A-Z0-9_]*_PX\b""")
        assertEquals(emptyList<String>(), sources.filter { it.name != "CarButtonDefaults.kt" }.flatMap { hits(it, pixelConstant) })
    }

    private fun hits(file: File, pattern: Regex) = file.readLines().withIndex()
        .filter { pattern.containsMatchIn(it.value) }
        .map { "${file.name}:${it.index + 1}: ${it.value.trim()}" }
}
