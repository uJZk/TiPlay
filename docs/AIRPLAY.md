# AirPlay 屏幕镜像与视频投放

手机 + 车载浏览器模式的实验性接收器，使用独立的 Bonjour 名称、监听端口和配对身份。AirPlay 默认开启，打开 TiPlay 时自动启动接收器；本地网络权限未授予时不会启动。

## 使用

1. 让 iPhone、安卓手机和车载浏览器处于同一局域网。可以使用安卓手机热点；启动接收器不会更改当前 Wi-Fi、热点或 CarPlay 连接方式。
2. 打开已配对的 TiPlay HTTPS 浏览器页面。特斯拉的热点附加地址和本地网络权限要求沿用 [TESLA_BROWSER.md](TESLA_BROWSER.md) 与 [HOTSPOT_ADDRESS.md](HOTSPOT_ADDRESS.md)。
3. 打开安卓端 TiPlay，接收器会自动开始监听。
4. 屏幕镜像：在 iPhone 控制中心的屏幕镜像中选择 **TiPlay**。
5. 视频投放：在支持 AirPlay 的视频应用中选择 **TiPlay**。暂停、继续和拖动进度在 iPhone 上操作。
6. 在 iPhone 上结束镜像/投放，恢复浏览器中的 CarPlay 画面。需要关闭接收器时，打开安卓端高级设置中的 **禁用 AirPlay**。

安卓端 **高级设置 → AirPlay（实验性）→ 禁用 AirPlay** 开关默认关闭。
打开后立即停止正在运行的 AirPlay 接收器，恢复仍有效的 CarPlay 画面，并禁止再次启动 AirPlay。
关闭开关立即重新启用接收器；此设置会保留，不要求重新连接 CarPlay。主页面与通知栏没有单独的 AirPlay 菜单或停止按钮。

这是仅输出视频的预览版，未提供 AirPlay 音频接收或浏览器音频。按用户要求，Audio-supported bit 9 先行开启用于兼容性验证；音频接收实现在 [TODO](todo.md) 中跟踪，能力位不等于功能已经完成。它不会宣称支持 DRM 视频；Apple TV+ 等需要 FairPlay Streaming 许可的内容不在支持范围内。

## 保留 CarPlay 并恢复画面

启动接收器只开始监听。实际收到镜像流或视频播放请求时，CarPlay 的浏览器输出临时暂停，接收器接管同一个画布。TiPlay 保留 CarPlay 控制连接、无线连接资源、时钟及最新视频配置；接收器不会主动结束会话或触发显示尺寸重新协商。

投屏期间浏览器不再向后台 CarPlay 发送触摸、按键和手动适配请求。进入投屏前会释放已有触点。镜像数据/控制连接关闭、视频反向控制连接关闭、收到停止命令、播放结束或接收器停止时，恢复仍然有效的 CarPlay 输出，并请求关键帧。停止服务时先恢复画面，不等待 Bonjour 清理计时器。浏览器的视频 HTTP 连接可继续接收新配置，无需重新配对或重新加载网页。旧投屏线程的迟到帧、关闭回调和已结束的 CarPlay 输出不能夺回画面。

这里保留的是 TiPlay 端的会话。iOS 如果主动终止 CarPlay 或更换网络，接收器无法恢复已经结束的会话；真车恢复行为仍需按具体设备验证。

显式 `TEARDOWN` 必须在清除镜像归属时通知监听状态，触发 CarPlay 显示恢复；只清除归属会使后续断连回调无法再恢复画面。恢复只由当前镜像所有者触发，旧连接不能结束新镜像。

镜像数据通道结束立即释放画面，但不主动关闭对应的 RTSP 控制连接、计时服务或传输密钥。控制连接仍可回复 `TEARDOWN`，或在同一连接上接受新的镜像 `SETUP`；由 `TEARDOWN`、控制连接结束或接收器停止统一清理会话。控制连接保留原有读取超时，数据通道结束不会导致无限持有空闲会话。该边界与 UxPlay 的普通镜像处理一致，避免在 iPhone 发送停止请求前抢先截断控制回复。

正常停止或连接关闭立即触发恢复。静默掉线使用现有 TCP 存活检测：Android 10+ 尝试启用约 20 秒的失联检测窗口，不以没有视频帧判断断线；系统不支持调优时退回其 TCP 行为。它不是实测恢复时延保证。

## 实现与开源依据

