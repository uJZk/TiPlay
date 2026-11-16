// SPDX-License-Identifier: GPL-3.0-only
package com.shilapi.xcertplay.foregroundproof

import android.Manifest
import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.admin.DevicePolicyManager
import android.companion.CompanionDeviceManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Process
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** Debug-only bounded evidence. No recording API, Bluetooth object or product controller. */
@android.annotation.TargetApi(36)
internal object ForegroundAdmissionJournal {
    const val BACKGROUND_DELAY_MS = 45_000L
    const val PHASE_HOLD_MS = 15_000L
    private lateinit var app: Context
    private lateinit var output: AtomicFile
    private var report = JSONObject()
    private var sequence = 0
    private var resumed = false
    private var stoppedAt = 0L
    private val active = linkedSetOf<String>()
    private var terminalFailure = false
    var scenario = ""
        private set
    var phase = "initializing"
        private set
    var phaseAt = 0L
        private set

    @Synchronized fun initialize(context: Context, selectedScenario: String, token: String) {
        check(Build.VERSION.SDK_INT == 36) { "proof-requires-api36" }
        check(context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) { "proof-requires-debug" }
        check(selectedScenario in setOf("positive", "background", "missing")) { "proof-scenario" }
        check(token.matches(Regex("[A-Za-z0-9_-]{1,48}"))) { "proof-token" }
        app = context.applicationContext
        output = AtomicFile(File(app.filesDir, "foreground-admission-$token.json"))
        scenario = selectedScenario
        val info = app.packageManager.getPackageInfo(app.packageName, 0)
        val digest = MessageDigest.getInstance("SHA-256")
        File(app.applicationInfo.sourceDir).inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) { val size = input.read(buffer); if (size < 0) break; digest.update(buffer, 0, size) }
        }
        val domain = File("/proc/self/attr/current").readText().trim().split(':').getOrNull(2) ?: "unknown"
        report = json("schema" to 1, "scenario" to scenario, "runToken" to token,
            "status" to "running", "packageName" to app.packageName,
            "versionName" to info.versionName, "versionCode" to info.longVersionCode,
            "runtime" to json("uid" to Process.myUid(), "applicationUid" to app.applicationInfo.uid,
                "pid" to Process.myPid(), "selinuxType" to domain, "sdk" to Build.VERSION.SDK_INT,
                "targetSdk" to app.applicationInfo.targetSdkVersion, "fingerprint" to Build.FINGERPRINT),
            "apkSha256" to digest.digest().joinToString("") { "%02x".format(it) },
            "exemptions" to json(
                "ignoringBatteryOptimizations" to app.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(app.packageName),
                "overlayPermission" to Settings.canDrawOverlays(app),
                "deviceOwner" to app.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(app.packageName),
                "profileOwner" to app.getSystemService(DevicePolicyManager::class.java).isProfileOwnerApp(app.packageName),
                "companionAssociations" to app.getSystemService(CompanionDeviceManager::class.java).myAssociations.size,
                "privilegedBackgroundActivityPermission" to (app.checkSelfPermission("android.permission.START_ACTIVITIES_FROM_BACKGROUND") == PackageManager.PERMISSION_GRANTED),
                "privilegedBackgroundFgsPermission" to (app.checkSelfPermission("android.permission.START_FOREGROUND_SERVICES_FROM_BACKGROUND") == PackageManager.PERMISSION_GRANTED),
                "voiceInteractionOwner" to (Settings.Secure.getString(app.contentResolver, "voice_interaction_service")?.startsWith(app.packageName + "/") == true)),
            "probeCreateCount" to 0, "events" to JSONArray(),
            "recordingOpenedByHarness" to false, "bluetoothUsedByHarness" to false,
            "instrumentationUsedByHarness" to false)
        event("initialized")
    }

    @Synchronized fun uiResumed(value: Boolean) {
        resumed = value
        if (!value) stoppedAt = SystemClock.elapsedRealtime()
        event(if (value) "ui-resumed" else "ui-stopped")
    }

    @Synchronized fun uiIsResumed() = resumed
    @Synchronized fun backgroundElapsed(): Long = if (resumed || stoppedAt == 0L) -1L else SystemClock.elapsedRealtime() - stoppedAt

    fun afterBackground(handler: Handler, action: () -> Unit) {
        val elapsed = backgroundElapsed()
        if (elapsed < BACKGROUND_DELAY_MS) {
            handler.postDelayed({ afterBackground(handler, action) }, 250L)
        } else action()
    }

    @Synchronized fun serviceCreated(role: String) {
        active.add(role)
        if (role == "probe") report.put("probeCreateCount", report.getInt("probeCreateCount") + 1)
        event("service-created", json("role" to role))
    }

    @Synchronized fun serviceDestroyed(role: String) {
        active.remove(role)
        event("service-destroyed", json("role" to role))
        if (active.isEmpty() && (phase == "stopping" || terminalFailure)) {
            report.put("status", if (terminalFailure) "failed" else "completed")
            persist()
        }
    }

    @Synchronized fun setPhase(value: String, details: JSONObject = JSONObject()) {
        phase = value; phaseAt = SystemClock.elapsedRealtime()
        event(value, details)
    }

    @Synchronized fun fail(code: String) {
        terminalFailure = true
        report.put("status", "failed").put("failureCode", code)
        event("failed", json("code" to code))
    }

    @Synchronized fun event(label: String, details: JSONObject = JSONObject()) {
        val events = report.getJSONArray("events")
        check(events.length() < 256) { "proof-event-limit" }
        events.put(json("sequence" to ++sequence, "atElapsedMs" to SystemClock.elapsedRealtime(),
            "event" to label, "state" to sample(), "details" to details))
        persist()
    }

    @Synchronized fun sample(): JSONObject {
        val memory = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(memory)
        val op = app.getSystemService(AppOpsManager::class.java).unsafeCheckOpRawNoThrow(
            AppOpsManager.OPSTR_RECORD_AUDIO, Process.myUid(), app.packageName)
        return json("importance" to memory.importance, "recordAudioGranted" to
            (app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED),
            "recordAudioRawMode" to op, "uiResumed" to resumed,
            "backgroundElapsedMs" to backgroundElapsed(), "activeServices" to JSONArray(active.toList()))
    }

    private fun persist() {
        report.put("phase", phase).put("phaseAtElapsedMs", phaseAt).put("lastState", sample())
        val stream = output.startWrite()
        try { stream.write((report.toString() + "\n").toByteArray(Charsets.UTF_8)); output.finishWrite(stream) }
        catch (error: Exception) { output.failWrite(stream); throw error }
    }

    fun notification(service: Service): Notification {
        service.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel("foreground-admission-proof", "Foreground admission proof", NotificationManager.IMPORTANCE_LOW))
        return Notification.Builder(service, "foreground-admission-proof")
            .setSmallIcon(android.R.drawable.stat_sys_warning).setContentTitle("TiPlay foreground admission proof")
            .setContentText("No microphone recording is opened").setOngoing(true).build()
    }

    fun json(vararg values: Pair<String, Any?>): JSONObject = JSONObject().also { value ->
        values.forEach { (key, entry) -> value.put(key, entry ?: JSONObject.NULL) }
    }
}
