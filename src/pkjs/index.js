// =========================================================================
// SECTION 1: LIBRARY IMPORT & INITIALIZATION
// =========================================================================

var Clay = require('@rebble/clay');
var GEMINI_PLUGIN_UUID='2c5edc42-b096-4f76-b284-1f27907e6501';
var UNIVERSAL_TTS_PLUGIN_UUID='2c5edc42-b096-4f76-b284-1f27907e6502';
var UniversalTts=require('./universal_tts');
var GoogleTtsLegacy=require('./google_tts_legacy');
var AgentPlugins=require('./agent_plugins');
function useStoredBackend(key,hasLegacyKey){return localStorage.getItem(key)||(hasLegacyKey?'direct':'plugin');}


// =========================================================================
// SECTION 2: STORAGE MEMORY RECOVERY & TOGGLE LOGIC
// =========================================================================

var geminiApiKey = localStorage.getItem("GEMINI_API_KEY") || "";
var ttsApiKey = localStorage.getItem("TTS_API_KEY") || ""; 
var geminiBackend=useStoredBackend('GEMINI_BACKEND',!!geminiApiKey);
if(geminiBackend==='plugin'){geminiBackend=AgentPlugins.agentId();localStorage.setItem('GEMINI_BACKEND',geminiBackend);}
// Never silently switch existing Gemini-with-Voice Direct Google TTS users.
 // Preserve TTS_BACKEND, TTS_API_KEY, TTS_VOICE and opt-out in localStorage.
function migrateSpeechProvider(){
  var provider=localStorage.getItem('TTS_BACKEND');
  var oldToggle=localStorage.getItem('ENABLE_TTS');
  var migrated=localStorage.getItem('TTS_PROVIDER_MIGRATED_V2')==='true';
  if(!migrated && oldToggle==='false')provider='none';
  if(provider!=='none'&&provider!=='direct'&&provider!=='plugin')
    provider=ttsApiKey?'direct':'plugin';
  localStorage.setItem('TTS_BACKEND',provider);
  localStorage.setItem('TTS_PROVIDER_MIGRATED_V2','true');
  return provider;
}
var ttsBackend=migrateSpeechProvider();
// AI Conversation manages its own default conversation.
       
var appearanceMode = localStorage.getItem('APPEARANCE_MODE') || 'auto';
if (['auto','day','night'].indexOf(appearanceMode) < 0) appearanceMode='auto';
var solarCache = null;
try { solarCache = JSON.parse(localStorage.getItem('APPEARANCE_SOLAR') || 'null'); }
catch (e) { solarCache = null; }
var weatherSubscription = null;
function sendAppearance() {
  var mode = appearanceMode==='day'?1:(appearanceMode==='night'?2:0);
  var payload={COMMAND:'UPDATE_APPEARANCE',APPEARANCE_MODE:mode};
  if (solarCache && solarCache.sunrise>0 && solarCache.sunset>solarCache.sunrise) {
    payload.SUNRISE=solarCache.sunrise;
    payload.SUNSET=solarCache.sunset;
  }
  Pebble.sendAppMessage(payload,function(){},function(e){console.log('Appearance sync retry at next start',e);});
}
function solarTimestamp(property) {
  if (!property || !property.timestamp) return 0;
  var value=property.timestamp.value !== undefined ? property.timestamp.value : property.timestamp;
  var n=Number(value);
  return isFinite(n) && n>0 ? Math.floor(n) : 0;
}
function beginWeatherAppearance() {
  if (weatherSubscription) { weatherSubscription.unsubscribe(); weatherSubscription=null; }
  if (appearanceMode!=='auto' || typeof Pebble.subscribeToSource!=='function') return;
  try {
    weatherSubscription=Pebble.subscribeToSource({
      category:'weather',item:'location',
      properties:['sunrise','sunset','daily_sunrise','daily_sunset'],
      onData:function(envelope){
        var instances=envelope && envelope.instances || [];
        var properties=instances.length && instances[0].properties;
        if (!properties) return;
        var sunrise=solarTimestamp(properties.sunrise);
        var sunset=solarTimestamp(properties.sunset);
        if (!(sunrise>0 && sunset>sunrise)) {
          var sunriseSeries=properties.daily_sunrise && properties.daily_sunrise.series;
          var sunsetSeries=properties.daily_sunset && properties.daily_sunset.series;
          var rises=sunriseSeries && sunriseSeries.timestamp && sunriseSeries.timestamp.values;
          var sets=sunsetSeries && sunsetSeries.timestamp && sunsetSeries.timestamp.values;
          var start=Number(sunriseSeries && sunriseSeries.start);
          var step=Number(sunriseSeries && sunriseSeries.stepSec) || 86400;
          var dayIndex=isFinite(start)?Math.max(0,Math.floor((Date.now()/1000-start)/step)):0;
          if (rises && sets && rises.length>dayIndex && sets.length>dayIndex) {
            sunrise=Number(rises[dayIndex]);
            sunset=Number(sets[dayIndex]);
          }
        }
        if (sunrise>0 && sunset>sunrise && isFinite(sunrise) && isFinite(sunset)) {
          solarCache={sunrise:Math.floor(sunrise),sunset:Math.floor(sunset)};
          localStorage.setItem('APPEARANCE_SOLAR',JSON.stringify(solarCache));
          sendAppearance();
        }
      },
      onError:function(err){console.log('Weather appearance unavailable; retaining solar cache',err && err.code || err);}
    });
  } catch(e) { console.log('Weather subscribe failed',e); }
}
var fontSize = localStorage.getItem("FONT_SIZE") || 24;          
var customPersona = localStorage.getItem("CUSTOM_PERSONA") || ""; 

