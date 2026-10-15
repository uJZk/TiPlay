package com.shilapi.xcertplay

import android.app.AlertDialog
import android.content.Context
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import com.shilapi.xcertplay.host.R
import com.shilapi.xcertplay.network.CarPlayVpnService

/** Configure the phone and obtain consent before handing over to the receiver host. */
class FirstUseActivity : ComponentActivity() {
    companion object {
        const val REVIEW = "review_first_use"
        private const val STEP = "first_use_step"
        private const val PREFS = "tiplay_first_use"
        // The previous introduction did not configure anything or request permissions.
        private const val COMPLETED = "setup_completed"
    }

    private var step = 0
    private val reviewing get() = intent.getBooleanExtra(REVIEW, false)
    private lateinit var draft: BrowserConnectionDraft
    private var connection: BrowserMainSettingsMenu? = null
    private var permissions: BrowserPermissionsPage? = null
    private var permissionStatus: TextView? = null
    private var grantButton: Button? = null
    private var finishLater: Button? = null
    private var vpnButton: Button? = null
    private lateinit var error: TextView
    private val pages = listOf(
        R.string.onboarding_welcome_title to R.string.onboarding_welcome_body,
        R.string.onboarding_connection_title to R.string.onboarding_connection_body,
        R.string.onboarding_audio_title to R.string.onboarding_audio_body,
        R.string.onboarding_permissions_title to R.string.onboarding_permissions_body,
    )
    private val runtimePermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        refresh()
    }
    private val vpnConsent = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        refresh()
    }

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_TiPlayNative)
        super.onCreate(savedInstanceState)
        if (!reviewing && getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean(COMPLETED, false)) {
            openMain()
            return
        }
        BrowserSettingsPolicy.activate(this)
        draft = BrowserConnectionDraft.load(this, savedInstanceState)
        step = (savedInstanceState?.getInt(STEP) ?: 0).coerceIn(pages.indices)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (step > 0) { step--; render() } else finish()
            }
        })
        render()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(STEP, step)
        if (::draft.isInitialized) draft.retain(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        connection?.dispose()
        super.onDestroy()
    }

    private fun settingsChanged() {
        if (reviewing) BrowserSettingsChanges.apply(this)
    }

    private fun render() {
        connection?.dispose()
        connection = null
        permissions = null
        permissionStatus = null
        grantButton = null
        finishLater = null
        vpnButton = null
        val ui = TiPlayNativeUi(this)
        val spacing = BrowserNativeSettingsUi(this)
        ui.applyWindow(this)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            spacing.pagePadding(this)
            setBackgroundColor(ui.background)
            ui.protectSystemInsets(this)
        }
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun label(text: String, heading: Boolean = false) = ui.label(text, heading).also {
            if (heading) androidx.core.view.ViewCompat.setAccessibilityHeading(it, true)
            content.addView(it, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = ui.dp(16) })
        }
        label(getString(R.string.onboarding_progress, step + 1, pages.size))
        label(getString(pages[step].first), true).also(spacing::field)
        label(getString(pages[step].second))
        error = label("").apply { visibility = View.GONE; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        when (step) {
            1 -> {
                connection = BrowserMainSettingsMenu(this, draft,
                    requestPermissions = { runtimePermissions.launch(it) },
                    advanced = {}, about = {}, settingsChanged = ::settingsChanged, setupOnly = true)
                content.addView(connection!!.view.also(spacing::field))
            }
            2 -> {
                val controls = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                content.addView(controls.also(spacing::field))
                BrowserCarPlayAudioSettings.addControls(this, controls,
                    toggle = { parent, title, description, value, save ->
                        BrowserNativeSettingsUi(this).toggle(parent, title, description, value, true, save)
                        Unit
                    }, changed = ::settingsChanged)
                controls.addView(BrowserBootConnectionSettings.create(this))
            }
            3 -> {
                val controls = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
                content.addView(controls.also(spacing::field))
                permissionStatus = TextView(this).also(controls::addView)
                permissions = BrowserPermissionsPage(this, controls) { runtimePermissions.launch(it) }
                if (needsVpn()) vpnButton = action(controls, R.string.onboarding_usb_vpn) {
                    runCatching { CarPlayVpnService.prepare(this) }.onSuccess { consent ->
                        if (consent != null) runCatching { vpnConsent.launch(consent) }.onFailure { showError(R.string.vpn_authorization_unavailable) }
                        else refresh()
                    }.onFailure { showError(R.string.vpn_authorization_unavailable) }
                }
                BrowserNativeSettingsUi(this).normalizeSpacing(controls)
            }
        }
        spacing.normalizeSpacing(content, recursive = true)
        root.addView(ScrollView(this).apply { addView(content) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val navigation = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, ui.dp(16), 0, 0)
            tag = "onboarding_navigation"
        }
        root.addView(navigation, LinearLayout.LayoutParams(-1, -2))
        val primary = action(navigation, if (step == pages.lastIndex) R.string.onboarding_finish else R.string.onboarding_next) {
            if (step == 1 && !saveConnection()) return@action
            if (step == pages.lastIndex) {
                if (permissions?.missingRuntimePermissions()?.isNotEmpty() == true) permissions?.requestMissingPermissions()
                else finishOrConfirm()
            } else { step++; render() }
        }
        if (step == pages.lastIndex) {
            grantButton = primary
            finishLater = action(navigation, R.string.onboarding_continue) { finishOrConfirm() }
        }
        if (step > 0) action(navigation, R.string.onboarding_back) { step--; render() }
        BrowserNativeSettingsUi(this).normalizeSpacing(navigation)
        setContentView(root)
        refresh()
    }

    private fun action(parent: LinearLayout, title: Int, click: () -> Unit) = Button(this).apply {
        setText(title)
        isAllCaps = false
        minHeight = TiPlayNativeUi(this@FirstUseActivity).dp(48)
        setOnClickListener { click() }
        parent.addView(this, LinearLayout.LayoutParams(-1, -2))
    }

    private fun needsVpn() = draft.allTransports || !draft.wireless
    private fun vpnGranted() = runCatching { CarPlayVpnService.prepare(this) == null }.getOrDefault(false)

    private fun refresh() {
        connection?.refresh()
        permissions?.let { page ->
            page.refresh()
            val count = page.missingRuntimePermissions().size
            permissionStatus?.text = if (count == 0) getString(R.string.onboarding_permissions_ready)
                else getString(R.string.onboarding_permissions_missing, count)
            grantButton?.setText(if (count > 0) R.string.onboarding_grant_missing else R.string.onboarding_finish)
            finishLater?.visibility = if (count > 0) View.VISIBLE else View.GONE
            grantButton?.parent?.let { BrowserNativeSettingsUi(this).normalizeSpacing(it as LinearLayout) }
        }
        vpnButton?.text = getString(R.string.onboarding_usb_vpn) + if (vpnGranted()) " ✓" else " ✕"
    }

    private fun showError(id: Int) {
        error.setText(id)
        error.visibility = View.VISIBLE
        BrowserNativeSettingsUi(this).normalizeSpacing(error.parent as LinearLayout, recursive = true)
    }

    private fun saveConnection(): Boolean {
        val invalid = draft.validationError()
            ?: if (draft.wireless && draft.phoneAddress.isNullOrBlank()) R.string.choose_your_iphone else null
        if (invalid != null) { showError(invalid); return false }
        draft.save(this)
        connection?.committed()
        return true
    }

    private fun finishOrConfirm() {
        if (permissions?.allGranted() != true || (needsVpn() && !vpnGranted())) {
            AlertDialog.Builder(this).setMessage(R.string.onboarding_missing_confirmation)
                .setPositiveButton(R.string.onboarding_continue) { _, _ -> completeSetup() }
                .setNegativeButton(android.R.string.cancel, null).create().also(TiPlayNativeUi(this)::showDialog)
        } else completeSetup()
    }

    private fun completeSetup() {
        if (!saveConnection()) return
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(COMPLETED, true).apply()
        BrowserSettingsChanges.apply(this)
        if (reviewing) finish() else openMain()
    }

    private fun openMain() {
        startActivity(CarPlaySettingsNavigation.mainIntent(this))
        finish()
    }
}
