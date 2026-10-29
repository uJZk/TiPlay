// Synthetic media fixture: real AVC pictures plus registered ITU-T T.35 SEI.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
if (!dir) throw new Error('Expected fixture output directory');
mkdirSync(dir, { recursive: true });
function ffmpeg(args) { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status) throw new Error(r.stderr); }
ffmpeg(['-f','lavfi','-i','testsrc2=size=320x180:rate=15','-t','16','-c:v','libx264','-preset','ultrafast','-bf','0','-g','30','-x264-params','aud=1','-f','h264',join(dir,'plain.h264')]);
function sei(triples) {
  const payload = [181,0,49,71,65,57,52,3,64|triples.length,255,...triples.flatMap(([type,a,b])=>[4|type,a,b])];
  const raw=[4,payload.length,...payload,128], escaped=[]; let zeros=0;
  for(const byte of raw){if(zeros>=2&&byte<=3){escaped.push(3);zeros=0;}escaped.push(byte);zeros=byte===0?zeros+1:0;}
  return Buffer.from([0,0,0,1,6,...escaped]);
}
const digital = [152,32,0,0,0,0,0,68,84,86];
const block=[32|digital.length,...digital]; if(block.length%2===0)block.push(0);
const dtv=[[3,(block.length+1)/2,block[0]]]; for(let i=1;i<block.length;i+=2)dtv.push([2,block[i],block[i+1]]);
const input=readFileSync(join(dir,'plain.h264')), positions=[];
for(let i=0;i<input.length-5;i++)if(input[i]===0&&input[i+1]===0&&input[i+2]===0&&input[i+3]===1&&(input[i+4]&31)===9)positions.push(i);
const chunks=[]; let start=0;
for(let frame=0;frame<positions.length;frame++){
  const pos=positions[frame], after=pos+6;
  chunks.push(input.subarray(start,after)); start=after;
  if(frame===15)chunks.push(sei([[0,20,32],[0,72,73],[0,20,47],...dtv]));
  if(frame===120)chunks.push(sei([[0,20,44]]));
}
chunks.push(input.subarray(start));writeFileSync(join(dir,'captions.h264'),Buffer.concat(chunks));
ffmpeg(['-fflags','+genpts','-r','15','-i',join(dir,'captions.h264'),'-c','copy','-hls_time','2','-hls_list_size','0','-hls_segment_filename',join(dir,'part%d.ts'),join(dir,'media.m3u8')]);
ffmpeg(['-fflags','+genpts','-r','15','-i',join(dir,'plain.h264'),'-c','copy','-hls_time','2','-hls_list_size','0','-hls_segment_filename',join(dir,'clean%d.ts'),join(dir,'clean.m3u8')]);
writeFileSync(join(dir,'master.m3u8'),'#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="text",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=NO,URI="text.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,CLOSED-CAPTIONS=NONE,SUBTITLES="text"\nmedia.m3u8\n');
writeFileSync(join(dir,'text.m3u8'),'#EXTM3U\n#EXT-X-TARGETDURATION:16\n#EXTINF:16,\ntext.vtt\n#EXT-X-ENDLIST\n');
writeFileSync(join(dir,'text.vtt'),'WEBVTT\n\n00:00.000 --> 00:16.000\nExternal caption\n');
console.log('Created AVC HLS fixture with CC1 and SERVICE1 at frame15, CC1 clear at frame120.');
