package com.shilapi.xcertplay

import org.junit.Assert.*
import org.junit.Test
import org.junit.Before
import org.junit.After
import java.nio.file.Files

class DiagnosticRedactorTest {
    @Test fun fixedAudioTempoBackendNamesSurviveStandardReportRedaction() {
        for (backend in listOf("none", "wasm-simd", "wasm", "soundtouchjs", "unknown")) {
            val line = "browser video stage=ENGINE_PCM id=7 revision=3 generation=4 audioTempoBackend=$backend audioSourceRate=48000"
            assertEquals(line, DiagnosticRedactor.redact(line))
        }
    }

    private var previousLevel = DiagnosticLogLevel.STANDARD

    @Before fun includeAllDebugEvidence() {
        previousLevel = DiagnosticLogPolicy.level
        DiagnosticLogPolicy.level = DiagnosticLogLevel.DEBUG
    }

    @After fun restoreLogLevel() { DiagnosticLogPolicy.level = previousLevel }

    @Test fun debugMetadataPreservesAirPlayEventsWithoutDeviceNames() {
        val lines = listOf(
            "browser video stage=EVENT id=1 revision=0 event=play-rejected active=true position=0.0 duration=120.0 bufferedPosition=0.0 paused=true ended=false seeking=false dragging=false readyState=4 networkState=1 errorCode=0 errorType=NotAllowedError errorText=play() failed for [url]",
            "browser video stage=EVENT id=2 revision=0 event=error active=true position=0.0 duration=unknown bufferedPosition=0.0 paused=true ended=false seeking=false dragging=false readyState=0 networkState=3 errorCode=2 errorType=OTHER errorText=A network error (status 502) prevented playback of [url]",
            "receiver protocol c=12 stage=REVERSE_REPLY kind=EVENT status=200 bodyBytes=0",
            "receiver protocol c=12 stage=FINISH reason=BROWSER_FAILED epoch=2",
        )
        val folder = Files.createTempDirectory("tiplay-airplay-report").toFile()
        try {
            val file = folder.resolve("diplay.log")
            SessionLogFile(file).use { log ->
                log.reset("started")
                lines.forEach { log.append(it) }
                log.append("phoneName=private-phone-name")
            }
            val report = file.readText()
            lines.forEach { assertTrue(it, report.contains(it)) }
            assertFalse(report.contains("private-phone-name"))
        } finally { folder.deleteRecursively() }
    }

    @Test fun debugMetadataPreservesTroubleshootingWithoutPayloadCopies() {
        val lines = listOf(
            "wireless startup elapsedMs=10000 authenticated=true wifiConfigs=2 startRequests=1 tcpAccepted=0 sessionActive=false waitingFor=WiFi_discovery_or_AirPlay_TCP startRequestAgeMs=9000 firstTcpAfterStartMs=none",
            "receiveCounters windowMs=10000 udpScope=device ifaceRx=sampled ifaceRxPacketsDelta=400 ifaceRxBytesDelta=8000 ifaceRxDroppedDelta=2 ifaceRxErrorsDelta=0 ifaceRxMissedErrorsDelta=1 udp4=sampled udp4InDatagramsDelta=390 udp4InErrorsDelta=2 udp4RcvbufErrorsDelta=1 udp4InCsumErrorsDelta=1 udp6=unavailable failureClass=FileNotFoundException",
            "Audio: renderer failed api=30 audioType=default codec=OPUS stage=decoder-configure error=IllegalArgumentException causes=IllegalArgumentException at=android.media.MediaCodec.configure:100",
            "Audio: decoder stats audioType=default codec=OPUS inputQueuedTotal=20 inputDroppedTotal=0 shortOpusPacketsTotal=2 decoderUnavailablePacketsTotal=0 outputBuffersTotal=19 ended=true",
            "THEME_DIAGNOSTIC sample source=poll uiMode=0x13 nightMask=0x10 reported=light applied=light sessionActive=true pollsSinceSample=30 callbacksSinceSample=0",
            "Process exit index=0 ageMs=5000 reason=native_crash reasonCode=5 status=11 importance=100 pssKiB=2048 rssKiB=4096",
            "airplay /info audioRoute=car-bluetooth audioFormats=0 audioLatencies=9 features=0x615653aee2",
            "airplay audio route=car-bluetooth expecting no audio SETUP",
            "airplay audio SETUP type=100 audioType=media formatBits=0x8000 audioRoute=car-bluetooth result=declined dataPort=none controlPort=none",
            "airplay audio summary audioRoute=car-bluetooth audioSetups=0 streams=none",
        )
        val folder = Files.createTempDirectory("diplay-troubleshooting-report").toFile()
        try {
            val file = folder.resolve("diplay.log")
            SessionLogFile(file).use { log ->
                log.reset("started")
                for (line in lines) {
                    assertTrue("New fields must fit the export cap", line.length < 700)
                    assertEquals(line, DiagnosticRedactor.redact(line))
                    log.append(line)
                }
                log.append("Audio: payload=private-recording")
            }
            val report = file.readText()
            lines.forEach { assertTrue(report.contains(it)) }
            assertFalse(report.contains("private-recording"))
        } finally { folder.deleteRecursively() }
    }

