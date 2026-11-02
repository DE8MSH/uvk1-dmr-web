// SPDX-License-Identifier: GPL-3.0-or-later
let mod, inputPtr=0, inputCapacity=0, lastPoll=0, failed=false;
const ready=createK1Decoder({print:()=>{},printErr:s=>postMessage({type:'log',text:s})}).then(m=>{
 mod=m;mod._k1_reset();postMessage({type:'ready'});
}).catch(e=>{failed=true;postMessage({type:'error',text:'WebAssembly konnte nicht starten: '+e.message});});
function reserve(n){if(n>inputCapacity){if(inputPtr)mod._free(inputPtr);inputCapacity=Math.max(n,65536);inputPtr=mod._malloc(inputCapacity);if(!inputPtr)throw new Error('Kein Speicher für den USB-Puffer');}}
function drain(force=false){
 for(let slot=0;slot<3;slot++){
  let n=mod._k1_audio_count(slot);
  if(n){let p=mod._k1_audio_ptr(slot);let pcm=mod.HEAPF32.slice(p/4,p/4+n);mod._k1_audio_clear(slot);postMessage({type:'audio',slot,pcm},[pcm.buffer]);}
 }
 if(force || performance.now()-lastPoll>250){lastPoll=performance.now();postMessage({type:'state',data:JSON.parse(mod.UTF8ToString(mod._k1_poll()))});}
}
let queue=Promise.resolve();
onmessage=e=>{queue=queue.then(async()=>{
 await ready;if(failed)return;const v=e.data;
 if(v.type==='reset'){mod._k1_reset();lastPoll=0;return;}
 if(v.type==='options'){mod._k1_options(+v.eq,+v.lf,+v.gain,+v.invert,+v.live);return;}
 if(v.type==='feed'){
  const d=new Uint8Array(v.buffer);reserve(d.length);mod.HEAPU8.set(d,inputPtr);mod._k1_feed(inputPtr,d.length,v.seconds);drain();postMessage({type:'consumed',id:v.id});
 } else if(v.type==='pcm'){
  const d=new Int16Array(v.buffer);reserve(d.byteLength);mod.HEAP16.set(d,inputPtr/2);mod._k1_pcm(inputPtr,d.length);drain();postMessage({type:'consumed',id:v.id});
 } else if(v.type==='poll'){drain(true);postMessage({type:'consumed',id:v.id});}
 }).catch(err=>{postMessage({type:'error',text:err.message});});};
