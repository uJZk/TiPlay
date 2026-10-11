package com.shilapi.xcertplay.orchestration

import com.shilapi.xcertplay.airplay.AirPlaySession
import com.shilapi.xcertplay.iap2.session.Iap2Session

/** The old display's expected tunnel loss must not interrupt its replacement display. */
internal class BrowserDisplayReconnect {
    @Volatile private var source: AirPlaySession? = null
    private val retiringTunnels = mutableSetOf<Iap2Session>()

    val pending: Boolean get() = source != null
    val retiringSession: AirPlaySession? get() = source

    @Synchronized fun begin(session: AirPlaySession, tunnel: Iap2Session?): Boolean {
        if (source != null) return false
        source = session
        tunnel?.let(retiringTunnels::add)
        return true
    }

    @Synchronized fun completed(session: AirPlaySession) {
        if (source != null && source !== session) source = null
    }

    @Synchronized fun suppressTunnelFailure(tunnel: Iap2Session): Boolean = retiringTunnels.remove(tunnel)
    @Synchronized fun isRetiringTunnel(tunnel: Iap2Session): Boolean = tunnel in retiringTunnels

    @Synchronized fun cancel(tunnel: Iap2Session?) {
        source = null
        tunnel?.let(retiringTunnels::remove)
    }

    @Synchronized fun cancelPending() {
        source = null
    }
}
