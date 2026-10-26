import { readFile } from 'node:fs/promises';
export async function loadFixtures() {
const fixtures = [];
const lc = JSON.parse(await readFile(new URL('../../web/fixtures/airplay-aac-lc.json', import.meta.url)));
fixtures.push({name:'AAC-LC 44100 stereo', rate:44100, channels:2, asc:lc.config.asc,
 packets:lc.packets.map(p=>new Uint8Array(Buffer.from(p.payload,'base64')))});
for (const rate of [44100,48000]) for (const channels of [1,2]) for (const size of [480,512]) {
 const bytes=await readFile(new URL(`../../web/fixtures/aac-eld/${rate}-${channels}-${size}-tone.bin`,import.meta.url));
 let offset=0; const parts=[];
 while(offset<bytes.length){const length=bytes.readUInt32LE(offset);offset+=4;parts.push(new Uint8Array(bytes.subarray(offset,offset+length)));offset+=length;}
 fixtures.push({name:`AAC-ELD ${rate} ${channels}ch ${size}`,rate,channels,asc:parts.shift(),packets:parts});
}
fixtures.push(JSON.parse(await readFile(new URL('./alac-tone.json', import.meta.url))));
for (const name of ['aac-48000-tone.json', 'alac-48000-tone.json'])
 fixtures.push(JSON.parse(await readFile(new URL(name, import.meta.url))));
return fixtures;
}
