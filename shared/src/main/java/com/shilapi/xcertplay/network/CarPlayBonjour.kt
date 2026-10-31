package com.shilapi.xcertplay.network

import com.shilapi.xcertplay.diagnostics.RawTraffic
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import com.shilapi.xcertplay.airplay.AirPlayConfig
import com.shilapi.xcertplay.airplay.AirPlayIdentity
import com.shilapi.xcertplay.airplay.AirPlayInfoPlist
import java.io.Closeable
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.nio.charset.StandardCharsets
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import javax.jmdns.JmDNS
import javax.jmdns.ServiceEvent
import javax.jmdns.ServiceInfo
import javax.jmdns.ServiceListener

data class CarPlayBonjourEndpoint(
    val serviceName: String,
    val host: String,
    val port: Int,
    val bluetoothId: String?,
)

sealed interface CarPlayBonjourEvent {
    data class Discovery(val stage: Stage, val ipv4Count: Int = 0, val ipv6Count: Int = 0) : CarPlayBonjourEvent {
        enum class Stage { ADDED, NO_MATCHING_ADDRESS, INVALID_PORT }
    }
    data class Resolved(val endpoint: CarPlayBonjourEndpoint) : CarPlayBonjourEvent

    data class Probed(
        val endpoint: CarPlayBonjourEndpoint,
        val attempts: Int,
        val statusLine: String?,
        val error: IOException?,
    ) : CarPlayBonjourEvent

    data class ProbeProgress(val stage: Stage, val attempt: Int, val ipv6: Boolean) : CarPlayBonjourEvent {
        enum class Stage { CONNECTING, TCP_CONNECTED, REQUEST_SENT }
    }
    data class ProbeFailed(val stage: ProbeProgress.Stage, val attempt: Int, val error: IOException) : CarPlayBonjourEvent
}

/** Saved reports need discovery outcomes without phone names, addresses, or pairing identifiers. */
fun CarPlayBonjourEvent.diagnosticSummary(): String = when (this) {
    is CarPlayBonjourEvent.Discovery -> "control discovery stage=$stage ipv4=$ipv4Count ipv6=$ipv6Count"
    is CarPlayBonjourEvent.Resolved ->
        "control resolved family=${if (':' in endpoint.host) "IPv6" else "IPv4"} port=${endpoint.port}"
    is CarPlayBonjourEvent.Probed -> {
        val status = statusLine?.let { Regex("^HTTP/\\d(?:\\.\\d)? (\\d{3})(?: |$)").find(it)?.groupValues?.get(1) }
        "control probe attempts=$attempts status=${status ?: "none"} error=${error?.javaClass?.simpleName ?: "none"}"
    }
    is CarPlayBonjourEvent.ProbeProgress ->
        "control probe stage=$stage attempt=$attempt family=${if (ipv6) "IPv6" else "IPv4"}"
    is CarPlayBonjourEvent.ProbeFailed ->
        "control probe failed after=$stage attempt=$attempt failureClass=${error.javaClass.simpleName}"
}

/** Pure protocol values shared by the Android runtime and JVM tests. */
object CarPlayBonjourProtocol {
    internal fun featuresTxt(features: Long): String {
        val low = "0x${(features and 0xffffffffL).toString(16)}"
        val high = features ushr 32
        return if (high == 0L) low else "$low,0x${high.toString(16)}"
    }

    fun airPlayTxtRecords(
        config: AirPlayConfig,
        identity: AirPlayIdentity,
    ): Map<String, String> = linkedMapOf(
        "deviceid" to config.deviceId,
        "features" to featuresTxt(AirPlayInfoPlist.features(config)),
        "flags" to "0x4",
        "model" to config.model,
        "srcvers" to config.sourceVersion,
        "protovers" to "1.1",
        "pi" to identity.pairingId,
        "pk" to identity.publicKeyHex,
    )

