# AirPlay URL video Canvas 收尾

本次只处理网页 Video.js 画面呈现，基线为 `a1748b81`。用户调用 `tie-up`，授权提交、合并到主分支、推送和现有 Pages 部署流程。

## 实现与决策

- `site/play/airplay-canvas.js` 将底层视频画面绘制到独立 Canvas；Video.js 继续管理解码、音频、媒体时钟、播放进度和控制栏。
- 复用 CarPlay 的 WebGL2／WebGL 绘制器，无法创建 WebGL 时使用 2D。没有改动 vendored Video.js 或安卓媒体协议。
- 优先使用 `requestVideoFrameCallback()`；兼容路径检查视频帧计数，避免重复绘制。绘制缓冲按显示尺寸限制，画面不超过源视频分辨率，不读取像素到 JavaScript。
- 暂停保留最后画面，跳转完成或尺寸变化时重绘；缓冲期间取消帧回调。上下文恢复后重建 GPU 绘制器，换源、图片接管及结束投放释放回调、观察器和 GPU 资源。
- 更新离线资源清单及缓存版本至 `v36`。当前协议和限制见 [AIRPLAY.md](AIRPLAY.md)，本地验证命令见 [网页 E2E 说明](../tests/web-e2e/README.md#airplay-url-canvas-airplay-videomjs)。

## 验证与构建

- Node 22 网页单元测试：116/116 通过，无失败或跳过。
- 真实 Chromium：MP4 的 WebGL、2D、无视频帧回调三条路径以及 HLS 的 WebGL 路径全部通过。检查动态画布像素、隐藏原始视频画面、等比留黑、分辨率限制、暂停跳转、尺寸变化、WebGL 上下文恢复、控制栏点击、蓝牙静音、播放结束、换源、图片接管和释放。
- 原有 CarPlay 全页面 E2E 通过，包括 worker/main 回退、触控映射、重连和离线缓存。
- 公共源码检查、差异空白检查和补丁在干净基线上的应用及内容比对通过。静态站点已组装，下载页继续使用既有 `https://ujzk.github.io/TiPlay/` 地址。
- 完整 Android CI 命令已尝试。Gradle 下载成功，但环境缺少 JDK 25，其自动下载请求被网络策略以 HTTP 403 拒绝，未进入安卓编译、lint 或单元测试阶段。本次没有 APK 改动，不新增版本或签名发布。
- 收尾复核源码语法和差异检查通过。临时媒体、补丁沙箱、下载缓存已清理；验证日志保存在忽略目录 `agent_docs/airplay-canvas-2026-10-14/`。

## 交付状态

待本次收尾提交合并到 `main` 并推送。既有 `.github/workflows/pages.yml` 会发布网站；部署结果和提交将在收尾完成后补记。

## 待验证

在实际特斯拉浏览器测量视频帧率、CPU/GPU 占用、长时间播放和音画偏差；确认 iPhone HLS／直连资源的 CORS、证书与局域网可达性。桌面浏览器验证不代表实车表现，也不保证硬件零拷贝。
