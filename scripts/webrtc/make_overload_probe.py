#!/usr/bin/env python3
"""Create a test-only Android sender probe; never alter the input file."""
import argparse
from pathlib import Path


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Expected one occurrence of {old!r}")
    return source.replace(old, new, 1)


def make_probe(source):
    helper = '''  static void proveForcedOverload(BrowserRtcVideoTrack bridge, RtpSender sender, List<byte[]> frames, String stage, long expectedEpoch)throws Exception {
    checkControl(stage+"-before");
    if(!bridge.awaitInput(10000))throw new Exception("overload input was not ready");
    byte[] bytes=frames.get(0); long now=System.nanoTime();
    if(!key(bytes)||!bridge.offer(new WebVideoRecord(2,1,1,0,1,0,bytes,null,now,now,null)))throw new Exception("failed to offer overload IDR");
    long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(10);long[] status;
    do {status=queueStatus(sender); if(status[1]!=0)break; Thread.sleep(20);} while(System.nanoTime()<deadline);
    if(status[0]!=expectedEpoch||status[1]!=expectedEpoch)throw new Exception("overload did not latch to expected sender epoch at "+stage+": "+Arrays.toString(status));
    Map<String,Object> event=new LinkedHashMap<>();event.put("stage",stage);event.put("epoch",status[0]);event.put("failureEpoch",status[1]);queueEpochProof.add(event);
    checkControl(stage+"-after");
  }
'''
    source = replace_once(source, '  public static void main(String[] args){', helper + '  public static void main(String[] args){')
    source = replace_once(source, '        proveGeneration(bridge,tx,rx,frames,replacement);', '        proveForcedOverload(bridge,sender,frames,"failed-"+replacement,queueEpoch);')
    source = replace_once(source, '        bridge.disable("video-track-replaced");sender.setTrack(null,false);', '        RtpSender retiredSender=sender; bridge.disable("video-track-replaced");sender.setTrack(null,false);')
    source = replace_once(source, '        if(expectQueueEpoch)queueEpoch=awaitQueueEpoch(sender,"replacement-"+replacement,queueEpoch);', '        if(expectQueueEpoch){queueEpoch=awaitQueueEpoch(sender,"replacement-"+replacement,queueEpoch);verifyQueueRetired(retiredSender,"still-retired-"+replacement,0);}')
    marker = '    if(mode.equals("bootstrap")){\n      runBootstrap(bridge,tx,rx,frames,profile,requestGate,start,sourceRate);'
    injected = '''    if(expectQueueEpoch){
      proveForcedOverload(bridge,sender,frames,"failed-final",queueEpoch);
      stopControlHeartbeat();checkControl("final-after-four-failures");
      Map<String,Object> result=new LinkedHashMap<>();result.put("testOnlyForcedOverload",true);result.put("queueEpochProof",queueEpochProof);result.put("controlChecks",controlChecks);result.put("controlEchoSendFailures",controlEchoSendFailures.get());
      System.out.println("OVERLOAD_RESULT "+WebJson.INSTANCE.write(result));
      tx.close();rx.close();bridge.close();tx.dispose();rx.dispose();txFactory.dispose();rxFactory.dispose();
      synchronized(NativeVideoProbe.class){nativeLog.flush();nativeLog.close();}
      System.exit(0);return;
    }
'''
    return replace_once(source, marker, injected + marker)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error("input and output must differ")
    args.output.write_text(make_probe(args.input.read_text(encoding="utf-8")), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
