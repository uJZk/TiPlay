# AirPlay 屏幕镜像与视频投放

2026-10-12：手机 + 车载浏览器模式的实验性接收器。它使用独立的 Bonjour 名称、监听端口和配对身份，入口在主设置的 **AirPlay（实验性）**。

## 使用

1. 让 iPhone、安卓手机和车载浏览器处于同一局域网。可以使用安卓手机热点；启动接收器不会更改当前 Wi-Fi、热点或 CarPlay 连接方式。
2. 打开已配对的 TiPlay HTTPS 浏览器页面。特斯拉的热点附加地址和本地网络权限要求沿用 [TESLA_BROWSER.md](TESLA_BROWSER.md) 与 [HOTSPOT_ADDRESS.md](HOTSPOT_ADDRESS.md)。
3. 在安卓端进入 **AirPlay（实验性）**，点击 **启动 AirPlay**。
4. 屏幕镜像：在 iPhone 控制中心的屏幕镜像中选择 **TiPlay AirPlay**。
5. 视频投放：在支持 AirPlay 的视频应用中选择 **TiPlay AirPlay**。暂停、继续和拖动进度在 iPhone 上操作。
6. 在 iPhone 上结束镜像/投放，或在安卓端点击 **停止 AirPlay 并返回 CarPlay**。通知栏也有停止按钮。

安卓端 **高级设置 → AirPlay（实验性）→ 禁用 AirPlay** 开关默认关闭。
打开后立即停止正在运行的 AirPlay 接收器，恢复仍有效的 CarPlay 画面，并禁止再次启动 AirPlay。
关闭开关只解除禁用，仍需在 AirPlay 页面手动启动接收器；此设置会保留，不要求重新连接 CarPlay。

这是仅传送视频的预览版，未提供 AirPlay 音频接收或浏览器音频。它不会宣称支持 DRM 视频；Apple TV+ 等需要 FairPlay Streaming 许可的内容不在支持范围内。

## 保留 CarPlay 并恢复画面

启动接收器只开始监听。实际收到镜像流或视频播放请求时，CarPlay 的浏览器输出临时暂停，接收器接管同一个画布。TiPlay 保留 CarPlay 控制连接、无线连接资源、时钟及最新视频配置；接收器不会主动结束会话或触发显示尺寸重新协商。

投屏期间浏览器不再向后台 CarPlay 发送触摸、按键和手动适配请求。进入投屏前会释放已有触点。镜像数据/控制连接关闭、视频反向控制连接关闭、收到停止命令、播放结束或接收器停止时，恢复仍然有效的 CarPlay 输出，并请求关键帧。停止服务时先恢复画面，不等待 Bonjour 清理计时器。浏览器的视频 HTTP 连接可继续接收新配置，无需重新配对或重新加载网页。旧投屏线程的迟到帧、关闭回调和已结束的 CarPlay 输出不能夺回画面。

这里保留的是 TiPlay 端的会话。尚未用真实 iPhone 验证同时保持 CarPlay 和普通 AirPlay 的行为；iOS 如果主动终止 CarPlay 或更换网络，接收器无法恢复已经结束的会话。未测量真车恢复延迟。

正常停止或连接关闭立即触发恢复。静默掉线使用现有 TCP 存活检测：Android 10+ 尝试启用约 20 秒的失联检测窗口，不以没有视频帧判断断线；系统不支持调优时退回其 TCP 行为。它不是实测恢复时延保证。

## 实现与开源依据