// Restore dynamic dropdown configurations with updated default
var geminiModel = localStorage.getItem("GEMINI_MODEL") || "gemini-3.8-flash"; 
// Legacy Direct Google TTS retains the original app-level voice selection.
var ttsVoice=localStorage.getItem('TTS_VOICE')||'en-US-Wavenet-F';
var TTS_VOICE_ALIASES={
  'en-US-Chirp3-HD-F':'en-US-Chirp3-HD-Kore',
  'en-US-Chirp3-HD-M':'en-US-Chirp3-HD-Charon',
  'en-US-Studio-O':'en-US-Wavenet-F',
  'en-US-Studio-M':'en-US-Wavenet-D',
  'en-US-Journey-F':'en-US-Wavenet-F',
  'en-US-Journey-D':'en-US-Wavenet-D'
};
var SUPPORTED_TTS_VOICES=[
  'en-US-Wavenet-C','en-US-Wavenet-D','en-US-Wavenet-F',
  'en-US-Neural2-C','en-US-Neural2-D','en-US-Neural2-F',
  'en-US-Chirp3-HD-Kore','en-US-Chirp3-HD-Aoede','en-US-Chirp3-HD-Leda',
  'en-US-Chirp3-HD-Zephyr','en-US-Chirp3-HD-Charon','en-US-Chirp3-HD-Puck'
];
function normalizeTtsVoice(name){
  var migrated=TTS_VOICE_ALIASES[name]||name;
  return SUPPORTED_TTS_VOICES.indexOf(migrated)>=0?migrated:'en-US-Wavenet-F';
}
ttsVoice=normalizeTtsVoice(ttsVoice);
// Do not erase a legacy voice on switching to Universal TTS.
if(localStorage.getItem('TTS_VOICE'))localStorage.setItem('TTS_VOICE',ttsVoice);
// The TTS_BACKEND setting alone determines whether speech is enabled.

// =========================================================================
// SECTION 3: SYSTEM SCOPE DECLARATIONS
// =========================================================================

var conversationHistory = [];
var MAX_HISTORY_MESSAGES = 6;
var MAX_HISTORY_CHARACTERS = 8000;
var GEMINI_TIMEOUT_MS = 30000;
function trimConversationHistory(items) {
  if (!Array.isArray(items)) return [];
  var pairs = [];
  for (var i = 0; i + 1 < items.length; i++) {
    var user = items[i], model = items[i + 1];
    if (user && model && user.role === 'user' && model.role === 'model' &&
        Array.isArray(user.parts) && Array.isArray(model.parts) &&
        user.parts[0] && model.parts[0] && typeof user.parts[0].text === 'string' && typeof model.parts[0].text === 'string') {
      pairs.push([user, model]); i++;
    }
  }
  var result = [], chars = 0;
  for (var j = pairs.length - 1; j >= 0 && result.length < MAX_HISTORY_MESSAGES; j--) {
    var size = JSON.stringify(pairs[j]).length;
    if (chars + size > MAX_HISTORY_CHARACTERS) break;
    chars += size;
    result.unshift(pairs[j][0], pairs[j][1]);
  }
  return result;
}
try {
  var storedHistory = localStorage.getItem("CHAT_HISTORY"); 
  if (storedHistory) {                                      
    conversationHistory = trimConversationHistory(JSON.parse(storedHistory));        
  }
} catch (e) {
  conversationHistory = [];                                 
}

// =========================================================================
// SECTION 4: ECOSYSTEM PLATFORM DETECTION
// =========================================================================

// Pebble 2 Duo (flint) and Time 2 (emery) have speakers. Round 2
// (gabbro) has a microphone but no speaker: use dictation + text only.
// Unknown hardware defaults to text-only until its capabilities are known.
function platformHasSpeaker(platform) {
  // Support SDK platform aliases without inferring speaker presence on
  // earlier Time/Time Round hardware.
  var label=String(platform||'').toLowerCase().replace(/[_ -]/g,'');
  return label === 'flint' || label === 'emery' ||
    label === 'pebble2duo' || label === 'pebbletime2';
}
var watchInfo = null;
var hasSpeaker = false;
function detectSpeakerFromInfo() {
  try {
    watchInfo = Pebble.getActiveWatchInfo();
    var platform = watchInfo && (watchInfo.platform || watchInfo.hardwarePlatform || watchInfo.model);
    if (watchInfo && platformHasSpeaker(platform)) hasSpeaker=true;
    if (watchInfo && watchInfo.capabilities &&
        (watchInfo.capabilities.speaker===true || watchInfo.capabilities.audioOutput===true))
      hasSpeaker=true;
  } catch(err) {
    console.log('Watch speaker metadata unavailable; awaiting hardware volume indication');
  }
}
detectSpeakerFromInfo();

