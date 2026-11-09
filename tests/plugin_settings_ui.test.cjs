'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../src/pkjs/index.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
const storage={GEMINI_BACKEND:'plugin',TTS_BACKEND:'direct',
  TTS_API_KEY:'legacy-app-level-secret',TTS_VOICE:'en-US-Wavenet-F'};
const configs=[],listeners={};
function Clay(config){configs.push(config);this.generateUrl=()=>'/settings';
  this.setSettings=obj=>{storage.clay=JSON.stringify(obj);};}
const Pebble={
  getActiveWatchInfo:()=>({platform:'emery'}),
  enumeratePlugins:()=>[{uuid:'2c5edc42-b096-4f76-b284-1f27907e6501',
    name:'AI Conversation',actions:[{name:'send_to_agent'}]}],
  addEventListener:(name,fn)=>{listeners[name]=fn;},
  sendAppMessage:(m,ok)=>{if(ok)ok();},
  invokeAction:async()=>({ok:true,text:'{}'}),
  openURL:()=>{}
};
const ctx={Pebble,
 localStorage:{getItem:k=>Object.prototype.hasOwnProperty.call(storage,k)?storage[k]:null,
   setItem:(k,v)=>{storage[k]=String(v);},removeItem:k=>delete storage[k]},
 require:name=>name==='./universal_tts'?{create:()=>({speak:async()=>{},
   stop:()=>{},handleMessage:()=>false})}:
   name==='./google_tts_legacy'?{create:()=>({speak:async()=>{},
   stop:()=>{},handleMessage:()=>false})}:
   name==='./agent_plugins'?require('../src/pkjs/agent_plugins'):Clay,
 console,Date,Math,JSON,Promise,isFinite,parseInt,setTimeout,clearTimeout,
 encodeURIComponent,decodeURIComponent};
vm.runInNewContext(app,ctx);
assert.equal(storage.TTS_BACKEND,'direct','legacy direct TTS selection survives upgrade');
assert.equal(storage.TTS_API_KEY,'legacy-app-level-secret','legacy key must survive upgrade');
assert.equal(storage.TTS_VOICE,'en-US-Wavenet-F','legacy selected voice must survive');
listeners.showConfiguration();
const config=configs.at(-1);
const fields=config.flatMap(x=>x.items||[]);
const speech=fields.find(x=>x.messageKey==='TTS_BACKEND');
assert.ok(speech);
assert.equal(speech.options.length,3);
assert.equal(speech.options.some(x=>x.value==='direct'),true);
assert.ok(speech.options.some(x=>x.label.includes('Universal TTS')));
assert.ok(fields.some(x=>x.messageKey==='TTS_API_KEY'));
assert.ok(fields.some(x=>x.messageKey==='TTS_VOICE'));
assert.equal(fields.find(x=>x.messageKey==='TTS_VOICE').defaultValue,'en-US-Wavenet-F');
const agent=fields.find(x=>x.messageKey==='GEMINI_BACKEND');
assert.ok(agent.options.some(x=>x.value==='agent:2c5edc42-b096-4f76-b284-1f27907e6501'));
assert.ok(fields.some(x=>x.messageKey==='APPEARANCE_MODE'));
assert.ok(fields.some(x=>x.messageKey==='FONT_SIZE'));
listeners.webviewclosed({response:encodeURIComponent(JSON.stringify({
  TTS_BACKEND:{value:'none'}, GEMINI_BACKEND:{value:'agent:2c5edc42-b096-4f76-b284-1f27907e6501'},
  TTS_API_KEY:{value:'must not store'},TTS_VOICE:{value:'must not store'}
}))});
assert.equal(storage.TTS_BACKEND,'none');
assert.equal(storage.TTS_API_KEY,'legacy-app-level-secret','switching to None must not delete old key');
assert.equal(storage.TTS_VOICE,'en-US-Wavenet-F','switching to None must not delete old voice');
listeners.webviewclosed({response:encodeURIComponent(JSON.stringify({
  TTS_BACKEND:{value:'direct'},TTS_API_KEY:{value:''},
  TTS_VOICE:{value:'en-US-Neural2-C'}
}))});
assert.equal(storage.TTS_BACKEND,'direct');
assert.equal(storage.TTS_API_KEY,'legacy-app-level-secret','blank field preserves existing key');
assert.equal(storage.TTS_VOICE,'en-US-Neural2-C','voice changes when direct selected');
listeners.webviewclosed({response:encodeURIComponent(JSON.stringify({
  TTS_BACKEND:{value:'plugin'},TTS_API_KEY:{value:'must-not-save'}
}))});
assert.equal(storage.TTS_BACKEND,'plugin');
assert.equal(storage.TTS_API_KEY,'legacy-app-level-secret','plugin mode does not erase old key');
assert.equal(manifest.pebble.displayName,'WISP');
assert.equal(manifest.name,'wisp');
assert.ok(manifest.pebble.usesPermissions.some(x=>x.name==='UniversalTtsSpeak'));
assert.equal(manifest.pebble.usesPermissions.some(x=>x.name==='GoogleTtsSpeak'),false);
console.log('PASS: Direct Google TTS upgrade retains voice/key, opt-out and Universal TTS selection');
