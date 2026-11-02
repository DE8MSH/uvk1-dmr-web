const {Worker}=require('node:worker_threads'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const decoder=require('./extract-decoder.cjs')();
const blob=require('./make-usb-fixture.cjs')();
(async()=>{let result=[];
 for(const [name,source,chunk] of [['before','baselines/worker-0.1.0.js',64],['after','../src/worker.js',4096]]){
  const w=new Worker(path.resolve(__dirname,'worker-host.cjs'),{workerData:{decoder,source:path.resolve(__dirname,source)}});
  let pending=new Map(),next=0,state,counts=[0,0,0],energy=[0,0,0],doneReady;
  const ready=new Promise(r=>doneReady=r);
  w.on('error',e=>{console.error(e);process.exit(1);});
  w.on('message',m=>{if(m.type==='ready')doneReady();else if(m.type==='consumed'){pending.get(m.id)?.();pending.delete(m.id);}else if(m.type==='audio'){counts[m.slot]+=m.pcm.length;for(const x of m.pcm){assert(Number.isFinite(x));energy[m.slot]+=x*x;}}else if(m.type==='state')state=m.data;else if(m.type==='error'){console.error(m);process.exit(1);}});
  const submit=(type,b,seconds)=>new Promise(r=>{const id=++next;pending.set(id,r);w.postMessage({type,buffer:b,seconds,id},[b]);});
  await ready;w.postMessage({type:'options',eq:0,lf:0,gain:8,invert:0,live:0});
  const t0=performance.now();
  for(let i=0;i<blob.length;i+=chunk){const b=Uint8Array.from(blob.subarray(i,i+chunk));await submit('feed',b.buffer,i/74200);}
  await submit('poll',new ArrayBuffer(0));const elapsedMs=performance.now()-t0;
  for(const slot of [1,2]){assert.equal(state.summary.dmr.slots[slot-1].src,slot===1?2625961:2623456);assert.equal(counts[slot],11520);assert(energy[slot]>.01);assert.equal(state.voice[slot].frames,72);}
  result.push({name,chunk,workerMessages:next,elapsedMs,counts,energy});await w.terminate();
 }
 assert.deepEqual(result[0].counts,result[1].counts);for(const slot of [1,2])assert(Math.abs(result[0].energy[slot]-result[1].energy[slot])<1e-4);
 console.log('PASS real WASM worker: both slots, 144 AMBE frames, identical PCM counts and energy');console.log(JSON.stringify(result,null,2));fs.writeFileSync(__dirname+'/results/pipeline.json',JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