// =========================================================================
// SECTION 5: STREAMING ARCHITECTURE QUEUE STATE
// =========================================================================

var requestGeneration=0;
function requestJsonWithTimeout(url, options, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var done = false;
    var timer = setTimeout(function() {
      if (!done) { done = true; reject(new Error('Request timed out')); }
    }, timeoutMs);
    try {
      fetch(url, options).then(function(response) {
        return response.json().then(function(data) {
          if (response.ok === false && !data.error) data.error = {message: 'HTTP ' + response.status};
          return data;
        });
      }).then(function(data) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(data);
      }).catch(function(err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
    } catch (err) {
      if (done) return;
      done = true; clearTimeout(timer); reject(err);
    }
  });
}
function apiErrorMessage(error, service) {
  var message = String(error && error.message || error || '').toLowerCase();
  if (message.indexOf('timed out') >= 0) return service + ' timed out. Try again.';
  if (/plugin unavailable|plugin support|install\/configure plugin|plugin.*permission|unknown plugin/.test(message))
    return 'Install/configure the '+(service==='Gemini'?'AI Conversation':'Universal TTS')+' plugin and grant permissions.';
  if (/api.key|permission.denied|unauthenticated|401|403/.test(message)) return service + ' key/access error. Check settings.';
  if (/quota|rate.limit|resource.exhausted|429/.test(message)) return service + ' usage limit reached. Try later.';
  if (message.indexOf('voice') >= 0) return 'Voice unavailable. Configure Universal TTS.';
  return service + ' request failed. Check connection.';
}
  

var activeSpeechBackend=null;
var legacyGoogleTts=GoogleTtsLegacy.create({
  Pebble:Pebble,
  UniversalTts:UniversalTts,
  storage:localStorage,
  getKey:function(){return ttsApiKey;},
  getVoice:function(){return ttsVoice;},
  saveVoice:function(name){
    ttsVoice=normalizeTtsVoice(name);
    localStorage.setItem('TTS_VOICE',ttsVoice);
  },
  onError:function(error){
    console.log('Direct Google TTS failed:',String(error&&error.message||error));
    Pebble.sendAppMessage({COMMAND:'TTS_FAILURE'},function(){},function(){});
  },
  onComplete:function(){console.log('Direct Google TTS transfer complete');},
  onStats:function(stats){console.log('WISP legacy speaker playback stats',JSON.stringify(stats));}
});
// Direct Gemini + Direct Google users do not need a phone with plugin support.
// Initialize the real Universal TTS client only when invokeAction is available.
var universalTts=typeof Pebble.invokeAction==='function'?UniversalTts.create({
  Pebble:Pebble,
  pluginId:UNIVERSAL_TTS_PLUGIN_UUID,
  storage:localStorage,
  onError:function(error){
    console.log('Universal TTS failed:',String(error&&error.message||error));
    Pebble.sendAppMessage({COMMAND:'TTS_FAILURE'},function(){},function(){});
  },
  onComplete:function(){console.log('Universal TTS transfer complete');},
  onStats:function(stats){console.log('WISP Universal speaker playback stats',JSON.stringify(stats));}
}):{
  speak:function(){return Promise.reject(Error('Update Pebble phone app to use Universal TTS'));},
  stop:function(){},
  handleMessage:function(){return false;}
};

// =========================================================================
// SECTION 7: DYNAMIC MENU CONFIGURATION TREE
// =========================================================================

