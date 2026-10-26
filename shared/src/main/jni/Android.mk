LOCAL_PATH := $(call my-dir)

include $(CLEAR_VARS)
LOCAL_MODULE := xcertplay_i2c
LOCAL_SRC_FILES := linux_i2c_jni.c
include $(BUILD_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := tiplay_soxr
LOCAL_SRC_FILES := soxr_jni.c soxr/soxr.c soxr/data-io.c soxr/vr32.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)/soxr
LOCAL_CFLAGS := -O3 -DNDEBUG -DSOXR_LIB -ffp-contract=off
LOCAL_LDLIBS := -lm
include $(BUILD_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := tiplay_airplay
LOCAL_SRC_FILES := airplay/fairplay_jni.c airplay/playfair/playfair.c \
    airplay/playfair/hand_garble.c airplay/playfair/modified_md5.c \
    airplay/playfair/omg_hax.c airplay/playfair/sap_hash.c
LOCAL_CFLAGS := -O2 -fno-strict-aliasing
LOCAL_LDLIBS := -lm
include $(BUILD_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := local_hotspot_radio
LOCAL_SRC_FILES := local_hotspot_radio.c
LOCAL_CFLAGS := -Wall -Wextra -Werror
include $(BUILD_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := speex_echo
LOCAL_SRC_FILES := speex_echo_jni.c \
    speexdsp/mdf.c speexdsp/preprocess.c speexdsp/fftwrap.c \
    speexdsp/kiss_fft.c speexdsp/kiss_fftr.c speexdsp/filterbank.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)/speexdsp $(LOCAL_PATH)/speexdsp/include
LOCAL_CFLAGS := -O2 -DFLOATING_POINT -DUSE_KISS_FFT -DEXPORT= -Wno-unused-parameter
LOCAL_LDLIBS := -lm
include $(BUILD_SHARED_LIBRARY)

# Fixed libdatachannel media transport, built by scripts/rtc-audio/build.py.
include $(CLEAR_VARS)
LOCAL_MODULE := datachannel
LOCAL_SRC_FILES := rtc-audio/prebuilt/$(TARGET_ARCH_ABI)/libdatachannel.so
include $(PREBUILT_SHARED_LIBRARY)

include $(CLEAR_VARS)
LOCAL_MODULE := tiplay_rtc_audio
LOCAL_SRC_FILES := rtc-audio/rtc_audio_jni.c
LOCAL_C_INCLUDES := $(LOCAL_PATH)/rtc-audio/include
LOCAL_CFLAGS := -O2 -Wall -Wextra -Werror -DRTC_ENABLE_WEBSOCKET=0 -DRTC_ENABLE_MEDIA=1
LOCAL_SHARED_LIBRARIES := datachannel
LOCAL_LDFLAGS := -Wl,-z,max-page-size=16384 -Wl,-z,common-page-size=16384
include $(BUILD_SHARED_LIBRARY)
