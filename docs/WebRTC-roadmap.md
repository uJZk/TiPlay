# WebRTC 实施路线图

## 当前实现与验证边界

Android 手机 + 车载浏览器是唯一产品范围。当前 APK 为 beta.24/code66，网页 v98 保留 v97 的媒体行为；
[清理部署](Build.md#current-browser-deployment)与 [beta.24 发布记录](Build.md#beta24-release)
分别记录网页和 APK 来源、产物及独立核验；源码通过、已发布
和实车验收是三个不同结论。正式入口为 <https://ujzk.github.io/TiPlay/>，旧
`/webrtc/` 子站已删除，不保留别名或重定向。

控制、视频元数据和未协商 RTP 的音频使用可靠有序 DataChannel。CarPlay／
镜像视频必须使用协商后的原编码 RTP 视频轨：Android 解密、整理 AU 并通过
pass-through encoder 接口转送压缩帧，不解码或二次编码。浏览器 WebRTC
接收器解码后由 MediaStreamTrackProcessor 将 VideoFrame 直接交给 Canvas。
没有直播 DataChannel／WebCodecs 视频回退，也没有应用层视频队列计时器或
触控追赶。支持的源变化使用已认证的视频独立重协商及 generation／ready 屏障；
格式不兼容、检测到重排、替换失败或 Processor 失败只报告视频错误，保留音频和控制连接。协议与身份边界见 [媒体传输契约](CarPlay-DataChannel.md)。

原编码音频在可协商时走标准 WebRTC；Android 不解码／重编码。其他已实现格式
经 DataChannel 软件路径统一为 PCM16/48 kHz，再交给官方 NetEq L16；
需解码／重采样时使用 libav.js Worker，原生 48 kHz PCM 直接进入 worklet。Opus 必须协商原生 RTP，不能回退到旧的应用 NetEq Opus 捷径。
AudioWorklet 负责共享混音、压低音乐及淡变；视频和时钟拟合不驱动实时音频。
URL 投屏由 libmedia AVPlayer 独立拥有资源读取、队列、解码、时钟、同步和
Canvas 输出。旧 URL PD／SoundTouch、PCM 队列和水位策略已退役。
实现边界见 [Audio tempo](Audio-tempo.md) 与 [WASM](Browser-wasm.md)。

v96 的有界 H.264 receive-level 能力探测与 v97 的实际 encoder selector
分别处理浏览器 SDP 接收声明和 Android 运行编码器身份，不能相互替代。
完整软件检查及限制见 [Testing](Testing.md#current-release-source)。
Chromium 接受本地 SDP 不等于 RTP 已解码；托管环境零 host ICE 仍阻止端到端
浏览器 RTP 验证，真实 JNI 切换、硬解和车辆持续播放仍待设备验收。

## 四场景播放策略

四场景表达产品优先级，不是用户可选的固定缓冲档位。

| 场景 | 优先级与当前责任边界 |
| --- | --- |
| CarPlay 触控 | 立即转发触控；不改变音频或视频时间线，不启用触控专用追赶。 |
| CarPlay 非触控 | 在直播延迟要求内保持流畅；原生 WebRTC 接收器拥有缓冲与解码时序。 |
| AirPlay 镜像 | 保持原压缩视频和独立音频，遵守暂停与屏幕所有权；原生 WebRTC 接收器拥有视频时序。 |
| AirPlay URL 投屏 | 流畅优先；AVPlayer 拥有预加载、缓冲与音画同步，TiPlay 保留会话／资源／控制适配。 |

直播音频和视频各自相对源计划呈现时间最多 +300 ms，属于验收要求，不是
固定缓冲或已测结果。缺少可信源锚点时保持 unknown；首帧到达、音轨时间戳、
PCM 计数和 Canvas 提交均不证明物理扬声器／面板时间。当前 worklet 的
source-deadline 引用为 `unknown`／`independent-audio`，不认证这一要求已达标。
URL 预取不套用直播源相对 300 ms 限制。

### 参数核验与调优边界

| 当前约束 | 核验与限制 |
| --- | --- |
| H.264 receive level | 只提升已存在、mode 1 且浏览器 API 确认 `supported && smooth` 的 profile，最高 4.2；不修改源 SPS、尺寸或帧率，不证明硬解。 |
| 实际 native encoder | 公开 selector 保留协商格式，丢弃中间错误格式输出并请求 IDR；六秒未完成选择只失败视频。JVM 回归不加载 Android JNI。 |
| 实时软件音频 | 48 kHz 图与 NetEq L16；4 个软件解码 Worker、16 个软件 NetEq 源流及有限输入信用是容量，不是最优延迟。 |
| URL 预加载 | AVPlayer `preLoadTime: 4`、jitter buffer 1–4 秒；不保证解码覆盖、物理时延或总内存。详见 [URL 契约](AirPlay.md#url-engine-and-captions)。 |
| 资源与 FCUP | 各阶段 HTTP／FCUP 截止、Range、owner 和字节限额仍独立生效；配置值不证明 Android 实际网络计时器或发送端互通已验收。 |

旧的 20／30 ms 视频余量、750 ms 触控保持与 1.25x 追赶、64／256 MiB
解码画面预算、URL 750／1500 ms 水位和 500 ms 提交窗口属于已退役引擎；
不能当成当前 WebRTC／AVPlayer 参数。旧 PD／Soxr 拟合、恢复与波形回归也
不能证明当前 NetEq 音频的质量。需要查阅完整历史参数及当时的证明边界时，使用
[保留在 Git 的参数记录](https://github.com/uJZk/TiPlay/blob/5c47dd00/docs/WebRTC-roadmap.md#参数核验与调优边界)。

### 尚待补证与选值标定

下一步是 beta.24/v97 的真实 iPhone → Android → 车浏览器复测：原生编码器
选择和 IDR 恢复、跨设备 host ICE、浏览器 RTP 音视频、实际硬解、长时负载、
触控与 P／非 P 切换、AirPlay 借还屏及 HFP/SCO。日志显示 source、negotiated、
current 三种格式相同仍不证明面板已出图；需配合首次 Canvas 成功提交与现场观察。

音频需分别测量 NetEq 重复伸缩的声音、导航结束／压低恢复、同时多流、实际
render quantum、CPU／峰值内存及声学输出。AVPlayer URL 另测持续慢解码、
高码率／4K、字幕、重复 seek 和资源退休。已有软件通过不能代替同设备多负载
对照；缺失字段保持 unknown，不能以逐包日志推算不可观测的物理输出。

独立 [Cloudflare Workers 对照实验](Todo.md#cloudflare-workers-audio-comparison)
仍是未完成工作，与生产 NetEq／AVPlayer 验收分开。该待办中的旧 Soxr 对照
方案需要结合当前引擎重新界定，不能把它写成当前生产后端。

## 传输与资源约束

- `/rtc/pair/start` 与 `/rtc/pair/finish` 使用 SRP-6a 双向证明和会话密钥
  绑定完整 offer/answer SDP；四位码不在 HTTP 信令中传送。保留浏览器所有权与退役语义。
  `control`、`video` 元数据、软件路径 `audio` 均 reliable ordered，不设部分可靠重传限制；
  RTP 音视频采用浏览器 WebRTC 接收策略，不承诺可靠有序的压缩帧交付。
- 安卓依赖固定 `io.github.webrtc-sdk:android:150.7871.01`；已核查四 ABI、
  最低 API、实际 AAR 与许可证，见 [第三方说明](Third-party-notices.md)。
- 媒体只走直连 host ICE，无公共 STUN/TURN 或互联网媒体中转。分片最多
  16 KiB（含 24 字节头），保留传输 epoch、record sequence、完整长度和偏移；
  复用媒体记录中的原时间基、配置 epoch 和原序号；直播视频载荷由 RTP 交付。
- 应用层信用按完整记录消费返还；`bufferedAmount` 不作为远端消费证据。
  编码记录协议视频 16 MiB、音频 2 MiB 窗口是 DataChannel 容量，不能解释为
  原生 RTP jitter buffer 或浏览器／GPU 总量。
- 音频重新订阅带独立 generation 和首记录序号 barrier；跨通道乱序时先完成并
  丢弃旧在途记录，新 reader 不会重播旧指导音。已排队旧触控也不能借新会话发送。
- Android 输入保留原压缩依赖顺序，视频 RTP 提交有依赖链／IDR 保护；触控不改变
  播放。容量或信用停滞显式失败／恢复，不通过修改源 PTS 伪装达标。
- Android NetworkMonitor 对无 Network handle 的 AP/别名接口可能标为不可用；
  当前使用 native 接口枚举与真实套接字绑定，不通过改写 ICE 候选假装连通。
  `169.254.111.111/32` 的实际双向 UDP、选中候选与热点恢复仍需实车检查。
- 原始视频仅在安卓输入捕获一份。下游分片不再保存一份完整视频，音频保留
  自身格式/重置/路由语义；通话与麦克风仍走既有安卓 HFP/SCO。

## 诊断与已修复的遗留问题

日志区分建连阶段、候选数/UDP 类型、ICE/通道错误、重组错误、消费信用、
解码背压/停滞、已解码但未呈现与原始捕获完整性。故障快照即时上报，避免
自动重连先替换状态；Standard 保留故障与安全异常链，Debug 保留有界细节。
候选诊断不保存 IP、SDP 凭据或私有资源 URL；完整原始内容只随显式 Debug 捕获。

已修复：压缩队列拥塞静默丢帧、软件能力误广告、音频受视频计划牵引、
AirPlay 暂停破坏预测引用链、UDP 音频线程异常后悬挂、URL 旧请求回落到新
播放 owner、原始捕获重复打开文件及脱敏后故障整行丢失。捕获 writer 同步
flush；存储失败记录首末时间与来源，不能把 flush 当成断电耐久保证。
详见 [Diagnostics](Diagnostics.md)。

日志无法证明应用读取前的丢包、不可观测的硬解选择、GPU/面板扫描或真实
扬声器输出，也不能承诺解释所有理论上的硬件/系统错误。

## 配对与信任边界

HTTPS 页保护静态代码并提供安全上下文。四位码通过 SRP-6a 双向证明使用，
而不是在 HTTP 中发送；浏览器验证服务器证明及完整 SDP 的会话密钥 HMAC 后
才应用 answer，DTLS 指纹包含在该认证绑定中。Tesla 手工输入地址与四位码
即可，不需要剪贴板、长指纹或新的车端应用。单次 challenge、在线猜测锁定、
未认证 peer 与会话数量/超时限制仍然必要，不能把 PAKE 写成可防止拒绝服务。
AirPlay HTTP 资源的随机会话 bearer 从加密控制通道发放；HTTP 资源本身仍有
局域网机密性限制。SRP 验证后仍须在 DTLS 控制通道完成 `{k:'auth',q,s,c}`，才释放媒体和所有权。
随机资源 bearer 仅随认证成功的加密响应发放，不在 HTTP finish 暴露；
资源/bye 只用该 token。可信时钟样本来自认证 DC status，公开 `/hello` 不作
可信时间锚点。媒体与控制不回落到裸码 HTTP 路由。

## 验证与实车验收

自动化覆盖协议/信用/代次、真实桌面 PeerConnection、浏览器媒体/触控/恢复、
AirPlay 接收/资源取消和日志导出。URL 桌面显式软件测试模式只验证真实压缩解码和应用接线，不能作为车端硬解证据；
当前 RTP 路径的能力声明同样不能证明实际硬解。
完整命令与测试模式见 [Testing](Testing.md) 和 [browser harness](../tests/web-e2e/README.md)。

以下结果仍未证明，必须用真实 iPhone → 安卓 → 车浏览器验证：

1. Shizuku 地址上的双向 host ICE/DTLS，热点重启/地址重加、VPN 与本地权限。
2. 实际硬件解码、编码/profile、主线程/Worker 路径和 P → 非 P → P 持续播放。
3. 四模式的延迟 P50/P95、帧间隔尾部、卡顿占比、音频连续性与队列峰值；
   时钟不确定度及独立面板/声学测量，不能用 draw/PCM 计数替代。
4. 大 AU、丢包重传、持续运动、热负载、后台恢复、接管、触控反复切换、
   AirPlay 镜像/URL/CarPlay 借屏归还与 HFP/SCO 路由。
5. Debug 存储压力、捕获完整性、故障恢复及原始视频只有一份。

## 保留的实测证据与后续排查

远端 0.2.21-beta.2/v70 的约 72 秒采集覆盖真实 CarPlay HEVC → WebCodecs
Worker → Canvas；摘要未见 reader 序号缺口、解码错误或 RTC 重连。用户确认
改用 Shizuku 地址 `100.111.111.111` 后可播放，但地址与接口枚举并非单变量对照，
不能单独认定某种地址类别或 NetworkMonitor 是根因。换挡与硬解仍未验收。

beta.3/v71 的 Windows Edge 155 测试选中 host↔host UDP。2026-10-20
13:31:00.195（UTC+08:00）最老未确认记录约 202.41 ms 时触发旧版 RTC
退休；新订阅至 13:31:06.795 才转交首个 FRAME，约 6.600 秒。40 张源帧
未进入 reader（28 张处于无订阅窗口，12 张在旧在途记录中）；面板 19 次
Drops 均为刷新替换，不能拿 reader gaps=0 或面板计数宣称端到端无损。

源帧 771→772 的 PTS/安卓到达间隔为 6083.333/6104.816 ms；860→861
为 7733.333/7751.066 ms，后一空隙有用户确认的卡住现象。间隔已在 RTC
发送前出现，但不能因此唯一归因于 iPhone 编码器。独立 `Video source:` /
`Video source gap:` 摘要、阶段快照与原始输入引用须继续保留，用同设备、
尺寸和运动负载区分源停供、消费进展、传输退休与刷新替换。

这些是旧实验版的实测问题；当前 TDR1 有限信用/停滞策略与旧 TRC1 的
200 ms 最老记录保护不同：200 ms 只作诊断，真实消费无进展六秒或容量
溢出才走恢复边界。仍须重新验证整合后的恢复，不能仅凭重构宣称
6.6 秒重连或 7.75 秒源停供已在实车消除。原始设备捕获不提交仓库。

## 保留的车端实验与 TCP 证据

D 本机 WebRTC → Processor → Canvas 已获用户可播放反馈；具体编码、浏览器/
车辆固件、实际硬解及换挡结果尚未齐全。手机本地动画、HTTP 可达或候选已
产生都不能证明跨设备 UDP 连通。

### TCP 背压实测

[Debug TCP 接收探针](Diagnostics.md#debug-tcp-receive-backpressure-probe)
的持续运动测试结果：

| 阶段 | 安卓接收情况 | 到达时间减源计划呈现时间 |
| --- | --- | --- |
| 无限制基线 | 约 11–12 Mbps、60 fps | 通常约 −60 至 −70 ms |
| 70% 读取预算 | 约 7.2 Mbps | 增长到约 4.5 s |
| 40% 读取预算 | 约 4.1 Mbps，帧率进一步降低 | 最大约 8.18 s |
| 恢复无限制 | 短时约 41.32 Mbps、107 fps，随后回到基线 | 快速回到约 −66 ms |

读取限速生效但产生明显积压；吞吐下降不等于源编码降码率。源端是否减少
生成或丢弃帧仍未确定。负偏差表示相对计划呈现时间提前，不是负采集延迟。

该历史 TCP 客户端会丢弃超过呈现期限的帧并保留上一幅 Canvas 画面，秒级积压与
冻结观察相符；缺少该次浏览器计数，冻结位置尚未确认。后续 DataChannel
未沿用此压缩帧丢弃策略；当前直播又已迁移至原编码 RTP，三者不能混为当前行为。
不通过数秒播放窗口掩盖积压；缩小接收缓冲区也只能作为独立实验。