// The plugin owns credentials, model and voice settings when selected.
// App-only controls (persona, speaker on/off, font size) remain visible.
var apiKeysItems = [
  {type:'heading',defaultValue:'Service providers'},
  {
    type:'select',messageKey:'GEMINI_BACKEND',label:'AI conversation provider',
    defaultValue:geminiBackend,
    description:'Only installed agent plugins appear in this list. Install other agents from the Pebble Store, then reopen settings. AI Conversation returns full replies; other agents may only confirm delivery.',
    options:AgentPlugins.options(Pebble,geminiBackend)
  },
  {
    type:'input',messageKey:'GEMINI_API_KEY',label:'Gemini API key (direct mode only)',
    description:geminiApiKey?'Direct key already saved locally. Leave blank to keep it.':'Only required when using Direct Gemini API.',
    attributes:{
      type:'password',autocorrect:'off',autocapitalize:'off',
      placeholder:geminiApiKey?'Existing direct key saved':'Paste Gemini Developer API key'
    }
  },
  {
    type:'select',messageKey:'GEMINI_MODEL',label:'Gemini model (direct mode only)',
    defaultValue:geminiModel,
    description:'In plugin mode, this setting is controlled by the AI Conversation plugin.',
    options:[
      {label:'Gemini 3.8 Flash',value:'gemini-3.8-flash'},
      {label:'Gemini 3.7 Flash',value:'gemini-3.7-flash'},
      {label:'Gemini 3.6 Flash',value:'gemini-3.6-flash'},
      {label:'Gemini 3.5 Flash',value:'gemini-3.5-flash'},
      {label:'Gemini 3.5 Flash-Lite',value:'gemini-3.5-flash-lite'},
      {label:'Gemini 3.1 Pro (Preview)',value:'gemini-3.1-pro-preview'},
      {label:'Gemini 3.1 Flash-Lite',value:'gemini-3.1-flash-lite'},
      {label:'Gemini 3 Flash (Preview)',value:'gemini-3-flash-preview'},
      {label:'Gemini 2.5 Pro',value:'gemini-2.5-pro'},
      {label:'Gemini 2.5 Flash',value:'gemini-2.5-flash'},
      {label:'Gemini 2.5 Flash-Lite',value:'gemini-2.5-flash-lite'}
    ]
  }
];
// New users use Universal TTS; existing direct users keep their credentials.
apiKeysItems.push({
  type:'select',messageKey:'TTS_BACKEND',label:'Spoken responses',
  defaultValue:ttsBackend,
  description:'Universal TTS owns its provider and voice. Direct Google TTS is retained for existing Gemini with Voice users.',
  options:[
    {label:'Universal TTS plugin (recommended)',value:'plugin'},
    {label:'Direct Google Cloud TTS (legacy)',value:'direct'},
    {label:'None — text only',value:'none'}
  ]
});
apiKeysItems.push({
  type:'input',messageKey:'TTS_API_KEY',label:'Google Cloud TTS API key (direct legacy)',
  description:ttsApiKey?'Existing legacy key saved. Leave blank to keep it.':'Required for direct Google TTS only. Leave blank to keep an existing key.',
  attributes:{
    type:'password',autocorrect:'off',autocapitalize:'off',
    placeholder:ttsApiKey?'Existing key saved':'Paste Google Cloud TTS API key'
  }
});
apiKeysItems.push({
  type:'select',messageKey:'TTS_VOICE',label:'Google TTS voice (direct legacy)',
  defaultValue:ttsVoice,
  description:'Only for Direct Google TTS. Universal TTS voice settings are in the plugin.',
  options:[
    {label:'WaveNet F',value:'en-US-Wavenet-F'},
    {label:'WaveNet C',value:'en-US-Wavenet-C'},
    {label:'WaveNet D',value:'en-US-Wavenet-D'},
    {label:'Neural2 F',value:'en-US-Neural2-F'},
    {label:'Neural2 C',value:'en-US-Neural2-C'},
    {label:'Neural2 D',value:'en-US-Neural2-D'},
    {label:'Chirp 3 HD Kore',value:'en-US-Chirp3-HD-Kore'},
    {label:'Chirp 3 HD Aoede',value:'en-US-Chirp3-HD-Aoede'},
    {label:'Chirp 3 HD Leda',value:'en-US-Chirp3-HD-Leda'},
    {label:'Chirp 3 HD Zephyr',value:'en-US-Chirp3-HD-Zephyr'},
    {label:'Chirp 3 HD Charon',value:'en-US-Chirp3-HD-Charon'},
    {label:'Chirp 3 HD Puck',value:'en-US-Chirp3-HD-Puck'}
  ]
});

var clayConfig = [
  { "type": "heading", "defaultValue": "WISP — Wrist Intelligence & Speech Portal" }, 
  {
    "type": "section", 
    "items": [
      { "type": "heading", "defaultValue": "Personalization" },
      {
        "type": "input", 
        "messageKey": "CUSTOM_PERSONA",
        "label": "Custom Assistant Memory",
        "defaultValue": customPersona,
        "description": "Tell WISP how you want your AI assistant to respond, regardless of provider.",
        "attributes": {
          "spellcheck": "true"
        }
      }
    ]
  },
  {
    "type": "section", 
    "items": apiKeysItems
  },
  {
    "type": "section",
    "items": [
      { "type": "heading", "defaultValue": "Conversation & Privacy" },
      { "type": "text", "defaultValue": "Your current provider handles model and voice settings. Plugin credentials are stored in Pebble secure storage; direct-mode keys remain in legacy app storage. Conversation history is stored on the phone. API usage may incur charges." },
      { "type": "toggle", "messageKey": "CLEAR_HISTORY", "label": "Clear Conversation History on Save",
        "defaultValue": false, "description": "Clear prior questions and answers without removing API keys, voice, or settings." }
    ]
  },
  {
    "type": "section", 
    "items": [
      { "type": "heading", "defaultValue": "Display Settings" },
      {type:'select',messageKey:'APPEARANCE_MODE',label:'Appearance',
        defaultValue:appearanceMode,
        description:'Auto follows sunrise and sunset from Weather+ or Weather. Uses cached times or 7 AM–7 PM when unavailable.',
        options:[
          {label:'Auto (sunrise / sunset)',value:'auto'},
          {label:'Day (light)',value:'day'},
          {label:'Night (dark)',value:'night'}
        ]
      },
      {
        "type": "slider",
        "messageKey": "FONT_SIZE",
        "defaultValue": parseInt(fontSize), 
        "label": "Font Size",
        "min": 14,
        "max": 28,
        "step": 2
      }
    ]
  },
  {
    "type": "submit", 
    "defaultValue": "Save Settings"
  }
];

