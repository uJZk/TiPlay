#!/usr/bin/env python3
"""Real product Kotlin/JNI sender -> C-API DTLS-SRTP receiver, original Opus bytes."""
import argparse, base64, ctypes as C, json, os, pathlib, select, struct, subprocess, threading
ROOT = pathlib.Path(__file__).resolve().parents[2]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--host-dir',type=pathlib.Path,required=True);p.add_argument('--kotlin-stdlib',type=pathlib.Path,required=True)
a=p.parse_args();host=a.host_dir.resolve()
classes=ROOT/'shared/build/intermediates/built_in_kotlinc/debug/compileDebugKotlin/classes'
probe=host/'probe-classes';probe.mkdir(exist_ok=True)
subprocess.run(['javac','-cp',os.pathsep.join(map(str,[classes,a.kotlin_stdlib])),'-d',str(probe),str(ROOT/'tests/native/EncodedAudioPeerProbe.java')],check=True)
lib=C.CDLL(str(host/'libdatachannel/libdatachannel.so'))
class Config(C.Structure):
 _fields_=[('servers',C.POINTER(C.c_char_p)),('serverCount',C.c_int),('proxy',C.c_char_p),('bind',C.c_char_p),('certificate',C.c_int),('policy',C.c_int),('tcp',C.c_bool),('mux',C.c_bool),('disableAuto',C.c_bool),('forceMedia',C.c_bool),('portBegin',C.c_uint16),('portEnd',C.c_uint16),('mtu',C.c_int),('maxMessage',C.c_int)]
Gather=C.CFUNCTYPE(None,C.c_int,C.c_int,C.c_void_p)
Message=C.CFUNCTYPE(None,C.c_int,C.c_void_p,C.c_int,C.c_void_p)
lib.rtcCreatePeerConnection.argtypes=[C.POINTER(Config)];lib.rtcCreatePeerConnection.restype=C.c_int
lib.rtcAddTrack.argtypes=[C.c_int,C.c_char_p];lib.rtcAddTrack.restype=C.c_int
lib.rtcSetGatheringStateChangeCallback.argtypes=[C.c_int,Gather]
lib.rtcSetMessageCallback.argtypes=[C.c_int,Message]
lib.rtcSetLocalDescription.argtypes=[C.c_int,C.c_char_p]
lib.rtcSetRemoteDescription.argtypes=[C.c_int,C.c_char_p,C.c_char_p]
lib.rtcGetLocalDescription.argtypes=[C.c_int,C.c_void_p,C.c_int]
lib.rtcInitLogger.argtypes=[C.c_int,C.c_void_p];lib.rtcInitLogger(0,None)
config=Config();config.disableAuto=True;config.forceMedia=True;config.mtu=1280
pc=lib.rtcCreatePeerConnection(C.byref(config));assert pc>=0
tracks=[];callbacks=[];ready=threading.Event();received={};failures=[];child=None
fixture=json.loads((ROOT/'tests/web/fixtures/neteq-opus.json').read_text());source=[base64.b64decode(packet) for packet in fixture['packets'][:80]]
@Gather
def gather(peer,state,user):
 if state==2:ready.set()
callbacks.append(gather);lib.rtcSetGatheringStateChangeCallback(pc,gather)
try:
 for slot in range(2):
  media=f'm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:{slot}\r\na=recvonly\r\na=rtcp-mux\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\n'.encode()
  track=lib.rtcAddTrack(pc,media);assert track>=0;tracks.append(track);received[track]={}
  @Message
  def message(track,data,size,user):
   try:
    if size<12:return
    raw=C.string_at(data,size)
    if raw[0]>>6!=2 or raw[1]&127!=111:return
    at=12+(raw[0]&15)*4
    if raw[0]&16:at+=4+struct.unpack_from('>H',raw,at+2)[0]*4
    end=len(raw)-(raw[-1] if raw[0]&32 else 0)
    timestamp=struct.unpack_from('>I',raw,4)[0]
    index=timestamp//960
    if timestamp%960 or index>=len(source) or raw[at:end]!=source[index]:failures.append('encoded payload or source timestamp changed')
    received[track][index]=raw[at:end]
   except Exception as error:failures.append(type(error).__name__)
  callbacks.append(message);lib.rtcSetMessageCallback(track,message)
 assert lib.rtcSetLocalDescription(pc,b'offer')==0
 assert ready.wait(5),'native receiver gathering timed out'
 size=lib.rtcGetLocalDescription(pc,None,0);assert 0<size<=48*1024
 buffer=C.create_string_buffer(size);assert lib.rtcGetLocalDescription(pc,buffer,size)>=0
 command=['java','--enable-native-access=ALL-UNNAMED','-Djava.library.path='+os.pathsep.join(map(str,[host,host/'libdatachannel'])),'-cp',os.pathsep.join(map(str,[probe,classes,a.kotlin_stdlib])),'com.shilapi.xcertplay.web.EncodedAudioPeerProbe',str(ROOT/'tests/web/fixtures/neteq-opus.json')]
 child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 child.stdin.write(base64.b64encode(buffer.value).decode()+'\n');child.stdin.flush()
 assert select.select([child.stdout],[],[],7)[0],'product JNI answer timed out'
 answer=base64.b64decode(child.stdout.readline().strip());assert answer.startswith(b'v=0')
 assert lib.rtcSetRemoteDescription(pc,answer,b'answer')==0
 child.stdin.write('start\n');child.stdin.flush()
 assert select.select([child.stdout],[],[],7)[0],'product sender timed out'
 assert child.stdout.readline().strip()=='sent:160'
 assert not failures,failures
 assert all(len(packets)==80 for packets in received.values()),[len(packets) for packets in received.values()]
 child.stdin.write('close\n');child.stdin.flush();child.wait(timeout=3)
 stderr=child.stderr.read();assert not stderr,stderr
 print(json.dumps({'backend':'actual product Kotlin + C JNI + libdatachannel','tracks':len(tracks),'packetsPerTrack':[len(packets) for packets in received.values()],'originalPayloadBytesVerified':True,'originalRtpTimestampsVerified':True,'decodingOrEncodingPerformed':False,'androidDeviceRuntimeVerified':False}))
finally:
 if child and child.poll() is None:child.kill();child.wait(timeout=3)
 for track in tracks:lib.rtcDeleteTrack(track)
 lib.rtcClosePeerConnection(pc);lib.rtcDeletePeerConnection(pc)
