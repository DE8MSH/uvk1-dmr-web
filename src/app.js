// SPDX-License-Identifier: GPL-3.0-or-later
'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const byId=new Map(), rows=[], logLines=[], pending=new Map(), slotCalls=new Map();
let worker, wasmReady=false, link=null, closing=false, connecting=false, verified=false, replay=false, replayCancel=false, state=null;
let lastInputWall=-Infinity;
// Keep reading USB while one bounded batch is decoded. A slow decoder must not
// stop host-side bulk reads and fill the radio's much smaller USB buffer.
const rxChunks=[];
let rxBytes=0,rxBusy=false,rxTimer=0,rxEpoch=0;
const perf={decodeMs:0,maxDecodeMs:0,batches:0,peakQueuedBytes:0,bufferMs:0,underruns:0,overflows:0,directAudio:false};
function clearReceiveQueue(){rxEpoch++;rxChunks.length=0;rxBytes=0;rxBusy=false;if(rxTimer)clearTimeout(rxTimer);rxTimer=0;}
function flushReceive(){
 rxTimer=0;if(rxBusy||!rxBytes||!link)return;
 const epoch=rxEpoch,n=Math.min(rxBytes,8192),batch=new Uint8Array(n);let at=0,seconds=0;
 while(at<n){const q=rxChunks[0],take=Math.min(n-at,q.data.length-q.offset);batch.set(q.data.subarray(q.offset,q.offset+take),at);q.offset+=take;at+=take;seconds=q.seconds;if(q.offset===q.data.length)rxChunks.shift();}
 rxBytes-=n;rxBusy=true;
 submit('feed',batch.buffer,seconds).then(()=>{
  if(epoch!==rxEpoch)return;rxBusy=false;if(rxBytes)rxTimer=setTimeout(flushReceive,0);
 },e=>{if(epoch!==rxEpoch)return;rxBusy=false;disconnect('Decoder: '+e.message);});
}
let id=0, bytes=0, startTime=0, lastFrameWall=0, lastFrames=0, chosenSlot=-1, audioCtx=null,audioNode=null,gainNode=null,audioOn=false;
let lastAudio=[-Infinity,-Infinity,-Infinity], logStart=performance.now(), replayMarked=false;
const settings={eq:true,lf:0,gain:8,invert:false,bw:0,bufferMs:320};
try{Object.assign(settings,JSON.parse(localStorage.getItem('k1-dmr-web-options')||'{}'));}catch{}
for(const key of ['eq','invert'])$('#'+key).checked=!!settings[key];
for(const key of ['lf','gain','bw'])$('#'+key).value=settings[key];
$('#audio-buffer').value=String([160,320,480].includes(Number(settings.bufferMs))?Number(settings.bufferMs):320);
function audioSettings(){if(worker&&wasmReady)worker.postMessage({type:'audioSettings',enabled:audioOn,slot:$('#slot').value});}
function log(text){logLines.push(new Date().toLocaleTimeString('de-DE')+'  '+text);if(logLines.length>100)logLines.shift();$('#log').textContent=logLines.join('\n');}
function error(e){$('#error').textContent=e?.message||String(e);log($('#error').textContent);}
function setDot(name,on){$('#dot-'+name).classList.toggle('on',!!on);}
function capability(){
 const serial=!!navigator.serial,usb=!!navigator.usb,secure=window.isSecureContext;
 setDot('browser',secure&&(serial||usb));
 if(!secure || (!serial&&!usb)){
  $('#notice').hidden=false;$('#notice').textContent=!secure?'Dieser Dateiaufruf erlaubt keinen sicheren USB-Zugriff. Datei direkt in Chrome öffnen; alternativ HTTPS oder localhost verwenden.':'Dieser Browser bietet weder Web Serial noch WebUSB. Für USB-Empfang Chrome/Chromium oder Edge verwenden. Aufnahmen und Selbsttest funktionieren weiterhin.';
 }
 return secure&&(serial||usb);
}
function opts(){
 settings.eq=$('#eq').checked;settings.invert=$('#invert').checked;
 settings.lf=Math.min(2000,Math.max(0,Number($('#lf').value)||0));settings.gain=Math.min(64,Math.max(.5,Number($('#gain').value)||8));settings.bw=Number($('#bw').value);
 try{localStorage.setItem('k1-dmr-web-options',JSON.stringify(settings));}catch{}
 $('#lf').disabled=settings.eq;
 if(wasmReady)worker.postMessage({type:'options',...settings,live:!replay});
}
function reset(){
 clearReceiveQueue();
 state=null;lastFrames=0;verified=false;lastFrameWall=0;lastAudio=[-Infinity,-Infinity,-Infinity];chosenSlot=-1;
 slotCalls.clear();worker.postMessage({type:'reset'});opts();if(audioNode)audioNode.port.postMessage({type:'clear'});drawCards();
}
function drawCards(){
 const sum=state?.summary?.dmr, now=state?.seconds||0;
 const html=[1,2].map(slot=>{
  const s=sum?.slots?.find(x=>x.slot===slot)||{},call=slotCalls.get(slot)||{};
  const recent=performance.now()-lastInputWall<1200;
  const active=recent&&(state?.voice?.[slot]?.last??-100)>now-.8;
  const direct=recent && slot===1 && (state?.voice?.[0]?.last??-100)>now-.8;
  const c=direct?(slotCalls.get(0)||{}):call;
  const source=c.src||s.src||0, db=byId.get(source)||{}, alias=c.alias||s.alias||'';
  const label=db.call||alias||(source?String(source):'Warte auf DMR');
  const desc=[db.name,db.where].filter(Boolean).join(' · ')||(source?'DMR-ID '+source:'Rufdaten erscheinen bei gültigem Empfang');
  return `<section class="panel slot ${(active||direct)?'active':''}"><div class="slothead"><h2>${direct?'Direkt / ohne TS-Zuordnung':'Zeitschlitz '+slot}</h2><span class="state">${(active||direct)?(s.privacy?'PRIVACY · STUMM':'SPRACHE'):'BEREIT'}</span></div><div class="callsign">${esc(label)}</div><div class="idline">${esc(desc)}</div><div class="facts"><span>Ziel / TG<b>${esc(c.dst||s.dst||'—')}</b></span><span>Color Code<b>${s.cc>=0?s.cc:'—'}</b></span><span>Audio<b>${chosenSlot===(direct?0:slot)&&audioOn?'AN':'—'}</b></span></div></section>`;
 }).join('');
 if(drawCards.last!==html){drawCards.last=html;$('#cards').innerHTML=html;}
}
function drawHistory(){
 $('#history').innerHTML=rows.length?rows.slice(0,150).map(r=>{
  let db=byId.get(+r.src)||{};
  return `<tr><td>${esc(r.wall)}</td><td>${esc(r.slot||'—')}</td><td>${esc(db.call||r.src||'—')}</td><td>${esc(r.dst||'—')}</td><td>${r.cc>=0?r.cc:'—'}</td><td>${esc(r.title)}${r.alias?' · '+esc(r.alias):''}</td></tr>`;
 }).join(''):'<tr><td colspan="6" class="empty">Noch kein DMR empfangen. Die Dekodierung beginnt mit dem ersten gültigen Signal.</td></tr>';
}
function update(data){
 state=data;
 const r=data.radio, sum=data.summary.dmr;
 if(link && r.frames!==lastFrames){lastFrameWall=performance.now();lastFrames=r.frames;}
 if(link && !verified && r.audioFrames>=4 && r.statusFrames>=1){
  verified=true;$('#connection').textContent='Digi Bridge erkannt';$('#radio-state').textContent='Empfang läuft. DMR wird automatisch dekodiert.';setDot('bridge',true);$('#tune').disabled=false;log('Gültige Digi-Bridge-Status- und Audiopakete erkannt.');send(command(0x81,settings.bw)).catch(error);
 }
 if(r.freq)$('#frequency').textContent=(r.freq/1e6).toFixed(6);
 $('#rssi').textContent=r.audioFrames?r.rssi+' dBm':'— dBm';$('#rssi-meter').style.width=Math.max(0,Math.min(100,(r.rssi+125)/.8))+'%';
 $('#bursts').textContent=sum.bursts;$('#dmr-meter').style.width=sum.bursts?'100%':'0%';
 for(const e of data.events){
  if(e.slot!==undefined && e.src)slotCalls.set(e.slot,{...(slotCalls.get(e.slot)||{}),...e});
  if(e.kind==='alias' || e.alias){const a=e.alias||e.fields?.find(f=>/Alias/.test(f[0]))?.[1];if(a)slotCalls.set(e.slot,{...(slotCalls.get(e.slot)||{}),alias:a});}
  const key=[e.kind,e.slot,e.src,e.dst,e.raw].join('|'),old=rows[0];
  if(!old || old.key!==key){rows.unshift({...e,key,wall:replay?'Aufn. '+(e.time||0).toFixed(2)+' s':new Date().toLocaleTimeString('de-DE')});if(rows.length>300)rows.pop();}
 }
 drawCards();if(data.events.length)drawHistory();
 if($('#diagnostics').closest('details')?.open)$('#diagnostics').textContent=JSON.stringify({Performanz:{...perf,queuedBytes:rxBytes},Kontext:{protokoll:location.protocol,sicher:isSecureContext,WebSerial:!!navigator.serial,WebUSB:!!navigator.usb},USB:r,DMR:sum,ADC_Hz:Math.round(data.rate*10)/10,Entzerrer:data.eq,Sprachdecoder:data.voice,Parser_verworfene_Bytes:data.bad},null,2);
}
function submit(type,buffer,seconds=0){
 if(type==='feed'||type==='pcm')lastInputWall=performance.now();
 return new Promise((resolve,reject)=>{
  const n=++id,t=setTimeout(()=>{pending.delete(n);reject(new Error('Decoder reagiert seit 10 Sekunden nicht.'));},10000);
  pending.set(n,{resolve,reject,t});worker.postMessage({type,buffer,seconds,id:n},[buffer]);
 });
}
function audioPacket(slot,pcm){
 lastAudio[slot]=performance.now();
 const wanted=$('#slot').value;let selected=wanted==='auto'?chosenSlot:Number(wanted);
 if(wanted==='auto' && (selected<0 || performance.now()-lastAudio[selected]>800))selected=slot;
 if(selected!==chosenSlot){chosenSlot=selected;if(audioNode)audioNode.port.postMessage({type:'clear'});}
 if(audioOn && audioNode && slot===selected)audioNode.port.postMessage({type:'pcm',pcm},[pcm.buffer]);
}
function initWorker(){
 try{
  const source=JSON.parse($('#worker-source').textContent);
  const u=URL.createObjectURL(new Blob([source],{type:'application/javascript'}));worker=new Worker(u);URL.revokeObjectURL(u);
  worker.onmessage=e=>{
   const m=e.data;
   if(m.type==='ready'){wasmReady=true;$('#decoder-status').textContent='WASM DECODER BEREIT';$('#connect').disabled=!capability();$('#audio').disabled=false;$('#selftest').disabled=false;opts();log('WebAssembly und AMBE-Sprachdecoder geladen. Keine Netzwerkverbindung erforderlich.');autoFind();}
   else if(m.type==='state')update(m.data);
   else if(m.type==='audioChoice'){chosenSlot=m.slot;drawCards();}
   else if(m.type==='audio')audioPacket(m.slot,m.pcm);
   else if(m.type==='consumed'){if(Number.isFinite(m.ms)){perf.decodeMs+=m.ms;perf.maxDecodeMs=Math.max(perf.maxDecodeMs,m.ms);perf.batches++;}const p=pending.get(m.id);if(p){clearTimeout(p.t);pending.delete(m.id);p.resolve();}}
   else if(m.type==='error'){const p=pending.get(m.id);if(p){clearTimeout(p.t);pending.delete(m.id);p.reject(new Error(m.text));}error(m.text);}
   else if(m.type==='log')log(m.text);
  };
  worker.onerror=e=>{error('Decoder-Worker: '+e.message);$('#decoder-status').textContent='DECODER-FEHLER';for(const p of pending.values()){clearTimeout(p.t);p.reject(new Error('Decoder-Worker ausgefallen'));}pending.clear();};
 }catch(e){error(e);$('#decoder-status').textContent='DECODER-FEHLER';}
}
function command(cmd,value){
 const b=new Uint8Array(9);b.set([0xA5,0x4B,cmd,4]);new DataView(b.buffer).setUint32(4,value,true);for(let i=0;i<8;i++)b[8]^=b[i];return b;
}
function chooseTransport(){const mode=$('#transport').value;return mode==='auto'?(navigator.serial&&!/Android/i.test(navigator.userAgent)?'serial':'usb'):mode;}
async function openSerial(port){
 await port.open({baudRate:115200,bufferSize:65536});
 try{await port.setSignals({dataTerminalReady:true,requestToSend:true});}catch(e){await port.close();throw e;}
 const reader=port.readable.getReader(),writer=port.writable.getWriter();
 return {type:'serial',port,reader,writer,async write(b){await writer.write(b);},async close(){try{await reader.cancel();}catch{}try{reader.releaseLock();}catch{}try{writer.releaseLock();}catch{}try{await port.setSignals({dataTerminalReady:false,requestToSend:false});}catch{}await port.close();},async pump(){
  while(link?.port===port){const {value,done}=await reader.read();if(done)break;if(value?.length)await receive(value);}
 }};
}
function cdcConfiguration(d){return d.configurations.find(c=>c.interfaces.some(i=>i.alternates.some(a=>a.interfaceClass===10&&a.endpoints.some(e=>e.direction==='in'&&e.type==='bulk')&&a.endpoints.some(e=>e.direction==='out'&&e.type==='bulk'))));}
async function openUSB(device){
 await device.open();let claims=[];
 try{
  const conf=cdcConfiguration(device);if(!conf)throw new Error('Dieses USB-Gerät besitzt keine CDC-Datenschnittstelle für Digi Bridge.');
  if(device.configuration?.configurationValue!==conf.configurationValue)await device.selectConfiguration(conf.configurationValue);
  let data,alt,comm;
  for(const i of device.configuration.interfaces)for(const a of i.alternates){if(a.interfaceClass===2)comm=i;if(a.interfaceClass===10&&a.endpoints.some(e=>e.direction==='in'&&e.type==='bulk')&&a.endpoints.some(e=>e.direction==='out'&&e.type==='bulk')){data=i;alt=a;}}
  if(!data||!comm)throw new Error('CDC-Steuer- oder Datenschnittstelle fehlt.');
  for(const i of [comm,data]){if(claims.includes(i.interfaceNumber))continue;await device.claimInterface(i.interfaceNumber);claims.push(i.interfaceNumber);}
  if(data.alternate.alternateSetting!==alt.alternateSetting)await device.selectAlternateInterface(data.interfaceNumber,alt.alternateSetting);
  const index=comm.interfaceNumber,ctl={requestType:'class',recipient:'interface',index};
  let r=await device.controlTransferOut({...ctl,request:0x20,value:0},new Uint8Array([0,0xC2,1,0,0,0,8]));if(r.status!=='ok')throw new Error('K1 hat SET_LINE_CODING abgewiesen.');
  r=await device.controlTransferOut({...ctl,request:0x22,value:3});if(r.status!=='ok')throw new Error('DTR ließ sich am K1 nicht setzen.');
  const input=alt.endpoints.find(e=>e.type==='bulk'&&e.direction==='in').endpointNumber,output=alt.endpoints.find(e=>e.type==='bulk'&&e.direction==='out').endpointNumber;
  return {type:'usb',device,async write(b){const r=await device.transferOut(output,b);if(r.status!=='ok'||r.bytesWritten!==b.byteLength)throw new Error('USB-Schreibfehler.');},async close(){try{await device.controlTransferOut({...ctl,request:0x22,value:0});}catch{}await device.close();},async pump(){
   const read=()=>device.transferIn(input,4096).then(r=>({r}),error=>({error}));let q=Array.from({length:4},read);
   while(link?.device===device){const x=await q.shift();if(link?.device!==device)break;q.push(read());if(x.error)throw x.error;if(x.r.status!=='ok')throw new Error('USB-Empfang: '+x.r.status);if(x.r.data?.byteLength)await receive(new Uint8Array(x.r.data.buffer,x.r.data.byteOffset,x.r.data.byteLength));}
  }};
 }catch(e){for(const i of claims.reverse())try{await device.releaseInterface(i);}catch{}try{await device.close();}catch{}throw e;}
}
function receive(b){
 if(!b.length||!link)return;
 bytes+=b.length;lastInputWall=performance.now();
 if(rxBytes+b.length>65536){clearReceiveQueue();disconnect('Decoder zu langsam: USB-Empfangspuffer voll. Diagnose speichern; Entzerrer testweise ausschalten.');return;}
 rxChunks.push({data:b.slice(),offset:0,seconds:lastInputWall/1000});rxBytes+=b.length;
 perf.peakQueuedBytes=Math.max(perf.peakQueuedBytes,rxBytes);
 if(!rxBusy&&!rxTimer)rxTimer=setTimeout(flushReceive,12);
}
async function send(b){if(!link || !verified)throw new Error('Zuerst eine laufende Digi Bridge erkennen lassen.');await link.write(b);}
async function connect(known=null){
 if(link||connecting||replay)return;connecting=true;$('#connect').disabled=true;$('#error').textContent='';$('#connection').textContent='USB wird geöffnet …';
 try{
  const kind=known?.kind||chooseTransport();let device;
  if(kind==='serial'){
   if(!navigator.serial)throw new Error('Web Serial ist hier nicht verfügbar. Auf Android WebUSB auswählen.');
   device=known?.device||await navigator.serial.requestPort();link=await openSerial(device);
  }else{
   if(!navigator.usb)throw new Error('WebUSB ist hier nicht verfügbar. Datei direkt in Chrome öffnen.');
   device=known?.device||await navigator.usb.requestDevice({filters:[{classCode:2},{classCode:10},{classCode:239,subclassCode:2,protocolCode:1}]});link=await openUSB(device);
  }
  reset();startTime=performance.now();bytes=0;$('#disconnect').disabled=false;$('#connection').textContent='USB offen · warte auf Digi Bridge';setDot('usb',true);
  $('#device').textContent=kind==='usb'?(device.productName||'USB-CDC-Gerät'):'USB-CDC über Web Serial';log('USB geöffnet, DTR/RTS gesetzt.');
  const active=link;active.pump().then(()=>{if(link===active&&!closing)disconnect('USB-Datenstrom beendet.');}).catch(e=>{if(link===active&&!closing)disconnect('USB: '+e.message);});
 }catch(e){if(e.name==='NotFoundError'){$('#connection').textContent='Geräteauswahl abgebrochen';}else{error(e);$('#connection').textContent='Keine Verbindung';}}
 finally{connecting=false;$('#connect').disabled=!!link||!wasmReady||!capability();}
}
async function disconnect(message='Verbindung getrennt.'){
 if(closing)return;closing=true;if(worker&&wasmReady)worker.postMessage({type:'reset'});const active=link;link=null;clearReceiveQueue();verified=false;$('#tune').disabled=true;setDot('usb',false);setDot('bridge',false);
 try{if(active)await active.close();}catch(e){log('Beim Schließen: '+e.message);}finally{closing=false;$('#disconnect').disabled=true;$('#connect').disabled=!wasmReady||!capability();$('#connection').textContent=message;$('#radio-state').textContent='K1 mit USB-C verbinden. Digi Bridge: F + 7.';if(audioNode)audioNode.port.postMessage({type:'clear'});log(message);}
}
async function autoFind(){
 // Enumerate earlier grants without opening arbitrary serial devices. USB CDC descriptors allow a candidate check.
 try{
  const kind=chooseTransport(),list=kind==='serial'?await navigator.serial?.getPorts():await navigator.usb?.getDevices();
  const candidates=kind==='usb'?(list||[]).filter(cdcConfiguration):(list||[]);
  if(candidates.length===1){$('#device').textContent='Ein zuvor freigegebenes Gerät gefunden. „K1 verbinden“ zum Öffnen.';$('#connect').textContent='Freigegebenes Gerät öffnen';$('#connect').onclick=()=>connect({kind,device:candidates[0]});}
 }catch(e){log('Gerätesuche: '+e.message);}
}
async function enableAudio(){
 if(audioOn){audioOn=false;audioSettings();$('#audio').textContent='Ton einschalten';if(audioNode)audioNode.port.postMessage({type:'clear'});return;}
 try{
  if(!audioCtx){
   audioCtx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:'playback'});await audioCtx.resume();
   if(!audioCtx.audioWorklet)throw new Error('AudioWorklet wird in diesem Browser-Kontext nicht angeboten.');
   const source=__AUDIO_WORKLET_SOURCE__;
   const u=URL.createObjectURL(new Blob([source],{type:'application/javascript'}));await audioCtx.audioWorklet.addModule(u);URL.revokeObjectURL(u);
   audioNode=new AudioWorkletNode(audioCtx,'k1-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[1]});const channel=new MessageChannel();audioNode.port.postMessage({type:'bind',port:channel.port1},[channel.port1]);worker.postMessage({type:'audioPort',port:channel.port2},[channel.port2]);audioNode.port.postMessage({type:'config',bufferMs:Number($('#audio-buffer').value)});perf.directAudio=true;audioNode.port.onmessage=e=>{if(e.data.type==='audioStats'){Object.assign(perf,{bufferMs:e.data.bufferMs,targetMs:e.data.targetMs,directAudio:e.data.direct,underruns:e.data.underruns,overflows:e.data.overflows});$('#audio-state').textContent='Direktaudio · Puffer '+e.data.bufferMs+'/'+e.data.targetMs+' ms · Nachpufferungen '+e.data.underruns;}};gainNode=audioCtx.createGain();gainNode.gain.value=Number($('#volume').value);audioNode.connect(gainNode).connect(audioCtx.destination);
  }
  await audioCtx.resume();audioOn=true;audioSettings();$('#audio').textContent='Ton ausschalten';$('#audio-state').textContent='Audio bereit · '+audioCtx.sampleRate+' Hz Ausgabe';log('Audioausgabe eingeschaltet.');
 }catch(e){if(audioCtx&&!audioNode){await audioCtx.close();audioCtx=null;}error(e);}
}
$('#connect').onclick=()=>connect();$('#disconnect').onclick=()=>disconnect();$('#audio').onclick=enableAudio;
$('#volume').oninput=()=>{if(gainNode)gainNode.gain.value=Number($('#volume').value);};
$('#slot').onchange=()=>{audioSettings();chosenSlot=$('#slot').value==='auto'?-1:Number($('#slot').value);if(audioNode)audioNode.port.postMessage({type:'clear'});drawCards();};
$('#audio-buffer').onchange=()=>{settings.bufferMs=Number($('#audio-buffer').value);try{localStorage.setItem('k1-dmr-web-options',JSON.stringify(settings));}catch{}if(audioNode)audioNode.port.postMessage({type:'config',bufferMs:settings.bufferMs});};
$('#transport').onchange=()=>{$('#connect').onclick=()=>connect();$('#connect').textContent='K1 verbinden';autoFind();};
$('#tuneform').onsubmit=async e=>{e.preventDefault();const t=$('#freq').value.trim().replace(/\s+/g,'').replace(',','.');if(!/^\d+(\.\d+)?$/.test(t)){error('Frequenz als MHz oder Hz eingeben.');return;}const v=Number(t),hz=Math.round((v<10000?v*1e6:v)/10)*10;if(hz<18000000||hz>1300000000){error('Empfangsfrequenz: 18–1300 MHz.');return;}try{await send(command(0x80,hz/10));$('#radio-state').textContent='Abstimmung angefordert · Bestätigung folgt im K1-Statuspaket.';}catch(e){error(e);}};
for(const key of ['eq','lf','gain','invert'])$('#'+key).onchange=opts;
$('#bw').onchange=()=>{opts();if(verified)send(command(0x81,settings.bw)).catch(error);};
$('#clear').onclick=()=>{rows.length=0;drawHistory();};
function csvLine(line){const out=[];let s='',q=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(q&&line[i+1]==='"'){s+='"';i++;}else q=!q;}else if(c===','&&!q){out.push(s);s='';}else s+=c;}out.push(s);return out;}
$('#radioid').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>100e6)throw new Error('CSV-Datei ist größer als 100 MB.');const lines=(await f.text()).replace(/^\uFEFF/,'').split(/\r?\n/);byId.clear();let imported=0;for(const line of lines){if(++imported%2000===0)await sleep(0);const c=csvLine(line);if(/^\d+$/.test(c[0])&&c[1])byId.set(+c[0],{call:c[1],name:[c[2],c[3]].filter(Boolean).join(' '),where:[c[4],c[5],c[6]].filter(Boolean).join(', ')});}$('#db-state').textContent=byId.size.toLocaleString('de-DE')+' Rufzeichen lokal geladen.';drawCards();drawHistory();}catch(e){error(e);}};
$('#save-log').onclick=()=>{const b=new Blob([JSON.stringify({version:'0.1.2',performance:perf,userAgent:navigator.userAgent,protocol:location.protocol,secure:isSecureContext,log:logLines,state},null,2)],{type:'application/json'});download(b,'K1_DMR_Diagnose.json');};
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function wavPCM(buffer){const dv=new DataView(buffer);if(dv.byteLength<44||dv.getUint32(0,false)!==0x52494646||dv.getUint32(8,false)!==0x57415645)throw new Error('Keine RIFF-WAV-Datei.');let fmt=null,data=null;for(let p=12;p+8<=dv.byteLength;){const size=dv.getUint32(p+4,true),end=p+8+size;if(end>dv.byteLength)throw new Error('Beschädigte WAV-Chunk-Länge.');const name=dv.getUint32(p,false);if(name===0x666d7420&&size>=16)fmt={format:dv.getUint16(p+8,true),channels:dv.getUint16(p+10,true),rate:dv.getUint32(p+12,true),bits:dv.getUint16(p+22,true)};if(name===0x64617461)data=buffer.slice(p+8,end);p=end+(size&1);}if(!fmt||!data||fmt.format!==1||fmt.channels!==1||fmt.rate!==48000||fmt.bits!==16)throw new Error('WAV muss PCM16, Mono, 48 kHz enthalten (Diskriminatorsignal, keine Sprachaufnahme).');return data;}
async function replayBuffer(buffer,pcm,label){
 if(!wasmReady)throw new Error('Decoder lädt noch.');if(link||connecting)throw new Error('Vor der Wiedergabe USB-Verbindung trennen.');if(replay)throw new Error('Wiedergabe läuft bereits.');
 replay=true;replayCancel=false;replayMarked=true;reset();$('#connect').disabled=true;$('#recording').disabled=true;$('#stop-replay').disabled=false;$('#selftest').disabled=true;$('#connection').textContent=label;$('#radio-state').textContent='Lokale Aufnahme / Test · kein Live-Empfang';setDot('bridge',false);
 const data=pcm?wavPCM(buffer):buffer;const block=pcm?9600:7680;const chunkDuration=pcm?block/2/48000:block/74200;
 const t0=performance.now();
 try{for(let p=0;p<data.byteLength&&!replayCancel;p+=block){await submit(pcm?'pcm':'feed',data.slice(p,Math.min(p+block,data.byteLength)),p/74200);$('#replay-state').textContent=label+' · '+Math.round(100*Math.min(p+block,data.byteLength)/data.byteLength)+' %';const target=t0+(p/block+1)*chunkDuration*1000;await sleep(Math.max(0,target-performance.now()));}await submit('poll',new ArrayBuffer(0));}
 finally{replay=false;opts();$('#connect').disabled=!capability();$('#recording').disabled=false;$('#stop-replay').disabled=true;$('#selftest').disabled=false;$('#connection').textContent=replayCancel?'Wiedergabe gestoppt':'Wiedergabe beendet';$('#replay-state').textContent=label+(replayCancel?' · gestoppt':' · beendet');
  if(label.startsWith('SYNTHETISCHER')&&!replayCancel){const s=state?.summary?.dmr?.slots||[];const ok=s[0]?.src===2625961&&s[1]?.src===2623456&&(state?.voice?.[1]?.frames||0)>=50&&(state?.voice?.[2]?.frames||0)>=50;$('#replay-state').textContent=ok?'SELBSTTEST BESTANDEN · beide DMR-IDs, TS1/TS2, TG 9/262 und AMBE-Audio dekodiert.':'SELBSTTEST FEHLGESCHLAGEN · Diagnose speichern und Decoder prüfen.';log($('#replay-state').textContent);}}
}
$('#recording').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;if(f.size>250e6)throw new Error('Aufnahme ist größer als 250 MB.');await replayBuffer(await f.arrayBuffer(),/\.wav$/i.test(f.name),f.name);}catch(e){error(e);}};
$('#stop-replay').onclick=()=>{replayCancel=true;};
$('#selftest').onclick=()=>{try{replayBuffer(Uint8Array.from(atob(SELFTEST_BASE64),c=>c.charCodeAt(0)).buffer,true,'SYNTHETISCHER SELBSTTEST · ID 2625961 / TG 9').catch(error);}catch(e){error(e);}};
// Replaced at packaging time with a real DMR RF-baseband WAV, including encoded AMBE.
const SELFTEST_BASE64='__SELFTEST_BASE64__';
setInterval(()=>{
 if(link){const elapsed=Math.max(.1,(performance.now()-startTime)/1000),rate=bytes/elapsed/1000;$('#data-rate').textContent=rate.toFixed(1)+' kB/s';$('#usb-meter').style.width=Math.min(100,rate/90*100)+'%';
  if(!verified&&elapsed>4)$('#radio-state').textContent='USB offen, noch keine laufende Digi Bridge erkannt. Am K1 F + 7 → Digi Bridge starten.';
  if(verified&&performance.now()-lastFrameWall>4000){$('#connection').textContent='Digi-Bridge-Datenstrom pausiert';$('#radio-state').textContent='Seit 4 Sekunden keine gültigen Pakete. Plugin und USB prüfen.';$('#tune').disabled=true;setDot('bridge',false);}
  else if(verified){$('#connection').textContent='Digi Bridge erkannt';$('#tune').disabled=false;setDot('bridge',true);}
 }
 if(wasmReady&&!pending.size&&!rxBusy)worker.postMessage({type:'poll'});
},1000);
navigator.usb?.addEventListener('disconnect',e=>{if(link?.device===e.device)disconnect('K1 abgezogen.');});
navigator.serial?.addEventListener('disconnect',()=>{if(link?.type==='serial')disconnect('Serielle USB-Verbindung getrennt.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&link)log('Browser im Hintergrund: USB-Empfang kann vom System gedrosselt werden.');});
window.addEventListener('pagehide',()=>{if(link)link.close().catch(()=>{});});
capability();drawCards();initWorker();
