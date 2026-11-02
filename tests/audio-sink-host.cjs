// SPDX-License-Identifier: GPL-3.0-or-later
// A separate render thread runs the shipped worklet while the main test is blocked.
const {parentPort}=require('node:worker_threads'),fs=require('node:fs'),vm=require('node:vm');
let Type,firstPCM=0,received=0,energy=0,nonzero=0;
vm.runInNewContext(fs.readFileSync(__dirname+'/../src/audio-worklet.js','utf8'),{
 Float32Array,Math,Number,sampleRate:48000,
 AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor(n,t){Type=t;}
});
const audio=new Type();const out=new Float32Array(128);
const timer=setInterval(()=>{audio.process([],[[out]]);for(const x of out)if(x!==0)nonzero++;},3);
parentPort.on('message',m=>{
 if(m.type==='bind'){
  m.port.on('message',v=>{if(v.type==='pcm'){if(!firstPCM)firstPCM=Date.now();received+=v.pcm.length;for(const x of v.pcm)energy+=x*x;}});
  audio.port.onmessage({data:{type:'bind',port:m.port}});parentPort.postMessage({type:'ready'});
 }else if(m.type==='finish'){
  clearInterval(timer);parentPort.postMessage({type:'result',firstPCM,received,energy,nonzero});
 }
});