    @Test fun boundedMicrophoneStartFailureAndCaptureCountersSurviveRedaction() {
        val lines = listOf(
            "Microphone: start type=telephony source=VOICE_COMMUNICATION codec=OPUS rate=48000 channels=1 frameMs=20 routedDeviceType=15",
            "Microphone: failure type=speechrecognition source=VOICE_RECOGNITION codec=LPCM rate=16000 channels=1 frameMs=20 stage=READ error=none code=-3",
            "Microphone: stats type=telephony source=VOICE_COMMUNICATION codec=OPUS rate=48000 channels=1 frameMs=20 routedDeviceType=15 captureBytes=1920 reads=2 zeroReads=1 readErrors=0 readMaxMs=30 encodedFrames=1 emptyEncodedFrames=1 udpSent=2 sendErrors=1 sendGapMaxMs=30 ended=false",
        )
        for (line in lines) assertEquals(line, DiagnosticRedactor.redact(line))
        assertNull(DiagnosticRedactor.redact("Microphone: payload=private-audio"))
        assertFalse(DiagnosticRedactor.redact("Microphone: failure peer=192.168.49.1")!!.contains("192.168.49.1"))
    }

    @Test fun connectionTimingAndCachedServiceMetadataSurviveWithoutPersonalIdentifiers() {
        val lines = listOf(
            "CONNECTION_DIAGNOSTIC attempt=2 phase=CONTROL wired io final readCalls=105 writeCalls=50 readTimeouts=3 ends=0 failures=1 maxReadMs=909 maxWriteMs=1937",
            "CONNECTION_DIAGNOSTIC attempt=2 phase=WIRELESS Bluetooth snapshot point=after-failure enabled=true bondState=12 cachedServiceCount=5 cachedIap2Service=false",
            "CONNECTION_DIAGNOSTIC generation=2 restart teardownWaitCompleted=false elapsedMs=4000",
            "CONNECTION_DIAGNOSTIC attempt=2 phase=USB_DISCOVERY USB configuration ready=true configurationId=6 reenumerationAttempts=0 action=reuse-descriptors",
        )
        for (line in lines) assertEquals(line, DiagnosticRedactor.redact(line))
        assertNull(DiagnosticRedactor.redact("CONNECTION_DIAGNOSTIC attempt=2 payload=private-data"))
        assertFalse(DiagnosticRedactor.redact("CONNECTION_DIAGNOSTIC attempt=2 peer=192.168.49.1 id=0123456789abcdef0123456789abcdef")!!.contains("192.168.49.1"))
    }
    @Test fun savedDriveReportKeepsMediaPerformanceCounters() {
        val folder = Files.createTempDirectory("diplay-media-report").toFile()
        try {
            val audio = "audio stats audioType=media codec=AAC_LC rx=215 dropped=0 underruns=+3 queue=2 playing=true maxGapMs=420 sinceRxMs=10 maxWriteMs=22 decoderDroppedTotal=0 outputBuffersTotal=212 ended=true"
            val video = "Video: video stats rx=29.8fps shown=29.8fps maxGap=150ms kbps=4000 recoveries=0 touch2frame avg=85ms max=110ms n=3 touchSendMax=1ms"
            SessionLogFile(folder.resolve("diplay.log")).use {
                it.reset("started")
                it.append(audio)
                it.append(video)
            }
            val report = folder.resolve("diplay.log").readText()
            assertTrue(report.contains(audio))
            assertTrue(report.contains(video))
        } finally { folder.deleteRecursively() }
    }
    @Test fun payloadAndCredentialLinesNeverReachReports() {
        for (line in listOf("TRACE IAP2 tx key", "hotspot passphrase=secret", "token=secret", "certificate bytes=607", "rx body={phone: 'Jane'}", "ok\nsecret", "wifi ssid=Home", "wireless name=Jane Smith’s iPhone")) {
            assertNull(line, DiagnosticRedactor.redact(line))
        }
    }

