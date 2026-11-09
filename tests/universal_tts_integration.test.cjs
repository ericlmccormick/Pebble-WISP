'use strict';
const assert=require('node:assert/strict');
const sdk=require('../src/pkjs/universal_tts.js');
const fs=require('node:fs'),path=require('node:path');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
const id='2c5edc42-b096-4f76-b284-1f27907e6502';
assert.equal(sdk.PLUGIN_UUID,id);
assert.equal(sdk.PERMISSION,'UniversalTtsSpeak');
assert.ok(fs.existsSync(path.join(__dirname,'../src/c/universal_tts.c')));
assert.ok(fs.existsSync(path.join(__dirname,'../src/c/universal_tts.h')));
assert.ok(manifest.pebble.usesPermissions.some(x=>x.plugin===id&&x.name==='InvokeAction'));
assert.ok(manifest.pebble.usesPermissions.some(x=>x.plugin===id&&x.name==='UniversalTtsSpeak'));

const wav=Buffer.alloc(44+8000);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);
wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(8000,40);
for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(3500*Math.sin(i/30)),i);
function fnv(buf){
  let h=2166136261>>>0;
  for(const b of buf)h=Math.imul((h^b)>>>0,16777619)>>>0;
  return h>>>0;
}
const actions=[],messages=[];
let complete,rejectComplete,ttsClient=null;
const done=new Promise((resolve,reject)=>{complete=resolve;rejectComplete=reject;});
const Pebble={
  invokeAction:async req=>{
    actions.push(req);
    assert.equal(req.plugin,id);
    if(req.action==='tts_prepare'){
      assert.ok(req.args.text.length<=500);
      return {ok:true,text:JSON.stringify({
        session_id:'tts1234',length:wav.length,chunk_bytes:6000,
        format:'pcm_s16le_wav',sample_rate:8000,channels:1,bits_per_sample:16,
        sample_count:4000,wav_checksum:fnv(wav),
        first_chunk:wav.subarray(0,6000).toString('base64'),
        first_chunk_checksum:fnv(wav.subarray(0,6000))
      })};
    }
    if(req.action==='tts_chunk'){
      assert.equal(req.args.offset,6000);
      const buf=wav.subarray(6000);
      return {ok:true,text:JSON.stringify({offset:6000,length:wav.length,
        audio:buf.toString('base64'),checksum:fnv(buf),done:true})};
    }
    if(req.action==='tts_release')return {ok:true,text:'{"released":true}'};
    throw Error('Unexpected action: '+req.action);
  },
  sendAppMessage:(message,success)=>{
    messages.push(message);if(success)success();
    if(message.TEXT&&/^(AUDIO_CHUNK|AUDIO_SENTENCE_END|AUDIO_STREAM_END)$/.test(message.COMMAND))
      setImmediate(()=>ttsClient.handleMessage({COMMAND:'AUDIO_ACK',TEXT:message.TEXT}));
  }
};
(async()=>{
  const storage=new Map();
  const tts=ttsClient=sdk.create({Pebble,storage:{
    getItem:key=>storage.get(key)||null,setItem:(key,v)=>storage.set(key,String(v))
  },onError:rejectComplete,onComplete:complete});
  await assert.rejects(tts.speak(''),/empty/);
  await tts.speak('Hello from WISP!');
  await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Speech transfer timed out')),7000))]);
  assert.ok(actions.some(x=>x.action==='tts_prepare'&&x.args.text==='Hello from WISP!'));
  assert.ok(actions.some(x=>x.action==='tts_chunk'));
  assert.ok(actions.some(x=>x.action==='tts_release'));
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_RESET'));
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_CHUNK'&&x.CHUNK.length));
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_SENTENCE_END'));
  assert.equal(tts.handleMessage({COMMAND:'AUDIO_STATS',TEXT:'frames=3'}),true);
  assert.equal(tts.handleMessage({COMMAND:'DICTATION'}),false);
  assert.ok(tts.diagnostics());
  tts.stop();
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_STOP'));
  console.log('PASS: Universal TTS session verification, BLE audio, release, and cancellation');
})().catch(e=>{console.error(e);process.exitCode=1;});
