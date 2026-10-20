package com.shilapi.xcertplay.web

import org.bouncycastle.crypto.agreement.srp.SRP6Server
import org.bouncycastle.crypto.agreement.srp.SRP6StandardGroups
import org.bouncycastle.crypto.agreement.srp.SRP6VerifierGenerator
import org.bouncycastle.crypto.digests.SHA256Digest
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** Four-digit PAKE: the password and reusable password hashes never cross HTTP. */
class BrowserRtcPairing(
    private val random: SecureRandom = SecureRandom(),
    private val now: () -> Long = System::currentTimeMillis,
) {
    data class Challenge(val id: String, val salt: String, val B: String)

    class Verified internal constructor(
        val session: String,
        val code: String,
        val serverProof: String,
        private val key: ByteArray,
        private val transcript: List<String>,
    ) {
        /** Authenticates the complete browser offer, phone answer and application session identity. */
        fun bind(offer: String, sdp: String, rtcSession: Long): String {
            require(rtcSession in 1..0xffffffffL)
            val bytes = ByteArrayOutputStream()
            DataOutputStream(bytes).use { output ->
                (transcript + listOf(offer, sdp, rtcSession.toString())).forEach { value ->
                    val encoded = value.toByteArray(Charsets.UTF_8)
                    output.writeInt(encoded.size)
                    output.write(encoded)
                }
            }
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key, "HmacSHA256"))
            return hex(mac.doFinal(bytes.toByteArray()))
        }
    }

    private class Pending(
        val session: String,
        val code: String,
        val challenge: Challenge,
        val server: SRP6Server,
        val created: Long,
    )

    private val pending = LinkedHashMap<String, Pending>()

    @Synchronized fun start(session: String, code: String): Challenge {
        require(Regex("[A-Za-z0-9_-]{8,96}").matches(session))
        require(Regex("[0-9]{4}").matches(code))
        expire()
        check(pending.size < 16) { "Pairing is busy" }
        // BigInt wire encoding has no leading zero; make the salt's first byte nonzero too.
        val salt = ByteArray(32).also(random::nextBytes).also { it[0] = (it[0].toInt() or 1).toByte() }
        val verifier = SRP6VerifierGenerator().apply { init(GROUP, SHA256Digest()) }
            .generateVerifier(salt, IDENTITY.toByteArray(Charsets.UTF_8), code.toByteArray(Charsets.UTF_8))
        val server = SRP6Server().apply { init(GROUP, verifier, SHA256Digest(), random) }
        val public = server.generateServerCredentials()
        val id = hex(ByteArray(16).also(random::nextBytes))
        val challenge = Challenge(id, hex(salt), public.toString(16))
        pending[id] = Pending(session, code, challenge, server, now())
        return challenge
    }

    @Synchronized fun sessionFor(id: String): String? {
        expire()
        return pending[id]?.session
    }

    /** One attempt per ephemeral exchange. Callers additionally share the existing online guessing lockout. */
    @Synchronized fun verify(id: String, clientA: String, clientProof: String, session: String): Verified {
        expire()
        val state = pending.remove(id) ?: throw SecurityException("Pairing expired")
        if (state.session != session) throw SecurityException("Pairing session changed")
        try {
            val a = parse(clientA, 512)
            if (a.signum() <= 0 || a >= GROUP.n) throw SecurityException("Invalid pairing public value")
            val proof = parse(clientProof, 64)
            state.server.calculateSecret(a)
            if (!state.server.verifyClientEvidenceMessage(proof)) throw SecurityException("Pairing code did not match")
            val serverProof = state.server.calculateServerEvidenceMessage().toString(16)
            val key = padded(state.server.calculateSessionKey(), 32)
            return Verified(state.session, state.code, serverProof, key,
                listOf(PROTOCOL, id, session, a.toString(16), state.challenge.B, state.challenge.salt))
        } catch (error: SecurityException) { throw error }
        catch (error: Exception) { throw SecurityException("Invalid pairing proof", error) }
    }

    @Synchronized fun clear() { pending.clear() }

    private fun expire() {
        val current = now()
        pending.entries.removeAll { current - it.value.created !in 0..30_000 }
    }

    companion object {
        const val IDENTITY = "TiPlay browser"
        const val PROTOCOL = "TiPlay-RTC-SRP6a-v1"
        private val GROUP = SRP6StandardGroups.rfc5054_2048
        private fun parse(text: String, maximum: Int): BigInteger {
            if (text.length !in 1..maximum || !Regex("[0-9a-f]+").matches(text)) throw SecurityException("Invalid pairing number")
            return BigInteger(text, 16)
        }
        private fun padded(value: BigInteger, length: Int): ByteArray {
            val bytes = value.toByteArray().let { if (it.size > length && it[0] == 0.toByte()) it.copyOfRange(1, it.size) else it }
            require(bytes.size <= length)
            return ByteArray(length).also { bytes.copyInto(it, length - bytes.size) }
        }
        private fun hex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
    }
}
