package com.shilapi.xcertplay

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.opengl.EGLExt
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean

/** Keeps decoder buffer geometry separate from the encoder's fixed input dimensions. */
internal class AirPlayVideoSurfaceBridge(
    encoderSurface: Surface,
    private val width: Int,
    private val height: Int,
    private val ready: (Surface) -> Unit,
    private val failed: (Exception) -> Unit,
) : Closeable {
    private val thread = HandlerThread("tiplay-airplay-cast-surface").apply { start() }
    private val handler = Handler(thread.looper)
    private val closed = AtomicBoolean(false)
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var window: EGLSurface = EGL14.EGL_NO_SURFACE
    private var textureId = 0
    private var program = 0
    private var texture: SurfaceTexture? = null
    private var decoderSurface: Surface? = null
    private var sourceAspect = width.toFloat() / height
    private var positionLocation = -1
    private var coordinateLocation = -1
    private var transformLocation = -1
    private var imageLocation = -1
    private val releaseLock = Any()
    private var released = false
    private val releaseCallbacks = mutableListOf<() -> Unit>()
    private val failureReported = AtomicBoolean(false)
    private val transform = FloatArray(16)
    private val vertices = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
        put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)); position(0)
    }
    private val coordinates = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
        put(floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f, 1f, 1f)); position(0)
    }

    init {
        // EGL initialization and disposal never block the Android main thread. Callers post the
        // ready callback to their player thread and reject it if its playback generation ended.
        handler.post {
            try {
                if (!closed.get()) {
                    initialize(encoderSurface)
                    if (!closed.get()) ready(requireNotNull(decoderSurface))
                }
            } catch (error: Exception) {
                closed.set(true)
                try { runCatching { releaseOnOwner() } }
                finally { completeRelease(); thread.quitSafely() }
                if (failureReported.compareAndSet(false, true)) failed(error)
            }
        }
    }

    fun setVideoSize(width: Int, height: Int, pixelRatio: Float, rotation: Int) {
        val aspect = AirPlayVideoLayout.aspect(width, height, pixelRatio, rotation) ?: return
        handler.post { sourceAspect = aspect }
    }

    private fun initialize(encoderSurface: Surface) {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        check(display != EGL14.EGL_NO_DISPLAY)
        val versions = IntArray(2)
        check(EGL14.eglInitialize(display, versions, 0, versions, 1))
        val configurations = arrayOfNulls<EGLConfig>(1)
        val count = IntArray(1)
        check(EGL14.eglChooseConfig(display, intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8, EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT, 0x3142 /* EGL_RECORDABLE_ANDROID */, 1,
            EGL14.EGL_NONE,
        ), 0, configurations, 0, 1, count, 0) && count[0] > 0)
        val configuration = requireNotNull(configurations[0])
        context = EGL14.eglCreateContext(display, configuration, EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        check(context != EGL14.EGL_NO_CONTEXT)
        window = EGL14.eglCreateWindowSurface(display, configuration, encoderSurface, intArrayOf(EGL14.EGL_NONE), 0)
        check(window != EGL14.EGL_NO_SURFACE)
        check(EGL14.eglMakeCurrent(display, window, window, context))
        program = createProgram()
        positionLocation = GLES20.glGetAttribLocation(program, "position")
        coordinateLocation = GLES20.glGetAttribLocation(program, "coordinate")
        transformLocation = GLES20.glGetUniformLocation(program, "transform")
        imageLocation = GLES20.glGetUniformLocation(program, "image")
        check(listOf(positionLocation, coordinateLocation, transformLocation, imageLocation).all { it >= 0 })
        val textures = IntArray(1)
        GLES20.glGenTextures(1, textures, 0)
        textureId = textures[0]
        check(textureId != 0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        texture = SurfaceTexture(textureId).apply {
            setDefaultBufferSize(width, height)
            setOnFrameAvailableListener({ render() }, handler)
        }
        decoderSurface = Surface(requireNotNull(texture))
    }

    private fun render() {
        if (closed.get()) return
        try {
            val current = requireNotNull(texture)
            current.updateTexImage()
            current.getTransformMatrix(transform)
            GLES20.glViewport(0, 0, width, height)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            val viewport = AirPlayVideoLayout.fit(width, height, sourceAspect)
            GLES20.glViewport(viewport.x, viewport.y, viewport.width, viewport.height)
            GLES20.glUseProgram(program)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId)
            GLES20.glEnableVertexAttribArray(positionLocation)
            GLES20.glEnableVertexAttribArray(coordinateLocation)
            GLES20.glVertexAttribPointer(positionLocation, 2, GLES20.GL_FLOAT, false, 0, vertices)
            GLES20.glVertexAttribPointer(coordinateLocation, 2, GLES20.GL_FLOAT, false, 0, coordinates)
            GLES20.glUniformMatrix4fv(transformLocation, 1, false, transform, 0)
            GLES20.glUniform1i(imageLocation, 0)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            check(GLES20.glGetError() == GLES20.GL_NO_ERROR)
            // Unknown metadata never substitutes a network/decoder arrival time for source timing.
            val presentation = current.timestamp
            check(EGLExt.eglPresentationTimeANDROID(display, window, presentation))
            check(EGL14.eglSwapBuffers(display, window))
        } catch (error: Exception) {
            if (!closed.get() && failureReported.compareAndSet(false, true)) failed(error)
        }
    }

    private fun createProgram(): Int {
        fun shader(type: Int, source: String): Int {
            val shader = GLES20.glCreateShader(type)
            try {
                GLES20.glShaderSource(shader, source)
                GLES20.glCompileShader(shader)
                val result = IntArray(1)
                GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, result, 0)
                check(result[0] != 0)
                return shader
            } catch (error: Exception) { GLES20.glDeleteShader(shader); throw error }
        }
        val vertex = shader(GLES20.GL_VERTEX_SHADER,
            "attribute vec4 position; attribute vec4 coordinate; uniform mat4 transform; varying vec2 uv; " +
                "void main(){ gl_Position=position; uv=(transform*coordinate).xy; }")
        var fragment = 0
        var linked = 0
        try {
            fragment = shader(GLES20.GL_FRAGMENT_SHADER,
                "#extension GL_OES_EGL_image_external : require\nprecision mediump float; " +
                    "uniform samplerExternalOES image; varying vec2 uv; void main(){ gl_FragColor=texture2D(image,uv); }")
            linked = GLES20.glCreateProgram()
            GLES20.glAttachShader(linked, vertex); GLES20.glAttachShader(linked, fragment)
            GLES20.glLinkProgram(linked)
            val result = IntArray(1)
            GLES20.glGetProgramiv(linked, GLES20.GL_LINK_STATUS, result, 0)
            check(result[0] != 0)
            return linked
        } catch (error: Exception) { if (linked != 0) GLES20.glDeleteProgram(linked); throw error }
        finally { GLES20.glDeleteShader(vertex); if (fragment != 0) GLES20.glDeleteShader(fragment) }
    }

    override fun close() = close {}

    fun close(onReleased: () -> Unit) {
        val alreadyReleased = synchronized(releaseLock) {
            if (released) true else { releaseCallbacks.add(onReleased); false }
        }
        if (alreadyReleased) { runCatching(onReleased); return }
        if (!closed.compareAndSet(false, true)) return
        handler.post {
            try { runCatching { releaseOnOwner() } }
            finally { completeRelease(); thread.quitSafely() }
        }
        // Keep encoder drain alive until onReleased runs. It may set its stop flag from this
        // owner thread; the drain thread alone still owns encoder stop/release.
    }

    private fun completeRelease() {
        val callbacks = synchronized(releaseLock) {
            released = true
            releaseCallbacks.toList().also { releaseCallbacks.clear() }
        }
        callbacks.forEach { runCatching(it) }
    }

    private fun releaseOnOwner() {
        runCatching { decoderSurface?.release() }; decoderSurface = null
        runCatching { texture?.setOnFrameAvailableListener(null); texture?.release() }; texture = null
        if (display != EGL14.EGL_NO_DISPLAY) {
            if (context != EGL14.EGL_NO_CONTEXT && window != EGL14.EGL_NO_SURFACE &&
                EGL14.eglMakeCurrent(display, window, window, context)) {
                if (program != 0) GLES20.glDeleteProgram(program)
                if (textureId != 0) GLES20.glDeleteTextures(1, intArrayOf(textureId), 0)
            }
            EGL14.eglMakeCurrent(display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
            if (window != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(display, window)
            if (context != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(display, context)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(display)
        }
        display = EGL14.EGL_NO_DISPLAY; context = EGL14.EGL_NO_CONTEXT; window = EGL14.EGL_NO_SURFACE
        program = 0; textureId = 0
    }
}
