const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict');
const nodes=new Map();function el(s){if(!nodes.has(s))nodes.set(s,{value:s==='#transport'?'auto':'8',checked:false,disabled:false,textContent:'',innerHTML:'',classList:{toggle(){}},style:{},closest(){return {open:false};}});return nodes.get(s);}
const sent=[];
const context=vm.createContext({console,Uint8Array,DataView,ArrayBuffer,Map,Promise,Number,Math,JSON,String,Error,Date,RegExp,Infinity,performance,location:{protocol:'https:'},isSecureContext:true,navigator:{userAgent:'Chrome'},document:{querySelector:el,addEventListener(){}},window:{addEventListener(){}},localStorage:{getItem:()=>null,setItem(){}},setInterval:()=>{},setTimeout,clearTimeout,Blob,URL,atob});
const run=s=>vm.runInContext(s,context);
vm.runInContext(fs.readFileSync(__dirname+'/../src/app.js','utf8').replace('capability();drawCards();initWorker();',''),context);
context.fakeWorker={postMessage:m=>{if(m.type==='feed')sent.push(m);}};
run('worker=fakeWorker;link={close:async()=>{}};');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function ack(m){context.messageId=m.id;run('clearTimeout(pending.get(messageId).t);pending.get(messageId).resolve();pending.delete(messageId);');}
(async()=>{
 const expected=[];
 for(let i=0;i<80;i++){context.packet=new Uint8Array(64).fill(i);expected.push(...context.packet);assert.equal(run('receive(packet)'),undefined);}
 await sleep(20);assert.equal(sent.length,1);assert.equal(sent[0].buffer.byteLength,5120);
 // While the worker is deliberately left busy, USB packets can still be accepted.
 for(let i=80;i<140;i++){context.packet=new Uint8Array(64).fill(i);expected.push(...context.packet);run('receive(packet)');}
 assert.equal(sent.length,1);assert.equal(run('rxBytes'),3840);
 ack(sent[0]);await sleep(10);assert.equal(sent.length,2);assert.equal(sent[1].buffer.byteLength,3840);
 assert.deepEqual(Array.from(new Uint8Array(sent[0].buffer)).concat(Array.from(new Uint8Array(sent[1].buffer))),expected);
 ack(sent[1]);await sleep(0);assert.equal(run('rxBytes'),0);assert.equal(run('rxBusy'),false);
 console.log('PASS 140 fragmented USB reads -> 2 worker batches, exact byte order, no decoder wait in USB read path');
 context.packet=new Uint8Array(100);run('receive(packet)');await sleep(20);const stale=sent[2];
 run('clearReceiveQueue();');context.packet=new Uint8Array(120);run('receive(packet)');await sleep(20);assert.equal(run('rxBusy'),true);
 ack(stale);await sleep(0);assert.equal(run('rxBusy'),true);ack(sent[3]);await sleep(0);assert.equal(run('rxBusy'),false);
 console.log('PASS stale completion cannot release a new session batch');
 // Stop safely instead of silently dropping bytes when a decoder cannot keep up.
 context.packet=new Uint8Array(65537);run('receive(packet)');await sleep(10);assert.equal(run('rxBytes'),0);assert.equal(run('link'),null);
 console.log('PASS bounded receive queue detects overload and closes transport');
})().catch(e=>{console.error(e);process.exitCode=1;});
