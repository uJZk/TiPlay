/* SPDX-License-Identifier: GPL-3.0-only
 * Thin stable-C-API bridge. libdatachannel owns ICE/DTLS/SRTP/Opus packetization;
 * this module never captures, decodes, encodes or rewrites an audio payload. */
#include <jni.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <fcntl.h>
#include <unistd.h>
#include "rtc.h"

#define SLOT_LIMIT 16
#define SDP_LIMIT (48 * 1024)
#define PACKET_LIMIT 65479

typedef struct {
    pthread_mutex_t mutex;
    pthread_cond_t changed;
    int pc;
    int tracks[SLOT_LIMIT];
    int count;
    int cancelled;
    int failed;
    int gathered;
} AudioPeer;

static void throw_state(JNIEnv *env, const char *message) {
    jclass type = (*env)->FindClass(env, "java/lang/IllegalStateException");
    if (type) (*env)->ThrowNew(env, type, message);
}
static AudioPeer *peer(jlong value) { return (AudioPeer *)(intptr_t)value; }
static void state_changed(int pc, rtcState state, void *ptr) {
    (void)pc;
    AudioPeer *p = ptr;
    if (!p) return;
    pthread_mutex_lock(&p->mutex);
    if (state == RTC_FAILED || state == RTC_CLOSED) p->failed = 1;
    pthread_cond_broadcast(&p->changed);
    pthread_mutex_unlock(&p->mutex);
}
static void gathered(int pc, rtcGatheringState state, void *ptr) {
    (void)pc;
    AudioPeer *p = ptr;
    if (!p || state != RTC_GATHERING_COMPLETE) return;
    pthread_mutex_lock(&p->mutex);
    p->gathered = 1;
    pthread_cond_broadcast(&p->changed);
    pthread_mutex_unlock(&p->mutex);
}
static uint32_t random_ssrc(void) {
    uint32_t result = 0;
    int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return 0;
    ssize_t n = read(fd, &result, sizeof(result));
    close(fd);
    return n == sizeof(result) ? result : 0;
}
static pthread_once_t init_once = PTHREAD_ONCE_INIT;
static void initialize_logging(void) { rtcInitLogger(RTC_LOG_NONE, NULL); }
static void destroy(AudioPeer *p) {
    if (!p) return;
    if (p->pc >= 0) {
        /* Unregister uses synchronized callbacks and waits for in-flight calls. */
        rtcSetStateChangeCallback(p->pc, NULL);
        rtcSetGatheringStateChangeCallback(p->pc, NULL);
        rtcSetUserPointer(p->pc, NULL);
        for (int i = 0; i < p->count; ++i) rtcDeleteTrack(p->tracks[i]);
        rtcClosePeerConnection(p->pc);
        rtcDeletePeerConnection(p->pc);
    }
    pthread_cond_destroy(&p->changed);
    pthread_mutex_destroy(&p->mutex);
    free(p);
}
JNIEXPORT jlong JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeCreate
  (JNIEnv *env, jclass type, jobjectArray mids, jintArray payloads) {
    (void)type;
    pthread_once(&init_once, initialize_logging);
    jsize count = (*env)->GetArrayLength(env, mids);
    if (count < 1 || count > SLOT_LIMIT || (*env)->GetArrayLength(env, payloads) != count) {
        throw_state(env, "invalid-audio-slots"); return 0;
    }
    AudioPeer *p = calloc(1, sizeof(*p));
    if (!p) { throw_state(env, "audio-native-allocation"); return 0; }
    p->pc = -1;
    pthread_mutex_init(&p->mutex, NULL);
    pthread_condattr_t attr;
    pthread_condattr_init(&attr); pthread_condattr_setclock(&attr, CLOCK_MONOTONIC);
    pthread_cond_init(&p->changed, &attr); pthread_condattr_destroy(&attr);
    rtcConfiguration config = {0};
    config.disableAutoNegotiation = true;
    config.forceMediaTransport = true;
    config.mtu = 1280;
    p->pc = rtcCreatePeerConnection(&config); /* No STUN, TURN, proxy or capture. */
    if (p->pc < 0) { destroy(p); throw_state(env, "audio-native-peer-create"); return 0; }
    rtcSetUserPointer(p->pc, p);
    rtcSetStateChangeCallback(p->pc, state_changed);
    rtcSetGatheringStateChangeCallback(p->pc, gathered);
    jint pt[SLOT_LIMIT]; (*env)->GetIntArrayRegion(env, payloads, 0, count, pt);
    if ((*env)->ExceptionCheck(env)) { destroy(p); return 0; }
    for (int i = 0; i < count; ++i) {
        jstring mid = (*env)->GetObjectArrayElement(env, mids, i);
        const char *text = mid ? (*env)->GetStringUTFChars(env, mid, NULL) : NULL;
        uint32_t ssrc = random_ssrc();
        if (!text || !ssrc || pt[i] < 0 || pt[i] > 127) {
            if (text) (*env)->ReleaseStringUTFChars(env, mid, text);
            if (mid) (*env)->DeleteLocalRef(env, mid);
            destroy(p); throw_state(env, "invalid-audio-slot"); return 0;
        }
        rtcTrackInit track = {0};
        track.direction = RTC_DIRECTION_SENDONLY; track.codec = RTC_CODEC_OPUS;
        track.payloadType = pt[i]; track.ssrc = ssrc; track.mid = text;
        track.name = "TiPlay audio"; track.msid = "tiplay-audio"; track.trackId = text;
        track.profile = "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1";
        int id = rtcAddTrackEx(p->pc, &track);
        (*env)->ReleaseStringUTFChars(env, mid, text); (*env)->DeleteLocalRef(env, mid);
        if (id < 0) { destroy(p); throw_state(env, "audio-native-track-create"); return 0; }
        p->tracks[i] = id; p->count++;
        rtcPacketizerInit packetizer = {0};
        packetizer.ssrc = ssrc; packetizer.cname = "tiplay-audio";
        packetizer.payloadType = (uint8_t)pt[i]; packetizer.clockRate = 48000;
        packetizer.sequenceNumber = (uint16_t)(ssrc >> 16);
        if (rtcSetOpusPacketizer(id, &packetizer) < 0 || rtcChainRtcpSrReporter(id) < 0 ||
            rtcChainRtcpNackResponder(id, 128) < 0) {
            destroy(p); throw_state(env, "audio-native-packetizer-create"); return 0;
        }
    }
    return (jlong)(intptr_t)p;
}
JNIEXPORT jstring JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeAnswer
  (JNIEnv *env, jclass type, jlong handle, jstring offer) {
    (void)type;
    AudioPeer *p = peer(handle);
    if (!p || !offer || (*env)->GetStringUTFLength(env, offer) > SDP_LIMIT) {
        throw_state(env, "invalid-audio-offer"); return NULL;
    }
    const char *sdp = (*env)->GetStringUTFChars(env, offer, NULL);
    if (!sdp) return NULL;
    int error = rtcSetRemoteDescription(p->pc, sdp, "offer");
    (*env)->ReleaseStringUTFChars(env, offer, sdp);
    if (error < 0 || rtcSetLocalDescription(p->pc, "answer") < 0) {
        throw_state(env, "audio-native-description"); return NULL;
    }
    struct timespec limit; clock_gettime(CLOCK_MONOTONIC, &limit); limit.tv_sec += 5;
    pthread_mutex_lock(&p->mutex);
    while (!p->gathered && !p->cancelled && !p->failed) {
        if (pthread_cond_timedwait(&p->changed, &p->mutex, &limit) != 0) break;
    }
    int success = p->gathered && !p->cancelled && !p->failed;
    pthread_mutex_unlock(&p->mutex);
    if (!success) { throw_state(env, "audio-native-answer-timeout-or-cancelled"); return NULL; }
    int size = rtcGetLocalDescription(p->pc, NULL, 0);
    if (size < 1 || size > SDP_LIMIT) { throw_state(env, "audio-native-answer-size"); return NULL; }
    char *answer = malloc((size_t)size);
    if (!answer) { throw_state(env, "audio-native-allocation"); return NULL; }
    if (rtcGetLocalDescription(p->pc, answer, size) < 0) {
        free(answer); throw_state(env, "audio-native-answer-read"); return NULL;
    }
    jstring result = (*env)->NewStringUTF(env, answer); free(answer); return result;
}
JNIEXPORT void JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeCancel
  (JNIEnv *env, jclass type, jlong handle) {
    (void)env; (void)type; AudioPeer *p = peer(handle); if (!p) return;
    pthread_mutex_lock(&p->mutex); p->cancelled = 1;
    pthread_cond_broadcast(&p->changed); pthread_mutex_unlock(&p->mutex);
}
JNIEXPORT void JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeDelete
  (JNIEnv *env, jclass type, jlong handle) { (void)env; (void)type; destroy(peer(handle)); }
