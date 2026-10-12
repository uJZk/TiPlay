#!/usr/bin/env python3
"""Host JNI boundary checks; requires a JDK and a C compiler, no Android device."""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / 'shared/src/main/jni/airplay'
JAVA = Path(os.environ['JAVA_HOME'])

with tempfile.TemporaryDirectory(prefix='tiplay-airplay-native-') as temp:
    work = Path(temp)
    sources = [NATIVE / 'fairplay_jni.c', *(NATIVE / 'playfair').glob('*.c')]
    subprocess.run(['cc', '-shared', '-fPIC', '-O2', '-fno-strict-aliasing',
                    '-I' + str(JAVA / 'include'), '-I' + str(JAVA / 'include/linux'),
                    *map(str, sources), '-lm', '-o', str(work / 'libtiplay_airplay.so')], check=True)
    source = work / 'ReceiverFairPlay.java'
    source.write_text('''package com.shilapi.xcertplay.receiver;
import java.util.Arrays;
public class ReceiverFairPlay {
  static { System.loadLibrary("tiplay_airplay"); }
  native byte[] reply(byte[] request);
  native byte[] decrypt(byte[] handshake, byte[] encrypted);
  static void check(boolean value) { if (!value) throw new AssertionError(); }
  static byte[] message(int length) {
    byte[] bytes = new byte[length];
    System.arraycopy(new byte[]{70,80,76,89,3}, 0, bytes, 0, 5);
    return bytes;
  }
  public static void main(String[] args) {
    ReceiverFairPlay fp = new ReceiverFairPlay();
    check(fp.reply(null) == null);
    check(fp.decrypt(null, new byte[72]) == null);
    check(fp.decrypt(new byte[164], null) == null);
    for (int length : new int[]{0, 1, 15, 17, 163, 165}) check(fp.reply(new byte[length]) == null);
    byte[] setup = message(16);
    for (int mode = 0; mode < 4; mode++) {
      setup[14] = (byte)mode;
      byte[] reply = fp.reply(setup);
      check(reply.length == 142 && reply[13] == mode);
    }
    setup[14] = 4; check(fp.reply(setup) == null);
    setup[14] = (byte)255; check(fp.reply(setup) == null);
    byte[] handshake = message(164);
    for (int i = 144; i < 164; i++) handshake[i] = (byte)i;
    byte[] reply = fp.reply(handshake);
    check(reply.length == 32);
    check(Arrays.equals(Arrays.copyOfRange(reply,12,32), Arrays.copyOfRange(handshake,144,164)));
    check(fp.decrypt(handshake, new byte[71]) == null);
    check(fp.decrypt(new byte[163], new byte[72]) == null);
    handshake[12] = 4; check(fp.decrypt(handshake, new byte[72]) == null);
    handshake[12] = (byte)255; check(fp.decrypt(handshake, new byte[72]) == null);
    for (int mode = 0; mode < 4; mode++) {
      handshake[12] = (byte)mode;
      check(fp.decrypt(handshake, new byte[72]).length == 16);
    }
    handshake[4] = 2; check(fp.reply(handshake) == null);
    System.out.println("AirPlay native JNI boundary checks passed");
  }
}''')
    subprocess.run([str(JAVA / 'bin/javac'), '-d', str(work), str(source)], check=True)
    subprocess.run([str(JAVA / 'bin/java'), '--enable-native-access=ALL-UNNAMED',
                    '-Djava.library.path=' + str(work), '-cp', str(work),
                    'com.shilapi.xcertplay.receiver.ReceiverFairPlay'], check=True)
