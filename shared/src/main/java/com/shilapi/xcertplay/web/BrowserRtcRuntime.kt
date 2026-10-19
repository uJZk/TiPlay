package com.shilapi.xcertplay.web

import android.content.Context
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtcCertificatePem
import java.io.ByteArrayInputStream
import java.security.MessageDigest
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.util.Date

/** One native factory and DTLS identity per process; the private identity never leaves app storage. */
object BrowserRtcRuntime {
    private var factory: PeerConnectionFactory? = null
    private var certificate: RtcCertificatePem? = null
    private var pin: String? = null

    @Synchronized
    fun fingerprint(context: Context): String {
        initialize(context)
        return checkNotNull(pin)
    }

    @Synchronized
    fun createPeer(context: Context, onControl: (String) -> Unit, onFailure: (String) -> Unit): BrowserRtcPeer {
        initialize(context)
        return BrowserRtcPeer(checkNotNull(factory), checkNotNull(certificate), onControl, onFailure)
    }

    private fun initialize(context: Context) {
        if (factory != null) return
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
            .setEnableInternalTracer(false).createInitializationOptions())
        val preferences = context.applicationContext.getSharedPreferences("browser-rtc-identity", Context.MODE_PRIVATE)
        val stored = runCatching {
            val key = checkNotNull(preferences.getString("private-key", null))
            val pem = checkNotNull(preferences.getString("certificate", null))
            decodeCertificate(pem).checkValidity(Date(System.currentTimeMillis() + 86_400_000L))
            RtcCertificatePem(key, pem)
        }.getOrNull()
        val identity = stored ?: RtcCertificatePem.generateCertificate().also {
            check(preferences.edit().putString("private-key", it.privateKey)
                .putString("certificate", it.certificate).commit()) { "cannot persist browser DTLS identity" }
        }
        val fingerprint = MessageDigest.getInstance("SHA-256").digest(decodeCertificate(identity.certificate).encoded)
            .joinToString("") { "%02x".format(it.toInt() and 255) }
        val nativeFactory = PeerConnectionFactory.builder().createPeerConnectionFactory()
        certificate = identity
        pin = fingerprint
        factory = nativeFactory
    }

    private fun decodeCertificate(pem: String) = CertificateFactory.getInstance("X.509")
        .generateCertificate(ByteArrayInputStream(pem.toByteArray(Charsets.US_ASCII))) as X509Certificate
}
