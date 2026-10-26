// SPDX-License-Identifier: GPL-3.0-only
#include "aacenc_lib.h"
#include "aacdecoder_lib.h"
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <vector>
#include <string>
#include <cstdint>
void ck(int e){if(e){fprintf(stderr,"FDK error %x\n",e);exit(1);}}
int main(){for(int rate:{44100,48000})for(int channels:{1,2})for(int fl:{480,512})for(int signal:{0,1,2}){
 char stem[100];sprintf(stem,"fixtures/%d-%d-%d-%d",rate,channels,fl,signal);FILE*f=fopen((std::string(stem)+".bin").c_str(),"wb"),*ref=fopen((std::string(stem)+".pcm").c_str(),"wb");if(!f||!ref)return 2;
 HANDLE_AACENCODER enc=0;ck(aacEncOpen(&enc,0,channels));ck(aacEncoder_SetParam(enc,AACENC_AOT,39));ck(aacEncoder_SetParam(enc,AACENC_SAMPLERATE,rate));ck(aacEncoder_SetParam(enc,AACENC_CHANNELMODE,channels==1?MODE_1:MODE_2));ck(aacEncoder_SetParam(enc,AACENC_BITRATE,channels*64000));ck(aacEncoder_SetParam(enc,AACENC_TRANSMUX,TT_MP4_RAW));ck(aacEncoder_SetParam(enc,AACENC_GRANULE_LENGTH,fl));ck(aacEncoder_SetParam(enc,AACENC_AFTERBURNER,1));ck(aacEncEncode(enc,0,0,0,0));AACENC_InfoStruct info={};ck(aacEncInfo(enc,&info));uint32_t n=info.confSize;fwrite(&n,4,1,f);fwrite(info.confBuf,1,n,f);HANDLE_AACDECODER dec=aacDecoder_Open(TT_MP4_RAW,1);UCHAR*cfg=info.confBuf;UINT clen=n;ck(aacDecoder_ConfigRaw(dec,&cfg,&clen));std::vector<INT_PCM> in(fl*channels),pcm(fl*channels);UCHAR data[8192];uint32_t rnd=123456;for(int k=0;k<400;k++){for(int i=0;i<fl;i++)for(int c=0;c<channels;c++){double t=(k*fl+i)/(double)rate;rnd=rnd*1664525+1013904223;double v=signal==0?0:signal==1?.15*sin(2*M_PI*(c?661:440)*t)+.05*sin(2*M_PI*(c?2039:1031)*t):.15*((int32_t)rnd/(double)2147483648)+.1*sin(2*M_PI*(200*t+1500*t*t));in[i*channels+c]=v*32767;}
 void*ip=in.data();void*op=data;int iid=IN_AUDIO_DATA,oid=OUT_BITSTREAM_DATA,isz=in.size()*2,osz=8192,iel=2,oel=1;AACENC_BufDesc ib={1,&ip,&iid,&isz,&iel},ob={1,&op,&oid,&osz,&oel};AACENC_InArgs ia={};ia.numInSamples=in.size();AACENC_OutArgs oa={};ck(aacEncEncode(enc,&ib,&ob,&ia,&oa));if(oa.numOutBytes){n=oa.numOutBytes;fwrite(&n,4,1,f);fwrite(data,1,n,f);UCHAR*bp=data;UINT len=n,valid=n;ck(aacDecoder_Fill(dec,&bp,&len,&valid));ck(aacDecoder_DecodeFrame(dec,pcm.data(),pcm.size(),0));fwrite(pcm.data(),2,pcm.size(),ref);}}
 fclose(f);fclose(ref);aacDecoder_Close(dec);aacEncClose(&enc);fprintf(stderr,"%s\n",stem);
}}
