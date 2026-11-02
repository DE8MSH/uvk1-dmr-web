// SPDX-License-Identifier: GPL-3.0-or-later
// Test the exact WASM embedded in the shipped HTML; no compiler or download.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
module.exports=()=>{
 const html=fs.readFileSync(path.resolve(__dirname,'../index.html'),'utf8');
 const worker=JSON.parse(html.match(/<script type="application\/json" id="worker-source">([\s\S]*?)<\/script>/)[1]);
 const marker='// SPDX-License-Identifier: GPL-3.0-or-later\nlet mod,';
 const pos=worker.indexOf(marker);if(pos<0)throw Error('Decoder source marker missing');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'k1-web-perf-'));
 const file=path.join(dir,'decoder.cjs');fs.writeFileSync(file,worker.slice(0,pos));
 process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));return file;
};
