'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/pkjs/index.js'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
const agentUUID='2c5edc42-b096-4f76-b284-1f27907e6501';
const ttsUUID='2c5edc42-b096-4f76-b284-1f27907e6502';
const store={GEMINI_BACKEND:'agent:'+agentUUID,TTS_BACKEND:'plugin',TTS_PROVIDER_MIGRATED_V2:'true'};
const listeners={},sent=[],spoken=[],stops=[],directSpoken=[],directStops=[];
let aiResponse={ok:true,text:'Hello from WISP',received:true,status:'completed',reply_type:'assistant',provider:'gemini'};
const Pebble={
  enumeratePlugins:()=>[{uuid:agentUUID,name:'AI Conversation',actions:[{name:'send_to_agent'}]}],
  getActiveWatchInfo:()=>({platform:'emery'}),
  addEventListener:(name,handler)=>{listeners[name]=handler;},
  sendAppMessage:(value,success)=>{sent.push(value);if(success)success();},
  openURL:()=>{},
  invokeAction:async req=>{
    if(req.action==='send_to_agent')return aiResponse;
    if(req.action==='get_config')return {ok:true,text:JSON.stringify({provider:'gemini',provider_name:'Gemini'})};
    if(req.action==='clear_conversation')return {ok:true};
    throw Error('Unexpected action: '+req.action);
  }
};
function Clay(config){this.config=config;this.generateUrl=()=>'/config';this.setSettings=()=>{};}
const fakeTts={create:({pluginId})=>{
  assert.equal(pluginId,ttsUUID);
  return {speak:text=>{spoken.push(text);return Promise.resolve();},
    stop:()=>stops.push(true),handleMessage:()=>false};
}};
const fakeLegacy={create:()=>({
  speak:text=>{directSpoken.push(text);return Promise.resolve();},
  stop:()=>directStops.push(true),handleMessage:()=>false
})};
const ctx={Pebble,localStorage:{getItem:k=>Object.prototype.hasOwnProperty.call(store,k)?store[k]:null,
  setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>delete store[k]},
  require:name=>name==='./universal_tts'?fakeTts:
    name==='./google_tts_legacy'?fakeLegacy:
    name==='./agent_plugins'?require('../src/pkjs/agent_plugins'):Clay,
  console,Date,Math,JSON,Promise,isFinite,Number,parseInt,parseFloat,
  setTimeout,clearTimeout,decodeURIComponent,encodeURIComponent};