JNIEXPORT jboolean JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeReady
  (JNIEnv *env, jclass type, jlong handle, jint slot) {
    (void)env; (void)type; AudioPeer *p = peer(handle);
    return p && slot >= 0 && slot < p->count && rtcIsOpen(p->tracks[slot]);
}
JNIEXPORT jboolean JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeFailed
  (JNIEnv *env, jclass type, jlong handle) {
    (void)env; (void)type; AudioPeer *p = peer(handle); if (!p) return JNI_TRUE;
    pthread_mutex_lock(&p->mutex); int result = p->failed || p->cancelled;
    pthread_mutex_unlock(&p->mutex); return result ? JNI_TRUE : JNI_FALSE;
}
JNIEXPORT void JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeSend
  (JNIEnv *env, jclass type, jlong handle, jint slot, jlong timestamp, jbyteArray payload) {
    (void)type; AudioPeer *p = peer(handle);
    jsize size = payload ? (*env)->GetArrayLength(env, payload) : 0;
    if (!p || slot < 0 || slot >= p->count || size < 1 || size > PACKET_LIMIT) {
        throw_state(env, "invalid-audio-packet"); return;
    }
    char *bytes = malloc((size_t)size);
    if (!bytes) { throw_state(env, "audio-native-allocation"); return; }
    (*env)->GetByteArrayRegion(env, payload, 0, size, (jbyte *)bytes);
    if ((*env)->ExceptionCheck(env)) { free(bytes); return; }
    int result = rtcSetTrackRtpTimestamp(p->tracks[slot], (uint32_t)timestamp);
    if (result >= 0) result = rtcSendMessage(p->tracks[slot], bytes, size);
    free(bytes);
    if (result < 0) throw_state(env, "audio-native-send");
}
