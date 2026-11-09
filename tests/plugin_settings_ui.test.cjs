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
   name==='./agent_plugins'?require('../src/pkjs/agent_plugins'):Clay,
 console,Date,Math,JSON,Promise,isFinite,parseInt,setTimeout,clearTimeout,
 encodeURIComponent,decodeURIComponent};
vm.runInNewContext(app,ctx);
assert.equal(storage.TTS_BACKEND,'plugin','old direct TTS migrates to Universal TTS');
assert.equal(storage.TTS_API_KEY,undefined,'legacy app key must be removed');
assert.equal(storage.TTS_VOICE,undefined,'plugin owns voice');
listeners.showConfiguration();
const config=configs.at(-1);
const fields=config.flatMap(x=>x.items||[]);
const speech=fields.find(x=>x.messageKey==='TTS_BACKEND');
assert.ok(speech);
assert.equal(speech.options.length,2);
assert.equal(speech.options.some(x=>x.value==='direct'),false);
assert.ok(speech.options.some(x=>x.label.includes('Universal TTS')));
assert.equal(fields.some(x=>x.messageKey==='TTS_API_KEY'),false);
assert.equal(fields.some(x=>x.messageKey==='TTS_VOICE'),false);
const agent=fields.find(x=>x.messageKey==='GEMINI_BACKEND');
assert.ok(agent.options.some(x=>x.value==='agent:2c5edc42-b096-4f76-b284-1f27907e6501'));
assert.ok(fields.some(x=>x.messageKey==='APPEARANCE_MODE'));
assert.ok(fields.some(x=>x.messageKey==='FONT_SIZE'));
listeners.webviewclosed({response:encodeURIComponent(JSON.stringify({
  TTS_BACKEND:{value:'none'}, GEMINI_BACKEND:{value:'agent:2c5edc42-b096-4f76-b284-1f27907e6501'},
  TTS_API_KEY:{value:'must not store'},TTS_VOICE:{value:'must not store'}
}))});
assert.equal(storage.TTS_BACKEND,'none');
assert.equal(storage.TTS_API_KEY,undefined);
assert.equal(storage.TTS_VOICE,undefined);
assert.equal(manifest.pebble.displayName,'WISP');
assert.equal(manifest.name,'wisp');
assert.ok(manifest.pebble.usesPermissions.some(x=>x.name==='UniversalTtsSpeak'));
assert.equal(manifest.pebble.usesPermissions.some(x=>x.name==='GoogleTtsSpeak'),false);
console.log('PASS: Universal TTS settings migration, provider ownership and permissions');
