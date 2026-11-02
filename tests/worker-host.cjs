const {parentPort,workerData}=require('node:worker_threads');
const fs=require('node:fs');
const createK1Decoder=require(workerData.decoder);
global.postMessage=(m,transfer)=>parentPort.postMessage(m,transfer);
eval(fs.readFileSync(workerData.source,'utf8'));
parentPort.on('message',data=>onmessage({data}));
