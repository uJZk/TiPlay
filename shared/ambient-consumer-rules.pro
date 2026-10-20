# Entry point launched by app_process from the installed application classpath.
-keep class com.shilapi.xcertplay.hud.BydAmbientLightTool {
    public static void main(java.lang.String[]);
}
-keep class com.shilapi.xcertplay.hud.BydCallPopupTool {
    public static void main(java.lang.String[]);
}
-keep class com.shilapi.xcertplay.transport.IphoneUsbGrantTool {
    public static void main(java.lang.String[]);
}
# The pinned WebRTC AAR calls Java classes/methods by their JNI names.
-keep class org.webrtc.** { *; }
