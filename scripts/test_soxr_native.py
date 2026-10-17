#!/usr/bin/env python3
"""Compile host JNI and test the actual Kotlin native adapter after :shared:assembleDebug."""
import argparse, os
from pathlib import Path
import subprocess, tempfile

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--classes', type=Path, default=ROOT / 'shared/build/intermediates/compile_library_classes_jar/debug/bundleLibCompileToJarDebug/classes.jar')
args = parser.parse_args()
java = Path(os.environ['JAVA_HOME'])
cache = Path(os.environ.get('GRADLE_USER_HOME', Path.home() / '.gradle')) / 'caches/modules-2/files-2.1'
stdlib = next(cache.glob('org.jetbrains.kotlin/kotlin-stdlib/2.2.10/*/*.jar'))
native = ROOT / 'shared/src/main/jni'
subprocess.run(['python3', str(ROOT / 'scripts/soxr/prepare-native.py'), '--check'], check=True)

with tempfile.TemporaryDirectory(prefix='tiplay-soxr-native-') as temp:
    work = Path(temp)
    subprocess.run(['cc', '-shared', '-fPIC', '-O3', '-DNDEBUG', '-DSOXR_LIB', '-ffp-contract=off',
        '-I' + str(java / 'include'), '-I' + str(java / 'include/linux'), '-I' + str(native / 'soxr'),
        str(native / 'soxr_jni.c'), *[str(native / 'soxr' / name) for name in ['soxr.c', 'data-io.c', 'vr32.c']],
        '-lm', '-o', str(work / 'libtiplay_soxr.so')], check=True)
    source = work / 'SoxrNativeCheck.java'
    source.write_text(r'''
import com.shilapi.xcertplay.media.NativeSoxr;
import com.shilapi.xcertplay.media.NativePcmResampler;
import com.shilapi.xcertplay.media.BluetoothVoiceMixer;
import com.shilapi.xcertplay.airplay.AudioStreamId;
import java.util.*;
public class SoxrNativeCheck {
  static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
  static short[] signal(int rate, int frequency) {
    short[] pcm = new short[rate];
    for (int i=0;i<rate;i++) pcm[i]=(short)Math.round(Math.sin(2*Math.PI*frequency*i/rate)*20000);
    return pcm;
  }
  static short[] convert(int rate, int outputRate, short[] pcm, int chunk) {
    NativePcmResampler engine = new NativePcmResampler(rate, outputRate);
    try {
      short[] all = new short[outputRate*2]; int used=0;
      for (int at=0;at<pcm.length;at+=chunk) {
        short[] out=engine.convert(Arrays.copyOfRange(pcm,at,Math.min(pcm.length,at+chunk)));
        System.arraycopy(out,0,all,used,out.length); used+=out.length;
      }
      check(engine.convert(new short[0]).length==0,"temporary shortage must not flush EOF");
      return Arrays.copyOf(all,used);
    } finally { engine.close(); engine.close(); }
  }
  static double energy(short[] pcm) {
    double sum=0; for(int i=4800;i<pcm.length;i++) sum+=(double)pcm[i]*pcm[i]; return sum;
  }
  public static void main(String[] args) throws Exception {
    for(int[] pair:new int[][]{{8000,48000},{16000,48000},{48000,16000},{48000,24000},{44100,48000},{96000,48000}}) {
      short[] pcm=signal(pair[0],1000);
      short[] split=convert(pair[0],pair[1],pcm,Math.max(1,pair[0]/50));
      short[] whole=convert(pair[0],pair[1],pcm,pcm.length);
      check(Arrays.equals(split,whole),"packet boundaries changed signal "+Arrays.toString(pair));
      check(split.length>pair[1]-2048 && split.length<=pair[1],"unexpected continuous duration");
      System.out.println("rate="+pair[0]+"->"+pair[1]+" frames="+split.length+" packet-parity=exact");
      short[] impulse=new short[4096]; impulse[256]=16384;
      short[] response=convert(pair[0],pair[1],impulse,320);
      double mass=0,moment=0;
      for(int i=0;i<response.length;i++) { double e=(double)response[i]*response[i];mass+=e;moment+=e*i; }
      check(mass>0,"impulse response present");
      double delay=(moment/mass-256.0*pair[1]/pair[0])*1000/pair[1];
      System.out.println("filter-content-offset-ms="+delay);
      check(Double.isFinite(delay) && Math.abs(delay)<160,"filter content offset fits existing speech queue budget");
    }
    double alias=energy(convert(96000,48000,signal(96000,40000),1920))/
                 energy(convert(96000,48000,signal(96000,1000),1920));
    check(alias<.001,"downsampling alias rejection");
    System.out.println("alias-energy-ratio="+alias);
    NativeSoxr engine=new NativeSoxr(1.0,1);
    try {
      float[] in=new float[4096], out=new float[512]; Arrays.fill(in,.25f);
      check(engine.process(in,4096,out,512)>=0,"process");
      engine.ratio(1.001,512); engine.ratio(.999,512);
      for(int i=0;i<out.length;i++) check(Float.isFinite(out[i]),"finite output");
      boolean rejected=false; try { engine.process(in,4097,out,512); } catch(IllegalStateException ok) { rejected=true; }
      check(rejected,"oversized input rejected at JNI boundary");
    } finally { engine.close(); }
    boolean rejected=false;
    try { engine.process(new float[1],1,new float[1],1); } catch(IllegalStateException ok) { rejected=true; }
    check(rejected,"closed handle rejected");
    BluetoothVoiceMixer mixer=new BluetoothVoiceMixer(48000,(inRate,outRate)->new NativePcmResampler(inRate,outRate));
    AudioStreamId call=new AudioStreamId(100,"telephony");
    byte[] positive=new byte[48000*2];
    for(int i=0;i<48000;i++) { positive[2*i]=(byte)16000; positive[2*i+1]=(byte)(16000>>8); }
    mixer.offer(call,48000,1,positive,false,Long.MAX_VALUE);
    short[] before=mixer.next(480,0L);
    byte[] negative=positive.clone();
    for(int i=0;i<48000;i++) { negative[2*i]=(byte)-16000; negative[2*i+1]=(byte)(-16000>>8); }
    mixer.offer(call,48000,1,negative,true,Long.MAX_VALUE);
    short[] after=mixer.next(7680,0L);
    check(Math.abs(after[0]-before[before.length-1])<=134,"native filter overflow boundary is blended");
    short[] tail=mixer.next(960,0L);
    for(int i=240;i<tail.length;i++) check(tail[i]==0,"native queue retains 160ms bound plus in-place decay");
    mixer.clear(); check(Arrays.equals(new short[960],mixer.next(960,0L)),"clear immediately retires old speech");
    BluetoothVoiceMixer timed=new BluetoothVoiceMixer(48000,
        (inRate,outRate)->new NativePcmResampler(inRate,outRate),()->138000000L);
    short[] tenMs=new short[160]; Arrays.fill(tenMs,(short)16000);
    NativePcmResampler lookahead=new NativePcmResampler(16000,48000);
    check(lookahead.convert(tenMs).length==0 && lookahead.convert(tenMs).length>0,
        "probe holds the first packet then emits its buffered output");
    lookahead.close();
    timed.offer(call,16000,1,Arrays.copyOf(positive,320),false,125000000L);
    timed.offer(call,16000,1,Arrays.copyOf(positive,320),false,135000000L);
    check(Arrays.equals(new short[960],timed.next(960,0L)),"native lookahead preserves original expired deadlines");
    timed.clear();
    Throwable[] failure=new Throwable[2]; Thread[] threads=new Thread[2];
    for(int n=0;n<2;n++) { final int index=n; threads[n]=new Thread(()->{
      try { for(int i=0;i<10;i++) convert(16000,48000,signal(16000,700+index*300),320); }
      catch(Throwable error) { failure[index]=error; }
    }); threads[n].start(); }
    for(Thread thread:threads) thread.join();
    check(failure[0]==null && failure[1]==null,"independent concurrent engines");
    System.out.println("Native libsoxr/Kotlin packet, DSP, lifecycle and concurrency checks passed");
  }
}
''')
    base_classes = ROOT / 'shared/build/intermediates/compile_library_classes_jar/debug/bundleLibCompileToJarDebug/classes.jar'
    cp = os.pathsep.join(map(str, [args.classes.resolve(), base_classes, stdlib]))
    subprocess.run([str(java / 'bin/javac'), '-cp', cp, '-d', str(work), str(source)], check=True)
    subprocess.run([str(java / 'bin/java'), '--enable-native-access=ALL-UNNAMED',
        '-Djava.library.path=' + str(work), '-cp', str(work) + os.pathsep + cp, 'SoxrNativeCheck'], check=True)