// =========================================================================
// SECTION 8: CUSTOM CLAY UI HANDLER FUNCTION
// =========================================================================

// This function is injected into the phone's webview to handle dynamic 
// layout changes cleanly without relying on unstable capability tags.
function customClay() {
  // Clay serializes this function into a separate phone webview. It must NEVER
  // reference PebbleKit JS globals such as geminiBackend or ttsBackend.
  var page = this;

  function fieldValue(key, fallback) {
    var field = page.getItemByMessageKey(key);
    if (!field) return fallback;
    var value = field.get();
    if (value && typeof value === 'object' && value.value !== undefined) {
      value = value.value;
    }
    return value === undefined || value === null || value === '' ? fallback : value;
  }

  function fieldVisible(key, show) {
    var field = page.getItemByMessageKey(key);
    if (!field) return;  // Non-speaker watch profiles have no TTS fields.
    if (show) field.show();
    else field.hide();
  }

  function updateVisibility() {
    var geminiLegacy = String(fieldValue('GEMINI_BACKEND', 'plugin')) === 'direct';
    var ttsLegacy = String(fieldValue('TTS_BACKEND', 'plugin')) === 'direct';
    fieldVisible('GEMINI_API_KEY', geminiLegacy);
    fieldVisible('GEMINI_MODEL', geminiLegacy);
    fieldVisible('TTS_API_KEY', ttsLegacy);
    fieldVisible('TTS_VOICE', ttsLegacy);
  }

  page.on(page.EVENTS.AFTER_BUILD, function() {
    ['GEMINI_BACKEND','TTS_BACKEND'].forEach(function(key) {
      var field = page.getItemByMessageKey(key);
      if (field) field.on('change', updateVisibility);
    });
    updateVisibility();
  });
}

// Initialize Clay and inject the custom UI handler
var clay = new Clay(clayConfig, customClay, {
  autoHandleEvents: false 
});

// Universal TTS SDK handles all ADPCM compression and BLE audio transport.

// =========================================================================
// SECTION 10: OS INFRASTRUCTURE EVENT SUB-SYSTEM
// =========================================================================

