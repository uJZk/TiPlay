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

实现提交 [`8e94b16a`](https://github.com/uJZk/TiPlay/commit/8e94b16a78f00deb41419f9f805e6adf28400018) 已从 `work` 快进合并到 `main` 并推送，`work` 已删除。工作区没有额外 worktree。

既有 [Publish site 运行](https://github.com/uJZk/TiPlay/actions/runs/38428679017) 成功，GitHub Pages 确认此提交已部署至 [TiPlay 网页](https://ujzk.github.io/TiPlay/)，包含 Canvas 模块和缓存 v36。

远程 [Android checks](https://github.com/uJZk/TiPlay/actions/runs/38428678932) 的网页测试、公共源码检查和发布工具测试通过，安卓单元测试／lint／debug 构建步骤返回 failure。用户随后明确要求跳过 Android 构建结果，因此本次不调查或修复此步骤，以已通过的网页验证和 Pages 部署完成收尾；不将安卓检查描述为通过。若后续修改安卓代码，再单独处理安卓构建与回归。

最终交付记录单独提交并推送，使用 `[skip ci]` 避免文档状态更新再次启动 Android 构建。部署后清理本地 `_site` 组装产物；保留忽略目录中的验证证据。没有新增 APK 或第二次网页发布。

## 待验证

在实际特斯拉浏览器测量视频帧率、CPU/GPU 占用、长时间播放和音画偏差；确认 iPhone HLS／直连资源的 CORS、证书与局域网可达性。桌面浏览器验证不代表实车表现，也不保证硬件零拷贝。
