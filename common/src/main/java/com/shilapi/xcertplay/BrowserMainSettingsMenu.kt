package com.shilapi.xcertplay

import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.BluetoothManager
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.*
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.orchestration.ManualHotspotSecurity

/** One main page, one draft, and the host's existing session; native head-unit menus stay upstream. */
internal class BrowserMainSettingsMenu(
    private val activity: Activity,
    val draft: BrowserConnectionDraft,
    private val requestPermissions: (Array<String>) -> Unit,
    advanced: () -> Unit,
    about: () -> Unit,
    private val settingsChanged: () -> Unit = {},
    private val setupOnly: Boolean = false,
) {
    private val ui = TiPlayNativeUi(activity)
    private val spacing = BrowserNativeSettingsUi(activity)
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float = 14f) = TextView(activity).apply {
        text = value
        if (size >= 18f) {
            setTextAppearance(android.R.style.TextAppearance_Material_Large)
            androidx.core.view.ViewCompat.setAccessibilityHeading(this, true)
        }
    }
    private val content = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        if (!setupOnly) spacing.pagePadding(this)
    }
    val view: View = if (setupOnly) content else ScrollView(activity).apply {
        isFillViewport = true; setBackgroundColor(ui.background); addView(content)
        ui.protectSystemInsets(this)
    }
    val status = text("", 18f).also(ui::emphasize)
    private val hints = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        tag = "connection_hints"
    }
    private val hintMessages = linkedMapOf<String, String>()
    private val hintGenerations = mutableMapOf<String, Int>()
    private var problem: BrowserConnectionProblem? = null
    private var nameInput: EditText? = null
    private var passwordInput: EditText? = null
    private val network = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var baseline = BrowserConnectionDraft.load(activity)
    private val editHandler = Handler(Looper.getMainLooper())
    private val applyEdit = Runnable { validateFields(); applyChanges() }
    private var browserReady = true
    private var active = false
    private var carPlayStage = activity.getString(R.string.settings_carplay_preparing_status)
    private var disposed = false
    private val receiverSubscription = AirPlayReceiverService.listenState {
        activity.runOnUiThread { if (!disposed && !activity.isDestroyed) updateActions() }
    }
    private val carBluetooth by lazy { CarBluetoothStatus(activity) { if (!disposed) updateActions() } }
    private var statusWatch: BrowserSettingsStatusWatch? = null
    private var phone: Button
    private lateinit var connectionMode: Button
    private var networkStatus: TextView? = null
    private var refreshAddress: () -> Unit = {}
    private var refreshBrowser: () -> Unit = {}
    private fun button(parent: LinearLayout, label: String, click: () -> Unit) = Button(activity).apply {
        text = label; isAllCaps = false; minHeight = dp(48)
        setOnClickListener { click() }; parent.addView(this, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }
    private fun heading(id: Int, parent: LinearLayout = content) {
        parent.addView(text(activity.getString(id), 18f))
    }
    private fun group(parent: LinearLayout): LinearLayout = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        spacing.section(this)
        parent.addView(this, LinearLayout.LayoutParams(-1, -2))
    }
    private fun <T> choice(parent: LinearLayout, label: Int, options: List<Pair<T, String>>, current: T, changed: (T) -> Unit) {
        var selected = current
        lateinit var row: Button
        fun title() = activity.getString(label) + " · " + options.first { it.first == selected }.second
        row = button(parent, title()) {
            AlertDialog.Builder(activity).setTitle(label)
                .setSingleChoiceItems(options.map { it.second }.toTypedArray(), options.indexOfFirst { it.first == selected }) { dialog, index ->
                    selected = options[index].first; changed(selected); row.text = title(); dialog.dismiss()
                }.setNegativeButton(android.R.string.cancel, null).create().also(ui::showDialog)
        }
    }
    init {
        if (!setupOnly) ui.applyWindow(activity)
        if (!setupOnly) content.addView(LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(activity).apply { setImageResource(R.drawable.ic_carplay); contentDescription = "TiPlay" },
                LinearLayout.LayoutParams(dp(32), dp(32)))
            addView(text("TiPlay", 24f).apply {
                setPadding(dp(8), 0, 0, 0)
                ui.emphasize(this)
            })
        })
        val session = group(content)
        if (!setupOnly) {
            session.addView(status)
            session.addView(hints)
        }
        val modeRows = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        session.addView(modeRows)
        if (!setupOnly) refreshAddress = BrowserSettingsMenu.addHotspotAddress(modeRows, activity,
            onMethodChanged = { refreshAddress(); refreshBrowser(); renderNetwork() },
            showHints = { draft.source == BrowserConnectionDraft.Source.LOCAL },
            browserReady = { browserReady }, newHintReporter = { newHintReporter("address") })
        connectionMode = BrowserSettingsPresentation.carPlayMode(activity, draft) {
            BrowserCarPlaySettings.saveMode(activity, if (draft.allTransports) BrowserCarPlaySettings.Mode.ALL
                else if (draft.wireless) BrowserCarPlaySettings.Mode.WIRELESS else BrowserCarPlaySettings.Mode.USB)
            baseline.wireless = draft.wireless; baseline.allTransports = draft.allTransports
            renderNetwork(); updateActions(); applyChanges(); settingsChanged()
        }
        session.addView(connectionMode, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) })
        phone = button(session, phoneLabel(), ::choosePhone).apply { isAllCaps = false }
        if (!setupOnly) session.addView(BrowserBootConnectionSettings.create(activity))
        val browser = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val details = LinearLayout(activity).apply {
            spacing.section(this)
            orientation = if (activity.resources.configuration.screenWidthDp >= 1000 && activity.resources.configuration.fontScale <= 1.2f) LinearLayout.HORIZONTAL else LinearLayout.VERTICAL
        }
        content.addView(details)
        for (column in if (setupOnly) listOf(network) else listOf(browser, network)) {
            spacing.section(column)
            details.addView(column,
            if (details.orientation == LinearLayout.HORIZONTAL) LinearLayout.LayoutParams(0, -2, if (column === network) 2f else 1f).apply { marginEnd = if (column === browser) dp(16) else 0 }
            else LinearLayout.LayoutParams(-1, -2))
        }
        if (!setupOnly) refreshBrowser = BrowserSettingsMenu.addBrowserLink(browser, activity,
            requestLocalNetwork = { requestPermissions(arrayOf(LocalNetworkPermission.PERMISSION)) },
            newHintReporter = { newHintReporter("browser") })
        renderNetwork()
        if (!setupOnly) {
            val more = group(content)
            heading(R.string.settings_browser_more, more)
            button(more, activity.getString(R.string.settings_advanced)) { applyChanges(); advanced() }
            button(more, activity.getString(R.string.onboarding_help)) {
                applyChanges()
                activity.startActivity(Intent(activity, FirstUseActivity::class.java).putExtra(FirstUseActivity.REVIEW, true))
            }
            val stackTools = activity.resources.configuration.screenWidthDp < 400 || activity.resources.configuration.fontScale > 1.2f
            val tools = LinearLayout(activity).apply { orientation = if (stackTools) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL }
            more.addView(tools)
            button(tools, activity.getString(R.string.language_app_language)) { AppLocale.showPicker(activity) }
            button(tools, activity.getString(R.string.about)) { applyChanges(); about() }
            for (i in 0 until tools.childCount) tools.getChildAt(i).layoutParams =
                if (stackTools) LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(8) }
                else LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = if (i < tools.childCount - 1) dp(8) else 0 }
            val version = activity.packageManager.getPackageInfo(activity.packageName, 0).versionName.orEmpty()
            content.addView(text("TiPlay $version").apply { gravity = Gravity.CENTER }.also(ui::emphasize))
        }
        updateActions()
        statusWatch = BrowserSettingsStatusWatch(view) { carBluetooth.refresh(); refreshNetwork() }
        if (draft != baseline) editHandler.postDelayed(applyEdit, 400L)
    }
    private fun phoneLabel() = if (draft.phoneAddress.isNullOrBlank()) activity.getString(R.string.choose_iphone)
        else activity.getString(R.string.settings_selected_iphone, draft.phoneName)
    private fun choosePhone() {
        if (Build.VERSION.SDK_INT >= 31 && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            val permission = Manifest.permission.BLUETOOTH_CONNECT
            val history = activity.getSharedPreferences("tiplay_permission_requests", android.content.Context.MODE_PRIVATE)
            if (history.getBoolean(permission, false) && !activity.shouldShowRequestPermissionRationale(permission)) {
                activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    android.net.Uri.parse("package:${activity.packageName}")))
            } else {
                history.edit().putBoolean(permission, true).apply()
                requestPermissions(arrayOf(permission))
            }
            return
        }
        val adapter = activity.getSystemService(BluetoothManager::class.java)?.adapter
        val devices = runCatching { adapter?.takeIf { it.isEnabled }?.bondedDevices?.sortedBy { it.name ?: "" } }.getOrNull().orEmpty()
        if (devices.isEmpty()) {
            activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); return
        }
        AlertDialog.Builder(activity).setTitle(R.string.choose_your_iphone)
            .setItems(devices.map { "${it.name ?: activity.getString(R.string.paired_device)} · ${it.address.takeLast(5)}" }.toTypedArray()) { _, index ->
                val device = devices[index]
                draft.phoneAddress = device.address; draft.phoneName = device.name ?: "iPhone"
                phone.text = phoneLabel(); applyChanges()
            }.setNeutralButton(R.string.pair_another) { _, _ -> activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS)) }
            .setNegativeButton(android.R.string.cancel, null).create().also(ui::showDialog)
    }
    private fun input(parent: LinearLayout, label: Int, value: String, secret: Boolean = false, changed: (String) -> Unit): EditText {
        parent.addView(text(activity.getString(label)).also(spacing::field))
        return EditText(activity).apply {
            spacing.related(this)
            setText(value); setSingleLine()
            inputType = InputType.TYPE_CLASS_TEXT or if (secret) InputType.TYPE_TEXT_VARIATION_PASSWORD else InputType.TYPE_TEXT_VARIATION_NORMAL
            ui.emphasize(this)
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
                override fun afterTextChanged(s: Editable?) {
                    error = null
                    changed(s.toString()); updateActions()
                    editHandler.removeCallbacks(applyEdit)
                    editHandler.postDelayed(applyEdit, 400L)
                }
            })
            setOnFocusChangeListener { _, focused -> if (!focused) validateFields() }
            parent.addView(this, LinearLayout.LayoutParams(-1, -2))
        }
    }
    private fun renderNetwork() {
        network.removeAllViews(); networkStatus = null; nameInput = null; passwordInput = null
        heading(R.string.settings_browser_network_configuration, network)
        val group = RadioGroup(activity).apply {
            orientation = if (activity.resources.configuration.screenWidthDp < 400 || activity.resources.configuration.fontScale > 1.2f)
                RadioGroup.VERTICAL else RadioGroup.HORIZONTAL
        }
        val labels = listOf(R.string.built_in_car_hotspot, R.string.existing_wifi_title)
        BrowserConnectionDraft.Source.entries.forEachIndexed { index, source ->
            group.addView(RadioButton(activity).apply {
                id = View.generateViewId(); setText(labels[index])
                minHeight = dp(48)
                tag = source
                isChecked = draft.source == source
                setOnClickListener { draft.source = source; renderNetwork(); applyChanges() }
            }, if (group.orientation == RadioGroup.VERTICAL) RadioGroup.LayoutParams(-1, -2)
                else RadioGroup.LayoutParams(0, -2, 1f).apply { marginEnd = dp(8) })
        }
        network.addView(group, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(12) })
        val local = draft.source == BrowserConnectionDraft.Source.LOCAL
        networkStatus = if (setupOnly) text("").also(network::addView) else null
        val actions = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        network.addView(actions)
        val fields = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }; network.addView(fields)
        val ssid = input(fields, if (local) R.string.hotspot_ssid else R.string.existing_wifi_ssid,
            if (local) draft.localSsid else draft.externalSsid) { if (local) draft.localSsid = it else { draft.externalSsid = it; refreshNetwork() } }
        nameInput = ssid
        val options = listOf(ManualHotspotSecurity.OPEN to activity.getString(R.string.open),
                ManualHotspotSecurity.WPA2 to activity.getString(R.string.wpa2),
                ManualHotspotSecurity.WPA3_TRANSITION to activity.getString(R.string.wpa3_transition),
                ManualHotspotSecurity.WPA3 to activity.getString(R.string.wpa3))
        choice(fields, R.string.security, options, if (local) draft.localSecurity else draft.externalSecurity) {
            if (local) draft.localSecurity = it else draft.externalSecurity = it
            renderNetwork(); applyChanges()
        }
        val secured = if (local) draft.localSecurity != ManualHotspotSecurity.OPEN else draft.externalSecured
        val passwordFields = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            visibility = if (secured) View.VISIBLE else View.GONE
        }
        fields.addView(passwordFields.also(spacing::field))
        val password = input(passwordFields, R.string.hotspot_password, if (local) draft.localPassword else draft.externalPassword, true) {
            if (local) draft.localPassword = it else draft.externalPassword = it
        }
        passwordInput = password
        if (local) {
            val privileged = HotspotExtraAddressSettings.method(activity) == HotspotAddressMethod.ROOT
            if (privileged) LocalHotspotAutofill.attach(fields, ssid, password, controlsParent = actions, showHint = false)
            else button(actions, activity.getString(R.string.open_car_hotspot_settings)) {
                activity.startActivity(Intent("android.settings.TETHER_SETTINGS"))
            }
            refreshNetwork()
        } else {
            button(fields, activity.getString(R.string.settings_external_ap_wifi)) {
                activity.startActivity(Intent(Settings.ACTION_WIFI_SETTINGS))
            }
            refreshNetwork()
        }
        refreshAddress()
    }
    fun transportSelected(wireless: Boolean) {
        if (draft.allTransports) return
        draft.wireless = wireless
        baseline.wireless = wireless
        renderNetwork(); updateActions()
    }
    fun refresh() {
        carBluetooth.refresh(); refreshAddress(); refreshBrowser(); refreshNetwork(); phone.text = phoneLabel(); updateActions()
    }
    fun refreshNetwork() {
        val message = if (draft.source == BrowserConnectionDraft.Source.LOCAL) {
            when (com.shilapi.xcertplay.network.CarHotspotStatus.isEnabled(activity)) {
                false -> R.string.settings_hint_hotspot_off
                null -> R.string.settings_hint_hotspot_unknown
                true -> null
            }
        } else {
            val connectivity = activity.getSystemService(ConnectivityManager::class.java)
            val wifi = connectivity?.allNetworks?.any {
                connectivity.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
            } == true
            @Suppress("DEPRECATION")
            val ssid = runCatching { activity.applicationContext.getSystemService(WifiManager::class.java)?.connectionInfo?.ssid }.getOrNull()
            BrowserConnectionHints.wifi(wifi, ssid, draft.externalSsid)
        }
        val visibleMessage = message.takeUnless { active &&
            (it == R.string.settings_hint_hotspot_unknown || it == R.string.settings_hint_wifi_unknown) }
        putHint("network", visibleMessage?.let(activity::getString))
        networkStatus?.text = visibleMessage?.let(activity::getString).orEmpty()
        networkStatus?.visibility = if (visibleMessage == null) View.GONE else View.VISIBLE
        updateActions()
    }
    fun update(stage: String, hasSession: Boolean, browserReady: Boolean = true,
        problem: BrowserConnectionProblem? = null) {
        val readinessChanged = this.browserReady != browserReady
        this.browserReady = browserReady
        if (readinessChanged) refreshAddress()
        active = hasSession
        carPlayStage = stage
        this.problem = problem
        updateActions(); refreshNetwork()
    }
    fun committed() { baseline = draft.copy(); updateActions() }
    private fun updateReceiverStatus() {
        status.text = if (!browserReady) activity.getString(R.string.settings_browser_waiting_connection) else receiverStatus(if (BrowserCarPlaySettings.disabled(activity))
            activity.getString(R.string.settings_carplay_disabled)
            else carPlayStage)
    }
    private fun receiverStatus(carPlay: String) = carPlay + " | " + activity.getString(
        BrowserReceiverPresentation.airPlayTitle(AirPlayReceiverService.state, AirPlayReceiverSettings.isDisabled(activity)))
    private fun updateActions() {
        updateReceiverStatus()
        putHint("debug", if (DiagnosticLogPolicy.level == DiagnosticLogLevel.DEBUG)
            activity.getString(R.string.settings_hint_debug_enabled) else null)
        val disabled = BrowserCarPlaySettings.disabled(activity)
        val currentProblem = problem?.takeIf {
            !disabled && !active && (browserReady || it != BrowserConnectionProblem.FAILED)
        }
        putHint("session", currentProblem?.message?.let(activity::getString))
        putHint("browser-open", if (!browserReady) activity.getString(R.string.settings_hint_browser_open, activity.getString(R.string.settings_tesla_browser)) else null)
        phone.visibility = if (draft.wireless && (setupOnly || !disabled)) View.VISIBLE else View.GONE
        val phoneMessage = if (phone.visibility == View.VISIBLE && !active) when {
            draft.phoneAddress.isNullOrBlank() -> R.string.settings_hint_phone_wireless
            draft.allTransports -> null // Only the host knows whether All currently uses USB.
            Build.VERSION.SDK_INT >= 31 && activity.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED -> null
            runCatching { activity.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled }.getOrNull() == false -> R.string.settings_hint_bluetooth
            else -> null
        } else null
        putHint("phone", phoneMessage?.let(activity::getString))
        val bluetoothHint = if (BrowserCarPlayAudioSettings.disabled(activity))
            R.string.settings_hint_iphone_car_audio else when (carBluetooth.state(draft.phoneAddress)) {
            CarBluetoothStatus.State.CONNECTED -> null
            CarBluetoothStatus.State.DISCONNECTED -> R.string.settings_hint_car_bluetooth_disconnected
            CarBluetoothStatus.State.UNKNOWN -> R.string.settings_hint_car_bluetooth_unknown
            CarBluetoothStatus.State.VERIFY_AUDIO_DEVICE -> R.string.settings_hint_car_bluetooth_verify
        }
        putHint("car-bluetooth", bluetoothHint?.let(activity::getString))
        val missing = BrowserPermissionStatus.missingLabels(activity)
        putHint("permissions", if (missing.isEmpty()) null else activity.getString(
            R.string.settings_hint_permissions_missing, missing.joinToString(" / ") { activity.getString(it) },
            activity.getString(R.string.onboarding_help)))
        spacing.normalizeSpacing(content, recursive = true)
    }

    /** A rebuilt card receives a new token; old asynchronous observations cannot overwrite it. */
    private fun newHintReporter(owner: String): (String, String?) -> Unit {
        val generation = (hintGenerations[owner] ?: 0) + 1
        hintGenerations[owner] = generation
        hintMessages.keys.removeAll { it.startsWith("$owner/") }
        renderHints()
        return { cause, message ->
            if (!disposed && hintGenerations[owner] == generation) putHint("$owner/$cause", message)
        }
    }

    private fun putHint(cause: String, message: String?) {
        if (hintMessages[cause] == message) return
        if (message.isNullOrBlank()) hintMessages.remove(cause) else hintMessages[cause] = message
        renderHints()
    }

    private fun renderHints() {
        if (setupOnly) return
        fun priority(key: String) = when {
            key == "permissions" || key == "browser/permission" || key == "browser/service" -> 0
            key == "session" -> 1
            key == "network" -> 2
            key.startsWith("address/") -> 3
            key == "browser-open" -> 5
            else -> 4
        }
        hints.removeAllViews()
        for ((cause, message) in hintMessages.entries.sortedBy { priority(it.key) }) {
            hints.addView(text(message).apply { tag = "connection_hint:$cause" })
        }
        spacing.normalizeSpacing(hints)
        spacing.normalizeSpacing(content, recursive = true)
    }

    private fun validateFields() {
        nameInput?.error = null
        passwordInput?.error = null
        val invalid = draft.validationError() ?: return
        val name = nameInput ?: return
        val target = if (name.text.isBlank() || name.text.toString().encodeToByteArray().size > 32 || '\u0000' in name.text.toString())
            name else passwordInput ?: name
        target.error = activity.getString(invalid)
    }
    private fun applyChanges() {
        editHandler.removeCallbacks(applyEdit)
        if (activity.isDestroyed || activity.isFinishing || draft == baseline || draft.validationError() != null) return
        draft.save(activity)
        committed()
        settingsChanged()
    }
    fun dispose() { disposed = true; statusWatch?.close(); carBluetooth.close(); editHandler.removeCallbacks(applyEdit); receiverSubscription.close() }
    fun applyPendingEdits() { applyChanges() }
}
