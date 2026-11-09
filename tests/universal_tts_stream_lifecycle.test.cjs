'use strict';
const assert=require('node:assert/strict');
const sdk=require('../src/pkjs/universal_tts');
function fnv(buf){let h=2166136261>>>0;for(const b of buf)h=Math.imul((h^b)>>>0,16777619)>>>0;return h>>>0;}
function wavFor(text){
  const sampleCount=4000; // half a second of speech, enough to expose gaps
  const b=Buffer.alloc(44+2*sampleCount);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);
  b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);
  b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(sampleCount*2,40);
  for(let i=44;i<b.length;i+=2)b.writeInt16LE(Math.round(3500*Math.sin(i/(text.length+33))),i);
  return b;
}
const sessions=new Map(),messages=[],actions=[],diag=new Map(),spoken=[],errors=[];
let resolveDone;
const done=new Promise(r=>{resolveDone=r;});
const Pebble={
  invokeAction:async function(req){
    actions.push(req);
    if(req.action==='tts_prepare'){
      const id=req.args.text.startsWith('First')?'first':'second';
      spoken.push(req.args.text);
      if(id==='second'){
        // Delayed next sentence: the original native 1.5s auto-close would
        // terminate this playback before the second speech arrives.
        await new Promise(resolve=>setTimeout(resolve,2700));
      }
      const wav=wavFor(req.args.text);
      sessions.set(id,wav);
      const first=wav.subarray(0,6000);
      return {ok:true,text:JSON.stringify({
        session_id:id,format:'pcm_s16le_wav',sample_rate:8000,channels:1,
        bits_per_sample:16,sample_count:4000,length:wav.length,
        wav_checksum:fnv(wav),chunk_bytes:6000,
        first_chunk:first.toString('base64'),first_chunk_checksum:fnv(first)
      })};
    }
    if(req.action==='tts_chunk'){
      const wav=sessions.get(req.args.session_id),offset=req.args.offset;
      const chunk=wav.subarray(offset,offset+6000);
      return {ok:true,text:JSON.stringify({offset,audio:chunk.toString('base64'),checksum:fnv(chunk)})};
    }
    if(req.action==='tts_release')return {ok:true,text:'{"released":true}'};
    throw Error('unexpected action '+req.action);
  },
  sendAppMessage:function(message,ok,fail){
    messages.push(message);
    if(ok)ok();
  }
};
async function run(){
  const tts=sdk.create({
    Pebble,storage:{getItem:k=>diag.get(k)||null,setItem:(k,v)=>diag.set(k,String(v))},
    onError:e=>errors.push(String(e&&e.message||e)),
    onComplete:resolveDone
  });
  await tts.speak('First sentence. Second sentence.');
  await Promise.race([done,new Promise((_,reject)=>setTimeout(()=>reject(Error('Audio response did not complete')),10000))]);
  assert.equal(errors.length,0,'no plugin/transport error during 2.7s speech gap');
  assert.equal(spoken.length,2,'both sentences must be synthesized');
  const cmds=messages.map(m=>m.COMMAND);
  assert.equal(cmds[0],'AUDIO_RESET');
  const finalIndex=cmds.lastIndexOf('AUDIO_STREAM_END');
  assert.ok(finalIndex>0,'explicit final stream signal must be sent');
  assert.equal(cmds.filter(c=>c==='AUDIO_STREAM_END').length,1);
  assert.equal(cmds.filter(c=>c==='AUDIO_SENTENCE_END').length,2);
  assert.ok(finalIndex>cmds.lastIndexOf('AUDIO_SENTENCE_END'),
    'final stream signal must follow last sentence, not first');
  assert.equal(cmds.includes('AUDIO_STOP'),false,'audio cannot be stopped between sentences');
  assert.ok(tts.diagnostics());
  const c=require('node:fs').readFileSync(require('node:path').join(__dirname,'../src/c/universal_tts.c'),'utf8');
  assert.match(c,/AUDIO_STREAM_END/);
  assert.match(c,/s_stream_end_received && !s_stream_close_timer/);
  assert.match(c,/STREAM_IDLE_FAILSAFE_MS 30000/);
  assert.doesNotMatch(c,/schedule_close_timer\(\);clear_stats/);
  console.log('PASS: two-sentence TTS survives 2.7s synthesis gap and explicitly closes after final audio');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
