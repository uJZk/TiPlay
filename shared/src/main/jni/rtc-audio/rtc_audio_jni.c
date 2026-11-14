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
#include <limits.h>
#include <stdio.h>
#include <strings.h>
#include <unistd.h>
#include <arpa/inet.h>
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
    int connection_state;
    int ice_state;
    int gathering_state;
    int signaling_state;
    int remote_description_result;
    int local_description_result;
    unsigned int connection_changes;
    unsigned int ice_changes;
    unsigned int gathering_changes;
    unsigned int signaling_changes;
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
    p->connection_state = (int)state;
    if (p->connection_changes < 65535) p->connection_changes++;
    if (state == RTC_FAILED || state == RTC_CLOSED) p->failed = 1;
    pthread_cond_broadcast(&p->changed);
    pthread_mutex_unlock(&p->mutex);
}
static void ice_changed(int pc, rtcIceState state, void *ptr) {
    (void)pc;
    AudioPeer *p = ptr;
    if (!p) return;
    pthread_mutex_lock(&p->mutex);
    p->ice_state = (int)state;
    if (p->ice_changes < 65535) p->ice_changes++;
    pthread_mutex_unlock(&p->mutex);
}
static void gathered(int pc, rtcGatheringState state, void *ptr) {
    (void)pc;
    AudioPeer *p = ptr;
    if (!p) return;
    pthread_mutex_lock(&p->mutex);
    p->gathering_state = (int)state;
    if (p->gathering_changes < 65535) p->gathering_changes++;
    if (state == RTC_GATHERING_COMPLETE) p->gathered = 1;
    pthread_cond_broadcast(&p->changed);
    pthread_mutex_unlock(&p->mutex);
}
static void signaling_changed(int pc, rtcSignalingState state, void *ptr) {
    (void)pc;
    AudioPeer *p = ptr;
    if (!p) return;
    pthread_mutex_lock(&p->mutex);
    p->signaling_state = (int)state;
    if (p->signaling_changes < 65535) p->signaling_changes++;
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
        rtcSetIceStateChangeCallback(p->pc, NULL);
        rtcSetGatheringStateChangeCallback(p->pc, NULL);
        rtcSetSignalingStateChangeCallback(p->pc, NULL);
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
    p->connection_state = -1;
    p->ice_state = -1;
    p->gathering_state = -1;
    p->signaling_state = -1;
    p->remote_description_result = INT_MIN;
    p->local_description_result = INT_MIN;
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
    rtcSetIceStateChangeCallback(p->pc, ice_changed);
    rtcSetGatheringStateChangeCallback(p->pc, gathered);
    rtcSetSignalingStateChangeCallback(p->pc, signaling_changed);
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
    pthread_mutex_lock(&p->mutex);
    p->remote_description_result = error;
    pthread_mutex_unlock(&p->mutex);
    int local_error = INT_MIN;
    if (error >= 0) local_error = rtcSetLocalDescription(p->pc, "answer");
    pthread_mutex_lock(&p->mutex);
    p->local_description_result = local_error;
    pthread_mutex_unlock(&p->mutex);
    if (error < 0 || local_error < 0) {
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
JNIEXPORT jlong JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeStates
  (JNIEnv *env, jclass type, jlong handle) {
    (void)env; (void)type; AudioPeer *p = peer(handle); if (!p) return 0;
    pthread_mutex_lock(&p->mutex);
    uint64_t result = (uint64_t)(p->connection_state + 1) | ((uint64_t)(p->ice_state + 1) << 4) |
        ((uint64_t)p->connection_changes << 8) | ((uint64_t)p->ice_changes << 24);
    pthread_mutex_unlock(&p->mutex);
    return (jlong)result;
}

/* Fixed classifications only. SDP credentials and candidate addresses never cross JNI. */
static int description_type(const char *type) {
    if (!strcmp(type, "offer")) return 1;
    if (!strcmp(type, "answer")) return 2;
    if (!strcmp(type, "pranswer")) return 3;
    if (!strcmp(type, "rollback")) return 4;
    return 5;
}
static void candidate_summary(const char *candidate, jint *summary) {
    summary[3] = candidate[0] != '\0';
    char foundation[64], protocol[16], address[256], kind[16];
    unsigned int component, priority, port;
    if (sscanf(candidate, "%63s %u %15s %u %255s %u typ %15s", foundation,
               &component, protocol, &priority, address, &port, kind) != 7) return;
    if (!strcasecmp(kind, "host")) summary[0] = 1;
    else if (!strcasecmp(kind, "srflx")) summary[0] = 2;
    else if (!strcasecmp(kind, "prflx")) summary[0] = 3;
    else if (!strcasecmp(kind, "relay")) summary[0] = 4;
    if (!strcasecmp(protocol, "udp")) summary[1] = 1;
    else if (!strcasecmp(protocol, "tcp")) summary[1] = 2;
    unsigned char binary[16];
    if (inet_pton(AF_INET, address, binary) == 1) summary[2] = 1;
    else if (inet_pton(AF_INET6, address, binary) == 1) summary[2] = 2;
    else {
        size_t length = strlen(address);
        if (length > 6 && !strcasecmp(address + length - 6, ".local")) summary[2] = 3;
    }
}
JNIEXPORT jintArray JNICALL Java_com_shilapi_xcertplay_web_NativeRtcAudioPeer_nativeDiagnostics
  (JNIEnv *env, jclass type, jlong handle) {
    (void)type;
    AudioPeer *p = peer(handle);
    if (!p) return (*env)->NewIntArray(env, 0);
    /* Keep this fixed layout in sync with nativeAudioDiagnostics() in Kotlin. */
    jint values[21] = {0};
    pthread_mutex_lock(&p->mutex);
    values[0] = p->connection_state; values[1] = p->ice_state;
    values[2] = (jint)p->connection_changes; values[3] = (jint)p->ice_changes;
    values[4] = p->gathering_state; values[5] = p->signaling_state;
    values[6] = (jint)p->gathering_changes; values[7] = (jint)p->signaling_changes;
    values[8] = p->remote_description_result; values[9] = p->local_description_result;
    pthread_mutex_unlock(&p->mutex);
    /* Official getters may acquire library locks; never call them under our callback mutex. */
    char local_type[16] = {0}, remote_type[16] = {0};
    if (rtcGetLocalDescriptionType(p->pc, local_type, sizeof(local_type)) >= 0)
        values[10] = description_type(local_type);
    if (rtcGetRemoteDescriptionType(p->pc, remote_type, sizeof(remote_type)) >= 0)
        values[11] = description_type(remote_type);
    char local[2048] = {0}, remote[2048] = {0};
    int result = rtcGetSelectedCandidatePair(p->pc, local, sizeof(local), remote, sizeof(remote));
    values[12] = result >= 0 ? RTC_ERR_SUCCESS : result;
    if (result >= 0) {
        candidate_summary(local, values + 13);
        candidate_summary(remote, values + 17);
    }
    jintArray output = (*env)->NewIntArray(env, 21);
    if (output) (*env)->SetIntArrayRegion(env, output, 0, 21, values);
    return output;
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
