package com.shilapi.xcertplay

import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.Surface
import java.io.Closeable
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Static photos are scaled once and redrawn at one fps so late browsers can recover an IDR. */
internal class AirPlayPhotoFrames(surface: Surface, bytes: ByteArray,
                                 private val failed: (Exception) -> Unit) : Closeable {
    private val closed = AtomicBoolean(false)
    private val worker = Executors.newSingleThreadScheduledExecutor { job ->
        Thread(job, "tiplay-airplay-photo").apply { isDaemon = true }
    }

    init {
        worker.execute {
            var bitmap: android.graphics.Bitmap? = null
            try {
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                require(bounds.outWidth in 1..16384 && bounds.outHeight in 1..16384)
                var sample = 1
                while (bounds.outWidth / sample > 1280 || bounds.outHeight / sample > 720) sample *= 2
                bitmap = requireNotNull(BitmapFactory.decodeByteArray(bytes, 0, bytes.size,
                    BitmapFactory.Options().apply { inSampleSize = sample }))
                val image = requireNotNull(bitmap)
                val paint = Paint(Paint.FILTER_BITMAP_FLAG)
                while (!closed.get()) {
                    val canvas = surface.lockCanvas(null)
                    try {
                        canvas.drawColor(Color.BLACK)
                        val ratio = minOf(canvas.width.toFloat() / image.width, canvas.height.toFloat() / image.height)
                        val width = image.width * ratio; val height = image.height * ratio
                        val left = (canvas.width - width) / 2; val top = (canvas.height - height) / 2
                        canvas.drawBitmap(image, null, RectF(left, top, left + width, top + height), paint)
                    } finally { surface.unlockCanvasAndPost(canvas) }
                    TimeUnit.SECONDS.sleep(1)
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (error: Exception) { if (!closed.get()) failed(error) }
            finally { bitmap?.recycle() }
        }
    }

    override fun close() { closed.set(true); worker.shutdownNow() }
}
