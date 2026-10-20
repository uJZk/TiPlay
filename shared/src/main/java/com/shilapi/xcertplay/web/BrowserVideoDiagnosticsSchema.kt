package com.shilapi.xcertplay.web

/** Protocol v1 mirrors site/play/video-diagnostics.js. Only these flat, non-identifying scalars may be journaled. */
object BrowserVideoDiagnosticsSchema {
    const val MAX_BYTES = 16 * 1024
    const val MAX_FIELDS = 256
    private const val MAX_NUMBER = 9_007_199_254_740_991.0
    private fun words(text: String) = text.split(' ').filter(String::isNotEmpty)
    private val counters = words("readFrames readFrameBytes decoded drawnFrames records bytes gaps discontinuities decodeErrors backlogResets keyRequests timingRecords timingRejected sourceForwardPtsSamples sourceReorderedPts decodeDroppedFrames scheduledDroppedFrames transferDroppedFrames renderDroppedFrames pacingDroppedFrames droppedFrames scheduledExpiredFrames scheduledCoalescedFrames scheduledStaleFrames scheduledCapacityFrames audioSyncDroppedFrames audioSyncUnavailableFrames videoCeilingViolations touchSkippedFrames expiredFrames untimedFrames audioRenderSyncDroppedFrames pacingRefreshDraws pacingDeadlineDraws")
    private val values = words("currentFps currentDelta lastDrawAgeMs frameIntervalP95Ms frameIntervalMaxMs decodedFps bytesPerSec width height decodeQueueSize decodedQueueSize clockRttMs readFrameIntervalMsP95 sourceForwardPtsIntervalMsP95 decodeMsP50 decodeMsP95 recordReadToDecodeSubmitMsP95 androidHubQueueMsP95 androidTransportSubmitToRecordReadMsP95 stageClockUncertaintyMs decodedToSchedulerMsP95 decodedToDrawMsP95 drawMsP95 presentationOffset90 presentationOffsetHigh5 presentationOffsetSamples senderRelativePolicyCeilingMs videoCursorSpeed videoCursorDeltaMs decodedFrontierDeltaMs touchCatchUpActive")
    private val receiver = words("retainedBytes consumedBytes queuedRecords partialBytes receivedRecords receivedFragments peakRetainedBytes reassemblyMsMean reassemblyMsMax consumerWaitMsMean consumerWaitMsMax")
    private val ice = words("currentRoundTripTimeMs availableOutgoingBitrate requestsSent requestsReceived responsesSent responsesReceived bytesSent bytesReceived sampleAgeMs errors")
    private val control = words("seq inFlight inFlightCount pending posts failures overflows rttMsP50 rttMsP95")
    private val senderRoot = words("authenticated ready closed nativeSampleAgeMs controlMessageLimitBytes localCandidateCount remoteCandidateCount localIPv4LinkLocalCandidateCount remoteIPv4LinkLocalCandidateCount pendingWorkerTasks transportBudgetMs")
    private val senderMedia = words("queueBytes queueRecords queueLimitBytes oldestQueuedAgeMs receiverWindowBytes receiverReservedBytes receiverConsumedBytes receiverInFlightBytes oldestUnackedAgeMs nativeBufferedBytes acceptedRecords acceptedBytes fragmentsSent recordsSent recordBytesSent wireBytesSent queueWaitMsMean queueWaitMsMax queuedToNativeSendMsMean queuedToNativeSendMsMax")
    private val senderControl = words("nativeBufferedBytes recordsSent bytesSent pendingReceiveTasks")
    val enums: Map<String, Set<String>> = linkedMapOf(
        "interval.state" to words("baseline valid capture-change source-change counter-reset unavailable").toSet(),
        "raw.mode" to words("carplay airplay-mirror airplay-audio").toSet(),
        "raw.codec" to words("avc1 avc3 hvc1 hev1 vp8 vp09 av01").toSet(),
        "raw.acceleration" to words("prefer-hardware prefer-software no-preference").toSet(),
        "raw.decoderImplementation" to setOf("unknown"),
        "raw.presentationTimingState" to words("unobserved unavailable mapped-presentation").toSet(),
        "raw.pacingMode" to words("display-refresh immediate").toSet(),
        "raw.pipelineCounterScope" to setOf("pipeline-lifetime"),
        "raw.decodeDropCounterScope" to setOf("epoch-reset"),
        "raw.schedulerCounterScope" to setOf("epoch-reset"),
        "raw.transferCounterScope" to setOf("epoch-reset"),
        "raw.renderCounterScope" to setOf("epoch-reset"),
        "raw.stageSampleScope" to setOf("rolling-may-span-epochs"),
        "raw.touchSubset" to setOf("scheduledDroppedFrames"),
        "raw.schedulerReasonSubset" to setOf("scheduledDroppedFrames"),
        "transport.ice.state" to words("collecting unavailable no-selected-pair selected").toSet(),
        "transport.ice.localCandidateType" to words("host srflx prflx relay").toSet(),
        "transport.ice.remoteCandidateType" to words("host srflx prflx relay").toSet(),
        "transport.ice.protocol" to words("udp tcp").toSet(),
        "transport.ice.connectionState" to words("new checking connected completed failed disconnected closed").toSet(),
        "sender.networkMode" to words("kernel-interfaces android-network-monitor").toSet(),
    ).apply {
        val nativeStates = words("NEW CHECKING CONNECTED COMPLETED FAILED DISCONNECTED CLOSED GATHERING COMPLETE CONNECTING").toSet()
        for (field in words("iceGatheringState iceConnectionState peerConnectionState")) put("sender.$field", nativeStates)
    }
    val booleanFields = setOf("raw.touchCatchUpActive", "control.inFlight", "sender.authenticated", "sender.ready", "sender.closed")
    val fields: Set<String> = linkedSetOf("schema", "pageVersion", "omittedFields", "sample", "streamGeneration", "epoch", "interval.durationMs").apply {
        addAll(counters.map { "interval.$it" }); addAll((counters + values).map { "raw.$it" })
        addAll(receiver.map { "transport.video.$it" }); addAll(ice.map { "transport.ice.$it" })
        addAll(control.map { "control.$it" }); addAll(senderRoot.map { "sender.$it" })
        for (kind in listOf("video", "audio")) addAll(senderMedia.map { "sender.$kind.$it" })
        addAll(senderControl.map { "sender.control.$it" }); addAll(enums.keys)
    }
    private val pageVersion = Regex("v[0-9]{1,8}(?:[-_][A-Za-z0-9]{1,16})?")
    private val identities = setOf("schema", "pageVersion", "sample", "streamGeneration", "epoch")
    val groups: Map<String, List<String>> = listOf("DROPS", "SOURCE", "DECODE", "SCHEDULE", "RENDER", "TRANSPORT", "SENDER")
        .associateWith { groupName -> fields.filter { it !in identities && group(it) == groupName } }