    @Test fun strictCodecProfilesSurviveAddressRedactionWithoutExemptingLocationsOrCredentials() {
        val vp9 = "vp09.00.10.08.01.01.01.01.00"
        val av1 = "av01.0.08M.08.0.110.01.01.01.0"
        val source = "browser video stage=ENGINE_CODEC codec=$vp9 peer=192.168.49.1 ipv6=fe80::abcd%wlan0 nextCodec=$av1"
        val saved = DiagnosticRedactor.redact(source)!!
        assertTrue(saved, saved.contains("codec=$vp9"))
        assertFalse(saved, saved.contains("192.168.49.1") || saved.contains("fe80::abcd"))
        assertEquals("codec=$av1", DiagnosticRedactor.redact("codec=$av1"))
        assertEquals("codec=avc1.640028", DiagnosticRedactor.redact("codec=avc1.640028"))
        assertEquals("codec=vp09.00.10.08", DiagnosticRedactor.redact("codec=vp09.00.10.08"))
        assertEquals("source=[url] codec=$vp9", DiagnosticRedactor.redact("source=https://private.test/video?codec=$vp9 codec=$vp9"))
        assertEquals("codec=[url]", DiagnosticRedactor.redact("codec=https://private.test/video?codec=$vp9"))
        for (text in listOf("codec=avc1.password", "codec=vp09.token", "codec=av01.0 password=private", "codec=avc1.token=private"))
            assertNull(text, DiagnosticRedactor.redact(text))
        // A similar field or pre-existing placeholder text has no codec privilege.
        assertFalse(DiagnosticRedactor.redact("othercodec=vp09.00.10.08")!!.contains("09.00.10.08"))
        assertEquals("[codec0] peer=[ip]", DiagnosticRedactor.redact("[codec0] peer=192.168.49.1"))
        val oversized = "codec=avc1." + "f".repeat(16) + "." + "f".repeat(16) + "." + "f".repeat(16) + " peer=192.168.49.1"
        assertFalse(DiagnosticRedactor.redact(oversized)!!.contains("192.168.49.1"))
    }

    @Test fun invalidCodecProfilesCannotDisguiseRealAddressesAsCodecComponents() {
        for (codec in listOf("av01.192.168.1.1", "avc1.192.168.1.1", "hvc1.192.168.1.1",
            "av01.0.08M.08.0.110.192.168.1.1")) {
            val saved = DiagnosticRedactor.redact("codec=$codec peer=192.168.49.1 ipv6=fe80::abcd%wlan0")!!
            assertFalse(saved, saved.contains("192.168.1.1") || saved.contains("192.168.49.1") || saved.contains("fe80::abcd"))
        }
        for (codec in listOf("vp09.00.99.08.01.01.01.01.00", "vp09.00.10.12.01.01.01.01.00")) {
            val saved = DiagnosticRedactor.redact("codec=$codec")!!
            assertFalse("Invalid level or profile/bit-depth must not receive an address exemption: $saved", saved.contains(codec))
        }
    }

    @Test fun standardKeepsFailureContextAfterSharedErrorTextHasRemovedCredentials() {
        DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
        val directory = Files.createTempDirectory("diagnostic-sanitized-failure").toFile()
        try {
            val text = com.shilapi.xcertplay.diagnostics.DiagnosticErrorText.sanitize("Invalid request token=private-value password=private-password")
            SessionLogFile(directory.resolve("diplay.log")).use { log ->
                log.append("receiver protocol c=1 stage=DISPATCH exception=IllegalArgumentException errorText=$text")
                log.append("receiver protocol c=1 stage=DISPATCH exception=IllegalArgumentException token=raw-private-value")
            }
            val saved = directory.resolve("diplay.log").readText()
            assertTrue(saved, saved.contains("stage=DISPATCH exception=IllegalArgumentException"))
            assertTrue(saved, saved.contains("errorText=Invalid request [credential] [credential]"))
            assertFalse(saved, saved.contains("private"))
            assertEquals(1, saved.lineSequence().filter { it.isNotEmpty() }.count())
        } finally { directory.deleteRecursively() }
    }
    @Test fun stateTransitionsSurviveWithoutAddressesOrIdentifiers() {
        val line = DiagnosticRedactor.redact("connected peer=C0:A6:00:29:58:0A ip=192.168.31.71 id=0123456789abcdef0123456789abcdef ipv6=fe80::1234:5678:abcd:9%p2p0")!!
        assertTrue(line.contains("connected"))
        assertFalse(line.contains("C0:A6")); assertFalse(line.contains("192.168")); assertFalse(line.contains("012345")); assertFalse(line.contains("fe80"))
    }

