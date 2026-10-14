# Buffered music in the car browser

Phone + car browser sessions always offer CarPlay enhanced buffering when CarPlay audio is enabled; there is no buffered-music setting in the product menus. Buffered playback starts only if the iPhone accepts `mainBuffered` and sets up a type-103 stream. Disabling CarPlay audio also removes buffered-music and microphone capabilities; the iPhone then owns its Bluetooth audio route to the car. The retained upstream opt-in API is compatibility code, not a product control.

The ordinary AirPlay receiver does not implement AirPlay 2 buffered audio or audio-only casting. CarPlay type 103 is a separate accessory protocol. Its retained implementation comes from [upstream #308](https://github.com/shihabal3amri/DiPlay/pull/308); [upstream #484](https://github.com/shihabal3amri/DiPlay/pull/484) explains why an unrestricted initial TCP fill competes with video and realtime audio.

## Buffer ownership

The browser owns the audible PCM queue. Android decrypts the CarPlay stream, decodes AAC-LC on a bounded worker and relays PCM; buffered music creates no AudioTrack. The browser applies a finite playback reservoir and backpressure to its HTTP reader. Realtime navigation, call and Siri streams use separate queues with a shorter latency bound.

When the iPhone requests Siri or call microphone capture, Android requests the car’s Bluetooth HFP/SCO route. After both capture and playback devices confirm SCO, call/Siri downlink and permitted navigation use only an Android AudioTrack; navigation has a fixed 0.25 gain. Without microphone demand, navigation remains in the browser. Media, alerts, buffered music and ordinary AirPlay audio continue in the browser throughout SCO connection, failure and release. Route changes do not clear their queues, replace the music HTTP body or restart their decoders. Android captures only the verified SCO input, with no browser or handset microphone fallback and no TiPlay software AEC. Speech/guidance returns to browser ownership only after actual SCO release. See [audio and microphone routing](TESLA_BROWSER.md#audio-and-microphone) for route and permission limits.

Android retains a small relay/preload window to preserve the upstream pause/resume contract. It does not accumulate the upstream two-minute music buffer for the browser product. A full relay pauses TCP intake; intake is additionally paced rather than racing the video connection. A stalled browser subscription is retired rather than dropping arbitrary buffered music frames. Losing the browser or switching the source clears the browser playback state.

Pause and FLUSHBUFFERED stop the current decoder and send a browser stream reset. Retained compressed preload can be decoded again on resume. Stream callbacks are ordered against pause, flush and close; retired control sessions cannot reclaim the shared buffered stream. Replacing an AirPlay picture/video source lends it the browser output and restores retained CarPlay audio ownership afterwards.

## Wire timing contract

The offer must carry both mainBufferedInfo and a type-103 AAC-LC media format. The session enables mainBuffered only when the iPhone proposes it. SETUP carries shk, ct=4 and spf=1024; only the control peer can claim its TCP listener. The response advertises the enforced relay byte limit.

Frames have a two-byte length, a twelve-byte RTP header, authenticated AAC payload and an eight-byte nonce. RTP timestamps advance by 1024 samples. Malformed packetization and authentication failures do not create audio renderers.

| Control | Receiver behavior |
| --- | --- |
| SETRATE with rate 1 | Begin at the requested RTP sample and return a timing anchor. |
| GETANCHOR | Return the current anchor. |
| SETRATEANCHORTIME with rate 0 | Pause and clear the browser output queue. |
| FLUSHBUFFERED | Discard compressed frames before the new timestamp and reset output. |

networkTimeSecs uses the 1970 epoch; networkTimeFrac is a 64-bit fraction. Feedback reports the receiver's estimated audible position. The browser transport does not yet measure the actual speaker clock against that anchor, so progress/seek timing remains an estimate rather than a precise synchronization guarantee.

## Limits

AAC-LC is supported for buffered music; Apple Music lossless and spatial audio are not advertised. Apps that do not negotiate mainBuffered retain normal CarPlay audio. A finite browser buffer cannot fix a connection whose sustained throughput is below the media bitrate. PCM relay uses more bandwidth than the compressed iPhone stream; the bounded buffers and pacing protect latency but do not promise uninterrupted playback.

Source-level tests exercise authenticated framing, local limits, pause/resume ownership and teardown. The browser audio path still needs physical iPhone/browser checks for Apple Music pause/resume, track changes, navigation ducking and call/Siri interruption. Historical native head-unit measurements are available from the upstream pull requests and do not establish browser behavior.
