package com.shilapi.xcertplay

import android.content.Context
import android.os.Bundle
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import com.shilapi.xcertplay.host.R

/** Launcher introduction. No receiver or permission request runs before the user finishes. */
class FirstUseActivity : ComponentActivity() {
    companion object {
        const val REVIEW = "review_first_use"
        private const val STEP = "first_use_step"
        private const val PREFS = "tiplay_first_use"
    }

    private var step = 0
    private val reviewing get() = intent.getBooleanExtra(REVIEW, false)
    private val pages = listOf(
        R.string.onboarding_welcome_title to R.string.onboarding_welcome_body,
        R.string.onboarding_connection_title to R.string.onboarding_connection_body,
        R.string.onboarding_browser_title to R.string.onboarding_browser_body,
        R.string.onboarding_audio_title to R.string.onboarding_audio_body,
    )

    override fun attachBaseContext(newBase: Context) {
        super.attachBaseContext(AppLocale.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.Theme_TiPlayNative)
        super.onCreate(savedInstanceState)
        if (!reviewing && getSharedPreferences(PREFS, MODE_PRIVATE).getBoolean("completed", false)) {
            openMain()
            return
        }
        step = (savedInstanceState?.getInt(STEP) ?: 0).coerceIn(pages.indices)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (step > 0) { step--; render() } else finish()
            }
        })
        render()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putInt(STEP, step)
        super.onSaveInstanceState(outState)
    }

    private fun render() {
        val ui = TiPlayNativeUi(this)
        ui.applyWindow(this)
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(ui.dp(24), ui.dp(24), ui.dp(24), ui.dp(24))
        }
        fun label(text: String, heading: Boolean = false) {
            content.addView(ui.label(text, heading).apply {
                setPadding(0, 0, 0, ui.dp(20))
                if (heading) androidx.core.view.ViewCompat.setAccessibilityHeading(this, true)
            })
        }
        label(getString(R.string.onboarding_progress, step + 1, pages.size))
        label(getString(pages[step].first), true)
        label(getString(pages[step].second))
        fun button(title: Int, action: () -> Unit) {
            content.addView(Button(this).apply {
                setText(title)
                isAllCaps = false
                minHeight = ui.dp(48)
                setOnClickListener { action() }
            }, LinearLayout.LayoutParams(-1, -2))
        }
        button(if (step == pages.lastIndex) R.string.onboarding_finish else R.string.onboarding_next) {
            if (step == pages.lastIndex) {
                getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean("completed", true).apply()
                if (reviewing) finish() else openMain()
            } else { step++; render() }
        }
        if (step > 0) button(R.string.onboarding_back) { step--; render() }
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(ui.background)
            addView(content)
            ui.protectSystemInsets(this)
        })
        content.getChildAt(1).sendAccessibilityEvent(android.view.accessibility.AccessibilityEvent.TYPE_VIEW_FOCUSED)
    }

    private fun openMain() {
        startActivity(CarPlaySettingsNavigation.mainIntent(this))
        finish()
    }
}