    fun connectProbeRequest(
        host: String,
        port: Int,
        sourceVersion: String,
        deviceId: String,
    ): String {
        val unbracketedHost = host.removeSurrounding("[", "]").substringBefore('%')
        require(unbracketedHost.isNotBlank()) { "host must not be blank" }
        require(port in 1..65535) { "port must be in 1..65535" }
        require(sourceVersion.isNotEmpty()) { "sourceVersion must not be empty" }
        require('\r' !in sourceVersion && '\n' !in sourceVersion) {
            "sourceVersion must not contain a line break"
        }
        require('\r' !in unbracketedHost && '\n' !in unbracketedHost) {
            "host must not contain a line break"
        }
        val receiverDeviceId = deviceId.replace(":", "")
        require(receiverDeviceId.isNotEmpty()) { "deviceId must contain a hexadecimal value" }
        require('\r' !in receiverDeviceId && '\n' !in receiverDeviceId) {
            "deviceId must not contain a line break"
        }
        val hostHeader = if (':' in unbracketedHost) {
            "[$unbracketedHost]:$port"
        } else {
            "$unbracketedHost:$port"
        }
        return "GET /ctrl-int/1/connect HTTP/1.1\r\n" +
            "Host: $hostHeader\r\n" +
            "User-Agent: AirPlay/$sourceVersion\r\n" +
            "AirPlay-Receiver-Device-ID: $receiverDeviceId\r\n" +
            "Connection: close\r\n" +
            "\r\n"
    }
}

/** JmDNS 3.6.3 calls getHostName() even when its instance name is supplied. */
internal fun namedMdnsAddress(address: InetAddress, hostname: String): InetAddress =
    if (address is Inet6Address) {
        address.scopedInterface?.let { Inet6Address.getByAddress(hostname, address.address, it) }
            ?: Inet6Address.getByAddress(hostname, address.address, address.scopeId)
    } else {
        InetAddress.getByAddress(hostname, address.address)
    }

/** Startup diagnostics are best effort and never change the operation or its exception. */
internal fun <T> mdnsStartupPhase(
    address: InetAddress,
    stage: String,
    diagnostic: (String) -> Unit,
    operation: () -> T,
): T {
    val prefix = "mdns startup family=${if (address is Inet4Address) "IPv4" else "IPv6"} stage=$stage"
    fun record(detail: String) { runCatching { diagnostic("$prefix $detail") } }
    record("state=starting")
    val startedAt = System.nanoTime()
    try {
        val result = operation()
        record("state=ready elapsedMs=${TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)}")
        return result
    } catch (error: Exception) {
        record("state=failed elapsedMs=${TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt)} " +
            "failureClass=${error.javaClass.simpleName}")
        throw error
    }
}

/**
 * Publishes the accessory AirPlay service and discovers the iPhone's CarPlay control service.
 *
 * The NSD callbacks only enqueue work. Resolution, probing, and [onEvent] all run on the worker
 * started by [start], so a blocking consumer callback never runs on the caller or main thread.
 * [onStartupDiagnostic] runs synchronously during interface mDNS startup and must not block.
 */
