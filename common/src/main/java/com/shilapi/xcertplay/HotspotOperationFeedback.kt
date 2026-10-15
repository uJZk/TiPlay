package com.shilapi.xcertplay

import android.view.View
import android.widget.LinearLayout
import android.widget.TextView

/** One page's explicit operation survives a card rebuild, but a later click replaces its result. */
internal class HotspotOperationFeedback {
    enum class Target { METHOD, AUTHORIZATION }
    private var generation = 0
    private var target = Target.METHOD
    private var message: Int? = null
    private var relatedMethod: HotspotAddressMethod? = null
    private var methodLine: TextView? = null
    private var authorizationLine: TextView? = null
    val hasMessage get() = message != null
    var onChanged: (() -> Unit)? = null
    fun owns(method: HotspotAddressMethod) = hasMessage && (relatedMethod == null || relatedMethod == method)

    inner class Operation internal constructor(private val token: Int, private val anchor: Target) {
        fun show(value: Int) {
            if (token != generation) return
            target = anchor
            message = value
            render()
        }
    }

    fun begin(anchor: Target, method: HotspotAddressMethod? = null): Operation {
        relatedMethod = method
        generation++
        clear()
        return Operation(generation, anchor)
    }

    fun bind(method: TextView, authorization: TextView?) {
        methodLine = method
        authorizationLine = authorization
        render()
    }

    fun clear() { message = null; render() }
    fun cancel() { generation++; clear() }

    private fun render() {
        val selected = if (target == Target.METHOD) methodLine else authorizationLine ?: methodLine
        for (line in listOfNotNull(methodLine, authorizationLine)) {
            val value = message.takeIf { line === selected }
            line.text = value?.let(line.context::getString).orEmpty()
            line.visibility = if (value == null) View.GONE else View.VISIBLE
            (line.parent as? LinearLayout)?.let { BrowserNativeSettingsUi(line.context).normalizeSpacing(it) }
        }
        onChanged?.invoke()
    }
}
