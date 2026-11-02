// SPDX-License-Identifier: GPL-3.0-or-later
const {Worker,MessageChannel}=require('node:worker_threads'),path=require('node:path'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const decoder=require('./extract-decoder.cjs')();const fixture=require('./make-usb-fixture.cjs')();
 const worker=new Worker(path.resolve(__dirname,'worker-host.cjs'),{workerData:{decoder,source:path.resolve(__dirname,'../src/worker.js')}});
 const sink=new Worker(path.resolve(__dirname,'audio-sink-host.cjs'));
 try{
  const messages=[];let ready;const decoderReady=new Promise(r=>ready=r);
  worker.on('message',m=>{messages.push(m);if(m.type==='ready')ready();});
  const sinkReady=new Promise(r=>sink.on('message',m=>{if(m.type==='ready')r();}));
  const result=new Promise(r=>sink.on('message',m=>{if(m.type==='result')r(m);}));
  await decoderReady;
  const channel=new MessageChannel();sink.postMessage({type:'bind',port:channel.port1},[channel.port1]);
  worker.postMessage({type:'audioPort',port:channel.port2},[channel.port2]);
  worker.postMessage({type:'audioSettings',enabled:true,slot:'1'});
  worker.postMessage({type:'options',eq:0,lf:0,gain:8,invert:0,live:0});await sinkReady;
  const blockedAt=Date.now();
  for(let i=0;i<fixture.length;i+=4096){const data=Uint8Array.from(fixture.subarray(i,i+4096));worker.postMessage({type:'feed',id:i,buffer:data.buffer,seconds:i/74200},[data.buffer]);}
  while(Date.now()-blockedAt<450){} // Simulate a long main-thread/UI task.
  const unblockedAt=Date.now();await new Promise(r=>setTimeout(r,50));sink.postMessage({type:'finish'});
  const r=await result;assert.equal(r.received,11520);assert(r.firstPCM>=blockedAt&&r.firstPCM<unblockedAt-30);assert(r.nonzero>0);
  assert.equal(messages.filter(m=>m.type==='audio').length,0);
  console.log('PASS direct decoder -> audio channel delivers selected-slot PCM while main thread is blocked for 450 ms');
  console.log('PASS shipped worklet renders nonzero audio on separate thread; main thread relays no PCM');
  async function phase(slot,enabled,id){
   worker.postMessage({type:'reset'});worker.postMessage({type:'options',eq:0,lf:0,gain:8,invert:0,live:0});worker.postMessage({type:'audioSettings',slot,enabled});
   const consumed=new Promise(resolve=>{function listener(m){if(m.type==='consumed'&&m.id===id){worker.off('message',listener);resolve();}}worker.on('message',listener);});
   const bytes=Uint8Array.from(fixture);worker.postMessage({type:'feed',id,buffer:bytes.buffer,seconds:0},[bytes.buffer]);await consumed;
   await new Promise(resolve=>setTimeout(resolve,30));const snapshot=new Promise(resolve=>sink.once('message',resolve));sink.postMessage({type:'finish'});return snapshot;
  }
  const ts2=await phase('2',true,10000001);assert.equal(ts2.received-r.received,11520);assert(Math.abs(ts2.energy-r.energy-151.72906913422048)<1e-4);
  const muted=await phase('1',false,10000002);assert.equal(muted.received,ts2.received);
  console.log('PASS direct channel TS2 selection and mute after decoder/session reset');
  fs.writeFileSync(__dirname+'/results/direct-audio.json',JSON.stringify({mainBlockedMs:unblockedAt-blockedAt,firstAudioDuringBlockMs:r.firstPCM-blockedAt,pcmSamples:r.received,nonzeroRenderedSamples:r.nonzero},null,2));
 }finally{await worker.terminate();await sink.terminate();}
})().catch(e=>{console.error(e);process.exitCode=1;});
