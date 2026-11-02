// SPDX-License-Identifier: GPL-3.0-or-later
// Wrap the HTML's synthetic 48 kHz discriminator WAV as K1 12-bit USB packets.
const fs=require('node:fs'),path=require('node:path');
module.exports=()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 const wav=Buffer.from(html.match(/const SELFTEST_BASE64='([^']+)'/)[1],'base64');
 let pcm;for(let p=12;p+8<=wav.length;){const n=wav.readUInt32LE(p+4);if(wav.toString('ascii',p,p+4)==='data'){pcm=wav.subarray(p+8,p+8+n);break;}p+=8+n+(n&1);}
 if(!pcm)throw Error('Embedded synthetic PCM fixture missing');
 const raw=[];for(let t=0;t+1<pcm.length/2;t+=48000/47619){const i=Math.floor(t),a=pcm.readInt16LE(2*i),b=pcm.readInt16LE(2*i+2);raw.push(Math.max(0,Math.min(4095,Math.round(2048+(a+(b-a)*(t-i))/8))));}
 const chunks=[];let seq=0;
 const packet=(type,payload)=>{const h=Buffer.from([165,75,type,3,seq&255,seq>>8,payload.length&255,payload.length>>8,178,255,0,0]);chunks.push(h,payload);};
 const status=()=>{const p=Buffer.alloc(13);p.writeUInt32LE(43832500);p.writeUInt32LE(47619,4);packet(1,p);};status();
 for(let i=0;i+256<=raw.length;i+=256){const p=Buffer.alloc(384);for(let j=0;j<256;j+=2){const a=raw[i+j],b=raw[i+j+1],at=j*3/2;p[at]=a;p[at+1]=(a>>8)|(b<<4);p[at+2]=b>>4;}packet(0,p);seq++;if(seq%186===0)status();}
 return Buffer.concat(chunks);
};
