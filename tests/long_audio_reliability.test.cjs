'use strict';
/* 10-second full-length WAV over the *real* Universal TTS JS sender.
 * Emulates the watch ACK path, one full-buffer WAIT, one lost ACK and one
 * phone-side send failure. No 2-3s cutoff or duplicate ADPCM is allowed.
 */
const assert=require('node:assert/strict');
const UniversalTts=require('../src/pkjs/universal_tts');
const SAMPLE_COUNT=80000,PCM_BYTES=SAMPLE_COUNT*2;
const wav=Buffer.alloc(44+PCM_BYTES);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);
wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);
wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(PCM_BYTES,40);
for(let i=44;i<wav.length;i+=2)wav.writeInt16LE((i/2*17)%20000-10000,i);
function fnv(buf){let h=2166136261>>>0;for(const x of buf)h=Math.imul((h^x)>>>0,16777619)>>>0;return h>>>0;}
const payloads=[],seen=new Set(),received=[],attempts=new Map(),diag=new Map();
let tts,accepted=0,waits=0,lostAcks=0,retries=0,complete=0;
let finished,rejected;
const completion=new Promise((resolve,reject)=>{finished=resolve;rejected=reject;});
function watchAck(msg,command){
  setTimeout(()=>tts.handleMessage({COMMAND:command,TEXT:msg.TEXT}),2);
}
const Pebble={
  invokeAction:async req=>{
    if(req.action==='tts_prepare'){
      const first=wav.subarray(0,6000);
      return {ok:true,text:JSON.stringify({
        session_id:'ten-seconds',format:'pcm_s16le_wav',sample_rate:8000,
        channels:1,bits_per_sample:16,sample_count:SAMPLE_COUNT,
        length:wav.length,wav_checksum:fnv(wav),chunk_bytes:6000,
        first_chunk:first.toString('base64'),first_chunk_checksum:fnv(first)
      })};
    }
    if(req.action==='tts_chunk'){
      const b=wav.subarray(req.args.offset,req.args.offset+6000);
      return {ok:true,text:JSON.stringify({offset:req.args.offset,
        audio:b.toString('base64'),checksum:fnv(b)})};
    }
    if(req.action==='tts_release')return {ok:true,text:'{"released":true}'};
    throw Error('Unexpected TTS action '+req.action);
  },
  sendAppMessage:function(msg,onSuccess,onFailure){
    payloads.push(msg);
    if(msg.COMMAND==='AUDIO_RESET'){
      seen.clear();
      if(onSuccess)onSuccess();
      return;
    }
    if(!/^(AUDIO_CHUNK|AUDIO_SENTENCE_END|AUDIO_STREAM_END)$/.test(msg.COMMAND)){
      if(onSuccess)onSuccess();return;
    }
    const tag=msg.TEXT,seq=Number(tag.split(':')[1]);
    const count=(attempts.get(tag)||0)+1;
    attempts.set(tag,count);
    if(seq===70&&count===1){
      // Phone rejection does not mean accepted at watch.
      if(onFailure)onFailure(new Error('Simulated transient BLE transport failure'));
      return;
    }
    if(seq===20&&count===1){
      waits++;
      if(onSuccess)onSuccess();
      watchAck(msg,'AUDIO_WAIT');
      return;
    }
    if(seen.has(tag)){
      retries++;
      if(onSuccess)onSuccess();
      watchAck(msg,'AUDIO_ACK');
      return;
    }
    seen.add(tag);
    if(msg.COMMAND==='AUDIO_CHUNK'){
      assert.ok(msg.CHUNK.length<=360,'packets must stay within proven BLE size');
      received.push(...msg.CHUNK);
      accepted++;
    }
    if(onSuccess)onSuccess();
    if(seq===35&&count===1){
      // The watch accepted the packet, but its ACK got lost. Retry the
      // same sequence; the watch must deduplicate and ACK without replay.
      lostAcks++;
      return;
    }
    watchAck(msg,'AUDIO_ACK');
  }
};
tts=UniversalTts.create({
  Pebble,storage:{getItem:k=>diag.get(k)||null,setItem:(k,v)=>diag.set(k,String(v))},
  onError:rejected,onComplete:()=>{complete++;finished();}
});
(async()=>{
  await tts.speak('This is a long, ten second end to end speech test with packet loss.');
  await Promise.race([completion,
    new Promise((_,reject)=>setTimeout(()=>reject(Error('Long audio stream hung')),17000))]);
  assert.equal(complete,1);
  assert.equal(waits,1);
  assert.equal(lostAcks,1);
  assert.ok(retries>=1,'lost ACK must cause a same-sequence retry');
  assert.ok(accepted>100);
  assert.equal(received.length,SAMPLE_COUNT/2,'all ten seconds of ADPCM must reach watch');
  assert.equal(payloads.filter(x=>x.COMMAND==='AUDIO_STREAM_END').length,1);
  assert.equal(payloads.filter(x=>x.COMMAND==='AUDIO_STOP').length,0);
  assert.equal(seen.size,accepted+2,'every unique sequence must be received once');
  console.log('PASS: full 10-second audio; '+accepted+' packets, '+received.length+
    ' bytes; BLE failure, WATCH_WAIT and lost ACK recovered without losing audio');
})().catch(e=>{console.error(e);process.exitCode=1;});
