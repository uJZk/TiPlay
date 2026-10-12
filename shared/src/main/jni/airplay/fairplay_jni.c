/* TiPlay AirPlay transport key exchange. GPL-3.0-only. */
#include <jni.h>
#include <string.h>
#include "fairplay_replies.h"
#include "playfair/playfair.h"

JNIEXPORT jbyteArray JNICALL
Java_com_shilapi_xcertplay_receiver_ReceiverFairPlay_reply(JNIEnv *env, jobject self, jbyteArray request) {
    (void)self;
    if (!request) return NULL;
    jsize size = (*env)->GetArrayLength(env, request);
    if (size != 16 && size != 164) return NULL;
    unsigned char bytes[164], out[142];
    (*env)->GetByteArrayRegion(env, request, 0, size, (jbyte *)bytes);
    if (memcmp(bytes, "FPLY", 4) || bytes[4] != 3) return NULL;
    int length;
    if (size == 16) {
        if (bytes[14] > 3) return NULL;
        memcpy(out, reply_message[bytes[14]], 142);
        length = 142;
    } else {
        memcpy(out, fp_header, 12);
        memcpy(out + 12, bytes + 144, 20);
        length = 32;
    }
    jbyteArray result = (*env)->NewByteArray(env, length);
    if (result) (*env)->SetByteArrayRegion(env, result, 0, length, (jbyte *)out);
    return result;
}

JNIEXPORT jbyteArray JNICALL
Java_com_shilapi_xcertplay_receiver_ReceiverFairPlay_decrypt(JNIEnv *env, jobject self,
                                                          jbyteArray handshake, jbyteArray encrypted) {
    (void)self;
    if (!handshake || !encrypted) return NULL;
    if ((*env)->GetArrayLength(env, handshake) != 164 || (*env)->GetArrayLength(env, encrypted) != 72) return NULL;
    unsigned char message[164], input[72], key[16];
    (*env)->GetByteArrayRegion(env, handshake, 0, 164, (jbyte *)message);
    (*env)->GetByteArrayRegion(env, encrypted, 0, 72, (jbyte *)input);
    /* playfair's message modes index four static tables. */
    if (memcmp(message, "FPLY", 4) || message[4] != 3 || message[12] > 3) return NULL;
    playfair_decrypt(message, input, key);
    jbyteArray result = (*env)->NewByteArray(env, 16);
    if (result) (*env)->SetByteArrayRegion(env, result, 0, 16, (jbyte *)key);
    memset(key, 0, sizeof(key));
    return result;
}
