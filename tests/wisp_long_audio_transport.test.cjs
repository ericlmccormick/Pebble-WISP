'use strict';
/* Drive the actual WISP PKJS sender and Google/Universal TTS adapter through a
 * 10-second, 8-kHz WAV stream. The mocked watch has a 16-KiB ring, watch ACKs,
 * one lost ACK, one BUSY/WAIT, and out-of-order plugin chunk completions.
 * Unlike stale Universal-SDK tests, this executes the current WISP code.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const assert=require('node:assert/strict');
const agentId='2c5edc42-b096-4f76-b284-1f27907e6501';
const ttsId='2c5edc42-b096-4f76-b284-1f27907e6502';
const SAMPLE_COUNT=80000,WAV_BYTES=SAMPLE_COUNT*2;
const wav=Buffer.alloc(44+WAV_BYTES);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);
wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(WAV_BYTES,40);
for(let i=44;i<wav.length;i+=2)
  wav.writeInt16LE(Math.round(9000*Math.sin((i-44)*Math.PI/60)),i);
function hash(buf){let h=2166136261>>>0;
  for(const v of buf)h=Math.imul((h^v)>>>0,16777619)>>>0;
  return h>>>0;
}
const meta={
  format:'pcm_s16le_wav',sample_rate:8000,channels:1,bits_per_sample:16,
  length:wav.length,sample_count:SAMPLE_COUNT,chunk_bytes:6000,
  session_id:'ttsplaybacktenseconds',wav_checksum:hash(wav),
  first_chunk:wav.subarray(0,6000).toString('base64'),
  first_chunk_checksum:hash(wav.subarray(0,6000))
};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const storage={GEMINI_BACKEND:'agent:'+agentId,TTS_BACKEND:'plugin',
  TTS_PROVIDER_MIGRATED_V2:'true'};
const listeners={},allSent=[],received=[],seen=new Set(),deliveryCount=new Map();
const ringCapacity=16384,adpcmPerSecond=4000;
let ring=0,consumed=0,lastClock=Date.now(),playing=false;
let activeId=0,expected=0,waits=0,duplicates=0,lostAcks=0;
let prepareCount=0,chunkCount=0,releases=0,finalSeen=0,errors=[];
let complete,failed;
const completion=new Promise((resolve,reject)=>{complete=resolve;failed=reject;});
function drain(){
  const now=Date.now(),delta=now-lastClock;
  lastClock=now;
  if(playing){
    let take=Math.min(ring,Math.floor(delta*adpcmPerSecond/1000));
    ring-=take;consumed+=take;
  }
  if(!playing&&ring>=5600)playing=true;
}
function callback(command,from){
  setTimeout(()=>{
    const fn=listeners.appmessage;
    if(fn)fn({payload:{COMMAND:command,STREAM_ID:from.STREAM_ID,
      SEQ:from.SEQ,BUFFER_FREE:ringCapacity-ring}});
  },20);
}
const Pebble={
  enumeratePlugins:()=>[{uuid:agentId,name:'AI Conversation',
    actions:[{name:'send_to_agent'}]}],
  getActiveWatchInfo:()=>({platform:'emery'}),
  addEventListener:(name,handler)=>{listeners[name]=handler;},
  openURL:()=>{},
  invokeAction:async req=>{
    if(req.plugin===agentId){
      if(req.action==='send_to_agent')
        return {ok:true,text:'This spoken response exercises ten continuous seconds of audio through the Universal TTS plugin and WISP Bluetooth audio.',received:true,
          reply_type:'assistant',status:'completed',provider:'gemini'};
      if(req.action==='get_config')
        return {ok:true,text:JSON.stringify({provider:'gemini',provider_name:'Gemini'})};
      if(req.action==='clear_conversation')return {ok:true,text:'{}'};
    }
    assert.equal(req.plugin,ttsId,'speech must use current Universal TTS UUID');
    if(req.action==='tts_prepare'){
      prepareCount++;
      assert.ok(req.args.text.length>0&&req.args.text.length<=500);
      return {ok:true,text:JSON.stringify(meta)};
    }
    if(req.action==='tts_chunk'){
      chunkCount++;
      const offset=req.args.offset;
      // The newer plugin may deliver concurrent chunks out of order.
      await sleep(offset%18000===0?90:(offset%12000===0?60:22));
      const part=wav.subarray(offset,offset+6000);
      return {ok:true,text:JSON.stringify({offset,audio:part.toString('base64'),
        length:wav.length,checksum:hash(part),done:offset+part.length===wav.length})};
    }
    if(req.action==='tts_release'){releases++;return {ok:true,text:'{}'};}
    throw Error('Unexpected action '+req.action);
  },
  sendAppMessage:(p,onSuccess,onFailure)=>{
    allSent.push(p);
    if(p.COMMAND==='TEXT_RESPONSE_8_16'){
      activeId=p.STREAM_ID;
      ring=0;playing=false;expected=0;lastClock=Date.now();
      if(onSuccess)onSuccess();return;
    }
    if(p.COMMAND==='AUDIO_ERROR'||p.COMMAND==='TTS_FAILURE'){
      errors.push(p);if(onSuccess)onSuccess();failed(Error('WISP audio error '+JSON.stringify(p)));return;
    }
    if(!/^(AUDIO_CHUNK|AUDIO_SENTENCE_END|AUDIO_STREAM_END)$/.test(p.COMMAND)){
      if(onSuccess)onSuccess();return;
    }
    assert.equal(p.STREAM_ID,activeId,'watch session must match displayed text');
    const tag=String(p.SEQ),count=(deliveryCount.get(tag)||0)+1;
    deliveryCount.set(tag,count);
    setTimeout(()=>{
      drain();
      if(p.SEQ<expected){
        duplicates++;
        if(onSuccess)onSuccess();
        callback('AUDIO_ACK',p);return;
      }
      assert.equal(p.SEQ,expected,'WISP must send ACKed audio in order');
      if(p.COMMAND==='AUDIO_CHUNK'&&p.SEQ===5&&count===1){
        waits++;
        if(onSuccess)onSuccess();
        callback('AUDIO_WAIT',p);return;
      }
      if(p.COMMAND==='AUDIO_CHUNK'&&ring+p.CHUNK.length>ringCapacity){
        waits++;
        if(onSuccess)onSuccess();
        callback('AUDIO_WAIT',p);return;
      }
      if(p.COMMAND==='AUDIO_CHUNK'){
        assert.ok(p.CHUNK.length<=700,'700 bytes per AppMessage is the tested upper bound');
        ring+=p.CHUNK.length;
        received.push(...p.CHUNK);
      }
      expected++;
      if(onSuccess)onSuccess();
      if(p.SEQ===10&&count===1){lostAcks++;return;}
      callback('AUDIO_ACK',p);
      if(p.COMMAND==='AUDIO_STREAM_END'){finalSeen++;complete();}
    },18);
  }
};
function Clay(){this.generateUrl=()=>'/settings';this.setSettings=()=>{};}
const source=fs.readFileSync(path.join(__dirname,'../src/pkjs/index.js'),'utf8');
const context={
  Pebble,localStorage:{
    getItem:k=>Object.hasOwn(storage,k)?storage[k]:null,
    setItem:(k,v)=>{storage[k]=String(v);},
    removeItem:k=>delete storage[k]
  },
  require:id=>id==='./google_tts_stream'?require('../src/pkjs/google_tts_stream'):
    id==='./agent_plugins'?require('../src/pkjs/agent_plugins'):Clay,
  console:{log:()=>{},warn:()=>{},error:console.error},
  Promise,Math,Date,JSON,Number,Array,Error,String,isFinite,parseInt,parseFloat,
  Uint8Array,atob:b64=>Buffer.from(b64,'base64').toString('binary'),
  fetch:()=>Promise.reject(Error('Direct fetch not expected')),setTimeout,clearTimeout,
  encodeURIComponent,decodeURIComponent
};
vm.runInNewContext(source,context);
(async()=>{
  listeners.appmessage({payload:{COMMAND:'DICTATION',TEXT:'Ten second transport test',SPEAKER_CAPABLE:1,VOLUME:100}});
  await Promise.race([completion,
    sleep(32000).then(()=>{throw Error('10-second WISP audio stream hung or cut out: received '+received.length+' bytes');})]);
  drain();
  assert.equal(finalSeen,1,'the response must have exactly one final marker');
  assert.equal(prepareCount,1,'one TTS sentence should be prepared');
  assert.equal(releases,1,'the plugin WAV session must be released');
  assert.ok(chunkCount>=26,'all 160k PCM WAV bytes must be retrieved from Universal TTS');
  assert.equal(received.length,SAMPLE_COUNT/2,
    'all ten seconds (40000 ADPCM bytes) must reach the watch, not 2-3 seconds');
  assert.ok(waits>=1,'watch buffer backpressure must not terminate speech');
  assert.equal(lostAcks,1);
  assert.ok(duplicates>=1,'a lost ACK must be safely retried without replay');
  assert.equal(errors.length,0);
  const c=fs.readFileSync(path.join(__dirname,'../src/c/main.c'),'utf8');
  assert.match(c,/#define PLAYBACK_INTERVAL_MS 40\b/);
  assert.match(c,/#define START_BUFFER_THRESHOLD 5600\b/);
  console.log('PASS: WISP actual 10s sender delivered '+received.length+
    ' ADPCM bytes via '+expected+' ACKed packets; '+waits+
    ' backpressure waits, '+duplicates+' duplicate suppression, no audio cutoff');
})().catch(e=>{console.error(e);process.exitCode=1;});