    @Test fun passedStatesSurviveAndRawResourceLocationsAndAdditionalCredentialsAreRemoved() {
        assertEquals("USB preflight passed action=bypass-cache", DiagnosticRedactor.redact("USB preflight passed action=bypass-cache"))
        assertEquals("Browser link: pairingCode=yes", DiagnosticRedactor.redact("Browser link: pairingCode=yes"))
        assertEquals("Browser link: pairingCode=no active=false", DiagnosticRedactor.redact("Browser link: pairingCode=no active=false"))
        assertEquals("Playback failed source=[url]", DiagnosticRedactor.redact("Playback failed source=https://example.test/video?code=private"))
        for (line in listOf("Authorization: Bearer private", "cookie=private", "pairingCode=private", "pairingCode= 123456", "pairingCode=yes-private", "api-key=private", "error\u2028private")) {
            assertNull(line, DiagnosticRedactor.redact(line))
        }
    }
    @Test fun standardLogRotationIsBoundedAndRedactionHappensBeforeDisk() {
        DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
        val folder = Files.createTempDirectory("diplay-log-test").toFile()
        try {
            val log = SessionLogFile(folder.resolve("diplay.log"))
            log.reset("started")
            log.append("password=secret")
            repeat(1600) { log.append("connection state " + "x".repeat(690)) }
            log.append("CarPlay connected")
            log.close()
            assertTrue(folder.resolve("diplay.log").length() <= SessionLogFile.MAX_BYTES + 701)
            assertTrue(folder.resolve("previous.log").length() <= SessionLogFile.MAX_BYTES + 701)
            assertTrue(folder.resolve("diplay.log").readText().contains("CarPlay connected"))
            assertFalse(folder.listFiles()!!.any { it.readText().contains("secret") })
        } finally { folder.deleteRecursively() }
    }
    @Test fun standardFailuresSurviveLaterSuccessfulSessionsAndOldestHistoryExpires() {
        DiagnosticLogPolicy.level = DiagnosticLogLevel.STANDARD
        val folder = Files.createTempDirectory("diplay-history-test").toFile()
        try {
            repeat(10) { session ->
                SessionLogFile(folder.resolve("diplay.log")).use {
                    it.reset("session=$session")
                    it.append(if (session == 3) "Wi-Fi P2P create rejected code=0" else "CarPlay connected")
                    it.append("password=secret")
                }
            }
            val history = SessionLogFile.REPORT_NAMES.map { folder.resolve(it).readText() }
            assertEquals(8, folder.listFiles()!!.size)
            assertTrue(history.first().contains("session=2"))
            assertTrue(history.last().contains("session=9"))
            assertTrue(history.any { it.contains("rejected code=0") })
            assertFalse(history.any { it.contains("secret") })
        } finally { folder.deleteRecursively() }
    }
    @Test fun safeWifiMetadataSurvivesWithoutWeakeningCredentialFilters() {
        val lines = listOf(
            "Wi-Fi P2P preflight wifiEnabled=true locationEnabled=false permissionGranted=true stationMHz=5180",
            "Wi-Fi P2P create mode=FIXED_2_GHZ frequencyMHz=2437",
            "Wi-Fi P2P create rejected code=0 reason=generic error",
            "Wi-Fi P2P ready mode=FIXED_2_GHZ band=2.4 GHz channel=6 frequencyMHz=2437",
            "Wi-Fi P2P channel requestedMHz=2437 actualMHz=2412 matched=false",
            "wireless hotspot backend=Wi-Fi P2P iface=p2p0 host=192.168.49.1 band=5 GHz channel=36 frequency=5180MHz",
        )
        for (line in lines) assertNotNull(line, DiagnosticRedactor.redact(line))
        assertFalse(DiagnosticRedactor.redact(lines.last())!!.contains("192.168.49.1"))
    }

    @Test fun startupAndAirPlayMilestonesSurviveExportWithoutWeakeningPayloadFilters() {
        val lines = listOf(
            "wireless startup elapsedMs=10000 authenticated=true wifiConfigs=2 startRequests=1 tcpAccepted=0 sessionActive=false waitingFor=WiFi_discovery_or_AirPlay_TCP",
            "interfaceState=up multicast=true ipv4Usable=1 ipv6LinkLocal=1 ipv6Scoped=1",
            "p2pGroup=present owner=true sameGroup=true reportedP2pClients=0 association=unknown legacyClients=not_exposed",
            "bonjourAdded=0 bonjourResolved=0 bonjourAddressMismatch=0 connectProbes=0 connectProbe2xx=0 lastProbe=not_started",
            "control probe stage=REQUEST_SENT attempt=1 family=IPv6",
            "airplay TCP accepted family=IPv6",
            "airplay control request method=POST route=pair-verify contentBytes=128",
            "airplay control response status=200 contentBytes=32",
            "iap2 availability wired=unknown wireless=true themeAssets=unknown",
        )
        for (line in lines) assertEquals(line, line, DiagnosticRedactor.redact(line))
        assertNull(DiagnosticRedactor.redact("airplay rx POST /pair-verify body=secret"))
    }
}
