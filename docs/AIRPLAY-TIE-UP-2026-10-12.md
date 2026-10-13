# AirPlay 交付记录（2026-10-12）

本文保留 2026-10-12 首次交付的测试、提交和清理记录；下文“仅传送视频”等限制属于该版本。后续源码已加入镜像伴随 AAC-ELD 音频与 HEVC 支持，并改用浏览器 Video.js 播放 URL 视频；当前合同见 [AIRPLAY.md](AIRPLAY.md) 和 [媒体调整](BROWSER-MEDIA-2026-10-13.md)。本次文档核对未重新执行历史测试或设备验证。

本次交付普通 AirPlay 屏幕镜像和非 DRM 视频投放的实验性接收器，协议参考固定为 FDH2/UxPlay `ec203121355220dd90278a369eeabb0b8ba4f14a`。具体使用、架构及来源见 [AIRPLAY.md](AIRPLAY.md)。

实际投屏时暂停 CarPlay 浏览器输出，保留仍有效的会话；停止时恢复画面并请求关键帧。安卓高级设置增加“禁用 AirPlay”，默认关闭；开启立即停止接收器，关闭后立即重新启用接收器，不触发 CarPlay 重连。接收器随 TiPlay 打开自动启动，主页面和通知栏不再提供 AirPlay 二级菜单或停止按钮。

## 验证与产物

- 完整 Android CI 通过：shared 1,232、common 1,055、home 4，共 2,291 项单测，失败、错误、跳过均为 0。
- mobile/home/maphost lint 均为 0 错误；三个 debug APK 构建成功。手机 APK 包含三个 ABI 的 AirPlay 原生库。
- Node 浏览器测试 65/65 通过；JNI 边界检查及手机到浏览器 JVM/Chromium 端到端检查通过。
- 完整 CI 使用临时 init script 将 common 测试设置为两个 JVM fork，没有过滤或跳过测试。既有 lint 警告仍为 mobile 18、home 5、maphost 2。
- 公共源码检查通过；自编文件的空白检查通过。原样导入的 UxPlay 源码和许可证保留上游行尾空白。
- 构建产物保留在各模块 `build/outputs/apk/debug/`，未提交 APK、私钥或发布签名材料。

## 集成与后续

本次工作基于 `cbe7cff6`，收尾时远端 main 为 `45351071`。实现提交为 `54237412`，通过 `d39ea706` 合入 main，并已正常推送到 `origin/main`，没有强推。README 和 AGENTS 的文档冲突已保留双方内容；生产代码、测试代码及构建配置与通过验证的实现版本一致。工作分支 `work` 已删除。

清理本次临时参考仓库、验证日志、线程转储和临时 Gradle init script；保留共用工具链及 APK 构建产物。最终公共源码和自编文件空白检查通过，工作树干净。

本次仅改 Android 接收器、测试和文档。现有 GitHub Pages 发布输入未改动，跳过网站部署；未创建 Release、版本标签或签名发布包。

仍需用真实 iPhone 验证配对、镜像、MP4/HLS、安卓 Surface 转码、与 CarPlay 共存及真车恢复时延。此版本仅传送视频，不提供 AirPlay 音频、DRM 或 HEVC 镜像。下一步按 [AIRPLAY.md](AIRPLAY.md) 的设备验证边界开展实测。
