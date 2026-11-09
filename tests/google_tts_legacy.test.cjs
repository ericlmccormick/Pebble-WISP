'use strict';
const assert=require('node:assert/strict');
const legacy=require('../src/pkjs/google_tts_legacy');
const UniversalTts=require('../src/pkjs/universal_tts');

// Google may include extra WAV metadata chunks; the direct adapter must
// normalize its response into the 44-byte format required by Universal TTS.
const wav=Buffer.alloc(44+8000);
wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);
wav.write('WAVE',8);wav.write('fmt ',12);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);
wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
wav.write('data',36);wav.writeUInt32LE(8000,40);
for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(3000*Math.sin(i/100)),i);
const extra=Buffer.from([76,73,83,84,4,0,0,0,73,78,70,79]); // LIST INFO
const withList=Buffer.concat([wav.subarray(0,12),extra,wav.subarray(12)]);
withList.writeUInt32LE(withList.length-8,4);
const canonical=legacy.canonicalWav(withList.toString('base64'));
assert.equal(canonical.length,wav.length);
assert.equal(canonical.slice(0,44),wav.subarray(0,44).toString('binary'));
assert.equal(legacy.decode64(legacy.encode64(canonical)),canonical);
assert.ok(legacy.fnv(canonical)>0);
assert.throws(()=>legacy.canonicalWav('not a WAV'),/WAV|base64/);
const actions=[],messages=[];
let voice='en-US-Neural2-F',key='old-app-stored-google-key',fallbackVoice=null;
let currentResolve,currentReject;
const done=()=>new Promise((resolve,reject)=>{currentResolve=resolve;currentReject=reject;});
let requests=0;
const Pebble={
  sendAppMessage:(message,success)=>{messages.push(message);if(success)success();}
};
const synthFetch=async(url,options)=>{
  assert.ok(url.startsWith('https://texttospeech.googleapis.com/v1/text:synthesize?key='));
  assert.ok(url.endsWith(encodeURIComponent(key)));
  const body=JSON.parse(options.body);
  assert.equal(body.audioConfig.audioEncoding,'LINEAR16');
  assert.equal(body.audioConfig.sampleRateHertz,8000);
  assert.equal(body.voice.name,voice);
  assert.ok(body.input.text.length<=500,'segmented Google TTS request');
  requests++;
  actions.push({url,body});
  return {ok:true,json:async()=>({audioContent:withList.toString('base64')})};
};
const memory=new Map();
const storage={getItem:key=>memory.get(key)||null,
  setItem:(key,value)=>memory.set(key,String(value))};
const tts=legacy.create({
  Pebble,UniversalTts,fetch:synthFetch,storage,
  getKey:()=>key,getVoice:()=>voice,
  saveVoice:value=>{fallbackVoice=value;voice=value;},
  onComplete:()=>{if(currentResolve)currentResolve();},
  onError:error=>{if(currentReject)currentReject(error);}
});
(async()=>{
  let end=done();
  await tts.speak('Working legacy speech!');
  await Promise.race([end,new Promise((_,reject)=>setTimeout(()=>reject(Error('Direct TTS completion timed out')),5000))]);
  assert.equal(requests,1);
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_RESET'));
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_CHUNK'&&x.CHUNK.length>0));
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_SENTENCE_END'));
  assert.ok(tts.diagnostics());
  tts.stop();
  assert.ok(messages.some(x=>x.COMMAND==='AUDIO_STOP'));

  // SDK automatically segments a long response, so the legacy path cannot
  // violate Google's per-request limits.
  end=done();
  await tts.speak('This is a long response segment. '.repeat(18));
  await Promise.race([end,new Promise((_,reject)=>setTimeout(()=>reject(Error('Long direct speech timed out')),7000))]);
  assert.ok(requests>=3,'long responses need several Google TTS calls');
  assert.ok(actions.every(a=>a.body.input.text.length<=500));

  // A missing saved key must show a recoverable error without silently
  // falling back to another provider or storing/revealing credentials.
  key='';
  const errors=new Promise(resolve=>{
    currentResolve=()=>{};
    currentReject=resolve;
  });
  await tts.speak('No key');
  const err=await Promise.race([errors,new Promise((_,reject)=>setTimeout(()=>reject(Error('No-key error not surfaced')),5000))]);
  assert.match(String(err.message||err),/Missing Direct Google TTS key/);
  tts.stop();

  // The old invalid-voice behavior falls back to WaveNet F once.
  key='old-app-stored-google-key';
  voice='en-US-Neural2-F';
  let invalid=true;
  const fallback=legacy.create({
    Pebble,UniversalTts,getKey:()=>key,getVoice:()=>voice,
    saveVoice:value=>{fallbackVoice=value;voice=value;},
    fetch:async(url,options)=>{
      const body=JSON.parse(options.body);
      if(invalid){
        invalid=false;
        return {ok:false,status:400,json:async()=>({error:{message:"Voice does not exist"}})};
      }
      assert.equal(body.voice.name,'en-US-Wavenet-F');
      return {ok:true,json:async()=>({audioContent:wav.toString('base64')})};
    },
    onComplete:()=>{if(currentResolve)currentResolve();},
    onError:error=>{if(currentReject)currentReject(error);}
  });
  end=done();
  await fallback.speak('Fallback voice check');
  await Promise.race([end,new Promise((_,reject)=>setTimeout(()=>reject(Error('Voice fallback timed out')),5000))]);
  assert.equal(fallbackVoice,'en-US-Wavenet-F');
  fallback.stop();
  console.log('PASS: legacy Google TTS uses shared SDK, preserves voice/key, verifies WAV, handles length/error/fallback');
})().catch(e=>{console.error(e);process.exitCode=1;});
