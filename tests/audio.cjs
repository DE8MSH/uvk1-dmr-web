const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const old=fs.readFileSync(__dirname+'/baselines/audio-0.1.0.js','utf8');
const current=fs.readFileSync(__dirname+'/../src/audio-worklet.js','utf8');
function make(source,rate=48000){let Type;const context={Float32Array,Math,sampleRate:rate,AudioWorkletProcessor:class{constructor(){this.port={postMessage(){}};}},registerProcessor(n,t){Type=t;}};vm.runInNewContext(source,context);return new Type();}
function test(source,rate,clock=1,duration=12000){const w=make(source,rate),jitter=[0,0,85,0,0,55,0,0,100,0,0,0,70];let arrivals=[],last=-1;
 for(let n=0;n<Math.ceil(duration/60);n++){const t=Math.max(last+1,n*60*clock+jitter[n%jitter.length]+(n>=30&&n<34?120:0));arrivals.push(t);last=t;}
 let next=0,zeros=0,energy=0;const out=new Float32Array(128);
 for(let time=0;time<duration;time+=128/rate*1000){while(next<arrivals.length&&arrivals[next]<=time){w.port.onmessage({data:{type:'pcm',pcm:new Float32Array(480).fill(.25)}});next++;}out.fill(NaN);w.process([],[ [out] ]);for(const s of out)assert(Number.isFinite(s));if(time>1000&&time<duration-1000)for(const s of out){if(s===0)zeros++;energy+=s*s;}}
 return {zeros,energy,underruns:w.underruns,overflows:w.overflows};}
const result={};for(const rate of [44100,48000]){const a=test(old,rate),b=test(current,rate);assert(a.zeros>100);assert.equal(b.zeros,0);result[rate]={before:a,after:b};}
const drift={before:test(old,48000,1.001,120000),after:test(current,48000,1.001,120000)};assert(drift.before.zeros>1000);assert.equal(drift.after.zeros,0);result.clockDrift=drift;
const w=make(current);for(let n=0;n<100;n++)w.port.onmessage({data:{type:'pcm',pcm:new Float32Array(480).fill(.5)}});assert(w.write-w.read<=4480);assert(w.overflows>0);
w.port.onmessage({data:{type:'clear'}});const out=new Float32Array(128).fill(1);w.process([],[[out]]);assert(out.every(x=>x===0));
console.log('PASS jitter simulation at 44.1/48 kHz: no mid-call silence with delayed ordered packets');
console.log('PASS bounded audio latency after stalls and clear on slot/session change');
console.log(JSON.stringify(result,null,2));
fs.writeFileSync(__dirname+'/results/audio-0.1.2.json',JSON.stringify(result,null,2));
