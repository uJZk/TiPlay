#!/usr/bin/env python3
"""Compile the probe against real WebRTC APIs with isolated product signature stubs.

This checks Java/API structure and pure fixture bookkeeping, not product Kotlin,
Android execution, JNI, media delivery, or source-rate native behavior.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[2]
PACKAGE = "com.shilapi.xcertplay.web"
STUBS = {
    "BrowserRtcVideoPolicy.java": """package com.shilapi.xcertplay.web;
import java.util.*;
class BrowserRtcVideoPolicy { static class Codec { Codec(String name, Map<String,String> parameters) {} } }
""",
    "WebVideoRecord.java": """package com.shilapi.xcertplay.web;
class WebVideoRecord {
  WebVideoRecord(int kind,int flags,int codec,int sequence,int epoch,long timestamp,
                byte[] payload,byte[] prefix,long queuedAt,Long captureAt,Object sourceCapture) {}
}
""",
    "WebJson.java": """package com.shilapi.xcertplay.web;
class WebJson { static final WebJson INSTANCE=new WebJson(); String write(Object value){return "";} }
""",
    "BrowserRtcVideoTrack.java": """package com.shilapi.xcertplay.web;
import java.util.*;
import kotlin.Unit;
import kotlin.jvm.functions.*;
import org.webrtc.*;
class BrowserRtcVideoTrack {
  BrowserRtcVideoTrack(List<BrowserRtcVideoPolicy.Codec> offered,Function0<Unit> key,
                      Function1<VideoFrame,Unit> capture,Function0<Long> clock) {}
  VideoTrack attach(PeerConnectionFactory factory){return null;}
  VideoCodecInfo[] getSupportedCodecs(){return null;}
  VideoEncoderFactory.VideoEncoderSelector getEncoderSelector(){return null;}
  VideoEncoder createEncoder(VideoCodecInfo info){return null;}
  Map<String,Object> diagnostics(){return null;}
  Map<String,Object> flowDiagnostics(){return null;}
  void negotiated(String sdp){}
  boolean configure(WebVideoRecord record){return false;}
  boolean offer(WebVideoRecord record){return false;}
  boolean awaitInput(long milliseconds){return false;}
  String getFailure(){return null;}
  String pollFailure(){return null;}
  void disable(String reason){}
  void close(){}
}
""",
    "ProbeFixtureCheck.java": """package com.shilapi.xcertplay.web;
import java.util.concurrent.*;
public class ProbeFixtureCheck {
  public static void main(String[] args) throws Exception {
    CompletableFuture<Long> heartbeat=new CompletableFuture<>(),stage=new CompletableFuture<>();
    NativeVideoProbe.controlEchoes.put("heartbeat",heartbeat);
    NativeVideoProbe.controlEchoes.put("stage",stage);
    NativeVideoProbe.completeControlEcho("stage",30);
    if(!stage.isDone()||heartbeat.isDone()||stage.get()!=30L)throw new AssertionError("Echo routing mixed concurrent checks");
    NativeVideoProbe.completeControlEcho("heartbeat",40);
    NativeVideoProbe.completeControlEcho("retired-message",50);
    if(heartbeat.get()!=40L||!NativeVideoProbe.controlEchoes.isEmpty())throw new AssertionError("Echo owner did not retire");
    NativeVideoProbe.beginSourcePhase("old");
    NativeVideoProbe.recordSourceInput(new byte[3],10);
    NativeVideoProbe.recordSourceInput(new byte[7],20);
    if(NativeVideoProbe.sourceFrames.get()!=2||NativeVideoProbe.sourceBytes.get()!=10||
       NativeVideoProbe.sourceFirstNanos!=10||NativeVideoProbe.sourceLastNanos!=20)throw new AssertionError("Source accounting lost input time or bytes");
    NativeVideoProbe.beginSourcePhase("replacement");
    if(NativeVideoProbe.sourceFrames.get()!=0||NativeVideoProbe.sourceBytes.get()!=0||
       NativeVideoProbe.sourceFirstNanos!=0||NativeVideoProbe.sourceLastNanos!=0)throw new AssertionError("Source phase retained retired counters");
    try { NativeVideoProbe.statCount(new java.util.HashMap<>(),"framesReceived"); throw new AssertionError("Missing RTP counter became zero"); }
    catch(IllegalStateException expected) {}
    java.util.Map<String,Object> before=new java.util.HashMap<>(),after=new java.util.HashMap<>();
    before.put("statsId","receiver");before.put("ssrc",1L);before.put("statsTimestampUs",1.0);
    before.put("framesReceived",1L);before.put("bytesReceived",100L);before.put("packetsReceived",1L);
    after.putAll(before);after.put("statsTimestampUs",2.0);after.put("framesReceived",61L);after.put("bytesReceived",1000L);after.put("packetsReceived",100L);
    NativeVideoProbe.validateRtpPhase(before,after,"receiver",60);
    after.put("ssrc",2L);
    try { NativeVideoProbe.validateRtpPhase(before,after,"receiver",60); throw new AssertionError("Retired receiver became current baseline"); }
    catch(Exception expected) {}
    System.out.println("fixture bookkeeping checks passed");
  }
}
""",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--webrtc-aar", type=Path, required=True)
    parser.add_argument("--android-sdk", type=Path, required=True)
    parser.add_argument("--java-home", type=Path, required=True)
    parser.add_argument("--kotlin-stdlib", type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "linux":
        parser.error("Run local compilation through Wlsc or another Linux container")
    work = args.work_dir.resolve()
    source, classes = work / "signature-stubs", work / "classes"
    source.mkdir(parents=True, exist_ok=True)
    classes.mkdir(exist_ok=True)
    for name, text in STUBS.items():
        (source / name).write_text(text)
    jar = work / "webrtc.jar"
    with zipfile.ZipFile(args.webrtc_aar) as archive:
        jar.write_bytes(archive.read("classes.jar"))
    android = sorted(args.android_sdk.glob("platforms/*/android.jar"))[-1]
    classpath = os.pathsep.join(map(str, (jar, android, args.kotlin_stdlib)))
    subprocess.run([str(args.java_home / "bin/javac"), "-source", "8", "-target", "8",
                    "-cp", classpath, "-d", str(classes),
                    *map(str, source.glob("*.java")),
                    str(ROOT / "tests/native/NativeVideoProbe.java")], check=True)
    subprocess.run([str(args.java_home / "bin/java"), "-cp",
                    os.pathsep.join((str(classes), classpath)), PACKAGE + ".ProbeFixtureCheck"], check=True)
    print(json.dumps({"actualWebRtcJavaApiCompiled": True, "productSignaturesStubbed": True,
                      "pureFixtureBookkeepingChecked": True, "androidNativeRuntimeVerified": False}))


if __name__ == "__main__":
    main()
