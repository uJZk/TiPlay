package com.shilapi.xcertplay

/** Fit external video without stretching or cropping when decoder and encoder dimensions differ. */
internal object AirPlayVideoLayout {
    data class Viewport(val x: Int, val y: Int, val width: Int, val height: Int)

    fun aspect(width: Int, height: Int, pixelRatio: Float, rotation: Int): Float? {
        if (width <= 0 || height <= 0 || !pixelRatio.isFinite() || pixelRatio <= 0f) return null
        val ratio = width.toFloat() * pixelRatio / height
        val displayRatio = if (rotation == 90 || rotation == 270) 1f / ratio else ratio
        return displayRatio.takeIf { it.isFinite() && it > 0f }
    }

    fun fit(width: Int, height: Int, aspect: Float): Viewport {
        require(width > 0 && height > 0 && aspect.isFinite() && aspect > 0f)
        val wide = aspect >= width.toFloat() / height
        val fitWidth = if (wide) width else (height * aspect).toInt().coerceIn(1, width)
        val fitHeight = if (wide) (width / aspect).toInt().coerceIn(1, height) else height
        return Viewport((width - fitWidth) / 2, (height - fitHeight) / 2, fitWidth, fitHeight)
    }
}