vm.runInNewContext(source,ctx);
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
async function ask(text,speaker=1,volume=100){
  const start=sent.length;
  listeners.appmessage({payload:{COMMAND:'DICTATION',TEXT:text,SPEAKER_CAPABLE:speaker,VOLUME:volume}});
  await settle();
  return sent.slice(start).filter(m=>String(m.COMMAND).startsWith('TEXT_RESPONSE'));
}
(async()=>{
  let out=await ask('Hello');
  assert.ok(out.some(x=>x.COMMAND==='TEXT_RESPONSE_8_16'&&x.TEXT==='Hello from WISP'));
  assert.equal(spoken.at(-1),'Hello from WISP',
    'the text displayed on the watch must be spoken via Universal TTS');

  aiResponse={ok:true,text:'Sent to ChatGPT'};
  out=await ask('Transfer this message');
  assert.ok(out.some(x=>x.TEXT==='Sent to ChatGPT'));
  assert.equal(spoken.at(-1),'Sent to ChatGPT',
    'displayed receipts must also be eligible for speech');

  aiResponse={ok:true,text:'A'.repeat(850)};
  out=await ask('Long answer');
  const shown=out.find(x=>x.COMMAND==='TEXT_RESPONSE_8_16');
  assert.ok(shown&&shown.TEXT.length<=700);
  assert.equal(spoken.at(-1),shown.TEXT,
    'only the text actually displayed should be spoken');

  const count=spoken.length;
  ctx.ttsBackend='none';
  out=await ask('Text only');
  assert.ok(out.some(x=>x.COMMAND==='TEXT_RESPONSE_NO_AUDIO'));
  assert.equal(spoken.length,count);
  ctx.ttsBackend='plugin';
  out=await ask('Unsupported watch',0,0);
  assert.ok(out.some(x=>x.COMMAND==='TEXT_RESPONSE_NO_AUDIO'));
  assert.equal(spoken.length,count);

  assert.ok(stops.length>=4,'new questions must stop previous Universal TTS speech');
  // Legacy direct must use a separate Google TTS instance, not require the plugin.
  ctx.ttsBackend='direct';
  ctx.ttsApiKey='old-existing-google-key';
  aiResponse={ok:true,text:'Legacy Google speech still works'};
  out=await ask('Legacy speech');
  assert.ok(out.some(x=>x.COMMAND==='TEXT_RESPONSE_8_16'&&
    x.TEXT==='Legacy Google speech still works'));
  assert.equal(directSpoken.at(-1),'Legacy Google speech still works');
  assert.equal(spoken.at(-1),shown.TEXT,'direct mode must not invoke the Universal plugin');

  ctx.ttsBackend='plugin';
  aiResponse={ok:true,text:'Plugin speech still works'};
  out=await ask('Plugin speech');
  assert.equal(spoken.at(-1),'Plugin speech still works');
  assert.ok(directStops.length>0,'transition must cancel the legacy direct stream');

  assert.match(source,/universalTts\.speak\(displayText\)/);
  assert.doesNotMatch(source,/googleTtsStream\.stream/);
  assert.doesNotMatch(source,/function startBLESendLoop/);

  const c=fs.readFileSync(path.join(__dirname,'../src/c/main.c'),'utf8');
  assert.match(c,/universal_tts_handle_message\(iterator\)/);
  assert.match(c,/universal_tts_set_volume\(s_volume\)/);
  assert.match(c,/universal_tts_init\(\)/);
  assert.doesNotMatch(c,/static uint8_t s_ring_buffer/);
  const perms=manifest.pebble.usesPermissions;
  assert.ok(perms.some(p=>p&&p.name==='UniversalTtsSpeak'&&p.plugin===ttsUUID));
  assert.equal(perms.some(p=>p&&p.name==='GoogleTtsSpeak'),false);
  assert.equal(manifest.pebble.uuid,'426c68c7-bdd7-445a-860a-ea587a188993');
  assert.deepEqual(manifest.pebble.targetPlatforms.slice().sort(),
    ['basalt','chalk','diorite','flint','emery','gabbro'].sort());

  // Compatibility migration must never delete or silently switch existing
  // Gemini with Voice Direct Google TTS settings.
  const fn=source.slice(source.indexOf('function migrateSpeechProvider(){'),
     source.indexOf('var ttsBackend=migrateSpeechProvider();')+
       'var ttsBackend=migrateSpeechProvider();'.length);
  function migrate(values){
    const local={...values};
    const target={localStorage:{getItem:k=>local[k]??null,
      setItem:(k,v)=>{local[k]=String(v);},removeItem:k=>delete local[k]}};
    vm.runInNewContext(fn,target);
    return {provider:target.ttsBackend,local};
  }
  assert.equal(migrate({TTS_BACKEND:'direct',TTS_API_KEY:'key'}).provider,'direct');
  assert.equal(migrate({TTS_API_KEY:'old-key'}).provider,'direct');
  assert.equal(migrate({}).provider,'plugin');
  assert.equal(migrate({TTS_BACKEND:'none'}).provider,'none');
  assert.equal(migrate({TTS_BACKEND:'plugin',ENABLE_TTS:'false'}).provider,'none');
  assert.equal(migrate({TTS_BACKEND:'plugin',ENABLE_TTS:'false',
    TTS_PROVIDER_MIGRATED_V2:'true'}).provider,'plugin');
  const legacy=migrate({TTS_BACKEND:'direct',TTS_API_KEY:'old-key',
    TTS_VOICE:'en-US-Neural2-F'});
  assert.equal(legacy.local.TTS_API_KEY,'old-key');
  assert.equal(legacy.local.TTS_VOICE,'en-US-Neural2-F');
  assert.equal(legacy.local.TTS_BACKEND,'direct');
  assert.equal(migrate({TTS_BACKEND:'none',TTS_API_KEY:'old-key'}).provider,'none');
  console.log('PASS: Universal and direct Google TTS both speak displayed text; preserves legacy keys, voices and opt-out');
})().catch(e=>{console.error(e);process.exitCode=1;});