class CarPlayBonjour(
    context: Context,
    private val config: AirPlayConfig,
    private val identity: AirPlayIdentity,
    private val advertisedHost: String? = null,
    private val useInterfaceMdns: Boolean = false,
    private val onEvent: (CarPlayBonjourEvent) -> Unit = {},
    additionalAddresses: List<InetAddress> = emptyList(),
    private val onStartupDiagnostic: (String) -> Unit = {},
    private val createRegistry: (InetAddress, String) -> JmDNS = JmDNS::create,
) : Closeable {
    // Interface-bound mDNS does not need Android's NSD service, which may be absent on some head units.
    private val nsdManager: NsdManager by lazy {
        (context.applicationContext ?: context)
            .getSystemService(Context.NSD_SERVICE) as? NsdManager
            ?: throw IOException("Android NSD service is unavailable")
    }
    private val services = LinkedBlockingQueue<NsdServiceInfo>(32)
    private val interfaceServices = LinkedBlockingQueue<Pair<CarPlayBonjourEndpoint, InetAddress>>(32)
    private val discoveryEvents = LinkedBlockingQueue<CarPlayBonjourEvent.Discovery>(32)
    private val seenServices = BonjourServiceNames()
    private val rejectedCandidates = AtomicInteger()
    private val lifecycleLock = Any()
    private val localAdvertisedAddress = advertisedHostAddress()
    private val advertisedAddresses = (listOfNotNull(localAdvertisedAddress) + additionalAddresses).distinct()
    @Volatile private var publishedFamilies = "none"
    private val addedCount = AtomicInteger()
    private val resolvedCount = AtomicInteger()
    private val addressMismatchCount = AtomicInteger()
    private val probeCount = AtomicInteger()
    private val successfulProbeCount = AtomicInteger()
    private val lastProbe = AtomicReference("not_started")

    /** Includes zero counts so a silent discovery interval is visible in exported reports. */
    fun diagnosticSnapshot(): String =
        "bonjourAdded=${addedCount.get()} bonjourResolved=${resolvedCount.get()} " +
            "bonjourAddressMismatch=${addressMismatchCount.get()} connectProbes=${probeCount.get()} " +
            "connectProbe2xx=${successfulProbeCount.get()} lastProbe=${lastProbe.get()} " +
            "mdnsFamilies=$publishedFamilies bonjourRejected=${rejectedCandidates.get()}"
    private val multicastLock = (context.applicationContext ?: context)
        .getSystemService(WifiManager::class.java)
        .createMulticastLock("carplay-bonjour").apply { setReferenceCounted(false) }

    private var started = false
    @Volatile
    private var closed = false
    private var registrationRequested = false
    private var discoveryRequested = false
    @Volatile
    private var worker: Thread? = null
    @Volatile
    private var activeSocket: Socket? = null
    private val interfaceMdns = mutableListOf<JmDNS>()
    private val mdnsReservations = mutableListOf<BonjourCleanupPool.Reservation>()
    private var startupRunning = false
    private var finishingClose = false
    private val closeComplete = CountDownLatch(1)
    private val closeCallbacks = mutableListOf<(Boolean) -> Unit>()
    @Volatile private var closeFailed = false

    private val interfaceListener = object : ServiceListener {
        override fun serviceAdded(event: ServiceEvent) {
            if (!closed) {
                discoveryEvents.offer(CarPlayBonjourEvent.Discovery(CarPlayBonjourEvent.Discovery.Stage.ADDED))
                event.dns.requestServiceInfo(event.type, event.name, true)
            }
        }

        override fun serviceRemoved(event: ServiceEvent) {
            seenServices.remove("${event.name}|${event.dns.inetAddress is Inet4Address}")
        }

        override fun serviceResolved(event: ServiceEvent) {
            if (closed) return
            val info = event.info
            // Use the registry address, not deprecated getInterface(), which can return
            // another address family of the same Android interface.
            val address = info.inetAddresses.firstOrNull {
                (it is Inet4Address) == (event.dns.inetAddress is Inet4Address)
            }?.let(::applyLocalScope)
            if (address == null || info.port !in 1..65535) {
                discoveryEvents.offer(CarPlayBonjourEvent.Discovery(
                    if (address == null) CarPlayBonjourEvent.Discovery.Stage.NO_MATCHING_ADDRESS
                    else CarPlayBonjourEvent.Discovery.Stage.INVALID_PORT,
                    info.inetAddresses.count { it is Inet4Address }, info.inetAddresses.count { it is Inet6Address },
                ))
                return
            }
            // A failed probe on one family must not suppress the other family's endpoint.
            if (!seenServices.add("${event.name}|${address is Inet4Address}")) return
            val endpoint = CarPlayBonjourEndpoint(
                event.name, address.hostAddress ?: return, info.port,
                info.getPropertyString("id"),
            )
            if (!interfaceServices.offer(endpoint to address)) {
                seenServices.remove("${event.name}|${address is Inet4Address}")
                rejectedCandidates.incrementAndGet()
            }
        }
    }

    private val registrationListener = object : NsdManager.RegistrationListener {
        override fun onServiceRegistered(serviceInfo: NsdServiceInfo) = Unit

        override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            Log.w(TAG, "AirPlay NSD registration failed code=$errorCode")
        }

        override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) = Unit

        override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
            Log.w(TAG, "AirPlay NSD unregistration failed code=$errorCode")
        }
    }

    private val discoveryListener = object : NsdManager.DiscoveryListener {
        override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
            Log.w(TAG, "CarPlay control discovery failed code=$errorCode")
        }

        override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
            Log.w(TAG, "CarPlay control discovery stop failed code=$errorCode")
        }

        override fun onDiscoveryStarted(serviceType: String) = Unit

        override fun onDiscoveryStopped(serviceType: String) = Unit

        override fun onServiceFound(serviceInfo: NsdServiceInfo) {
            if (closed) return
            val name = serviceInfo.serviceName ?: return
            val type = serviceInfo.serviceType ?: CARPLAY_CONTROL_SERVICE_TYPE
            val key = "$type|$name"
            if (!seenServices.add(key)) return
            if (!services.offer(serviceInfo)) {
                seenServices.remove(key)
                rejectedCandidates.incrementAndGet()
            }
        }

        override fun onServiceLost(serviceInfo: NsdServiceInfo) {
            val name = serviceInfo.serviceName ?: return
            val type = serviceInfo.serviceType ?: CARPLAY_CONTROL_SERVICE_TYPE
            seenServices.remove("$type|$name")
        }
    }

    /** Own resources under a short lock; all opaque registry work runs outside it. */
    fun start() {
        synchronized(lifecycleLock) {
            check(!closed) { "CarPlayBonjour is closed" }
            if (started) return
            started = true
            startupRunning = true
        }
        try {
            multicastLock.acquire()
            if (useInterfaceMdns) {
                requireNotNull(localAdvertisedAddress) { "Interface mDNS requires a local advertised address" }
                val hostname = "carplay-${config.deviceId.replace(":", "")}"
                for (address in advertisedAddresses) {
                    val reservation = synchronized(lifecycleLock) {
                        check(!closed) { "CarPlayBonjour is closed" }
                        (BonjourMdnsCleanup.reserve() ?: throw IOException("Bonjour cleanup capacity is busy"))
                            .also { mdnsReservations.add(it) }
                    }
                    reservation.whenComplete(::finishCloseIfReady)
                    val dns = try {
                        mdnsStartupPhase(address, "create", onStartupDiagnostic) {
                            createRegistry(namedMdnsAddress(address, hostname), hostname)
                        }
                    } catch (error: Throwable) { reservation.abandon(); throw error }
                    reservation.attach(dns)
                    synchronized(lifecycleLock) { if (!closed) interfaceMdns.add(dns) else reservation.requestClose() }
                    reservation.use {
                        mdnsStartupPhase(address, "listener", onStartupDiagnostic) {
                            dns.addServiceListener("$CARPLAY_CONTROL_SERVICE_TYPE.local.", interfaceListener)
                        }
                    }
                    reservation.use {
                        mdnsStartupPhase(address, "register", onStartupDiagnostic) {
                            dns.registerService(ServiceInfo.create("$AIRPLAY_SERVICE_TYPE.local.", config.deviceName,
                                config.port, 0, 0, CarPlayBonjourProtocol.airPlayTxtRecords(config, identity)))
                        }
                    }
                }
                synchronized(lifecycleLock) {
                    if (!closed) publishedFamilies = advertisedAddresses.joinToString(",") { if (it is Inet4Address) "IPv4" else "IPv6" }
                }
            } else {
                // Legacy NSD API calls are asynchronous; retain atomic registration ownership.
                synchronized(lifecycleLock) {
                    check(!closed)
                    registerAirPlay(); registrationRequested = true
                    nsdManager.discoverServices(CARPLAY_CONTROL_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
                    discoveryRequested = true
                }
            }
            synchronized(lifecycleLock) {
                if (!closed) worker = Thread(::runWorker, WORKER_NAME).apply { isDaemon = true; start() }
            }
        } catch (error: Throwable) {
            close()
            throw error
        } finally {
            synchronized(lifecycleLock) { startupRunning = false }
            finishCloseIfReady()
        }
    }

    /** Quick cancellation; awaitClosed reports whether opaque registry cleanup has actually finished. */
    override fun close() {
        val existing = synchronized(lifecycleLock) { if (closed) !startupRunning else null }
        if (existing != null) { if (existing) awaitClosed(JOIN_TIMEOUT_MILLIS); return }
        val reservations: List<BonjourCleanupPool.Reservation>
        val socket: Socket?
        val mayWait: Boolean
        synchronized(lifecycleLock) {
            if (closed) return
            closed = true
            mayWait = !startupRunning
            if (registrationRequested) { registrationRequested = false; runCatching { nsdManager.unregisterService(registrationListener) } }
            if (discoveryRequested) { discoveryRequested = false; runCatching { nsdManager.stopServiceDiscovery(discoveryListener) } }
            socket = activeSocket; activeSocket = null
            worker?.interrupt(); worker = null
            services.clear(); interfaceServices.clear(); discoveryEvents.clear(); seenServices.clear()
            reservations = mdnsReservations.toList()
            interfaceMdns.clear(); publishedFamilies = "none"
        }
        runCatching { socket?.close() }
        reservations.forEach { it.requestClose() }
        finishCloseIfReady()
        if (mayWait) awaitClosed(JOIN_TIMEOUT_MILLIS)
    }

    fun awaitClosed(timeoutMillis: Long): Boolean = try {
        closeComplete.await(timeoutMillis.coerceAtLeast(0), TimeUnit.MILLISECONDS) && !closeFailed
    } catch (_: InterruptedException) { Thread.currentThread().interrupt(); false }

    fun whenClosed(callback: (Boolean) -> Unit) {
        val now = synchronized(lifecycleLock) {
            if (closeComplete.count == 0L) true else { closeCallbacks += callback; false }
        }
        if (now) callback(!closeFailed)
    }

    private fun finishCloseIfReady() {
        synchronized(lifecycleLock) {
            if (!closed || startupRunning || finishingClose || mdnsReservations.any { !it.complete } || closeComplete.count == 0L) return
            finishingClose = true
            closeFailed = mdnsReservations.any { it.failureClass != null }
        }
        try {
            if (multicastLock.isHeld) multicastLock.release()
        } catch (error: Exception) {
            closeFailed = true
            Log.w(TAG, "Bonjour multicast release failed", error)
        }
        val callbacks = synchronized(lifecycleLock) {
            closeComplete.countDown()
            closeCallbacks.toList().also { closeCallbacks.clear() }
        }
        if (closeFailed) runCatching {
            val failures = mdnsReservations.mapNotNull { it.failureClass }.distinct().joinToString(",")
            onStartupDiagnostic("mdns close state=failed failureClass=${failures.ifEmpty { "multicast-release" }}")
        }
        callbacks.forEach { callback -> runCatching { callback(!closeFailed) } }
    }

    @Suppress("DEPRECATION")
    private fun registerAirPlay() {
        val serviceInfo = NsdServiceInfo().apply {
            serviceName = config.deviceName
            serviceType = AIRPLAY_SERVICE_TYPE
            port = config.port
            CarPlayBonjourProtocol.airPlayTxtRecords(config, identity).forEach { (key, value) ->
                setAttribute(key, value)
            }
            localAdvertisedAddress?.let(::setHost)
        }
        nsdManager.registerService(
            serviceInfo,
            NsdManager.PROTOCOL_DNS_SD,
            registrationListener,
        )
    }

    private fun advertisedHostAddress(): InetAddress? {
        val value = advertisedHost?.trim()?.takeIf { it.isNotEmpty() } ?: return null
        val address = try {
            InetAddress.getByName(value.removeSurrounding("[", "]"))
        } catch (error: Exception) {
            throw IllegalArgumentException("Invalid advertised host: $value", error)
        }
        require(!address.isLoopbackAddress) {
            "advertisedHost must not be a loopback address"
        }
        require(address !is Inet6Address || address.isLinkLocalAddress) {
            "advertisedHost must be link-local IPv6 or IPv4"
        }
        return address
    }

    private fun runWorker() {
        while (!closed) {
            if (useInterfaceMdns) {
                try {
                    while (true) emit(discoveryEvents.poll() ?: break)
                    val (endpoint, address) = interfaceServices.poll(
                        WORKER_POLL_MILLIS, TimeUnit.MILLISECONDS,
                    ) ?: continue
                    emit(CarPlayBonjourEvent.Resolved(endpoint))
                    probe(endpoint, address)?.let(::emit)
                } catch (_: InterruptedException) {
                    return
                } catch (error: Exception) {
                    if (!closed) Log.w(TAG, "Interface CarPlay service handling failed", error)
                }
                continue
            }
            val service = try {
                services.poll(WORKER_POLL_MILLIS, TimeUnit.MILLISECONDS)
            } catch (_: InterruptedException) {
                return
            } ?: continue
            if (closed) return
            try {
                handleService(service)
            } catch (_: InterruptedException) {
                return
            } catch (error: Exception) {
                if (!closed) Log.w(TAG, "CarPlay control service handling failed", error)
            }
        }
    }

    private fun handleService(service: NsdServiceInfo) {
        val resolved = resolveWithRetry(service) ?: return
        val address = preferredAddress(resolved) ?: return
        val port = resolved.port
        if (port !in 1..65535) return
        val serviceName = resolved.serviceName ?: service.serviceName ?: return
        val host = address.hostAddress ?: return
        val bluetoothId = resolved.attributes
            ?.get("id")
            ?.let(::decodeTxtValue)
            ?.takeIf { it.isNotBlank() }
        val endpoint = CarPlayBonjourEndpoint(
            serviceName = serviceName,
            host = host,
            port = port,
            bluetoothId = bluetoothId,
        )
        emit(CarPlayBonjourEvent.Resolved(endpoint))
        probe(endpoint, address)?.let(::emit)
    }

    @Suppress("DEPRECATION")
    private fun resolveWithRetry(service: NsdServiceInfo): NsdServiceInfo? {
        repeat(RESOLVE_ATTEMPTS) { attempt ->
            if (closed) return null
            val latch = CountDownLatch(1)
            val resolved = AtomicReference<NsdServiceInfo?>()
            val failure = AtomicInteger(FAILURE_NONE)
            val listener = object : NsdManager.ResolveListener {
                override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                    resolved.set(serviceInfo)
                    latch.countDown()
                }

                override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                    failure.set(errorCode)
                    latch.countDown()
                }
            }
            val submitted = try {
                synchronized(lifecycleLock) {
                    if (closed) {
                        false
                    } else {
                        nsdManager.resolveService(service, listener)
                        true
                    }
                }
            } catch (error: RuntimeException) {
                Log.w(TAG, "CarPlay control service resolution failed", error)
                false
            }
            if (!submitted) return null
            val completed = try {
                latch.await(RESOLVE_TIMEOUT_MILLIS, TimeUnit.MILLISECONDS)
            } catch (error: InterruptedException) {
                throw error
            }
            if (!completed) {
                Log.w(TAG, "CarPlay control service resolution timed out")
                return null
            }
            resolved.get()?.let { return it }
            if (failure.get() != NsdManager.FAILURE_ALREADY_ACTIVE) {
                Log.w(TAG, "CarPlay control service resolution failed code=${failure.get()}")
                return null
            }
            if (!closed && attempt + 1 < RESOLVE_ATTEMPTS) {
                Thread.sleep(RESOLVE_RETRY_DELAY_MILLIS)
            }
        }
        return null
    }

    @Suppress("DEPRECATION")
    private fun preferredAddress(serviceInfo: NsdServiceInfo): InetAddress? {
        val addresses = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            serviceInfo.hostAddresses.orEmpty()
        } else {
            listOfNotNull(serviceInfo.host)
        }
        return addresses.firstOrNull { it is Inet6Address && it.isLinkLocalAddress }
            ?.let(::applyLocalScope)
            ?: addresses.firstOrNull { it is Inet4Address }
            ?: addresses.firstOrNull { it is Inet6Address }
            ?: addresses.firstOrNull()
    }

    private fun applyLocalScope(address: InetAddress): InetAddress {
        val scope = advertisedAddresses.filterIsInstance<Inet6Address>()
            .firstOrNull { it.scopeId != 0 }?.scopeId ?: return address
        if (address !is Inet6Address || address.scopeId != 0) return address
        return try {
            Inet6Address.getByAddress(null, address.address, scope)
        } catch (_: Exception) {
            address
        }
    }

    private fun probe(
        endpoint: CarPlayBonjourEndpoint,
        address: InetAddress,
    ): CarPlayBonjourEvent.Probed? {
        var lastError: IOException? = null
        repeat(MAX_PROBE_ATTEMPTS) { attempt ->
            if (closed) return null
            try {
                val statusLine = probeOnce(address, endpoint.port, attempt + 1)
                return CarPlayBonjourEvent.Probed(
                    endpoint = endpoint,
                    attempts = attempt + 1,
                    statusLine = statusLine,
                    error = null,
                )
            } catch (error: IOException) {
                lastError = error
            } catch (error: RuntimeException) {
                lastError = IOException("AirPlay control probe failed", error)
            }
            if (closed) return null
            if (attempt + 1 < MAX_PROBE_ATTEMPTS) {
                Thread.sleep(PROBE_RETRY_DELAY_MILLIS)
            }
        }
        return CarPlayBonjourEvent.Probed(
            endpoint = endpoint,
            attempts = MAX_PROBE_ATTEMPTS,
            statusLine = null,
            error = lastError,
        )
    }

    private fun probeOnce(address: InetAddress, port: Int, attempt: Int): String {
        val socket = Socket()
        var stage = CarPlayBonjourEvent.ProbeProgress.Stage.CONNECTING
        synchronized(lifecycleLock) {
            check(!closed) { "CarPlayBonjour is closed" }
            activeSocket = socket
        }
        try {
            emit(CarPlayBonjourEvent.ProbeProgress(CarPlayBonjourEvent.ProbeProgress.Stage.CONNECTING, attempt, address is Inet6Address))
            sourceAddressFor(address)?.let { socket.bind(InetSocketAddress(it, 0)) }
            socket.connect(InetSocketAddress(address, port), CONNECT_TIMEOUT_MILLIS)
            stage = CarPlayBonjourEvent.ProbeProgress.Stage.TCP_CONNECTED
            emit(CarPlayBonjourEvent.ProbeProgress(CarPlayBonjourEvent.ProbeProgress.Stage.TCP_CONNECTED, attempt, address is Inet6Address))
            val host = address.hostAddress
                ?: throw IOException("AirPlay control service has no host address")
            val request = CarPlayBonjourProtocol.connectProbeRequest(
                host = host,
                port = port,
                sourceVersion = config.sourceVersion,
                deviceId = config.deviceId,
            )
            val output = RawTraffic.output("iphone/discovery-control/${socket.remoteSocketAddress}/out", socket.getOutputStream())
            output.write(request.toByteArray(StandardCharsets.US_ASCII))
            output.flush()
            stage = CarPlayBonjourEvent.ProbeProgress.Stage.REQUEST_SENT
            emit(CarPlayBonjourEvent.ProbeProgress(CarPlayBonjourEvent.ProbeProgress.Stage.REQUEST_SENT, attempt, address is Inet6Address))
            return readBonjourStatusLine(
                RawTraffic.input("iphone/discovery-control/${socket.remoteSocketAddress}/in", socket.getInputStream()),
                READ_TIMEOUT_MILLIS.toLong(), { socket.soTimeout = it },
            )
        } catch (error: IOException) {
            if (!closed) emit(CarPlayBonjourEvent.ProbeFailed(stage, attempt, error))
            throw error
        } finally {
            synchronized(lifecycleLock) {
                if (activeSocket === socket) activeSocket = null
            }
            runCatching { socket.close() }
        }
    }

    private fun sourceAddressFor(target: InetAddress): InetAddress? =
        advertisedAddresses.firstOrNull { (it is Inet4Address) == (target is Inet4Address) }

    private fun emit(event: CarPlayBonjourEvent) {
        if (closed) return
        when (event) {
            is CarPlayBonjourEvent.Discovery -> when (event.stage) {
                CarPlayBonjourEvent.Discovery.Stage.ADDED -> addedCount.incrementAndGet()
                CarPlayBonjourEvent.Discovery.Stage.NO_MATCHING_ADDRESS -> addressMismatchCount.incrementAndGet()
                else -> Unit
            }
            is CarPlayBonjourEvent.Resolved -> resolvedCount.incrementAndGet()
            is CarPlayBonjourEvent.ProbeProgress -> {
                if (event.stage == CarPlayBonjourEvent.ProbeProgress.Stage.CONNECTING) probeCount.incrementAndGet()
                lastProbe.set(event.stage.name)
            }
            is CarPlayBonjourEvent.ProbeFailed -> lastProbe.set("failed_after_${event.stage}_${event.error.javaClass.simpleName}")
            is CarPlayBonjourEvent.Probed -> {
                val status = event.statusLine?.let { Regex("^HTTP/\\d(?:\\.\\d)? (\\d{3})(?: |$)").find(it)?.groupValues?.get(1)?.toIntOrNull() }
                if (status != null && status in 200..299) successfulProbeCount.incrementAndGet()
                if (event.error == null) lastProbe.set("status_${status ?: "unknown"}")
            }
        }
        try {
            onEvent(event)
        } catch (error: RuntimeException) {
            Log.w(TAG, "CarPlay Bonjour event callback failed", error)
        }
    }

    private fun decodeTxtValue(value: ByteArray): String =
        String(value, StandardCharsets.UTF_8).trimEnd('\u0000')

    private fun joinWorker(worker: Thread) {
        if (worker === Thread.currentThread()) return
        try {
            worker.join(JOIN_TIMEOUT_MILLIS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        }
    }

    private companion object {
        const val TAG = "xcertplay-bonjour"
        const val WORKER_NAME = "carplay-bonjour"
        const val AIRPLAY_SERVICE_TYPE = "_airplay._tcp"
        const val CARPLAY_CONTROL_SERVICE_TYPE = "_carplay-ctrl._tcp"
        const val WORKER_POLL_MILLIS = 500L
        const val RESOLVE_ATTEMPTS = 3
        const val RESOLVE_TIMEOUT_MILLIS = 10_000L
        const val RESOLVE_RETRY_DELAY_MILLIS = 250L
        const val MAX_PROBE_ATTEMPTS = 7
        const val PROBE_RETRY_DELAY_MILLIS = 1_500L
        const val CONNECT_TIMEOUT_MILLIS = 3_000
        const val READ_TIMEOUT_MILLIS = 3_000
        const val JOIN_TIMEOUT_MILLIS = 2_000L
        const val FAILURE_NONE = -1
    }
}
