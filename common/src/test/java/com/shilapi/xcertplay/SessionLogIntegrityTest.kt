package com.shilapi.xcertplay

import java.nio.file.Files
import org.junit.Assert.*
import org.junit.Test

class SessionLogIntegrityTest {
    @Test fun closeRetainsAlreadyAcceptedWritesAndReportsLateRejectedEntries() {
        val folder = Files.createTempDirectory("tiplay-log-close").toFile()
        val log = SessionLogFile(folder.resolve("diplay.log"))
        try {
            log.reset("started")
            assertTrue(log.reserve())
            log.close()
            log.appendReserved("teardown finished")
            log.complete()
            log.append("late callback")
            assertTrue(log.file.readText().contains("teardown finished"))
            assertFalse(log.file.readText().contains("late callback"))
            assertTrue(log.integrityLine().contains("rejectedAfterClose=1"))
            assertTrue(log.integrityLine().contains("coverage=partial"))
        } finally { log.close(); folder.deleteRecursively() }
    }

    @Test fun overloadAndStorageFailuresRemainVisibleWithoutPrivateExceptionMessages() {
        val folder = Files.createTempDirectory("tiplay-log-failure").toFile()
        val log = SessionLogFile(folder.resolve("missing/diplay.log"))
        try {
            assertTrue(log.reserve())
            log.complete(droppedFromQueue = true)
            log.append("connection failed")
            val status = log.integrityLine()
            assertTrue(status.contains("queueDropped=1"))
            assertTrue(status.contains("writeFailures=1"))
            assertTrue(status.contains("pending=0"))
            assertTrue(status.contains("coverage=partial"))
            assertFalse(status.contains(folder.absolutePath))
        } finally { log.close(); folder.deleteRecursively() }
    }

    @Test fun policyOmissionsAndPrivacyOmissionsAreCountedSeparatelyFromLostEvidence() {
        val folder = Files.createTempDirectory("tiplay-log-filter").toFile()
        val log = SessionLogFile(folder.resolve("diplay.log"))
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            log.reset("started")
            log.append("Browser: decoded=100 dropped=0")
            log.append("password=private")
            val status = log.integrityLine()
            assertTrue(status.contains("filtered=1"))
            assertTrue(status.contains("privacyFiltered=1"))
            assertTrue(status.contains("coverage=complete"))
        } finally { DiagnosticLogPolicy.level = previous; log.close(); folder.deleteRecursively() }
    }

    @Test fun debugPreservesCredentialsEvenWhenExportedAfterReturningToStandard() {
        val folder = Files.createTempDirectory("tiplay-log-debug").toFile()
        val log = SessionLogFile(folder.resolve("diplay.log"))
        val previous = DiagnosticLogPolicy.level
        try {
            DiagnosticLogPolicy.level = DiagnosticLogLevel.DEBUG
            val raw = "password=private pairingCode=1234 url=http://192.168.1.2/media"
            log.append(raw)
            DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
            val report = StringBuilder()
            DiagnosticLogSnapshot.appendTo(report, folder)
            assertTrue(report.toString().contains(raw))
        } finally { DiagnosticLogPolicy.level = previous; log.close(); folder.deleteRecursively() }
    }

    @Test fun recoveryPersistsEarlierLoggingGapsForTheNextProcessReport() {
        val folder = Files.createTempDirectory("tiplay-log-recovery").toFile()
        val log = SessionLogFile(folder.resolve("missing/diplay.log"))
        try {
            log.append("connection failed")
            assertTrue(log.file.parentFile.mkdirs())
            log.append("connection recovered")
            val text = log.file.readText()
            assertTrue(text.contains("LOG_INTEGRITY_LOSS queueDropped=0 writeFailures=1"))
            assertTrue(text.contains("connection recovered"))
            assertFalse(text.contains(folder.absolutePath))
        } finally { log.close(); folder.deleteRecursively() }
    }
}