维护情况核对于 2026-10-12：`FDH2/UxPlay` 最新提交为 2026-10-11；`antimof/UxPlay` 最新提交为 2026-04-04；`FD-/RPiPlay` 最新代码提交为 2022-03-14。因此以 [FDH2/UxPlay](https://github.com/FDH2/UxPlay) 的 `ec203121355220dd90278a369eeabb0b8ba4f14a` 为主要协议参考，固定版本便于后续对照更新。

复用 UxPlay 的 `playfair` 镜像传输密钥模块及传输握手回复表，保留许可证和出处；Android 侧的协议、发现、媒体和浏览器适配为 TiPlay 新文件。没有将 UxPlay 的桌面应用或 GStreamer 播放器搬入 Android。详见 [第三方说明](THIRD_PARTY_NOTICES.md) 和 [native 来源记录](../shared/src/main/jni/airplay/README.md)。

- 屏幕镜像：独立的 legacy pair-setup / pair-verify、镜像传输密钥协商、SETUP / RECORD / TEARDOWN、NTP 计时和 AES-CTR 屏幕流。H.264 配置与解密后的帧直接进入 `WebVideoHub`，按镜像头里的尺寸适配横竖屏，不在安卓端重新编码。该接收器未声明 HEVC 镜像能力。
- 视频投放：HTTP `/play`、`/reverse`、`/rate`、`/scrub`、`/stop`、`/playback-info`。沿用 UxPlay 的 `unhandledURLRequest` / `/action` FCUP 交换，让 iPhone 应用提供其持有的 HLS 播放列表和资源；请求按会话、对端、URL 和请求 ID 关联，并在停止或断连时取消。不会通过资源加载器请求 `skd` 密钥或安卓本地文件。
- 视频播放：Media3 加载未受 DRM 保护的 MP4 / HLS，解码到独立 SurfaceTexture，通过 EGL 按比例绘制到编码器 Surface，生成 1280×720、30 fps H.264，传入既有浏览器画布链路。视频投放会转码，其耗电与延迟不同于 CarPlay/屏幕镜像。解码与编码使用独立 Surface，避免缓冲尺寸耦合导致解码已输出但编码器无帧；释放时先关闭 EGL 生产者，再结束编码输出线程，清理不阻塞安卓主线程。
- 后台与发现：默认启用的 connected-device 前台服务、CPU/Wi-Fi/多播锁；每个物理 IPv4 局域网接口使用一个主地址发布 Bonjour，定期跟踪热点地址变化。浏览器专用附加地址及接口别名不另建 Bonjour 实例，避免同一热点上的接收器互相判定名称冲突；不同物理接口使用不同主机名。接收器不需要 CarPlay 的 MFi 认证身份。启动期间允许同一局域网中的 iPhone 发起连接，不设置 AirPlay PIN；浏览器配对仍使用原有配对码。

所有功能仅面向安卓手机 + 车载浏览器，没有增加原生车机产品流程。

Bonjour 的功能位 30 表示同一 `_airplay` 端口也提供 RTSP 镜像入口，因此不需要另行发布 `_raop`（AirTunes）服务；它与音频支持位 9 及功能位 26（Unified Advertiser 信息）不同。接收器的 HTTP 视频接口与 RTSP 配对、镜像共用监听端口，发现记录、`/info` 与 `/server-info` 保持此声明一致。音频支持位 9 已按用户要求开启；音频格式位保持关闭，不发布音频编解码器或音频服务，实际接收实现仍待后续工作。该发现语义依据 [公开功能位说明](https://openairplay.github.io/airplay-spec/features.html) 和固定 UxPlay 的 [端口与功能位实现](https://github.com/FDH2/UxPlay/blob/ec203121355220dd90278a369eeabb0b8ba4f14a/uxplay.cpp)。UxPlay 的 `-a` 仅关闭音频渲染，仍接收音频并发布 AirTunes，不能将它视为无音频协议声明的范例。

Legacy 镜像初始 SETUP 的 `eventPort` 为 0，不能填写接收器控制监听端口。iPhone 仍可能查询 `GET_PARAMETER volume`；接收器返回静音参数；此回复本身不代表音频接收已经实现。`/feedback` 是心跳，不能用它冒充关键帧请求。网页加入视频流必须等待可独立解码的 IDR；收到配置或持续转发加密流解出的帧，都不能单独证明网页已有画面。诊断仅记录帧数、IDR 数与 Annex B 格式计数，不记录媒体内容或密钥。

## 验证

新增回归覆盖双方配对签名、坏签名拒绝、跨非整块帧的 CTR 连续性、发现与 `/info` 能力一致、请求长度边界、镜像尺寸与加密码流、视频进度/速率、反向事件、FCUP 会话归属和断连取消、资源加载与重定向、CarPlay 配置保留/关键帧恢复、后台输入隔离以及入口不会断开 CarPlay。

原生边界检查可用 JDK 和 C 编译器运行：

```sh
python3 scripts/test_airplay_native.py
```

完整源码检查以 [AGENTS.md](../AGENTS.md) 和 [Android CI 工作流](../.github/workflows/android.yml) 为准。协议回归、原生 JNI 边界和模拟浏览器检查不能代替真实 iPhone 连接、Android 硬件转码与车载浏览器验证。
