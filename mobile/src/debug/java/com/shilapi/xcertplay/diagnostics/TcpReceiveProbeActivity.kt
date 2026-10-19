package com.shilapi.xcertplay.diagnostics

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.shilapi.xcertplay.airplay.CarPlayTcpProbe

/** A second launcher entry in debug APKs only; no server endpoint or release navigation. */
class TcpReceiveProbeActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var status: TextView
    private lateinit var start: Button
    private val probe get() = CarPlayTcpProbe.controller
    private val refresh = object : Runnable {
        override fun run() {
            status.text = probe.snapshot()
            handler.postDelayed(this, 500)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val padding = (16 * resources.displayMetrics.density).toInt()
            setPadding(padding, padding, padding, padding)
        }
        column.addView(TextView(this).apply {
            text = "先在 TiPlay 主应用连接 iPhone 和车浏览器，再运行本实验。\nConnect CarPlay first. 60 s automatic test: 15 s baseline → 15 s 70% → 15 s 40% → 15 s unrestricted.\n仅限制主视频 TCP 读取；音频/控制保持原路径。默认关闭，进程重启清零。测试期间保持画面持续变化。"
        })
        start = Button(this).apply {
            text = "开始 60 秒实验 / Start"
            setOnClickListener {
                val accepted = probe.start()
                text = if (accepted) "实验已启动 / Running" else "需已连接视频且无运行中实验 / Connect video first"
                status.text = probe.snapshot()
            }
        }
        column.addView(start)
        column.addView(Button(this).apply {
            text = "立即停止并恢复读取 / Stop"
            setOnClickListener { probe.stop(); start.text = "开始 60 秒实验 / Start"; status.text = probe.snapshot() }
        })
        column.addView(Button(this).apply {
            text = "分享实验文本 / Share"
            setOnClickListener {
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "TiPlay TCP receive probe")
                    putExtra(Intent.EXTRA_TEXT, probe.snapshot())
                }, "TiPlay TCP probe"))
            }
        })
        status = TextView(this).apply { textSize = 12f; setTextIsSelectable(true) }
        column.addView(status)
        setContentView(ScrollView(this).apply { addView(column) })
    }

    override fun onStart() {
        super.onStart()
        handler.post(refresh)
    }

    override fun onStop() {
        handler.removeCallbacks(refresh)
        super.onStop()
        // Switching back to the car browser must not cancel the finite experiment.
    }
}
