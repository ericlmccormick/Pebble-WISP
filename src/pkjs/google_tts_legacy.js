/* Compatibility bridge for existing Gemini-with-Voice Direct Google TTS users.
 * Uses the unchanged Universal TTS SDK + native receiver for audio playback.
 * No external plugin is invoked in direct mode; the old app-held Google key
 * and selected voice are used with the same Google REST synthesis endpoint.
 */
'use strict';
var CHUNK_BYTES=6000;
var MAX_WAV_BYTES=1500000;
var SESSION_TTL_MS=180000;
var b64alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decode64(b64){
  if(typeof b64!=='string'||!b64.length)throw Error('Google TTS returned no audio');
  if(typeof atob==='function')return atob(b64);
  var out='',val=0,bits=0;
  for(var i=0;i<b64.length;i++){
    var c=b64.charAt(i);
    if(c==='=')break;
    var p=b64alphabet.indexOf(c);
    if(p<0)throw Error('Invalid Google TTS base64 audio');
    val=(val<<6)|p;bits+=6;
    if(bits>=8){bits-=8;out+=String.fromCharCode((val>>bits)&255);}
  }
  return out;
}
function encode64(binary){
  var out='';
  for(var i=0;i<binary.length;i+=3){
    var a=binary.charCodeAt(i)&255;
    var b=i+1<binary.length?binary.charCodeAt(i+1)&255:0;
    var c=i+2<binary.length?binary.charCodeAt(i+2)&255:0;
    out+=b64alphabet.charAt(a>>2);
    out+=b64alphabet.charAt(((a&3)<<4)|(b>>4));
    out+=i+1<binary.length?b64alphabet.charAt(((b&15)<<2)|(c>>6)):'=';
    out+=i+2<binary.length?b64alphabet.charAt(c&63):'=';
  }
  return out;
}
function fnv(binary){
  var hash=2166136261>>>0;
  for(var i=0;i<binary.length;i++)hash=Math.imul((hash^binary.charCodeAt(i))>>>0,16777619)>>>0;
  return hash>>>0;
}
function bytes16(v){
  return String.fromCharCode(v&255,(v>>8)&255);
}
function bytes32(v){
  return String.fromCharCode(v&255,(v>>8)&255,(v>>16)&255,(v>>24)&255);
}
function canonicalWav(inputBase64){
  var wav=decode64(inputBase64);
  if(wav.length<44||wav.substr(0,4)!=='RIFF'||wav.substr(8,4)!=='WAVE')
    throw Error('Invalid Google TTS WAV header');
  function u16(p){return wav.charCodeAt(p)|(wav.charCodeAt(p+1)<<8);}
  function u32(p){return (wav.charCodeAt(p)|wav.charCodeAt(p+1)<<8|
    wav.charCodeAt(p+2)<<16|wav.charCodeAt(p+3)<<24)>>>0;}
  var fmt=false,off=12,pcm=null;
  while(off+8<=wav.length){
    var id=wav.substr(off,4),size=u32(off+4),start=off+8;
    if(size>wav.length-start)throw Error('Truncated Google TTS WAV');
    if(id==='fmt '){
      if(size<16||u16(start)!==1||u16(start+2)!==1||
        u32(start+4)!==8000||u16(start+14)!==16)
        throw Error('Google TTS returned unsupported audio format (need 8kHz mono PCM16)');
      fmt=true;
    }else if(id==='data'){
      pcm=wav.substr(start,size);
    }
    off=start+size+(size&1);
  }
  if(!fmt||pcm===null||!pcm.length||pcm.length%2)
    throw Error('Google TTS returned invalid PCM data');
  if(pcm.length+44>MAX_WAV_BYTES)throw Error('Google TTS audio exceeds stream limit');
  // Universal TTS expects one canonical 44-byte RIFF WAV, with no extras.
  return 'RIFF'+bytes32(36+pcm.length)+'WAVE'+'fmt '+bytes32(16)+
    bytes16(1)+bytes16(1)+bytes32(8000)+bytes32(16000)+
    bytes16(2)+bytes16(16)+'data'+bytes32(pcm.length)+pcm;
}
function create(options){
  options=options||{};
  var Pebble=options.Pebble,UniversalTts=options.UniversalTts;
  var request=options.fetch||fetch;
  var getKey=options.getKey||function(){return '';};
  var getVoice=options.getVoice||function(){return 'en-US-Wavenet-F';};
  var saveVoice=options.saveVoice||function(){};
  var sessions={},sessionSeq=0;
  function expire(){
    var now=Date.now();
    Object.keys(sessions).forEach(function(id){
      if(now-sessions[id].at>SESSION_TTL_MS)delete sessions[id];
    });
  }
  function synthesize(text,voice,fallback){
    var key=String(getKey()||'');
    if(!key.trim())return Promise.reject(Error('Missing Direct Google TTS key. Open WISP settings.'));
    var url='https://texttospeech.googleapis.com/v1/text:synthesize?key='+encodeURIComponent(key);
    var audioConfig={audioEncoding:'LINEAR16',sampleRateHertz:8000};
    if(voice.indexOf('-Chirp3-HD-')<0)audioConfig.speakingRate=0.92;
    var timeout;
    var pending=new Promise(function(resolve,reject){
      timeout=setTimeout(function(){reject(Error('Direct Google TTS timed out'));},20000);
      try{
        Promise.resolve(request(url,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({
            input:{text:text},voice:{languageCode:'en-US',name:voice},
            audioConfig:audioConfig
          })
        })).then(function(response){
          return response.json().then(function(data){
            if(response.ok===false||data.error||!data.audioContent){
              throw Error(data.error&&data.error.message||
                'Google TTS HTTP '+(response.status||'error'));
            }
            return canonicalWav(data.audioContent);
          });
        }).then(resolve,reject);
      }catch(e){reject(e);}
    });
    return pending.catch(function(error){
      var message=String(error&&error.message||error);
      if(!fallback&&voice!=='en-US-Wavenet-F'&&
        /voice/i.test(message)&&/not found|does not exist|invalid|misspelled/i.test(message)){
        saveVoice('en-US-Wavenet-F');
        return synthesize(text,'en-US-Wavenet-F',true);
      }
      throw error;
    }).then(function(wav){clearTimeout(timeout);return wav;},
      function(error){clearTimeout(timeout);throw error;});
  }
  function virtualAction(req){
    expire();
    var args=req.args||{};
    if(req.action==='tts_prepare'){
      var text=String(args.text||'');
      if(!text||text.length>500)return Promise.resolve({ok:false,message:'Invalid direct TTS text segment'});
      return synthesize(text,String(getVoice()||'en-US-Wavenet-F'),false).then(function(wav){
        var id='legacy-'+Date.now()+'-'+(++sessionSeq);
        sessions[id]={wav:wav,at:Date.now()};
        var first=wav.substr(0,Math.min(CHUNK_BYTES,wav.length));
        return {ok:true,text:JSON.stringify({
          format:'pcm_s16le_wav',sample_rate:8000,channels:1,bits_per_sample:16,
          length:wav.length,sample_count:(wav.length-44)/2,chunk_bytes:CHUNK_BYTES,
          wav_checksum:fnv(wav),session_id:id,
          first_chunk:encode64(first),first_chunk_checksum:fnv(first)
        })};
      });
    }
    if(req.action==='tts_chunk'){
      var session=sessions[String(args.session_id||'')];
      var offset=Number(args.offset);
      if(!session||!Number.isInteger(offset)||offset<0||offset%CHUNK_BYTES||
        offset>=session.wav.length)
        return Promise.resolve({ok:false,message:'Direct Google TTS session unavailable'});
      var bytes=session.wav.substr(offset,CHUNK_BYTES);
      return Promise.resolve({ok:true,text:JSON.stringify({
        offset:offset,audio:encode64(bytes),checksum:fnv(bytes),
        done:offset+bytes.length>=session.wav.length
      })});
    }
    if(req.action==='tts_release'){
      delete sessions[String(args.session_id||'')];
      return Promise.resolve({ok:true,text:'{"released":true}'});
    }
    return Promise.reject(Error('Unknown direct TTS action'));
  }
  var facade={
    sendAppMessage:function(payload,success,error){return Pebble.sendAppMessage(payload,success,error);},
    invokeAction:virtualAction
  };
  var sdk=UniversalTts.create({
    Pebble:facade,pluginId:'legacy-google-direct-local',
    storage:options.storage,
    onError:options.onError,onComplete:options.onComplete
  });
  return {
    speak:function(text){return sdk.speak(text);},
    stop:function(){sdk.stop();sessions={};},
    diagnostics:function(){return sdk.diagnostics();}
  };
}
module.exports={create:create,canonicalWav:canonicalWav,encode64:encode64,decode64:decode64,fnv:fnv};
