# TODO

当前待办；后面的 2026-10-08／09 报告保留历史设备证据，本次文档核对未重新取得报告或完成实车验证。TiPlay 仅支持安卓手机＋车载浏览器，保留的车机接口属于上游兼容性。当前官方项目与网页为 `https://github.com/uJZk/TiPlay` 和 `https://ujzk.github.io/TiPlay/`；媒体合同见 [媒体调整](BROWSER-MEDIA-2026-10-13.md)。

## common 模块独立 lint

- [ ] 排查并修复 `:common:lintDebug` 的权限与 API 使用错误。先核对库模块与应用合并后的权限上下文，再补齐真实调用点的权限检查；包括 `BrowserMainSettingsMenu` 读取 `BluetoothAdapter.bondedDevices` 前的 `BLUETOOTH_CONNECT` 检查。验证口径仍以 [Android CI](../.github/workflows/android.yml) 为准，独立库 lint 通过后再考虑加入 CI。

## AirPlay 停止与 CarPlay 共存

- [ ] 验证共享入口的冷启动、CarPlay 断开／重连、热点变化及禁用／重新启用普通 AirPlay；关注同名记录、旧 TXT 缓存和实际监听端口的一致性，合同见 [AIRPLAY.md](AIRPLAY.md)。

## 独立图片／视频 AirPlay

- [ ] 验证 Bilibili／YouTube 的原生 AirPlay 首次投放、重复投放与重连稳定性，以及相册首次投放与实际协议路径；分别测试 CarPlay 活跃和非活跃时的入口选择，区分 iOS 输出限制与接收器故障。HTTP 视频解码到网页的验证不能替代真实应用验证。
- [ ] 验证 `/photo` JPEG/PNG、`cacheOnly` / `displayCached` 的实机兼容性、缓存未命中 412、停止清理与 EXIF 原图方向。幻灯片调度未声明，不属于本次实现。相册使用类型 110 不代表客户端采用独立图片协议。
- [ ] 实现独立视频播放队列及队列控制；固定 UxPlay 的 HLS 播放列表缓存与恢复不能作为队列实现。完成前不声明 bit 33。

## AirPlay 普通音频与视频验证

