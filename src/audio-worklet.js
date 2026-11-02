// SPDX-License-Identifier: GPL-3.0-or-later
// 8 kHz decoder PCM -> browser sample rate, with a bounded jitter buffer.
class K1Audio extends AudioWorkletProcessor {
 constructor() {
  super();this.samples=new Float32Array(8192);this.read=0;this.write=0;
  this.target=1280;this.maximum=3200;this.started=false;this.ticks=0;
  this.underruns=0;this.overflows=0;
  this.port.onmessage=e=>{
   if(e.data.type==='clear'){this.read=this.write=0;this.started=false;return;}
   if(e.data.type!=='pcm' || !e.data.pcm?.length)return;
   let pcm=e.data.pcm;
   if(pcm.length>this.maximum){pcm=pcm.subarray(pcm.length-this.maximum);this.overflows++;}
   if(this.write-this.read+pcm.length>this.maximum){this.read=this.write-(this.maximum-pcm.length);this.overflows++;}
   for(let i=0;i<pcm.length;i++)this.samples[this.write++&8191]=pcm[i];
  };
 }
 process(inputs,outputs) {
  const out=outputs[0][0];out.fill(0);
  let available=this.write-this.read;
  if(!this.started && available>=this.target)this.started=true;
  if(this.started){
   // Small bounded rate correction prevents long-term device clock drift.
   const correction=Math.max(-.003,Math.min(.003,(available-this.target)*.000002));
   const step=8000/sampleRate*(1+correction);
   for(let i=0;i<out.length;i++){
    if(this.write-this.read<2){this.started=false;this.underruns++;break;}
    const at=Math.floor(this.read),fraction=this.read-at;
    const a=this.samples[at&8191],b=this.samples[(at+1)&8191];
    out[i]=a+(b-a)*fraction;this.read+=step;
   }
  }
  this.ticks+=out.length;
  if(this.ticks>=sampleRate){this.ticks=0;this.port.postMessage({type:'audioStats',bufferMs:Math.round((this.write-this.read)/8),underruns:this.underruns,overflows:this.overflows});}
  return true;
 }
}
registerProcessor('k1-audio',K1Audio);