Pebble.addEventListener('showConfiguration', function() {
  // Refresh the original source tree, then reconstruct Clay from scratch.
  // Merely mutating an already constructed Clay object can retain its
  // originally compiled select options in the generated configuration.
  geminiBackend=AgentPlugins.validChoice(Pebble,geminiBackend);
  localStorage.setItem('GEMINI_BACKEND',geminiBackend);
  clayConfig.forEach(function(section){
    (section.items||[]).forEach(function(item){
      if(item.messageKey==='GEMINI_BACKEND'){
        item.options=AgentPlugins.options(Pebble);
        item.defaultValue=geminiBackend;
      }
    });
  });
  clay=new Clay(clayConfig,customClay,{autoHandleEvents:false});
  // Clay can load an older 'clay-settings' snapshot before defaults. Keep its
  // selected provider and legacy model/voice fields aligned with our saved
  // app settings so plugin mode is respected every time the webview opens.
  clay.setSettings({
    GEMINI_BACKEND: geminiBackend,
    TTS_BACKEND: ttsBackend,
    GEMINI_MODEL: geminiModel,
    TTS_VOICE: ttsVoice,
    APPEARANCE_MODE: appearanceMode
  });
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (e && !e.response) return; 
  var settings;
  try { settings = JSON.parse(decodeURIComponent(e.response)); }
  catch (error) { console.log('Invalid configuration response', error); return; } 

  if (settings.CLEAR_HISTORY && (settings.CLEAR_HISTORY.value === true || settings.CLEAR_HISTORY.value === 'true')) {
    cancelCurrentAudio();
    if(typeof Pebble.invokeAction==='function'){
      Pebble.invokeAction({plugin:GEMINI_PLUGIN_UUID,action:'clear_conversation',args:{all:true}}).catch(function(){});
    }
    localStorage.setItem('CHAT_HISTORY', '[]');
    console.log('Conversation history cleared');
  }
  if(settings.GEMINI_BACKEND){
    var selectedAgent=String(settings.GEMINI_BACKEND.value||'plugin');
    geminiBackend=AgentPlugins.validChoice(Pebble,selectedAgent);
    localStorage.setItem('GEMINI_BACKEND',geminiBackend);
    refreshAgentInfo();
  }
  if(settings.TTS_BACKEND){
    var selectedSpeechProvider=settings.TTS_BACKEND.value;
    cancelCurrentAudio();
    ttsBackend=['none','plugin','direct'].indexOf(selectedSpeechProvider)>=0?
      selectedSpeechProvider:'plugin';
    localStorage.setItem('TTS_BACKEND',ttsBackend);
  }
  if (settings.CUSTOM_PERSONA) {
    customPersona = settings.CUSTOM_PERSONA.value;
    localStorage.setItem("CUSTOM_PERSONA", customPersona); 
  }

  if (geminiBackend==='direct' && settings.GEMINI_API_KEY && settings.GEMINI_API_KEY.value !== "") {
    geminiApiKey = settings.GEMINI_API_KEY.value;
    localStorage.setItem("GEMINI_API_KEY", geminiApiKey); 
  }

  // Reuse original Direct Google TTS credentials on upgrades.
  // Blank inputs must never overwrite previously stored API keys.
  if (ttsBackend==='direct' && settings.TTS_API_KEY && settings.TTS_API_KEY.value) {
    ttsApiKey=String(settings.TTS_API_KEY.value);
    localStorage.setItem('TTS_API_KEY',ttsApiKey);
  }
  if (ttsBackend==='direct' && settings.TTS_VOICE) {
    ttsVoice=normalizeTtsVoice(settings.TTS_VOICE.value||ttsVoice);
    localStorage.setItem('TTS_VOICE',ttsVoice);
  }

  if (geminiBackend==='direct' && settings.GEMINI_MODEL) {
    geminiModel = settings.GEMINI_MODEL.value || "gemini-3.8-flash"; 
    localStorage.setItem("GEMINI_MODEL", geminiModel); 
  }

  if (settings.APPEARANCE_MODE) {
    var selectedMode=String(settings.APPEARANCE_MODE.value || 'auto');
    appearanceMode=['auto','day','night'].indexOf(selectedMode)>=0?selectedMode:'auto';
    localStorage.setItem('APPEARANCE_MODE',appearanceMode);
    sendAppearance();
    beginWeatherAppearance();
  }
  if (settings.FONT_SIZE) {
    fontSize = settings.FONT_SIZE.value;
    localStorage.setItem("FONT_SIZE", fontSize);         
    Pebble.sendAppMessage({ 'COMMAND': 'UPDATE_FONT', 'FONT_SIZE': parseInt(fontSize) }); 
  }
});


// Agent icon protocol: 0 WISP, 1 Gemini, 2 ChatGPT/OpenAI,
// 3 Claude/Anthropic, 4 Grok/xAI, 5 Muse, 6 OpenRouter, 7 DeepSeek.
var agentInfoGeneration=0;
var lastAgentInfo=null;
try {lastAgentInfo=JSON.parse(localStorage.getItem('WISP_LAST_AGENT_INFO')||'null');}
catch(e){lastAgentInfo=null;}
function rememberAgentInfo(name,icon){
  lastAgentInfo={name:String(name||'WISP').slice(0,28),icon:icon|0};
  localStorage.setItem('WISP_LAST_AGENT_INFO',JSON.stringify(lastAgentInfo));
  sendAgentInfoReliable(lastAgentInfo.name,lastAgentInfo.icon);
}
function providerIcon(provider){
  var ids={gemini:1,openai:2,anthropic:3,claude:3,xai:4,grok:4,
    muse:5,openrouter:6,deepseek:7};
  return ids[String(provider||'').toLowerCase()]||0;
}
function agentInfoPayload(name,icon){
  return {COMMAND:'AGENT_INFO',AGENT_NAME:String(name||'WISP').slice(0,28),AGENT_ICON:icon|0};
}
function sendAgentInfoReliable(name,icon) {
  var message=agentInfoPayload(name,icon);
  Pebble.sendAppMessage(message,function(){},function(err){
    console.log('Agent display retry',err);
    setTimeout(function(){
      Pebble.sendAppMessage(message,function(){},function(e){console.log('Agent display unavailable',e);});
    },250);
  });
}
function refreshAgentInfo(){
  var generation=++agentInfoGeneration;
  if(geminiBackend==='direct'){
    sendAgentInfoReliable('Gemini',1);return;
  }
  var chosen=AgentPlugins.selected(Pebble,geminiBackend);
  if(!chosen){
    sendAgentInfoReliable('WISP',0);return;
  }
  if(chosen.uuid===GEMINI_PLUGIN_UUID&&lastAgentInfo&&lastAgentInfo.icon>0){
    sendAgentInfoReliable(lastAgentInfo.name,lastAgentInfo.icon);
  }
  if(chosen.uuid!==GEMINI_PLUGIN_UUID){
    var aliases={};
    aliases['3f97d5c5-bc28-48ba-b4af-e7ad7f6000f0']=['ChatGPT',2];
    aliases['0d33014e-5d56-42ea-9665-3ebf182b4cfb']=['Claude',3];
    aliases['80ee6780-856f-411f-954b-4553ba7f2af8']=['Grok Bot',4];
    aliases['b8346592-cd59-4b83-9185-87d94e0734b0']=['Muse',5];
    var displayed=aliases[chosen.uuid]||[chosen.name,0];
    sendAgentInfoReliable(displayed[0],displayed[1]);return;
  }
  // Preserve the previous known provider instead of briefly replacing it
  // with WISP, which could remain stuck if get_config fails.
  if(typeof Pebble.invokeAction!=='function')return;
  Pebble.invokeAction({plugin:GEMINI_PLUGIN_UUID,action:'get_config',args:{}})
    .then(function(reply){
      if(generation!==agentInfoGeneration)return;
      var config={};
      if(reply&&reply.ok&&typeof reply.text==='string'){
        try{config=JSON.parse(reply.text);}catch(e){}
      }
      if(!config.provider){
        console.log('Agent provider config missing; retaining previous display');
        return;
      }
      var icon=providerIcon(config.provider);
      var label=String(config.provider_name||config.provider);
      if(label==='OpenAI')label='ChatGPT';
      if(label==='Anthropic')label='Claude';
      if(label==='xAI')label='Grok';
      rememberAgentInfo(label,icon);
    }).catch(function(err){
      console.log('WISP provider info unavailable',err&&err.code||err&&err.message||err);
    });
}

