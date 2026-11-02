// SPDX-License-Identifier: GPL-3.0-or-later
let mod, inputPtr=0, inputCapacity=0, lastPoll=0, failed=false;
let audioPort=null,audioEnabled=false,audioWanted='auto',audioSelected=-1;
const audioSeen=[-Infinity,-Infinity,-Infinity];
function clearAudio(){audioSelected=-1;audioSeen.fill(-Infinity);if(audioPort)audioPort.postMessage({type:'clear'});}
function deliverAudio(slot,pcm){
 if(!audioPort){postMessage({type:'audio',slot,pcm},[pcm.buffer]);return;}
 if(!audioEnabled)return;
 const now=performance.now();audioSeen[slot]=now;
 let selected=audioWanted==='auto'?audioSelected:Number(audioWanted);
 if(audioWanted==='auto'&&(selected<0||now-audioSeen[selected]>800))selected=slot;
 if(selected!==audioSelected){audioSelected=selected;audioPort.postMessage({type:'clear'});postMessage({type:'audioChoice',slot:selected});}
 if(slot===selected)audioPort.postMessage({type:'pcm',pcm},[pcm.buffer]);
}
const ready=createK1Decoder({print:()=>{},printErr:s=>postMessage({type:'log',text:s})}).then(m=>{
 mod=m;mod._k1_reset();postMessage({type:'ready'});
}).catch(e=>{failed=true;postMessage({type:'error',text:'WebAssembly konnte nicht starten: '+e.message});});
function reserve(n){if(n>inputCapacity){if(inputPtr)mod._free(inputPtr);inputCapacity=Math.max(n,65536);inputPtr=mod._malloc(inputCapacity);if(!inputPtr)throw new Error('Kein Speicher für den USB-Puffer');}}
function drain(force=false){
 for(let slot=0;slot<3;slot++){
  let n=mod._k1_audio_count(slot);
  if(n){let p=mod._k1_audio_ptr(slot);let pcm=mod.HEAPF32.slice(p/4,p/4+n);mod._k1_audio_clear(slot);deliverAudio(slot,pcm);}
 }
 if(force || performance.now()-lastPoll>250){lastPoll=performance.now();postMessage({type:'state',data:JSON.parse(mod.UTF8ToString(mod._k1_poll()))});}
}
let queue=Promise.resolve();
onmessage=e=>{queue=queue.then(async()=>{
 await ready;if(failed)return;const v=e.data;
 if(v.type==='reset'){mod._k1_reset();lastPoll=0;clearAudio();return;}
 if(v.type==='audioPort'){if(audioPort)audioPort.close();audioPort=v.port;clearAudio();return;}
 if(v.type==='audioSettings'){audioEnabled=!!v.enabled;audioWanted=v.slot==='auto'?'auto':String(Math.max(0,Math.min(2,Number(v.slot)||0)));clearAudio();return;}
 if(v.type==='options'){mod._k1_options(+v.eq,+v.lf,+v.gain,+v.invert,+v.live);return;}
 const begin=performance.now();
 if(v.type==='feed'){
  const d=new Uint8Array(v.buffer);reserve(d.length);mod.HEAPU8.set(d,inputPtr);mod._k1_feed(inputPtr,d.length,v.seconds);drain();postMessage({type:'consumed',id:v.id,ms:performance.now()-begin});
 } else if(v.type==='pcm'){
  const d=new Int16Array(v.buffer);reserve(d.byteLength);mod.HEAP16.set(d,inputPtr/2);mod._k1_pcm(inputPtr,d.length);drain();postMessage({type:'consumed',id:v.id,ms:performance.now()-begin});
 } else if(v.type==='poll'){drain(true);postMessage({type:'consumed',id:v.id,ms:performance.now()-begin});}
 }).catch(err=>{postMessage({type:'error',id:e.data.id,text:err.message});});};
