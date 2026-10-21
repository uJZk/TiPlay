package com.shilapi.xcertplay

import com.shilapi.xcertplay.web.BrowserVideoDiagnosticsSchema
import org.junit.Assert.*
import org.junit.Test

class BrowserVideoDiagnosticsTest {
    @Test fun completeEvidenceSplitsIntoCorrelatedShortLinesWithoutLosingAnyTailField() {
        val values = BrowserVideoDiagnosticsSchema.fields.associateWith<String, Any?> { field ->
            when {
                field == "schema" -> 1
                field == "pageVersion" -> "v99999999_abcdefghijklmnop"
                field == "sample" -> 9_007_199_254_740_991L
                field == "omittedFields" -> 0
                field == "epoch" -> 17
                field == "streamGeneration" -> 2
                field in BrowserVideoDiagnosticsSchema.enums -> BrowserVideoDiagnosticsSchema.enums.getValue(field).first()
                field in BrowserVideoDiagnosticsSchema.booleanFields -> false
                else -> 9_007_199_254_740_991L
            }
        }
        // The allowlist is larger than one legal wire event. Exercise all values
        // across bounded events, rather than submitting an impossible >256-field map.
        val identityFields = setOf("schema", "pageVersion", "sample", "epoch", "streamGeneration")
        val snapshots = values.keys.filter { it !in identityFields }
            .chunked(BrowserVideoDiagnosticsSchema.MAX_FIELDS - identityFields.size).map { fields ->
                values.filterKeys { it in identityFields || it in fields }
            }
        val lines = snapshots.flatMap(BrowserVideoDiagnostics::lines)
        assertTrue(lines.size > 7)
        assertEquals(BrowserVideoDiagnosticsSchema.groups.keys, lines.map { it.substringAfter("stage=").substringBefore(' ') }.toSet())
        for (line in lines) {
            assertTrue(line.toByteArray(Charsets.UTF_8).size <= 600)
            assertTrue(line.contains("pageVersion=v99999999_abcdefghijklmnop epoch=17 sample=9007199254740991 generation=2"))
            val timestamped = "2026-10-20 01:02:03.456 +0000  $line"
            assertEquals("The complete scalar line must survive real metadata redaction", timestamped, DiagnosticRedactor.redact(timestamped))
        }
        for (field in BrowserVideoDiagnosticsSchema.groups.values.flatten()) {
            assertEquals("Exactly one complete value for $field", 1,
                lines.sumOf { Regex("(?:^| )${Regex.escape(field)}=(?!missing(?: |$))").findAll(it).count() })
        }
    }

    @Test fun decoderObservationFieldsReachSavedMetadataWithoutExposingInternalSamplingTimestamps() {
        val lines = BrowserVideoDiagnostics.lines(mapOf("schema" to 1, "pageVersion" to "v75", "sample" to 1,
            "streamGeneration" to 4, "epoch" to 2, "raw.decoderStatsAgeMs" to 250.5,
            "raw.readFrameIntervalMsMax" to 190, "raw.decodeOldestInFlightMs" to 284))
        assertTrue(lines.any { it.contains("raw.decoderStatsAgeMs=250.500") })
        assertTrue(lines.any { it.contains("raw.readFrameIntervalMsMax=190") })
        assertTrue(lines.any { it.contains("raw.decodeOldestInFlightMs=284") })
        assertTrue(lines.none { it.contains("decoderStatsSampledAtMs") })
        assertTrue(lines.all { it.length <= 600 && DiagnosticRedactor.redact(it) == it })
    }

    @Test fun absentMetricsRemainMissingAndDoNotBecomeZeroOrClaimSourceEvidence() {
        val lines = BrowserVideoDiagnostics.lines(mapOf("schema" to 1, "pageVersion" to "v71", "sample" to 2,
            "epoch" to null, "streamGeneration" to null, "interval.state" to "unavailable",
            "raw.decodeDroppedFrames" to 0, "raw.currentDelta" to -20.5))
        assertTrue(lines.isNotEmpty())
        assertTrue(lines.all { it.contains("pageVersion=v71 epoch=unknown sample=2 generation=unknown") })
        assertTrue(lines.none { it.contains("stage=SOURCE") })
        assertTrue(lines.any { it.contains("raw.decodeDroppedFrames=0") })
        assertTrue(lines.any { it.contains("raw.scheduledDroppedFrames=missing") })
        assertTrue(lines.any { it.contains("raw.currentDelta=-20.500") })
        assertTrue(lines.any { it.contains("interval.state=unavailable") })
        assertTrue(BrowserVideoDiagnostics.lines(mapOf("schema" to 2, "pageVersion" to "v71", "sample" to 1)).isEmpty())
    }
}