维护情况核对于 2026-10-12：`FDH2/UxPlay` 最新提交为 2026-10-11；`antimof/UxPlay` 最新提交为 2026-04-04；`FD-/RPiPlay` 最新代码提交为 2022-03-14。因此以 [FDH2/UxPlay](https://github.com/FDH2/UxPlay) 的 `ec203121355220dd90278a369eeabb0b8ba4f14a` 为主要协议参考，固定版本便于后续对照更新。

复用 UxPlay 的 `playfair` 镜像传输密钥模块及传输握手回复表，保留许可证和出处；Android 侧的协议、发现、媒体和浏览器适配为 TiPlay 新文件。没有将 UxPlay 的桌面应用或 GStreamer 播放器搬入 Android。详见 [第三方说明](THIRD_PARTY_NOTICES.md) 和 [native 来源记录](../shared/src/main/jni/airplay/README.md)。

- 屏幕镜像：独立的 legacy pair-setup / pair-verify、镜像传输密钥协商、SETUP / RECORD / TEARDOWN、NTP 计时和 AES-CTR 屏幕流。H.264 配置与解密后的帧直接进入 `WebVideoHub`，按镜像头里的尺寸适配横竖屏，不在安卓端重新编码。该接收器未声明 HEVC 镜像能力。
- 视频投放：HTTP `/play`、`/reverse`、`/rate`、`/scrub`、`/stop`、`/playback-info`。沿用 UxPlay 的 `unhandledURLRequest` / `/action` FCUP 交换，让 iPhone 应用提供其持有的 HLS 播放列表和资源；请求按会话、对端、URL 和请求 ID 关联，并在停止或断连时取消。不会通过资源加载器请求 `skd` 密钥或安卓本地文件。
- 视频播放：Media3 加载未受 DRM 保护的 MP4 / HLS，解码后通过安卓 Surface 编码器生成 1280×720、30 fps H.264，传入既有浏览器画布链路。视频投放会转码，其耗电与延迟不同于 CarPlay/屏幕镜像。实际画幅和硬件编码器兼容性仍需设备验证。
- 后台与发现：显式启动的 connected-device 前台服务、CPU/Wi-Fi/多播锁；在可用 IPv4 局域网接口发布 Bonjour，定期跟踪热点地址变化。接收器不需要 CarPlay 的 MFi 认证身份。启动期间允许同一局域网中的 iPhone 发起连接，不设置 AirPlay PIN；浏览器配对仍使用原有配对码。

所有功能仅面向安卓手机 + 车载浏览器，没有增加原生车机产品流程。

## 验证

新增回归覆盖双方配对签名、坏签名拒绝、跨非整块帧的 CTR 连续性、发现与 `/info` 能力一致、请求长度边界、镜像尺寸与加密码流、视频进度/速率、反向事件、FCUP 会话归属和断连取消、资源加载与重定向、CarPlay 配置保留/关键帧恢复、后台输入隔离以及入口不会断开 CarPlay。

原生边界检查可用 JDK 和 C 编译器运行：

```sh
python3 scripts/test_airplay_native.py
```

最终完整 Android CI 命令已通过，`BUILD SUCCESSFUL`：

```sh
./gradlew :shared:testDebugUnitTest :common:testDebugUnitTest :home:testDebugUnitTest \
  :mobile:lintDebug :home:lintDebug :maphost:lintDebug \
  :mobile:assembleDebug :home:assembleDebug :maphost:assembleDebug \
  --max-workers=2 --console=plain
```

最终验证使用临时 Gradle init script 将 common 测试设置为两个 JVM fork，未过滤或跳过测试，也未改动仓库的测试配置。shared 1,232 项、common 1,051 项、home 4 项，共 2,287 项测试，失败、错误与跳过均为 0。三个 lint 检查均为 0 错误，三个调试 APK 构建成功；手机 APK 包含 arm64-v8a、armeabi-v7a、x86_64 的 AirPlay 原生库和非导出的接收器入口/前台服务。

浏览器 Node 测试 65/65 通过，手机到浏览器的 JVM/Chromium 端到端测试通过，原生 JNI 边界检查通过，公共源码检查与自编文件的 diff 空白检查通过；原样导入的 UxPlay 文件保留其上游行尾空白。初次运行出现一次既有端口释放测试的 `BindException`；后续验证还出现重叠进程引起的测试报告临时文件冲突。结束旧验证进程后，最终独立运行完整检查通过，没有修改或绕过这些测试。

没有进行真实 iPhone 配对、实际 MP4/HLS 投放、安卓硬件 Surface 转码或车载浏览器实测；自动化协议与浏览器测试不代表这些设备验收已经完成。

后续增加安卓高级设置的“禁用 AirPlay”开关，默认关闭。回归覆盖默认值与保存、停止服务的目标、关闭禁用不会自动启动、接收器页面状态、服务启动拦截及不触发 CarPlay 重连。更新后的完整 CI 通过，共 2,291 项单测，失败、错误与跳过均为 0；浏览器 65 项测试通过，lint 和三个调试 APK 构建通过。