    private fun group(key: String): String {
        if (key.startsWith("sender.")) return "SENDER"
        if (key.startsWith("transport.") || key.startsWith("control.")) return "TRANSPORT"
        val field = key.substringAfter('.')
        if (field.contains("Dropped") || field == "droppedFrames" || field in words("scheduledExpiredFrames scheduledCoalescedFrames scheduledStaleFrames scheduledCapacityFrames videoCeilingViolations touchSkippedFrames expiredFrames untimedFrames gaps discontinuities backlogResets touchSubset schedulerReasonSubset")) return "DROPS"
        if (field.startsWith("read") || field.startsWith("source") || field.startsWith("android") || field in words("records bytes bytesPerSec timingRecords timingRejected presentationTimingState pipelineCounterScope stageSampleScope")) return "SOURCE"
        if (field.startsWith("decode") && field !in words("decodedToSchedulerMsP95 decodedToDrawMsP95") || field in words("codec acceleration keyRequests")) return "DECODE"
        if (field.startsWith("draw") || field in words("currentFps lastDrawAgeMs frameIntervalP95Ms frameIntervalMaxMs decodedToDrawMsP95 pacingMode pacingRefreshDraws pacingDeadlineDraws renderCounterScope")) return "RENDER"
        return "SCHEDULE"
    }

    /** Reject the entire malformed event; never journal an arbitrary stats object or silently discard its tail. */
    fun parse(value: Any?): Map<String, Any?>? {
        val input = value as? Map<*, *> ?: return null
        if (input.size > MAX_FIELDS || input.keys.any { it !is String || it !in fields }) return null
        val version = input["pageVersion"] as? String ?: return null
        if ((input["schema"] as? Number)?.toDouble() != 1.0 || !pageVersion.matches(version)) return null
        val sample = (input["sample"] as? Number)?.toDouble() ?: return null
        if (!sample.isFinite() || sample < 1 || sample > MAX_NUMBER || sample % 1.0 != 0.0) return null
        val result = linkedMapOf<String, Any?>()
        for ((rawName, item) in input) {
            val name = rawName as String
            if (item == null) {
                if (name in setOf("schema", "pageVersion", "sample")) return null
            } else when {
                name == "pageVersion" -> if (item !is String || !pageVersion.matches(item)) return null
                name in enums -> if (item !is String || item !in enums.getValue(name)) return null
                name in booleanFields -> if (item !is Boolean) return null
                else -> {
                    val number = (item as? Number)?.toDouble() ?: return null
                    if (!number.isFinite() || kotlin.math.abs(number) > MAX_NUMBER) return null
                    if (name in setOf("schema", "sample", "streamGeneration", "epoch", "omittedFields") && (number < 0 || number % 1.0 != 0.0)) return null
                }
            }
            result[name] = item
        }
        return result.takeIf { WebJson.write(it).toByteArray(Charsets.UTF_8).size <= MAX_BYTES }
    }
}