- [ ] 实机验证类型 96 的 PCM／ALAC／AAC-LC／AAC-ELD 格式选择、UDP 接收、浏览器声画同步与断连清理，以及镜像音频与 URL 视频切换时的声音清理（URL 视频声轨由网页 TiPlay 播放引擎输出），契约见 [AIRPLAY.md](AIRPLAY.md)。
- [ ] 实机验证镜像音频控制通道提供有效 RTP/NTP 锚点，确认浏览器同步路径未持续退回到达播放；验证回绕、乱序、缺包后的时间位置及新会话隔离，契约见 [AIRPLAY.md](AIRPLAY.md)。
- [ ] 在车辆浏览器验证 TiPlay URL 视频的 MP4/HLS WebCodecs 解码、跳转、暂停、恢复、倍速、字幕、长时间播放、短尾声音与缓冲反馈，以及代理 FCUP 资源和 iPhone 直连资源的 CORS／可达性；安卓浏览器模拟车机的验证不能替代实车兼容性。另验证镜像的画面端到端延迟与音画偏差，以及 CarPlay 音乐与导航／通话独立重置。
- [ ] 实机验证已实现的字幕路径：HLS-TS SEI CEA-608/708 文本、CMAF/fMP4 `wvtt`／`stpp`、MP4 内嵌 `tx3g`／`wvtt`／`stpp`，以及 AES-128 WebVTT／fMP4 的密钥可达性、轮换、IV 和初始化段；检查 Video.js 按实际解析的轨显示按钮、语言切换、跳转与直播 discontinuity 对齐。来源与音视频起点不同的旁挂字幕仍需原始媒体锚点，不能把已归一的媒体时间当作 MPEGTS。Apple AirPlay 2 电视路径要求 WebVTT，不以通用 fMP4 支持推断所有 iPhone 应用都会发送它；TTML 图片／复杂布局、CEA-708 窗口样式和 DRM 授权不属于当前呈现范围，合同见 [AIRPLAY.md](AIRPLAY.md#url-视频字幕)。
- [ ] 实机验证 UDP 0x55／0x56 缺包重传、FLUSH 后状态隔离及独立音频停止；冗余格式未实现，不声明 bit 11 或 RFC2198 bit 61。
- [ ] 实机验证普通镜像 HEVC 的配置封装、暂停／恢复、横竖屏变化和浏览器解码兼容性；关闭 HEVC 后必须恢复 H.264 声明。验证视窗改变只缩放当前镜像、下次 SETUP 才应用新尺寸。
- [ ] 使用真实应用验证 HLS SDR 版本筛选、无 SDR 的错误反馈及镜像 HDR 输入拒绝；legacy AirPlay 没有已确认的强制 SDR 请求字段。

## AirPlay 轻量信任设备机制（已实现，待设备验收）

实现见 [AIRPLAY.md](AIRPLAY.md) 与 [接收器改进记录](AIRPLAY-RECEIVER-2026-10-14.md)。首次请求在已配对网页右上角显示 5 秒通知；拒绝、超时、网页断开均不允许接管。成功 pair-verify 的公钥指纹可持久信任，未验证的旧式 HTTP 请求只允许当前连接。高级设置提供“忘记所有可信 AirPlay 设备”，不主动终止当前播放；后续连接重新确认。当前所有者及请求 epoch 阻止其他设备和迟到回调夺取画布，禁用 AirPlay 仍优先。

- [ ] 分别用真实 iPhone 验证镜像、相册和 URL 视频的首次允许／拒绝／超时、配对重试、下次自动允许、忘记后再次确认与并发抢占；验证各应用是否提供稳定可验证身份，旧式 HTTP 不得凭名称或 IP 记住。
- [ ] 在实车验证通知显示、5 秒有效期、设置页保留通知及浏览器断开时的拒绝行为。

## 车载浏览器音频实车验证

- [ ] 排查 CarPlay 声音断续而画面正常的问题：区分上游 RTP 丢包、解码停顿、HTTP 抖动与网页队列欠载，补齐数值诊断；验证现有有界抖动缓冲与欠载恢复，验证连续播放与电话/Siri 延迟。
- [ ] 实车验证现有 CarPlay RTP 采样时间戳 → `RtpAudioTimeline` → 网页 PCM 呈现时间与调度链路，关注有效时钟锚点、漂移、回绕、乱序、丢包和流切换；源码已传送时间戳，不再作为未实现功能列出。

- [ ] 在实车验证网页播放、安卓麦克风权限、按需 HFP/SCO 录音／切换、导航固定衰减、电话/Siri 往返时延、车机回声处理与连接恢复；ADB 安卓测试不能替代车辆浏览器与 iPhone 的路由验证。
- [ ] 验证高级设置“禁用 CarPlay 音频”后所有声音是否稳定交给 iPhone 与车辆之间的蓝牙；重新启用后验证闲时网页播放，录音期间由安卓蓝牙电话通道承载通话、Siri、固定衰减的导航和麦克风。完整音频合同见 [TESLA_BROWSER.md](TESLA_BROWSER.md)。
- [ ] 验证网页端固定协商的 CarPlay 缓冲音乐在网络波动、暂停、跳转和长时间播放下的背压与连续性，设计依据见 [BUFFERED_AUDIO.md](BUFFERED_AUDIO.md)。

## 特斯拉浏览器 CarPlay：其余待定事项

- [x] 收集特斯拉浏览器探测报告（报告 `d73a0959`，2026-10-08）。探测页源码只放在会话临时目录，没有提交，需要时重新生成。
  - 车辆：Model Y，AMD Ryzen（GPU：Radeon Vega），Chromium 148，HTTPS 安全上下文。屏幕 1254×784，视口 773×601，DPR 1.53。8 核。
  - 硬解：H.264、HEVC、VP9 都支持。1080p60 实时解码 60 fps，解码延迟 p50 0.9 ms、p95 约 1.5 ms；极限吞吐 210–225 fps。
  - AV1：只有软解，60 fps，延迟 p50 7.4 ms。不作为主路径。
  - HEVC 只能硬解，没有软解。
  - 渲染：WebGL 绘制 p95 0.4 ms，Canvas 2D 0.6 ms。WebGPU API 存在但拿不到 adapter。Worker 比主线程的偶发尖峰小（max 30 ms 对 51 ms）。
  - 挂 D 挡（报告 `8b2fbb80`）：D 挡连续 22 秒，H.264 硬解 + WebGL 稳定 60 fps，页面刷新 60 fps，页面保持可见，Web Audio 持续运行；解码延迟 p50 1.5 ms、p95 3.7 ms。用户目测画面和声音都正常。
  - 私有 IP：`http://10.176.81.135:8080` 打不开，与"拦截 RFC1918"一致。还没排除热点 AP 隔离的可能。
  - API：WebTransport、WebRTC、OffscreenCanvas、WASM SIMD、AudioWorklet 都有；SharedArrayBuffer 没有。
  - 声音：Web Audio 能出声，基础延迟 42.7 ms。
  - 触摸：最多 10 点，移动事件约 306 次/秒。
  - 补测（报告 `a98934e0`）：WSS 可用，到 Cloudflare 往返中位 178 ms（走公网，不代表热点内延迟），下行 96 Mbps；WebRTC 数据通道可用。这次视口为 1256×706，说明浏览器窗口大小会变，需要监听 resize 重新协商分辨率。
  - 私有 IP（报告 `8b2fbb80`）：另一台设备能打开 `http://10.176.81.135:8080`，排除了 AP 隔离，确认是特斯拉浏览器拦截私有地址。
- [x] **前置实测（报告 `305294d4`，2026-10-09）**：热点网卡加 `100.109.220.253/32` 后，特斯拉（热点内地址 10.176.81.89，直连、未经 VPN）：
  - **UDP 能到达手机**：WebRTC 往 `100.109.220.253:8080` 发的 STUN 包全部被手机收到（来源端口 1034）。方案 B 成立。
  - **TCP 也能到达**：公网 HTTPS 页面 `fetch("http://100.109.220.253:8080/…")` 成功并读到响应内容（21 ms）；
    `https://` 打到 8080 端口时手机收到了 TLS 握手；ICE-TCP 连接也到达了。
  - 没有弹出"本地网络访问"授权提示。`ws://` 没有到达手机（被浏览器拦截）。
- [ ] 确认 iPhone 发来的码流格式：在诊断日志中记录配置头的格式标记（`avcC`/`hvcC`/其他）。
  代码已完成：会话日志每种配置记一行 `Video config marker=… codec=…`；待真机报告确认。
- [x] 视频链路：新增 `WebMediaSink`，不转码，直接把 iPhone 码流（H.264 或 HEVC）通过 HTTP 响应流送给浏览器；浏览器在主线程发起 `fetch`，把响应流转交 Worker 读取，用 WebCodecs 硬解，用 WebGL 画到 OffscreenCanvas；发送端积压时丢帧到下一个关键帧。
  分辨率按浏览器上报的视口 × DPR 协商；当前帧率新安装默认 60 fps，已保存选择保持不变；高级设置提供 30–60 fps 和 HEVC。未保存编码选择时 HEVC 默认开启，可关闭以使用 H.264；修改立即保存并自动应用，需要新协商时重连，保持设置页打开。启用 CarPlay 时闲置修改也可能恢复连接准备；禁用时阻止启动和重试，没有“返回并应用”步骤。
  代码已完成（`TeslaBrowserLink`、`TeslaBrowserCanvas`，在 `CarPlayHostActivity` 的 `createMediaEngine` 分出视频），实车测试见 [TESLA_BROWSER.md](TESLA_BROWSER.md) 的清单。
- [x] 网络：按下面"热点地址"和"传输层"的决定实现。
  代码已完成：手机在所有 IPv4 地址的监听端口（默认 8080，可修改）提供协议接口，不再打包或提供网页副本；端口被占用时退避重试；Android 17 申请本地网络权限；连接期间持有唤醒锁和低延迟 Wi-Fi 锁。实车测试待做。
- [x] 触摸：Pointer Events 多点触控，每次 `requestAnimationFrame` 合并发送一次，换算后调用 `CarPlayController.sendTouch`。
  代码已完成（页面 `site/play/`，手机端 `BrowserTouchSlots` → `CarPlayController.sendTouch`；Home、返回和 Siri 键也已接通）。实车测试待做。

## 已定的决定

- **传输层用 HTTPS 页面 + HTTP fetch 流（方案 D，2026-10-09，取代此前的 WSS 和 WebTransport 方案）**：
  - 原因：WebCodecs 只在安全上下文可用，所以页面必须是 HTTPS；CA 不会给 100.64 地址签证书，`ws://` 又会被混合内容拦截。
    Chrome 对"发往本地 IP 字面量的 `fetch`"豁免混合内容检查，并把 100.64.0.0/10 视为本地地址，特斯拉的拦截名单也不含 100.64，
    所以 HTTPS 页面可以直接 `fetch("http://100.109.220.253:8080/…")`（报告 `305294d4` 实测成功，无授权弹窗）。
    参考：https://developer.chrome.com/blog/local-network-access
  - 页面：静态 HTTPS 页面，托管在国内不开代理也能访问的地址（自定义域名，不用 `workers.dev`），用 Service Worker 缓存，首次加载后不依赖外网。
    - **最短链接（2026-10-09 历史方案）**：页面放在 GitHub Pages 站点根目录（`https://ujzk.github.io/DiPlay/`），下载页移到 `download/`（旧的语言页地址如 `zh-Hans/` 转发过去），
      当前官方默认页面为 `https://ujzk.github.io/TiPlay/`；这里的旧 `/DiPlay/` URL 保留历史方案。旧地址 `play/` 只做转发（带上 `?t=` 和 `#c=`，并注销旧的 Service Worker）。默认手机地址 `100.109.220.253:8080` 不写 `?t=`，
      链接就是 `https://<页面地址>#c=<配对码>`；其他地址才加 `?t=<地址>`（端口不是 8080 时加 `:端口`）。带配对码、不带 `?t=` 的链接
      一律指默认地址，不沿用浏览器之前保存的地址。配对码仍然必需，只在 `#c=` 里出现一次，页面保存后删掉，所以首次打开后再加书签。
      App 内置页面及本地 `/play/` 入口已按用户要求移除，所有浏览器使用托管的 HTTPS 页面。
    - 站点地址由仓库变量 `SITE_BASE_URL` 决定（下载页的 canonical 等链接用它），换自定义域名的步骤见 [TESLA_BROWSER.md](TESLA_BROWSER.md) 第 1 节。
      国内：不用 `workers.dev`；`github.io` 不开代理可能不稳定；自定义域名指向 GitHub Pages 时仍由 GitHub 提供服务，要在车上不开代理实测。
    - [ ] 决定是否用自定义域名：需要一个域名，并在车上不开代理测试首次加载。
  - 视频：页面主线程 `fetch("http://100.109.220.253:8080/video?…", { targetAddressSpace: "local" })`，把 `response.body`（可转移的 `ReadableStream`）`postMessage` 转交给解码 Worker，由 Worker 读取；
    这样请求从页面发起，确定享受豁免，读取和解码仍在 Worker 里。手机返回不定长的 HTTP/1.1 响应，
    持续写入帧；每帧带长度前缀和帧头（时间戳、关键帧标记、序号、编码），页面用 `ReadableStream` 读取后重组。
  - 控制和触摸：用短 `fetch` POST（keep-alive），按 `requestAnimationFrame` 合并发送；使用"简单请求"（如 `text/plain`），避免 CORS 预检。
    不用流式上传：Chrome 只在 HTTP/2 以上支持流式请求体。
  - 手机端：普通 HTTP 服务器，监听 8080，开 TCP_NODELAY，发送缓冲设小，积压时丢帧到下一个关键帧并向 iPhone 请求关键帧；
    返回 CORS 响应头（含 `Access-Control-Allow-Private-Network`），以备浏览器发出本地网络预检。
  - 配对：页面链接片段 `#c=` 带配对码，静态页面服务器收不到片段；页面随后在 `/video` 查询和 `/control`、`/bye` 请求体中发给手机，只允许一个控制端。热点有 WPA 加密，明文 HTTP 的风险可以接受。
  - 手机 HTTP 接口不需要证书或证书服务器；公网静态页面仍需域名解析和有效 HTTPS 证书。
  - 风险（都不受我们控制）：Chrome 取消或收紧这条混合内容豁免；特斯拉以后开始弹授权提示（只需用户允许一次）；特斯拉的拦截名单加入 100.64。
  - Worker 里直接发起 `fetch` 是否享受豁免：公开资料没有定论（2026-10-09 查证）。LNA 规范说该机制同样适用于 Worker，
    但授权检查依赖关联的 Document；Chrome 文档只说明 Service Worker 和 Shared Worker 需要其来源事先获得授权，未提及 Dedicated Worker。
    规范把 100.64.0.0/10 列为 local。因此采用上面"主线程发起、转交流给 Worker"的做法，绕开这个不确定性。
  - 待实测：长时间响应流是否会被浏览器或特斯拉中途断开。
  - 备选：方案 B（WebTransport + 证书指纹，UDP 已实测可达），代价是证书最长 14 天要轮换、安卓端要集成 HTTP/3。
- **以 DiPlay 为基础开发，不以 [WheelPlay](https://github.com/fython/wheelplay) 为基础**：
  - WheelPlay 基于较旧的 DiPlay 快照，没有共同 git 历史，缺少后来的热点和无线可靠性修复，难以再合并上游修复。
  - 它的主视频路线是 WebRTC → `<video>` → `drawImage`，按其他项目的报告，特斯拉挂挡后 `<video>` 会暂停（推断，未在本车验证）。
  - 当时的“声音走车辆蓝牙”方案已被取代：当前闲时网页播放固定缓冲音乐，麦克风需求期间使用安卓到车辆的 HFP/SCO 通道；“禁用 CarPlay 音频”是独立退出选项。
- [ ] 评估是否还需要从 WheelPlay 移植以下组件（GPL-3.0，保留署名）；当前已用 `BrowserLinkServer`、`BrowserPairingGate`、`WebMediaSink` 和触摸/统计实现对应主要功能，未完成标记不表示这些功能缺失：
  - `LanWebServer`：手机端 HTTP 服务器（只提供视频流和控制接口，页面改为公网静态托管）。`LanTls` 不再需要。
  - `QrPairing`、`RememberedBrowsers`、`TouchLease`：扫码配对、记住已配对浏览器、单一控制端。
  - `EncodedVideoSink`、`CompressedVideoFrame`：从媒体层接出不解码的码流，作为 `WebMediaSink` 的基础。
  - 触摸坐标换算，以及浏览器端统计面板（参考 `window.wheelplayStats`）。
  - 不移植 WheelPlay 的代码：WebRTC 原生代码（`rtc_bridge.cpp`、libdatachannel）、`<video>` 转画布渲染、JPEG 兼容模式、浏览器音频；这项移植决定不表示当前 TiPlay 没有自己的浏览器音频实现。
- [x] 增加"手机 + 浏览器"运行模式：跳过 BYD HUD、仪表、ADB、方向盘按键等车机专属功能。当前产品配置固定选择该模式，界面没有切换开关。
- **热点地址**（2026-10-09）：
  - [x] 2026-10-09 主设置菜单第一项为"热点地址"；当前位于主设置的安卓热点网络配置内，四种方式（说明见 [HOTSPOT_ADDRESS.md](HOTSPOT_ADDRESS.md)），都立即生效、不重新连接：
    - 无（默认；此前名为“无特权”）：不加地址，不需要 root。适用于其他车机浏览器，或手机热点网段本身就在 100.64.0.0/10 内。
    - Root：`ip addr` 加地址；离开这个方式时删除。
    - VPN（用户确认的简短标签）：只持有地址的 VPN，不需要 root 和 Shizuku；Android 14（2025-01 补丁起）和 15 以上很可能无效，
      设置里会提示，并建议改用 `169.254.220.253`。
    - Shizuku：免 root，见下面"免 root"。离开这个方式时地址删不掉，热点重启后消失。
    - 旧的开关（`hotspot_extra_address_enabled`）自动迁移：开 → Root，关 → 无。
  - “无”方式显示当前热点 IP；不在 100.64.0.0/10 内时，提示"特斯拉浏览器很可能无法访问"。
    依据：特斯拉浏览器在车内直接拦截 10/8、172.16/12、192.168/16、127/8 的访问（报告 `334dac05`、`b549281c`、`1d728b90`），
    直接访问 IPv6 地址报 `ERR_ACCESS_DENIED`，100.64.0.0/10 未被本地拦截。
  - Root／Shizuku 地址默认 `100.109.220.253/32`，可修改，限 100.64.0.0/10；VPN 地址限 169.254.0.0/16。特斯拉浏览器能否访问 VPN 的链路本地地址仍待实测。
  - 网卡名不要写死 `wlan2`，按当前热点网卡的地址查找。热点重启后地址会消失，Root 和 Shizuku 方式会自动重新添加。
  - **免 root（2026-10-09 实测）**：shell 用户（uid 2000，和免 root 的 Shizuku 相同）调用 `network_management` 服务的
    `setInterfaceConfig("wlan2:tp", 100.109.220.253/32)`，成功把地址加到 wlan2，热点原地址 `10.176.81.135/24` 不受影响
    （Android 16，SDK 36，安全补丁 2026-07-01；工具见 [shell-address](../tools/shell-address/README.md)）。
    - 原理：shell 没有 `CAP_NET_ADMIN`，但有 `CONNECTIVITY_INTERNAL`，`NetworkManagementService.setInterfaceConfig` 接受它，
      再以 system 身份让 netd 加地址。Android 17 源码（`android-17.0.0_r1`）这条链没有变化。
    - 网卡名必须带别名（`wlan2:tp`）。不带别名时系统会先清空该网卡的 IPv4 地址，热点上的设备全部断网。
    - shell 只能加、不能删（删除需要 `NETWORK_STACK`）；热点重启后地址消失，由 TiPlay 自动补加。
    - Shizuku 官方 v13.6.0 在 Android 17 上授权新应用有已知问题（issue #2180），TiPlay 直接用 `ShizukuBinderWrapper`
      调系统服务，不用 UserService。Shizuku 每次手机重启后要重新启动，无线调试只在手机连着 Wi-Fi 时可用。
    - [x] 已实现为"Shizuku"方式（Shizuku API 13.1.5）。用到的隐藏接口在 Android 17 的 hiddenapi 名单里都允许
      targetSdk 37 调用，唯一不允许的 `LinkAddress` 构造函数（`@SystemApi`）改用公开的 `LinkAddress.CREATOR` 生成；
      事务号取自系统自己的 `Stub.Proxy`，不写死。
    - VpnService 的 tun 地址：已做成"VPN"方式（标签按用户确认保持简短，适用性限制仍保留），待车上实测。Android 14（2025-01 补丁起）和 15 以上
      会丢弃从热点进来、发往 VPN 地址的包（CVE-2024-49734）；169.254 链路本地地址被豁免，但特斯拉是否放行 169.254 的 HTTP 还没测。
    - Android 17 + targetSdk 37：接受热点设备的连接需要 `ACCESS_LOCAL_NETWORK` 权限，用哪种方式加地址都一样。
  - [ ] 用特斯拉浏览器访问 shell 加上的 `http://100.109.220.253:8080`，确认和 root 加的地址效果相同。
  - [ ] 车上实测 Shizuku 方式：热点重启后自动补加；Android 17 上 Shizuku 授权 TiPlay 是否正常。
  - [ ] 车上实测 VPN 方式：
    - [ ] 特斯拉浏览器能否打开 `http://169.254.220.253:8080`（受影响的 Android 版本只剩这个范围）。
    - [ ] 未打 2025-01 补丁的 Android 14 或更早的手机上，`100.109.220.253` 能否打开。
    - [ ] VPN 开着时 iPhone 的无线 CarPlay 连接和 TiPlay 自己的网络是否正常。
  - 监听端口默认 8080，可在主设置的热点地址行填写 address:port（端口 1024–65535，不需要 iptables 重定向）；安卓端修改立即应用，配对码保留；网页不会收到主动端点通知或自动迁移。用户在网页点击“断开连接”，手动修改“安卓地址”后点击“连接”，或打开手机复制的新配对链接；旧书签与保存地址不会自动更新。Root／Shizuku 地址限 100.64.0.0/10，VPN 限 169.254.0.0/16。视频和控制使用同一 HTTP 端口。
- 不依赖 root 的备选（没有可用的私有地址绕过方式时）：云端中转，延迟 +100 ms 以上、双向流量约 7 GB/小时（8 Mbps），
  在国内需使用能直接访问的服务器（`workers.dev` 在国内无法直连）。