Pebble.addEventListener('ready', function() {
  detectSpeakerFromInfo();
  refreshAgentInfo();
  sendAppearance();
  beginWeatherAppearance();
  if (fontSize != 24) {
    Pebble.sendAppMessage({ 'COMMAND': 'UPDATE_FONT', 'FONT_SIZE': parseInt(fontSize) }); 
  }
});

Pebble.addEventListener('appmessage', function(e) {
  var dict = e.payload || {};
  if((activeSpeechBackend==='direct'?legacyGoogleTts:universalTts).handleMessage &&
      (activeSpeechBackend==='direct'?legacyGoogleTts:universalTts).handleMessage(dict))return;
  if (dict.COMMAND === 'WATCH_STATUS') {
    hasSpeaker = Number(dict.SPEAKER_CAPABLE) === 1;
    console.log('Watch reported speaker=',hasSpeaker,'volume=',dict.VOLUME,'TTS provider=',ttsBackend);
    refreshAgentInfo();
    return;
  } 

  if (dict.COMMAND === 'DICTATION') {
    // The C app sends VOLUME only for builds with PBL_SPEAKER.
    // This is authoritative even if getActiveWatchInfo reports an alias or
    // is unavailable when the phone-side JS first initializes.
    if (dict.SPEAKER_CAPABLE !== undefined) {
      hasSpeaker = Number(dict.SPEAKER_CAPABLE) === 1;
    } else if (Number(dict.VOLUME)>0 && !hasSpeaker) {
      hasSpeaker = true;
    }
    console.log('Dictation audio capability:',hasSpeaker,'volume:',dict.VOLUME,'provider:',ttsBackend);
    refreshAgentInfo();
    if (!geminiApiKey) geminiApiKey = localStorage.getItem("GEMINI_API_KEY") || "";
    // The plugins own credentials; direct requests retain their old keys.
    if (geminiBackend==='direct' && !geminiApiKey) {
      sendErrorToWatch("Missing Gemini Key. Check settings.");
      return;
    }

    var skipAudio = false; 
    if (!hasSpeaker || ttsBackend==='none') {
      console.log('TTS skipped:',!hasSpeaker?'speaker not detected':'speech disabled');
      skipAudio = true;
    } else if (dict.VOLUME !== undefined && dict.VOLUME === 0) {
      skipAudio = true;    
    }

    fetchGeminiResponse(dict.TEXT, skipAudio);
  }
});

function sendErrorToWatch(msg) {
  // Show diagnostic failures without starting a recursive TTS error loop.
  Pebble.sendAppMessage({ 'COMMAND': 'TEXT_RESPONSE_NO_AUDIO', 'TEXT': msg });
}

// =========================================================================
// SECTION 11: CORE INTELLIGENCE ROUTINES
// =========================================================================

