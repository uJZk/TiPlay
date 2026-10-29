/* SPDX-License-Identifier: GPL-3.0-only */
package com.shilapi.xcertplay.web;

import android.content.Context;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import kotlin.Unit;
import org.webrtc.*;

/**
 * Runs the actual Android AAR and product compressed-video bridge in native RTP loopback.
 * Fixture encoding happens offline; this process never encodes source pictures. The receiver
 * counts depacketized access units and returns test buffers, without codec decoding.
 */
public final class NativeVideoProbe {
  static final String TRIALS = "WebRTC-FrameDropper/Disabled/WebRTC-CongestionWindow/QueueSize:350,MinBitrate:30000,DropFrame:false/";
  static final String SOURCE_RATE_TRIAL = "TiPlay-SourceRateVideo/Enabled/";
  static final int VIDEO_MIN_BITRATE_BPS = 16000000;
  static final int VIDEO_MAX_BITRATE_BPS = 128000000;
  static volatile BrowserRtcVideoTrack currentBridge;
  static final List<DataChannel> dataChannels=new CopyOnWriteArrayList<>();
  static final AtomicInteger decoded = new AtomicInteger();
  static final AtomicInteger keys = new AtomicInteger();
  static final List<String> createdCodecs = new CopyOnWriteArrayList<>();
  static final Set<String> bootstrapSourceHashes = new HashSet<>();
  static final AtomicInteger unexpectedBootstrapOutput = new AtomicInteger();
  static String sha256(byte[] data){try{return hex(java.security.MessageDigest.getInstance("SHA-256").digest(data));}catch(Exception e){throw new IllegalStateException(e);}}
  static DataChannel probeControl;
  static final Map<String,CompletableFuture<Long>> controlEchoes=new ConcurrentHashMap<>();
  static final AtomicLong controlSequence=new AtomicLong();
  static final List<String> controlChecks=new CopyOnWriteArrayList<>();
  static final AtomicInteger controlEchoSendFailures=new AtomicInteger();
  static final AtomicInteger heartbeatSent=new AtomicInteger(),heartbeatCompleted=new AtomicInteger();
  static final List<Long> heartbeatRttNanos=new CopyOnWriteArrayList<>();
  static final List<Map<String,Object>> controlEchoSamples=new CopyOnWriteArrayList<>();
  static final AtomicBoolean heartbeatRunning=new AtomicBoolean();
  static final AtomicReference<String> heartbeatFailure=new AtomicReference<>();
  static Thread heartbeatThread;
  static final List<Map<String,Object>> bundleNegotiations=new ArrayList<>();
  static final List<Map<String,Object>> videoNegotiations=new ArrayList<>();
  static void recordVideoNegotiation(String stage,RtpTransceiver receive,PeerConnection tx,RtpSender sender)throws Exception{
    String mid=receive.getMid(),senderMid=null;
    for(RtpTransceiver t:tx.getTransceivers())if(t.getSender().id().equals(sender.id()))senderMid=t.getMid();
    if(mid==null||!mid.equals(senderMid))throw new Exception("Negotiated sender/receiver video MID mismatch at "+stage);
    Map<String,Object> record=new LinkedHashMap<>();record.put("stage",stage);record.put("mid",mid);videoNegotiations.add(record);
  }
  static void observeControl(DataChannel channel,boolean echo){
    channel.registerObserver(new DataChannel.Observer(){
      public void onBufferedAmountChange(long previous){}
      public void onStateChange(){}
      public void onMessage(DataChannel.Buffer buffer){
        byte[] bytes=new byte[buffer.data.remaining()];buffer.data.get(bytes);
        if(echo){if(!channel.send(new DataChannel.Buffer(java.nio.ByteBuffer.wrap(bytes),buffer.binary)))controlEchoSendFailures.incrementAndGet();}
        else completeControlEcho(new String(bytes,java.nio.charset.StandardCharsets.UTF_8),System.nanoTime());
      }
    });
  }
  static void completeControlEcho(String message,long receivedNanos){CompletableFuture<Long> pending=controlEchoes.remove(message);if(pending!=null)pending.complete(receivedNanos);}
  static void createProbeDataChannels(PeerConnection peer){
    for(String label:Arrays.asList("control","video","audio")){
      DataChannel channel=peer.createDataChannel(label,new DataChannel.Init());dataChannels.add(channel);
      if(label.equals("control")){probeControl=channel;observeControl(channel,false);}
    }
  }
  static boolean allProbeChannelsOpen(){
    return dataChannels.size()==6&&dataChannels.stream().allMatch(c->c.state()==DataChannel.State.OPEN);
  }
  static void checkControl(String stage)throws Exception{
    long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
    while(!allProbeChannelsOpen()&&System.nanoTime()<deadline)Thread.sleep(20);
    if(!allProbeChannelsOpen())throw new Exception("DataChannel did not remain open at "+stage);
    echoControl(stage);
    if(controlEchoSendFailures.get()!=0||heartbeatFailure.get()!=null)throw new Exception("Control echo failed at "+stage+": "+heartbeatFailure.get());
    controlChecks.add(stage);System.out.println("CONTROL_OK "+stage);
  }
  static long echoControl(String stage)throws Exception{
    String message="probe-"+controlSequence.incrementAndGet()+"-"+stage;
    CompletableFuture<Long> completed=new CompletableFuture<>();controlEchoes.put(message,completed);
    long begin=System.nanoTime();String phase=sourcePhase;
    try{
      if(probeControl.state()!=DataChannel.State.OPEN||!probeControl.send(new DataChannel.Buffer(java.nio.ByteBuffer.wrap(message.getBytes(java.nio.charset.StandardCharsets.UTF_8)),false)))throw new Exception("Control send failed at "+stage);
      long end=completed.get(5,TimeUnit.SECONDS),rtt=end-begin;
      Map<String,Object> sample=new LinkedHashMap<>();sample.put("stage",stage);sample.put("phase",phase);sample.put("sentMonotonicNanos",begin);sample.put("receivedMonotonicNanos",end);sample.put("rttNanos",rtt);controlEchoSamples.add(sample);
      return rtt;
    }finally{controlEchoes.remove(message);}
  }
  static void startControlHeartbeat(){
    heartbeatRunning.set(true);
    heartbeatThread=new Thread(()->{
      try{
        while(heartbeatRunning.get()){
          heartbeatSent.incrementAndGet();heartbeatRttNanos.add(echoControl("heartbeat"));heartbeatCompleted.incrementAndGet();
          Thread.sleep(100);
        }
      }catch(Exception failure){heartbeatFailure.set(failure.toString());heartbeatRunning.set(false);}
    },"native-probe-control-heartbeat");
    heartbeatThread.setDaemon(true);heartbeatThread.start();
  }
  static void stopControlHeartbeat()throws Exception{
    heartbeatRunning.set(false);
    if(heartbeatThread!=null){heartbeatThread.join(6000);if(heartbeatThread.isAlive())throw new Exception("Control heartbeat did not retire");}
    if(heartbeatFailure.get()!=null||heartbeatSent.get()!=heartbeatCompleted.get())throw new Exception("Control heartbeat failed: "+heartbeatFailure.get());
  }
  static void recordBundleNegotiation(SessionDescription offer,String stage,boolean dataAnchor)throws Exception{
    String bundleTag=null,applicationMid=null,type=null,mid=null;List<String> types=new ArrayList<>();
    for(String line:offer.description.split("\\r?\\n")){
      if(line.startsWith("a=group:BUNDLE "))bundleTag=line.substring(15).trim().split(" ")[0];
      if(line.startsWith("m=")){type=line.substring(2).split(" ")[0];types.add(type);}
      if(line.startsWith("a=mid:")){mid=line.substring(6);if("application".equals(type))applicationMid=mid;}
    }
    if(bundleTag==null||applicationMid==null||dataAnchor&&!bundleTag.equals(applicationMid))throw new Exception("Unexpected BUNDLE anchor at "+stage);
    Map<String,Object> record=new LinkedHashMap<>();record.put("stage",stage);record.put("bundleTag",bundleTag);record.put("applicationMid",applicationMid);record.put("mediaTypes",types);
    record.put("transportWideExtension",offer.description.contains("draft-holmer-rmcat-transport-wide-cc-extensions-01"));
    record.put("transportCcFeedback",offer.description.contains(" transport-cc"));bundleNegotiations.add(record);
  }
  static class RequestGate {
    final AtomicInteger calls=new AtomicInteger(),accepted=new AtomicInteger();
    final AtomicBoolean pending=new AtomicBoolean();
    final AtomicLong lastAccepted=new AtomicLong(),primedAt=new AtomicLong();
    final List<Long> attemptsAtMs=new CopyOnWriteArrayList<>(),acceptedAtMs=new CopyOnWriteArrayList<>();
    void prime(){long now=System.nanoTime();primedAt.set(now);lastAccepted.set(now);}
    Unit request(){
      calls.incrementAndGet();long now=System.nanoTime(),old=lastAccepted.get();attemptsAtMs.add(TimeUnit.NANOSECONDS.toMillis(now-primedAt.get()));
      if(now-old>=500_000_000L&&lastAccepted.compareAndSet(old,now)){accepted.incrementAndGet();acceptedAtMs.add(TimeUnit.NANOSECONDS.toMillis(now-primedAt.get()));pending.set(true);}
      return Unit.INSTANCE;
    }
  }
  static final AtomicInteger blocked = new AtomicInteger();
  static final AtomicInteger badTimestamps = new AtomicInteger();
  static volatile BufferedWriter nativeLog;
  static final Object digestLock = new Object();
  static java.security.MessageDigest outputDigest;
  static java.security.MessageDigest offeredDigest;
  static final Map<String,Object> lastSenderStats = new LinkedHashMap<>();
  static final Map<String,Object> lastReceiverStats = new LinkedHashMap<>();
  static volatile RtpSender activeSender;
  static volatile RtpReceiver activeReceiver;
  static final AtomicLong sourceBytes=new AtomicLong(),sourceFrames=new AtomicLong();
  static final List<Map<String,Object>> rateSamples=new CopyOnWriteArrayList<>();
  static final List<Map<String,Object>> generationProofs=new ArrayList<>();
  static volatile String sourcePhase="startup";
  static volatile long sourceFirstNanos,sourceLastNanos;
  static void beginSourcePhase(String phase){sourcePhase=phase;sourceBytes.set(0);sourceFrames.set(0);sourceFirstNanos=0;sourceLastNanos=0;}
  static void recordSourceInput(byte[] bytes,long now){if(sourceFirstNanos==0)sourceFirstNanos=now;sourceLastNanos=now;sourceBytes.addAndGet(bytes.length);sourceFrames.incrementAndGet();}
  static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format("%02x",b&255));return out.toString();}
  static class Obs implements PeerConnection.Observer {
    final String name; final CountDownLatch gathered=new CountDownLatch(1), connected=new CountDownLatch(1);
    Obs(String name){this.name=name;}
    public void onSignalingChange(PeerConnection.SignalingState s){}
    public void onIceConnectionChange(PeerConnection.IceConnectionState s){
      System.out.println("ICE "+name+" "+s);
      if(s==PeerConnection.IceConnectionState.CONNECTED||s==PeerConnection.IceConnectionState.COMPLETED)connected.countDown();
    }
    public void onIceConnectionReceivingChange(boolean b){}
    public void onIceGatheringChange(PeerConnection.IceGatheringState s){if(s==PeerConnection.IceGatheringState.COMPLETE)gathered.countDown();}
    public void onIceCandidate(IceCandidate c){}
    public void onIceCandidatesRemoved(IceCandidate[] c){}
    public void onAddStream(MediaStream s){}
    public void onRemoveStream(MediaStream s){}
    public void onDataChannel(DataChannel c){dataChannels.add(c);if(c.label().equals("control"))observeControl(c,true);}
    public void onRenegotiationNeeded(){}
    public void onTrack(RtpTransceiver transceiver){
      if(transceiver.getReceiver().track() instanceof VideoTrack)((VideoTrack)transceiver.getReceiver().track()).addSink(f->{});
    }
  }
  static class Sdp implements SdpObserver {
    final CountDownLatch done=new CountDownLatch(1); SessionDescription description; String error;
    public void onCreateSuccess(SessionDescription s){description=s;done.countDown();}
    public void onSetSuccess(){done.countDown();}
    public void onCreateFailure(String e){error=e;done.countDown();}
    public void onSetFailure(String e){error=e;done.countDown();}
    SessionDescription await() throws Exception {if(!done.await(60,TimeUnit.SECONDS))throw new Exception("SDP timeout");if(error!=null)throw new Exception(error);return description;}
  }
  static class Decoder implements VideoDecoder {
    Callback callback; JavaI420Buffer buffer;
    public VideoCodecStatus initDecode(Settings s,Callback c){callback=c;buffer=JavaI420Buffer.allocate(2,2);return VideoCodecStatus.OK;}
    public VideoCodecStatus release(){if(buffer!=null)buffer.release();buffer=null;return VideoCodecStatus.OK;}
    public VideoCodecStatus decode(EncodedImage image,DecodeInfo info){
      decoded.incrementAndGet(); if(image.frameType==EncodedImage.FrameType.VideoFrameKey)keys.incrementAndGet();
      buffer.retain();VideoFrame f=new VideoFrame(buffer,0,image.captureTimeNs);callback.onDecodedFrame(f,null,null);f.release();
      return VideoCodecStatus.OK;
    }
    public String getImplementationName(){return "probe-count-original-access-units";}
  }
  static PeerConnection.RTCConfiguration config(){
    PeerConnection.RTCConfiguration c=new PeerConnection.RTCConfiguration(Collections.emptyList());
    c.sdpSemantics=PeerConnection.SdpSemantics.UNIFIED_PLAN;
    c.tcpCandidatePolicy=PeerConnection.TcpCandidatePolicy.DISABLED;c.enableCpuOveruseDetection=false;c.suspendBelowMinBitrate=false;
    return c;
  }
  static long counter(BrowserRtcVideoTrack bridge,String key){return ((Number)bridge.flowDiagnostics().get(key)).longValue();}
  static List<byte[]> readFixture(String path)throws Exception{
    byte[] data=Files.readAllBytes(Paths.get(path));ArrayList<Integer> boundaries=new ArrayList<>();
    for(int i=0;i+5<data.length;i++)if(data[i]==0&&data[i+1]==0&&data[i+2]==0&&data[i+3]==1&&(data[i+4]&31)==9)boundaries.add(i);
    boundaries.add(data.length);ArrayList<byte[]> frames=new ArrayList<>();
    for(int i=0;i+1<boundaries.size();i++)frames.add(Arrays.copyOfRange(data,boundaries.get(i),boundaries.get(i+1)));
    if(frames.isEmpty())throw new Exception("fixture has no AUD");return frames;
  }
  static boolean key(byte[] data){for(int i=0;i+4<data.length;i++)if(data[i]==0&&data[i+1]==0&&data[i+2]==1&&(data[i+3]&31)==5)return true;return false;}
  static String profile(byte[] data){for(int i=0;i+7<data.length;i++)if(data[i]==0&&data[i+1]==0&&data[i+2]==1&&(data[i+3]&31)==7)return String.format("%02x%02x%02x",data[i+4]&255,data[i+5]&255,data[i+6]&255);return "42c02a";}
  static void stats(PeerConnection p,String label)throws Exception{
    stats(p,label,false);
  }
  static void stats(PeerConnection p,String label,boolean allowNotReady)throws Exception{
    CountDownLatch done=new CountDownLatch(1);AtomicReference<String> failure=new AtomicReference<>();
    Map<String,Object> selected=label.equals("sender")?lastSenderStats:lastReceiverStats;
    selected.clear();
    RTCStatsCollectorCallback callback=r->{int selectedCount=0;for(RTCStats s:r.getStatsMap().values())if(s.getType().equals("outbound-rtp")||s.getType().equals("inbound-rtp")||s.getType().equals("candidate-pair")||s.getType().equals("remote-inbound-rtp")){
      Map<String,Object> safe=new LinkedHashMap<>();
      safe.put("statsTimestampUs",s.getTimestampUs());safe.put("statsId",s.getId());
      for(String k:Arrays.asList("kind","mid","ssrc","framesReceived","framesDecoded","framesDropped","packetsReceived","packetsLost","bytesReceived","jitterBufferDelay","jitterBufferEmittedCount","framesEncoded","framesSent","keyFramesEncoded","bytesSent","headerBytesSent","retransmittedBytesSent","retransmittedPacketsSent","packetsSent","totalPacketSendDelay","targetBitrate","qualityLimitationReason","qualityLimitationDurations","availableOutgoingBitrate","currentRoundTripTime","state","nominated","roundTripTime","roundTripTimeMeasurements","totalRoundTripTime","fractionLost","reportsReceived","feedbackPacketsReceived","bytesDiscardedOnSend","packetsDiscardedOnSend"))if(s.getMembers().containsKey(k))safe.put(k,s.getMembers().get(k));
      if((label.equals("sender")&&s.getType().equals("outbound-rtp")||label.equals("receiver")&&s.getType().equals("inbound-rtp"))&&!"audio".equals(safe.get("kind"))){selectedCount++;selected.putAll(safe);}
      System.out.println("STATS "+label+" "+s.getType()+" "+safe);
    }if(selectedCount>1||selectedCount==0&&!allowNotReady)failure.set("Expected one RTP stream for active "+label+", found "+selectedCount);done.countDown();};
    if(label.equals("sender"))p.getStats(Objects.requireNonNull(activeSender),callback);else p.getStats(Objects.requireNonNull(activeReceiver),callback);
    if(!done.await(10,TimeUnit.SECONDS))throw new Exception("Active "+label+" stats timed out");
    if(failure.get()!=null)throw new Exception(failure.get());
    if(label.equals("sender")&&!selected.isEmpty()){
      Map<String,Object> sample=new LinkedHashMap<>(selected);sample.put("phase",sourcePhase);sample.put("senderId",activeSender.id());
      sample.put("sampleMonotonicNanos",System.nanoTime());sample.put("sourceBytes",sourceBytes.get());sample.put("sourceFrames",sourceFrames.get());
      sample.put("sourceFirstMonotonicNanos",sourceFirstNanos);sample.put("sourceLastMonotonicNanos",sourceLastNanos);rateSamples.add(sample);
    }
  }
  static int warmBridge(BrowserRtcVideoTrack bridge,PeerConnection rx,List<byte[]> frames)throws Exception{
    int preroll=0;
    while(counter(bridge,"outputFrames")==0&&preroll<10){
      if(!bridge.awaitInput(10_000))throw new Exception("native input completion timeout");
      long now=System.nanoTime();if(!bridge.offer(new WebVideoRecord(2,1,1,preroll,1,preroll*16667L,frames.get(0),null,now,now,null)))throw new Exception("Warmup offer failed");
      preroll++;Thread.sleep(150);
    }
    if(!bridge.awaitInput(10_000))throw new Exception("native input completion timeout");
    long expected=counter(bridge,"outputFrames");
    if(counter(bridge,"outputFrames")==0)throw new Exception("Warmup did not produce an encoded access unit");
    long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
    do{stats(rx,"receiver",true);if(!lastReceiverStats.isEmpty()&&statCount(lastReceiverStats,"framesReceived")>=expected)break;Thread.sleep(100);}while(System.nanoTime()<deadline);
    if(lastReceiverStats.isEmpty()||statCount(lastReceiverStats,"framesReceived")!=expected)throw new Exception("Warmup RTP access units did not drain");
    Thread.sleep(250);
    return preroll;
  }
  static long statCount(Map<String,Object> values,String name){Object value=values.get(name);if(!(value instanceof Number))throw new IllegalStateException("Required RTP counter missing: "+name);return ((Number)value).longValue();}
  static void validateRtpPhase(Map<String,Object> before,Map<String,Object> after,String direction,long frames)throws Exception{
    for(String identity:Arrays.asList("statsId","ssrc"))if(before.get(identity)==null||!before.get(identity).equals(after.get(identity)))throw new Exception("Active "+direction+" "+identity+" changed or is missing within phase");
    if(!(before.get("statsTimestampUs") instanceof Number)||!(after.get("statsTimestampUs") instanceof Number)||((Number)after.get("statsTimestampUs")).doubleValue()<=((Number)before.get("statsTimestampUs")).doubleValue())throw new Exception("Active "+direction+" statistics time did not advance");
    String suffix=direction.equals("sender")?"Sent":"Received";
    if(statCount(after,"frames"+suffix)-statCount(before,"frames"+suffix)!=frames||statCount(after,"bytes"+suffix)<=statCount(before,"bytes"+suffix)||statCount(after,"packets"+suffix)<=statCount(before,"packets"+suffix))throw new Exception("Active "+direction+" frame/byte/packet counters did not match phase input");
  }
  static void proveGeneration(BrowserRtcVideoTrack bridge,PeerConnection tx,PeerConnection rx,List<byte[]> frames,int generation)throws Exception{
    int preroll=warmBridge(bridge,rx,frames);beginSourcePhase("generation-"+generation);
    stats(tx,"sender");stats(rx,"receiver");Map<String,Object> senderBefore=new LinkedHashMap<>(lastSenderStats),receiverBefore=new LinkedHashMap<>(lastReceiverStats);long receivedBefore=statCount(receiverBefore,"framesReceived");
    java.security.MessageDigest input=java.security.MessageDigest.getInstance("SHA-256");synchronized(digestLock){outputDigest.reset();}
    long outputBefore=counter(bridge,"outputFrames"),lossBefore=counter(bridge,"lossEvents");
    long begin=System.nanoTime();int count=60;
    for(int i=0;i<count;i++){
      if(!bridge.awaitInput(10_000))throw new Exception("Generation input timed out");
      long sleep=begin+i*16666667L-System.nanoTime();if(sleep>0)TimeUnit.NANOSECONDS.sleep(sleep);
      byte[] bytes=frames.get(i%frames.size());long now=System.nanoTime();
      input.update(bytes);
      if(!bridge.offer(new WebVideoRecord(2,key(bytes)?1:0,1,i,1,(i+preroll)*16667L,bytes,null,now,now,null)))throw new Exception("Generation offer failed");
      recordSourceInput(bytes,now);
    }
    if(!bridge.awaitInput(10_000))throw new Exception("Generation output timed out");
    long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);
    do{stats(rx,"receiver");if(statCount(lastReceiverStats,"framesReceived")-receivedBefore>=count)break;Thread.sleep(100);}while(System.nanoTime()<deadline);
    stats(tx,"sender");
    validateRtpPhase(senderBefore,lastSenderStats,"sender",count);validateRtpPhase(receiverBefore,lastReceiverStats,"receiver",count);
    String inputHash=hex(input.digest()),outputHash;synchronized(digestLock){outputHash=hex(outputDigest.digest());}
    long received=statCount(lastReceiverStats,"framesReceived")-receivedBefore,output=counter(bridge,"outputFrames")-outputBefore;
    Map<String,Object> proof=new LinkedHashMap<>();proof.put("generation",generation);proof.put("offeredFrames",count);proof.put("outputFrames",output);proof.put("receivedFrames",received);proof.put("sourceBytes",sourceBytes.get());proof.put("senderId",activeSender.id());proof.put("offeredSha256",inputHash);proof.put("encoderOutputSha256",outputHash);proof.put("receiverContentVerified",false);proof.put("senderStatsBaseline",senderBefore);proof.put("senderStatsFinal",new LinkedHashMap<>(lastSenderStats));proof.put("receiverStatsBaseline",receiverBefore);proof.put("receiverStatsFinal",new LinkedHashMap<>(lastReceiverStats));generationProofs.add(proof);
    if(output!=count||received!=count||counter(bridge,"lossEvents")!=lossBefore||!inputHash.equals(outputHash))throw new Exception("Generation "+generation+" encoder-byte/count observations failed before replacement: "+proof);
    checkControl("video-generation-"+generation);
  }
  static void runBootstrap(BrowserRtcVideoTrack bridge,PeerConnection tx,PeerConnection rx,List<byte[]> frames,String profile,RequestGate gate,int start,boolean sourceRate)throws Exception{
    long begin=System.nanoTime();long pts=0;String failure=null;
    List<String> trace=new ArrayList<>();gate.prime();
    for(int i=0;i<4;i++){
      if(!bridge.awaitInput(10_000))throw new Exception("initial input timeout");
      long now=System.nanoTime();byte[] bytes=frames.get(i);
      if(!bridge.offer(new WebVideoRecord(2,i==0?1:0,1,i,1,pts,bytes,null,now,now,null)))throw new Exception("initial offer failed "+bridge.getFailure());
      trace.add("initial-"+i+"@"+TimeUnit.NANOSECONDS.toMillis(now-begin));pts+=16667;
      if(i<3)Thread.sleep(47);
    }
    Map<String,Object> initialDiagnostics=bridge.diagnostics(),initialFlow=bridge.flowDiagnostics();
    System.out.println("BOOTSTRAP_INITIAL "+initialDiagnostics+" "+initialFlow+" requestCalls="+gate.calls.get()+" accepted="+gate.accepted.get());
    long nextPoll=begin+TimeUnit.SECONDS.toNanos(1),deadline=begin+TimeUnit.SECONDS.toNanos(9);int recoveryKeys=0;
    while(System.nanoTime()<deadline){
      long now=System.nanoTime();
      if(now>=nextPoll){
        failure=bridge.pollFailure();trace.add("poll@"+TimeUnit.NANOSECONDS.toMillis(now-begin)+":"+failure);nextPoll+=TimeUnit.SECONDS.toNanos(1);
        if(failure!=null)break;
      }
      if(gate.pending.compareAndSet(true,false)){
        Thread.sleep(50);if(!bridge.awaitInput(10_000))throw new Exception("recovery input timeout");
        now=System.nanoTime();pts=Math.max(pts+16667,TimeUnit.NANOSECONDS.toMicros(now-begin));
        if(!bridge.offer(new WebVideoRecord(2,1,1,4+recoveryKeys,1,pts,frames.get(0),null,now,now,null)))throw new Exception("recovery offer failed "+bridge.getFailure());
        recoveryKeys++;trace.add("recovery-key@"+TimeUnit.NANOSECONDS.toMillis(now-begin));
      }
      if(counter(bridge,"outputFrames")>0){Thread.sleep(500);stats(rx,"receiver",true);if(!lastReceiverStats.isEmpty()&&statCount(lastReceiverStats,"framesReceived")>0)break;}
      Thread.sleep(10);
    }
    bridge.awaitInput(1000);stats(tx,"sender");stats(rx,"receiver");
    Map<String,Object> result=new LinkedHashMap<>();result.put("scenario","sparse-high-profile-bootstrap");result.put("sourceProfile",profile);
    result.put("failure",failure);result.put("startBitrateBps",start);result.put("requestedRateControlMode",sourceRate?"source-rate":"adaptive");result.put("nativeRateControlVerified",false);result.put("receiverContentVerified",false);result.put("senderFieldTrials",sourceRate?SOURCE_RATE_TRIAL:TRIALS);result.put("receiverFieldTrials",TRIALS);
    result.put("initialDiagnostics",initialDiagnostics);result.put("initialFlow",initialFlow);
    result.put("diagnostics",bridge.diagnostics());result.put("flow",bridge.flowDiagnostics());
    result.put("requestCalls",gate.calls.get());result.put("acceptedRequests",gate.accepted.get());result.put("recoveryKeys",recoveryKeys);
    result.put("requestAttemptsAtMs",gate.attemptsAtMs);result.put("requestAcceptedAtMs",gate.acceptedAtMs);
    result.put("outputAccessUnitsOriginal",unexpectedBootstrapOutput.get()==0);
    synchronized(digestLock){result.put("encoderOutputSha256",hex(outputDigest.digest()));}
    result.put("createdCodecs",createdCodecs);result.put("trace",trace);result.put("receiver",lastReceiverStats);result.put("sender",lastSenderStats);result.put("videoNegotiations",videoNegotiations);
    System.out.println("BOOTSTRAP_RESULT "+WebJson.INSTANCE.write(result));
  }
  public static void main(String[] args){try{run(args);}catch(Throwable t){t.printStackTrace(System.out);System.exit(1);}}
  public static void run(String[] args)throws Exception{
    System.out.println("STEP probe-main");
    outputDigest=java.security.MessageDigest.getInstance("SHA-256");
    offeredDigest=java.security.MessageDigest.getInstance("SHA-256");
    String mode=args.length>0?args[0]:"paced"; int start=args.length>1?Integer.parseInt(args[1]):0;
    boolean sourceRate=args.length>6&&args[6].equals("source-rate");
    if(sourceRate&&start!=0)throw new IllegalArgumentException("source-rate mode forbids bitrate settings");
    if(start!=0&&(start<VIDEO_MIN_BITRATE_BPS||start>VIDEO_MAX_BITRATE_BPS))throw new IllegalArgumentException("start bitrate must be zero or between "+VIDEO_MIN_BITRATE_BPS+" and "+VIDEO_MAX_BITRATE_BPS);
    int delay=args.length>2?Integer.parseInt(args[2]):0;int frameCount=args.length>3?Integer.parseInt(args[3]):360;
    boolean warm=args.length>4&&args[4].equals("warm");
    boolean verbose=args.length>5&&args[5].equals("verbose");
    boolean bundle=mode.equals("bundle")||mode.equals("bundle-video-anchor");
    boolean primeData=mode.equals("bundle");
    String dir="/data/local/tmp/tiplay-native-probe";
    nativeLog=new BufferedWriter(new FileWriter(dir+"/native-"+mode+"-"+start+"-"+delay+(sourceRate?"-source-rate":"")+".log"));
    System.out.println("STEP context");
    android.os.Looper.prepareMainLooper();
    Class<?> activityThread=Class.forName("android.app.ActivityThread");
    Object thread=activityThread.getMethod("systemMain").invoke(null);
    Context context=(Context)activityThread.getMethod("getSystemContext").invoke(thread);
    System.out.println("STEP initialize");
    PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context)
      .setNativeLibraryLoader(name->{System.load(dir+"/libjingle_peerconnection_so.so");return true;})
      .setInjectableLogger((message,severity,tag)->{
        synchronized(NativeVideoProbe.class){try{nativeLog.write(tag+" "+message);nativeLog.newLine();}catch(Exception ignored){}}
        if(message.contains("encoder is blocked"))blocked.incrementAndGet();
        if(message.contains("Same/old NTP timestamp"))badTimestamps.incrementAndGet();
        if(message.contains("suspend")||message.contains("suspension")||message.contains("Too large for target bitrate")||message.contains("Same/old NTP")||message.contains("encoder is blocked")||message.contains("Number of frames:"))System.out.println("NATIVE "+message);
      },verbose?Logging.Severity.LS_VERBOSE:Logging.Severity.LS_INFO).createInitializationOptions());
    System.out.println("STEP initialized");
    List<byte[]> frames=readFixture(dir+"/fixture.h264");String profile=profile(frames.get(0));
    if(mode.equals("bootstrap")){
      if(!profile.startsWith("64"))throw new IllegalArgumentException("bootstrap fixture must use H.264 High profile");
      for(int i=0;i<4;i++)bootstrapSourceHashes.add(sha256(frames.get(i)));
    }
    Map<String,String> params=new LinkedHashMap<>();params.put("packetization-mode","1");params.put("profile-level-id",profile);params.put("level-asymmetry-allowed","1");
    VideoCodecInfo codec=new VideoCodecInfo("H264",params,Collections.emptyList());
    Map<String,String> baselineParams=new LinkedHashMap<>(params);baselineParams.put("profile-level-id","42002a");
    VideoCodecInfo baselineCodec=new VideoCodecInfo("H264",baselineParams,Collections.emptyList());
    List<BrowserRtcVideoPolicy.Codec> offered=new ArrayList<>();
    if(mode.equals("bootstrap")||bundle)offered.add(new BrowserRtcVideoPolicy.Codec("H264",baselineParams));
    offered.add(new BrowserRtcVideoPolicy.Codec("H264",params));
    RequestGate requestGate=new RequestGate();
    BrowserRtcVideoTrack bridge=new BrowserRtcVideoTrack(offered,()->mode.equals("bootstrap")?requestGate.request():Unit.INSTANCE,null,()->System.nanoTime());
    currentBridge=bridge;
    VideoEncoderFactory encoder=new VideoEncoderFactory(){
      public VideoCodecInfo[] getSupportedCodecs(){return currentBridge.getSupportedCodecs();}
      public VideoEncoderFactory.VideoEncoderSelector getEncoderSelector(){return currentBridge.getEncoderSelector();}
      public VideoEncoder createEncoder(VideoCodecInfo info){
        createdCodecs.add(info.name+":"+info.params.get("profile-level-id"));
        System.out.println("ENCODER_CREATED "+info.name+":"+info.params.get("profile-level-id"));
        VideoEncoder real=currentBridge.createEncoder(info);
        return new VideoEncoder(){
          public VideoCodecStatus initEncode(Settings s,Callback c){return real.initEncode(s,(image,info)->{
            byte[] bytes=new byte[image.buffer.remaining()];image.buffer.duplicate().get(bytes);
            synchronized(digestLock){outputDigest.update(bytes);}
            if(mode.equals("bootstrap")&&!bootstrapSourceHashes.contains(sha256(bytes)))unexpectedBootstrapOutput.incrementAndGet();
            c.onEncodedFrame(image,info);
          });}
          public VideoCodecStatus release(){return real.release();}
          public VideoCodecStatus encode(VideoFrame f,EncodeInfo i){if(delay>0)try{Thread.sleep(delay);}catch(Exception ignored){}return real.encode(f,i);}
          public VideoCodecStatus setRateAllocation(BitrateAllocation b,int f){return real.setRateAllocation(b,f);}
          public ScalingSettings getScalingSettings(){return real.getScalingSettings();}
          public String getImplementationName(){return real.getImplementationName();}
          public boolean isHardwareEncoder(){return false;}
        };
      }
    };
    PeerConnectionFactory.Options options=new PeerConnectionFactory.Options();options.disableNetworkMonitor=true;
    System.out.println("STEP factories");
    PeerConnectionFactory txFactory=PeerConnectionFactory.builder().setOptions(options).setFieldTrials(sourceRate?SOURCE_RATE_TRIAL:TRIALS).setVideoEncoderFactory(encoder).createPeerConnectionFactory();
    PeerConnectionFactory rxFactory=PeerConnectionFactory.builder().setOptions(options).setFieldTrials(TRIALS).setVideoDecoderFactory(new VideoDecoderFactory(){
      public VideoCodecInfo[] getSupportedCodecs(){return mode.equals("bootstrap")||bundle?new VideoCodecInfo[]{baselineCodec,codec}:new VideoCodecInfo[]{codec};}
      public VideoDecoder createDecoder(VideoCodecInfo info){return new Decoder();}
    }).createPeerConnectionFactory();
    System.out.println("STEP peers");
    Obs txObs=new Obs("sender"),rxObs=new Obs("receiver");
    PeerConnection tx=txFactory.createPeerConnection(config(),txObs),rx=rxFactory.createPeerConnection(config(),rxObs);
    RtpTransceiver receiveActive;
    if(primeData){
      createProbeDataChannels(rx);
      Sdp prime=new Sdp();rx.createOffer(prime,new MediaConstraints());SessionDescription pendingData=prime.await();prime=new Sdp();rx.setLocalDescription(prime,pendingData);prime.await();
      Files.write(Paths.get(dir+"/pending-data-offer.sdp"),rx.getLocalDescription().description.getBytes("UTF-8"));
      receiveActive=rx.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY));
    }else{
      receiveActive=rx.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY));
      if(bundle)createProbeDataChannels(rx);
    }
    RtpTransceiver receiveAnchor=primeData?null:receiveActive;
    Sdp s=new Sdp();rx.createOffer(s,new MediaConstraints());SessionDescription offer=s.await();s=new Sdp();rx.setLocalDescription(s,offer);s.await();
    rxObs.gathered.await(30,TimeUnit.SECONDS);Files.write(Paths.get(dir+"/offer.sdp"),rx.getLocalDescription().description.getBytes("UTF-8"));s=new Sdp();tx.setRemoteDescription(s,rx.getLocalDescription());s.await();
    RtpSender sender=tx.addTrack(bridge.attach(txFactory),Collections.singletonList("probe-video"));
    activeSender=sender;activeReceiver=receiveActive.getReceiver();
    RtpParameters parameters=sender.getParameters();parameters.degradationPreference=RtpParameters.DegradationPreference.DISABLED;
    if(start>0)for(RtpParameters.Encoding e:parameters.encodings)e.maxBitrateBps=VIDEO_MAX_BITRATE_BPS;
    if(!sender.setParameters(parameters))throw new Exception("setParameters failed");
    for(RtpTransceiver t:tx.getTransceivers())if(t.getSender().id().equals(sender.id())){
      t.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY);
      if(mode.equals("bootstrap")||bundle){
        List<RtpCapabilities.CodecCapability> preferred=new ArrayList<>();
        for(RtpCapabilities.CodecCapability c:txFactory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs)
          if((c.name.equalsIgnoreCase("H264")&&profile.equalsIgnoreCase(c.parameters.get("profile-level-id")))||c.name.equalsIgnoreCase("rtx"))preferred.add(c);
        t.setCodecPreferences(preferred).throwError();
      }
    }
    if(start>0){
      if(!tx.setBitrate(VIDEO_MIN_BITRATE_BPS,start,VIDEO_MAX_BITRATE_BPS))throw new Exception("setBitrate failed");
      System.out.println("START_BITRATE true");
    }
    s=new Sdp();tx.createAnswer(s,new MediaConstraints());SessionDescription answer=s.await();s=new Sdp();tx.setLocalDescription(s,answer);s.await();
    txObs.gathered.await(30,TimeUnit.SECONDS);Files.write(Paths.get(dir+"/answer.sdp"),tx.getLocalDescription().description.getBytes("UTF-8"));bridge.negotiated(tx.getLocalDescription().description);
    s=new Sdp();rx.setRemoteDescription(s,tx.getLocalDescription());s.await();
    recordVideoNegotiation("initial",receiveActive,tx,sender);
    if(!txObs.connected.await(60,TimeUnit.SECONDS))throw new Exception("ICE sender timeout");
    Thread.sleep(1000);
    String config="{\"codec\":\"avc1."+profile+"\",\"width\":1568,\"height\":1080,\"fps\":60}";
    if(!bridge.configure(new WebVideoRecord(1,0,1,0,1,0,config.getBytes("UTF-8"),null,0,null,null)))throw new Exception("configure failed");
    if(bundle){
      checkControl("initial");recordBundleNegotiation(rx.getLocalDescription(),"initial",primeData);
      startControlHeartbeat();
      for(int replacement=0;replacement<3;replacement++){
        proveGeneration(bridge,tx,rx,frames,replacement);
        sourcePhase="replacement-"+replacement;checkControl("before-replacement-"+replacement);
        bridge.disable("video-track-replaced");sender.setTrack(null,false);
        if(receiveActive==receiveAnchor)receiveActive.setDirection(RtpTransceiver.RtpTransceiverDirection.INACTIVE);else receiveActive.stop();
        receiveActive=rx.addTransceiver(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,new RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY));
        List<RtpCapabilities.CodecCapability> receivePreferred=new ArrayList<>();
        for(RtpCapabilities.CodecCapability c:rxFactory.getRtpReceiverCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs)
          if((c.name.equalsIgnoreCase("H264")&&profile.equalsIgnoreCase(c.parameters.get("profile-level-id")))||c.name.equalsIgnoreCase("rtx"))receivePreferred.add(c);
        receiveActive.setCodecPreferences(receivePreferred).throwError();
        s=new Sdp();rx.createOffer(s,new MediaConstraints());SessionDescription nextOffer=s.await();s=new Sdp();rx.setLocalDescription(s,nextOffer);s.await();
        Files.write(Paths.get(dir+"/bundle-offer-"+replacement+".sdp"),rx.getLocalDescription().description.getBytes("UTF-8"));
        s=new Sdp();tx.setRemoteDescription(s,rx.getLocalDescription());s.await();
        bridge.close();bridge=new BrowserRtcVideoTrack(offered,()->Unit.INSTANCE,null,()->System.nanoTime());currentBridge=bridge;
        sender=tx.addTrack(bridge.attach(txFactory),Collections.singletonList("probe-video"));
        activeSender=sender;activeReceiver=receiveActive.getReceiver();
        RtpParameters nextParameters=sender.getParameters();nextParameters.degradationPreference=RtpParameters.DegradationPreference.DISABLED;
        if(!sourceRate)for(RtpParameters.Encoding e:nextParameters.encodings)e.maxBitrateBps=VIDEO_MAX_BITRATE_BPS;
        if(!sender.setParameters(nextParameters))throw new Exception("replacement setParameters failed");
        for(RtpTransceiver t:tx.getTransceivers())if(t.getSender().id().equals(sender.id())){
          t.setDirection(RtpTransceiver.RtpTransceiverDirection.SEND_ONLY);
          List<RtpCapabilities.CodecCapability> preferred=new ArrayList<>();
          for(RtpCapabilities.CodecCapability c:txFactory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs)
            if((c.name.equalsIgnoreCase("H264")&&profile.equalsIgnoreCase(c.parameters.get("profile-level-id")))||c.name.equalsIgnoreCase("rtx"))preferred.add(c);
          t.setCodecPreferences(preferred).throwError();
        }
        s=new Sdp();tx.createAnswer(s,new MediaConstraints());SessionDescription nextAnswer=s.await();s=new Sdp();tx.setLocalDescription(s,nextAnswer);s.await();
        Files.write(Paths.get(dir+"/bundle-answer-"+replacement+".sdp"),tx.getLocalDescription().description.getBytes("UTF-8"));
        bridge.negotiated(tx.getLocalDescription().description);s=new Sdp();rx.setRemoteDescription(s,tx.getLocalDescription());s.await();
        recordVideoNegotiation("replacement-"+replacement,receiveActive,tx,sender);
        if(!bridge.configure(new WebVideoRecord(1,0,1,0,1,0,config.getBytes("UTF-8"),null,0,null,null)))throw new Exception("replacement configure failed");
        recordBundleNegotiation(rx.getLocalDescription(),"replacement-"+replacement,primeData);
        checkControl("replacement-"+replacement);
        System.out.println("REPLACEMENT "+replacement+" sender="+sender.id()+" receiveMid="+receiveActive.getMid());
      }
    }
    if(mode.equals("bootstrap")){
      runBootstrap(bridge,tx,rx,frames,profile,requestGate,start,sourceRate);
      tx.close();rx.close();bridge.close();tx.dispose();rx.dispose();txFactory.dispose();rxFactory.dispose();
      synchronized(NativeVideoProbe.class){nativeLog.flush();nativeLog.close();}
      System.exit(0);return;
    }
    int preroll=0;
    if(warm){
      preroll=warmBridge(bridge,rx,frames);
      System.out.println("WARMUP receiverDecoderInvocations="+decoded.get()+" "+bridge.flowDiagnostics());
    }
    beginSourcePhase(bundle?"generation-3-measured":"measured");
    stats(tx,"sender");Map<String,Object> senderBaseline=new LinkedHashMap<>(lastSenderStats);
    stats(rx,"receiver");
    Map<String,Object> receiverBaseline=new LinkedHashMap<>(lastReceiverStats);
    synchronized(digestLock){outputDigest.reset();offeredDigest.reset();}
    Map<String,Object> baseline=new LinkedHashMap<>(bridge.flowDiagnostics());int decodedBaseline=decoded.get(),blockedBaseline=blocked.get();
    System.out.println("PROBE_START mode="+mode+" start="+start+" delay="+delay+" fixtureFrames="+frames.size()+" profile="+profile+" count="+frameCount);
    long begin=System.nanoTime();int sent=0;
    for(int i=0;i<frameCount;i++){
      byte[] bytes=frames.get(i%frames.size());boolean key=key(bytes);
      if(mode.equals("serial")||bundle){
        if(!bridge.awaitInput(10_000))throw new Exception("native input completion timeout");
      }
      if(!mode.equals("burst")){
        long target=begin+i*16666667L;long sleep=target-System.nanoTime();if(sleep>0)TimeUnit.NANOSECONDS.sleep(sleep);
      }
      long now=System.nanoTime();
      synchronized(digestLock){offeredDigest.update(bytes);}
      if(!bridge.offer(new WebVideoRecord(2,key?1:0,1,i,1,(i+preroll)*16667L,bytes,null,now,now,null)))throw new Exception("offer failed "+bridge.getFailure());
      recordSourceInput(bytes,now);
      sent++;
      if(i%60==59){System.out.println("FLOW "+i+" "+bridge.flowDiagnostics());stats(tx,"sender");stats(rx,"receiver");}if(i%300==299&&bundle)checkControl("frame-"+(i+1));
    }
    if(!bridge.awaitInput(10_000))throw new Exception("Final input completion timed out");
    Thread.sleep(3000);if(bundle)checkControl("final");stats(tx,"sender");stats(rx,"receiver");
    validateRtpPhase(senderBaseline,lastSenderStats,"sender",frameCount);validateRtpPhase(receiverBaseline,lastReceiverStats,"receiver",frameCount);
    if(bundle)stopControlHeartbeat();
    Map<String,Long> delta=new LinkedHashMap<>();
    for(Map.Entry<String,Object> e:bridge.flowDiagnostics().entrySet())if(e.getValue() instanceof Number&&baseline.get(e.getKey()) instanceof Number&&!e.getKey().startsWith("allocated")&&!e.getKey().startsWith("pending")&&!e.getKey().equals("encoderInputsInFlight"))delta.put(e.getKey(),((Number)e.getValue()).longValue()-((Number)baseline.get(e.getKey())).longValue());
    System.out.println("DELTA mode="+mode+" start="+start+" receiverDecoderInvocations="+(decoded.get()-decodedBaseline)+" nativeBlocked="+(blocked.get()-blockedBaseline)+" "+delta);
    System.out.println("RESULT mode="+mode+" start="+start+" delay="+delay+" offered="+sent+" receiverDecoderInvocations="+decoded.get()+" keys="+keys.get()+" nativeBlocked="+blocked.get()+" badTimestamps="+badTimestamps.get()+" "+bridge.flowDiagnostics());
    Map<String,Object> result=new LinkedHashMap<>();
    result.put("videoNegotiations",videoNegotiations);
    result.put("mode",mode);result.put("startBitrateBps",start);result.put("minBitrateBps",start>0?VIDEO_MIN_BITRATE_BPS:null);result.put("maxBitrateBps",start>0?VIDEO_MAX_BITRATE_BPS:null);
    result.put("requestedRateControlMode",sourceRate?"source-rate":"adaptive");result.put("nativeRateControlVerified",false);result.put("receiverContentVerified",false);result.put("senderFieldTrials",sourceRate?SOURCE_RATE_TRIAL:TRIALS);result.put("receiverFieldTrials",TRIALS);
    result.put("sourceBytes",sourceBytes.get());result.put("sourceFrames",sourceFrames.get());result.put("sourceFirstMonotonicNanos",sourceFirstNanos);result.put("sourceLastMonotonicNanos",sourceLastNanos);result.put("sourceTimelineDurationUs",frameCount*16667L);
    result.put("senderStatsBaseline",senderBaseline);result.put("rateSamples",rateSamples);
    result.put("syntheticEncodeDelayMs",delay);result.put("fixtureProfile",profile);result.put("fixtureAccessUnits",frameCount);
    result.put("warmup",baseline);result.put("delta",delta);result.put("final",bridge.flowDiagnostics());
    result.put("receiverDecoderInvocations",decoded.get()-decodedBaseline);result.put("nativeBlocked",verbose?blocked.get()-blockedBaseline:null);
    result.put("nativeLogSeverity",verbose?"verbose":"info");
    result.put("badTimestamps",badTimestamps.get());result.put("senderStats",lastSenderStats);
    synchronized(digestLock){result.put("offeredSha256",hex(offeredDigest.digest()));result.put("encoderOutputSha256",hex(outputDigest.digest()));}
    Map<String,Long> receiverDelta=new LinkedHashMap<>();
    for(Map.Entry<String,Object> e:lastReceiverStats.entrySet())if(e.getValue() instanceof Number){
      Object old=receiverBaseline.get(e.getKey());
      receiverDelta.put(e.getKey(),((Number)e.getValue()).longValue()-(old instanceof Number?((Number)old).longValue():0));
    }
    result.put("receiverRtpDelta",receiverDelta);result.put("receiverStats",lastReceiverStats);result.put("receiverStatsBaseline",receiverBaseline);
    if(bundle){result.put("bundleAnchor",primeData?"data":"video-inactive");result.put("bundleNegotiations",bundleNegotiations);result.put("generationProofs",generationProofs);result.put("dataChannelsOpen",allProbeChannelsOpen());result.put("controlRoundTrips",controlChecks);result.put("controlEchoSendFailures",controlEchoSendFailures.get());result.put("controlHeartbeatSent",heartbeatSent.get());result.put("controlHeartbeatCompleted",heartbeatCompleted.get());result.put("controlHeartbeatFailure",heartbeatFailure.get());result.put("controlHeartbeatRttNanos",heartbeatRttNanos);result.put("controlEchoSamples",controlEchoSamples);result.put("controlAvailabilityTimeoutSeconds",5);result.put("controlLowLatencyVerified",false);}
    result.put("receiverTestBufferSize",2);
    result.put("receiverCodecDecode",false);result.put("physicalPerformanceMeasured",false);
    System.out.println("RESULT_JSON "+WebJson.INSTANCE.write(result));
    tx.close();rx.close();bridge.close();tx.dispose();rx.dispose();txFactory.dispose();rxFactory.dispose();
    synchronized(NativeVideoProbe.class){nativeLog.flush();nativeLog.close();}
    System.exit(0);
  }
}
