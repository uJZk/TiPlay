package com.shilapi.xcertplay.receiver

import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayInfoPlist
import com.shilapi.xcertplay.airplay.RtspMessage
import java.io.Closeable
import java.net.Socket
import java.util.Locale

internal enum class UnifiedAirPlayStage { REGISTERED, ENTRY_ACCEPTED, IDENTITY_MISMATCH, ORDINARY_ROUTE, CARPLAY_ROUTE }

/** Reversible shared-entry trial; pairing and media state remain local to each connection. */
object UnifiedAirPlayTrial {
    const val SETTINGS_KEY = "tiplay_unified_airplay_trial"
    private data class Backend(val server: ReceiverServer, val config: ReceiverConfig)
    @Volatile var enabled: Boolean = false
        private set
    @Volatile private var backend: Backend? = null

    fun configure(enabled: Boolean) { this.enabled = enabled }

    @Synchronized fun install(server: ReceiverServer, config: ReceiverConfig) {
        backend = Backend(server, config)
        server.reportTrial(UnifiedAirPlayStage.REGISTERED)
    }

    @Synchronized fun remove(server: ReceiverServer) {
        if (backend?.server === server) backend = null
    }

    fun advertisedName(originalName: String): String = if (enabled) SHARED_NAME else originalName

    /** Ordinary discovery profile; negotiated CarPlay keeps its original bit 32. */
    fun bonjourFeatures(carPlayFeatures: Long): Long =
        backend?.takeIf { enabled }?.config?.features ?: carPlayFeatures

    fun txtRecords(original: Map<String, String>): Map<String, String> {
        val current = backend?.takeIf { enabled } ?: return original
        return original.toMutableMap().apply {
            for (key in listOf("model", "srcvers", "vv", "pw")) {
                current.config.txt[key]?.let { this[key] = it }
            }
            // Match the working ordinary Bonjour profile; protocol version remains in server-info.
            remove("protovers")
        }
    }

    fun connection(socket: Socket, carPlayConfig: AirPlayConfig, identity: AirPlayIdentity): UnifiedAirPlayConnection? {
        if (!enabled) return null
        val current = backend ?: return null
        if (!sameIdentity(current.config.identity, identity)) {
            current.server.reportTrial(UnifiedAirPlayStage.IDENTITY_MISMATCH)
            return null
        }
        current.server.reportTrial(UnifiedAirPlayStage.ENTRY_ACCEPTED)
        // Both dialects are reachable through this identity/port; retain the entry's real union
        // when CarPlay clients cache /info for a later ordinary connection.
        val combinedFeatures = AirPlayInfoPlist.features(carPlayConfig) or current.config.features
        val discoveryFeatures = bonjourFeatures(AirPlayInfoPlist.features(carPlayConfig))
        return UnifiedAirPlayConnection(identity, combinedFeatures, current.server::reportTrial, discoveryFeatures,
            discoveryInfo = { request -> ReceiverInfoProtocol.response(current.config, request,
                discoveryFeatures, carPlayConfig.deviceId) }) {
            // Wireless CarPlay uses the active hotspot BSSID, not the persisted bootstrap device ID.
            current.server.openConnection(socket, bonjourFeatures(AirPlayInfoPlist.features(carPlayConfig)), carPlayConfig.deviceId)
        }
    }

    private fun sameIdentity(a: AirPlayIdentity, b: AirPlayIdentity): Boolean =
        a.pairingId == b.pairingId && a.publicKey.contentEquals(b.publicKey) &&
            a.privateKey.contentEquals(b.privateKey)

    internal const val SHARED_NAME = "TiPlay"
}

/** The first unambiguous handshake fixes the dialect for the lifetime of this TCP connection. */
class UnifiedAirPlayConnection internal constructor(
    private val identity: AirPlayIdentity,
    private val combinedFeatures: Long,
    private var log: ((UnifiedAirPlayStage) -> Unit)? = {},
    private val discoveryFeatures: Long = combinedFeatures,
    private var discoveryInfo: ((RtspMessage.Request) -> RtspMessage.Response)? = null,
    private var ordinaryFactory: (() -> ReceiverRequestConnection)?,
) : Closeable {
    private enum class Dialect { UNKNOWN, ORDINARY, CARPLAY }
    @Volatile private var dialect = Dialect.UNKNOWN
    private var ordinary: ReceiverRequestConnection? = null
    private var closed = false
    val isOrdinary: Boolean get() = dialect == Dialect.ORDINARY
    val isCarPlay: Boolean get() = dialect == Dialect.CARPLAY

    @Synchronized fun handle(request: RtspMessage.Request): RtspMessage.Response? {
        check(!closed)
        if (dialect == Dialect.UNKNOWN) {
            val path = request.path.substringBefore('?').lowercase(Locale.ROOT)
            if (request.method in listOf("SETUP", "RECORD", "TEARDOWN")) {
                return RtspMessage.Response(status = 403, statusText = "Forbidden", headers = mapOf("Connection" to "close"))
            }
            if (path.endsWith("/info") && request.method == "GET") {
                discoveryInfo?.let { return it(request) }
            }
            val pairing = path.endsWith("/pair-setup") || path.endsWith("/pair-verify")
            val legacyPairing = request.method == "POST" && when {
                path.endsWith("/pair-setup") -> request.body.size == 32
                path.endsWith("/pair-verify") -> request.body.size == 68 &&
                    request.body[0] in byteArrayOf(0, 1) && (1..3).all { request.body[it] == 0.toByte() }
                else -> false
            }
            dialect = when {
                legacyPairing || path.endsWith("/fp-setup") ||
                    path.endsWith("/server-info") || path.endsWith("/reverse") || path.endsWith("/play") -> Dialect.ORDINARY
                path.endsWith("/auth-setup") || (pairing && request.method == "POST") -> Dialect.CARPLAY
                else -> Dialect.UNKNOWN
            }
            when (dialect) {
                Dialect.ORDINARY -> log?.invoke(UnifiedAirPlayStage.ORDINARY_ROUTE)
                Dialect.CARPLAY -> {
                    log?.invoke(UnifiedAirPlayStage.CARPLAY_ROUTE)
                    // A retained CarPlay session must not retain a disabled ordinary service.
                    ordinaryFactory = null
                    discoveryInfo = null
                    log = null
                }
                else -> Unit
            }
        }
        if (!isOrdinary) return null
        val receiver = ordinary ?: requireNotNull(ordinaryFactory).invoke().also { ordinary = it }
        return receiver.handle(request)
    }

    fun decorateCarPlayInfo(info: MutableMap<String, Any?>) {
        info["name"] = UnifiedAirPlayTrial.SHARED_NAME
        info["features"] = if (dialect == Dialect.UNKNOWN) discoveryFeatures else combinedFeatures
        if (dialect == Dialect.UNKNOWN) {
            info["model"] = "AppleTV3,2"
            info["sourceVersion"] = "220.68"
        }
        info["pk"] = identity.publicKey.copyOf()
        info["pi"] = identity.pairingId
    }

    @Synchronized fun responseSent(response: RtspMessage.Response) {
        ordinary?.responseSent(response)
    }

    @Synchronized override fun close() {
        if (closed) return
        closed = true
        ordinary?.close()
        ordinary = null
        ordinaryFactory = null
        discoveryInfo = null
        log = null
    }
}