function fetchGeminiResponse(prompt, skipAudio) {
  cancelCurrentAudio();
  var generation = requestGeneration;

  var localTime = new Date().toLocaleString(); 
  var systemText = "You are a smartwatch voice assistant. Responses must be conversational and under 100 words. No markdown or bullet lists. Current local time: " + localTime + ".";
  
  if (customPersona) {
    systemText += "\nUser's custom instructions: " + customPersona; 
  }

  var historyForRequest = trimConversationHistory(conversationHistory).slice();
  historyForRequest.push({ role: "user", parts: [{ text: prompt }] }); 

  // DYNAMIC URL ROUTING
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + geminiModel + ":generateContent?key=" + geminiApiKey;

  var responseRequest;
  if(geminiBackend!=='direct'){
    var agent=AgentPlugins.selected(Pebble,geminiBackend);
    responseRequest=AgentPlugins.dispatch(Pebble,agent,prompt).then(function(result){
      if(agent.uuid===GEMINI_PLUGIN_UUID && result.provider){
        var type=providerIcon(result.provider);
        var shown=String(result.provider);
        if(shown==='openai')shown='ChatGPT';
        if(shown==='anthropic')shown='Claude';
        rememberAgentInfo(shown.charAt(0).toUpperCase()+shown.slice(1),type);
      }
      // Every displayed agent response is eligible for TTS, including
      // handoff receipts. The watch display, not plugin metadata, is the
      // source of truth for speech. Never silently drop text-to-speech here.
      console.log('AI plugin text received, kind=',result.kind,'TTS provider=',ttsBackend,'speaker=',hasSpeaker);
      return {candidates:[{content:{parts:[{text:result.text}]}}]};
    });
  }else responseRequest=requestJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemText }] },
      contents: historyForRequest
    })
  }, GEMINI_TIMEOUT_MS);
  responseRequest.then(function(data) {
    if (generation !== requestGeneration) return;
     if (data.candidates && data.candidates.length > 0) {
      var parts = data.candidates[0].content && data.candidates[0].content.parts || [];
      var replyText = parts.map(function(part) { return part.text || ''; }).join(' ').trim();
      if (!replyText) {
        sendErrorToWatch('Gemini returned no readable text.');
        return;
      } 
      
      if(geminiBackend==='direct'){
        conversationHistory = trimConversationHistory(historyForRequest.concat([{ role: "model", parts: [{ text: replyText }] }]));
        localStorage.setItem("CHAT_HISTORY", JSON.stringify(conversationHistory));
      }  

      var cmd = skipAudio ? 'TEXT_RESPONSE_NO_AUDIO' : 'TEXT_RESPONSE_8_16';

      // UTF-8-aware limit: watch inbox is only 1024 bytes including tuple overhead.
      var displayText = '', bytes = 0;
      for (var i = 0; i < replyText.length; i++) {
        var c = replyText.charCodeAt(i), size = c < 128 ? 1 : (c < 2048 ? 2 : 3);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < replyText.length && replyText.charCodeAt(i + 1) >= 0xDC00 && replyText.charCodeAt(i + 1) <= 0xDFFF) {
          if (bytes + 4 > 700) break;
          displayText += replyText.substr(i, 2); bytes += 4; i++; continue;
        }
        if (bytes + size > 700) break;
        displayText += replyText.charAt(i); bytes += size;
      }
      // Start audio only once the watch has accepted its new answer/session.
      var textPayload = {COMMAND:cmd,TEXT:displayText};
      function startAnswer() {
        if (generation !== requestGeneration || skipAudio) return;
        var engine=ttsBackend==='direct'?legacyGoogleTts:universalTts;
        if(ttsBackend==='direct'&&!ttsApiKey) {
          console.log('Direct Google TTS selected without a saved key; open WISP settings.');
          Pebble.sendAppMessage({COMMAND:'TTS_FAILURE'},function(){},function(){});
          return;
        }
        activeSpeechBackend=ttsBackend;
        console.log('Speech request for displayed response via',activeSpeechBackend);
        engine.speak(displayText).catch(function(error){
          if(generation !== requestGeneration)return;
          console.log('Speech start failed:',String(error&&error.message||error));
          Pebble.sendAppMessage({COMMAND:'TTS_FAILURE'},function(){},function(){});
        });
      }
      Pebble.sendAppMessage(textPayload, startAnswer, function(error) {
        if (generation !== requestGeneration) return;
        console.log("Text delivery failed", error);
        Pebble.sendAppMessage(textPayload, startAnswer, function() { console.log("Text retry failed"); });
      });

    } else if (data.error && data.error.message) {
      // Failed requests do not modify the committed conversation history. 
      sendErrorToWatch(apiErrorMessage(data.error, 'Gemini'));
    } else {
      sendErrorToWatch("Gemini returned no answer.");
    }
  })
  .catch(function(error) {
    if (generation !== requestGeneration) return;
    sendErrorToWatch(apiErrorMessage(error,geminiBackend==='direct'?'Gemini':'AI agent'));
  });
}

// =========================================================================
// SECTION 12: Shared Universal TTS lifecycle
// =========================================================================
function cancelCurrentAudio(){
  requestGeneration++;
  if(activeSpeechBackend==='direct')legacyGoogleTts.stop();
  else if(activeSpeechBackend==='plugin')universalTts.stop();
  activeSpeechBackend=null;
}
