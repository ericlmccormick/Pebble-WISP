/* Pebble Universal TTS watch audio transport SDK v1.
 * MIT licensed. Audio codec/PCM scheduler extracted from the validated
 * Universal TTS transport, not any application's UI or conversation logic.
 * Message keys: COMMAND, TEXT, CHUNK. App registers one inbox handler and
 * delegates AUDIO_* commands here.
 */
#include "universal_tts.h"
#include <string.h>
#include <stdio.h>
#ifdef PBL_SPEAKER
#define RING_BUFFER_SIZE 16384
#define PLAYBACK_ADPCM_BYTES 800
#define PLAYBACK_PCM_SAMPLES (PLAYBACK_ADPCM_BYTES * 2)
#define PLAYBACK_INTERVAL_MS 200
#define START_BUFFER_THRESHOLD 2800
#define STREAM_CLOSE_DELAY_MS 1000
#define STREAM_IDLE_FAILSAFE_MS 30000
static float s_volume=1.0f;
  static uint8_t s_ring_buffer[RING_BUFFER_SIZE]; 
  static uint32_t s_head = 0;                   
  static uint32_t s_tail = 0;                   
  static uint32_t s_buffer_count = 0;           
  static AppTimer *s_playback_timer = NULL;     
  static AppTimer *s_stream_close_timer = NULL;
  static AppTimer *s_stream_idle_timer = NULL;
  static bool s_stream_end_received = false;
  static bool s_speaker_open = false;
  // Preserve PCM bytes rejected by a full speaker queue; never drop a partial write.
  // Ping-pong PCM frames: while one frame drains into the speaker stream,
  // the next is already decoded from the ADPCM ring. The predictor remains
  // continuous across both buffers and between consecutive sentences.
  static int16_t s_pcm_frames[2][PLAYBACK_PCM_SAMPLES];
  static uint32_t s_pcm_lengths[2] = {0,0};
  static uint8_t s_pcm_read = 0;
  static uint8_t s_pcm_write = 0;
  static uint8_t s_pcm_queued = 0;
  static bool s_sentence_end_pending = false;
  static uint32_t s_pending_offset = 0;
  // Playback counters are transmitted only once the speaker closes.
  static bool s_audio_frame_written = false;
  static bool s_audio_waiting = false;
  static uint16_t s_audio_empty_events = 0;
  static uint32_t s_audio_empty_ms = 0;
  static uint16_t s_audio_partial_writes = 0;
  static uint16_t s_audio_zero_writes = 0;
  static uint16_t s_audio_frames_written = 0;
  static uint32_t s_audio_max_queued = 0;           
  static bool s_ignore_audio = false;
  // Watch-level reliable transport. Token prevents an old phone packet from
  // corrupting the next answer; seq prevents duplicate retries.
  static uint32_t s_transport_token = 0;
  static uint32_t s_expected_sequence = 0;
  static uint32_t s_transport_packets = 0;
  static uint32_t s_transport_waits = 0;
  static uint32_t s_transport_duplicates = 0;           

  static const int16_t stepTable[89] = {
    7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,
    34,37,41,45,50,55,60,66,73,80,88,97,107,118,
    130,143,157,173,190,209,230,253,279,307,337,
    371,408,449,494,544,598,658,724,796,876,963,
    1060,1166,1282,1411,1552,1707,1878,2066,2272,
    2499,2749,3024,3327,3660,4026,4428,4871,5358,
    5894,6484,7132,7845,8630,9493,10442,11487,
    12635,13899,15289,16818,18500,20350,22385,
    24623,27086,29794,32767
  };

  static const int8_t indexTable[16] = {
    -1,-1,-1,-1,2,4,6,8,
    -1,-1,-1,-1,2,4,6,8
  };

  static int32_t s_adpcm_valpred = 0;           
  static int32_t s_adpcm_index = 0;             
  static void reset_adpcm_state() {
    s_adpcm_valpred = 0;                        
    s_adpcm_index = 0;                          
  }

  static int16_t decode_adpcm_to_16bit(uint8_t delta) {
    int32_t step = stepTable[s_adpcm_index];     
    int32_t vpdiff = step >> 3;                 

    if (delta & 4) vpdiff += step;
    if (delta & 2) vpdiff += (step >> 1);
    if (delta & 1) vpdiff += (step >> 2);

    if (delta & 8) s_adpcm_valpred -= vpdiff;
    else s_adpcm_valpred += vpdiff;

    if (s_adpcm_valpred > 32767) s_adpcm_valpred = 32767;
    if (s_adpcm_valpred < -32768) s_adpcm_valpred = -32768;

    s_adpcm_index += indexTable[delta];
    if (s_adpcm_index < 0) s_adpcm_index = 0;     
    if (s_adpcm_index > 88) s_adpcm_index = 88;   

    return (int16_t)(s_adpcm_valpred * s_volume);
  }

  static void playback_timer_callback(void *data);
  static void delayed_close_callback(void *data);
  static void stream_idle_callback(void *data);
  static void start_playback(void);

  static void cancel_close_timer() {
    if (s_stream_close_timer) {
      app_timer_cancel(s_stream_close_timer);   
      s_stream_close_timer = NULL;              
    }
  }

  // A temporary BLE or synthesis gap is NOT the end of a spoken response.
  // The sender explicitly terminates the stream with AUDIO_STREAM_END.
  static void schedule_close_timer() {
    if (s_stream_end_received && !s_stream_close_timer) {
      s_stream_close_timer = app_timer_register(STREAM_CLOSE_DELAY_MS, delayed_close_callback, NULL);
    }
  }
  static void cancel_idle_timer(void) {
    if (s_stream_idle_timer) {
      app_timer_cancel(s_stream_idle_timer);
      s_stream_idle_timer = NULL;
    }
  }
  static void reset_idle_timer(void) {
    cancel_idle_timer();
    if (!s_stream_end_received)
      s_stream_idle_timer = app_timer_register(STREAM_IDLE_FAILSAFE_MS, stream_idle_callback, NULL);
  }
  // Guard against a genuinely disconnected phone without prematurely closing
  // the speaker during normal in-flight WAV chunks or sentence synthesis.
  static void stream_idle_callback(void *data) {
    (void)data;
    s_stream_idle_timer = NULL;
    if (s_stream_end_received || s_ignore_audio) return;
    APP_LOG(APP_LOG_LEVEL_WARNING, "Universal TTS stalled: no audio packet for 30s");
    s_stream_end_received = true;
    // A stalled stream may leave fewer than 800 ADPCM bytes in the ring.
    // Without this end marker, the last partial PCM frame never decodes
    // and the speaker can remain open indefinitely.
    s_sentence_end_pending = s_buffer_count > 0;
    if (s_buffer_count && !s_speaker_open) start_playback();
    if (s_speaker_open && !s_buffer_count && !s_pcm_queued)
      schedule_close_timer();
  }

  static void report_audio_stats(void) {
    DictionaryIterator *iter=NULL;
    if(app_message_outbox_begin(&iter)!=APP_MSG_OK||!iter)return;
    char stats[144];
    snprintf(stats,sizeof(stats),
      "empty=%u,empty_ms=%lu,partial=%u,zero=%u,peak=%lu,frames=%u,rx=%lu,wait=%lu,dup=%lu",
      (unsigned)s_audio_empty_events,(unsigned long)s_audio_empty_ms,
      (unsigned)s_audio_partial_writes,(unsigned)s_audio_zero_writes,
      (unsigned long)s_audio_max_queued,(unsigned)s_audio_frames_written,
      (unsigned long)s_transport_packets,(unsigned long)s_transport_waits,
      (unsigned long)s_transport_duplicates);
    dict_write_cstring(iter,MESSAGE_KEY_COMMAND,"AUDIO_STATS");
    dict_write_cstring(iter,MESSAGE_KEY_TEXT,stats);
    app_message_outbox_send();
  }
  static void delayed_close_callback(void *data) {
    (void)data;
    s_stream_close_timer = NULL;                
    if (s_stream_end_received && s_buffer_count == 0 &&
        s_pcm_queued == 0 && s_pending_offset == 0 && s_speaker_open) { 
      speaker_stream_close();                   
      s_speaker_open = false;
      if(s_audio_frame_written)report_audio_stats();
      s_audio_frame_written=false;
      s_audio_waiting=false;

    }
  }

  static void stop_audio(void);
  static void push_to_ring_buffer(uint8_t *data, uint16_t length) {
    // ADPCM has a stateful predictor. Dropping a single byte silently
    // desynchronizes the entire remaining speech stream into noise.
    if (length > RING_BUFFER_SIZE - s_buffer_count) {
      APP_LOG(APP_LOG_LEVEL_ERROR,
        "ADPCM ring overflow: queued=%lu incoming=%u capacity=%u",
        (unsigned long)s_buffer_count, (unsigned)length, RING_BUFFER_SIZE);
      stop_audio();
      s_ignore_audio = true;

      return;
    }
    for (uint16_t i = 0; i < length; i++) {
      s_ring_buffer[s_tail] = data[i];
      s_tail = (s_tail + 1) % RING_BUFFER_SIZE;
      s_buffer_count++;
    }
    if(s_buffer_count>s_audio_max_queued)s_audio_max_queued=s_buffer_count;
    cancel_close_timer();
  }

  static void start_playback() {
    cancel_close_timer();                       

    if (!s_speaker_open) {                      
      bool success = speaker_stream_open(SpeakerPcmFormat_8kHz_16bit, 100);
      if (!success) {
        APP_LOG(APP_LOG_LEVEL_ERROR, "Speaker failed to open"); 
        return;
      }
      s_speaker_open = true;                    
    }

    if (!s_playback_timer) {                     
      s_playback_timer = app_timer_register(1, playback_timer_callback, NULL); 
    }
  }

  // Decode ahead into the free PCM frame without writing to the speaker.
  // Each 800 ADPCM bytes produces 200 ms of 8 kHz/16-bit PCM. A second
  // buffer absorbs BLE callback jitter while the first frame is playing.
  static void fill_pcm_frames(void) {
    // Wait for a complete 200 ms frame to avoid repeatedly starving the
    // speaker. Only decode a shorter final frame after sentence-end.
    while (s_pcm_queued < 2 &&
          (s_buffer_count >= PLAYBACK_ADPCM_BYTES ||
           (s_sentence_end_pending && s_buffer_count > 0))) {
      uint8_t slot = s_pcm_write;
      uint16_t count = s_buffer_count < PLAYBACK_ADPCM_BYTES ?
                         s_buffer_count : PLAYBACK_ADPCM_BYTES;
      if(count<PLAYBACK_ADPCM_BYTES)s_sentence_end_pending=false;
      for(uint16_t i=0;i<count;i++){
        uint8_t value=s_ring_buffer[s_head];
        s_head=(s_head+1)%RING_BUFFER_SIZE;
        s_buffer_count--;
        s_pcm_frames[slot][i*2]=decode_adpcm_to_16bit((value>>4)&15);
        s_pcm_frames[slot][i*2+1]=decode_adpcm_to_16bit(value&15);
      }
      s_pcm_lengths[slot]=(uint32_t)count*4;
      s_pcm_write^=1;
      s_pcm_queued++;
      // An exact multiple of frame size can finish without a short frame.
      // Do not apply that sentence-end flag to the next spoken sentence.
      if(s_buffer_count==0 && s_sentence_end_pending)
        s_sentence_end_pending=false;
    }
  }

  static void playback_timer_callback(void *data) {
    (void)data;
    s_playback_timer=NULL;
    if(!s_speaker_open)return;
    // Preserve any partially accepted PCM. Decode into the alternate frame
    // and never overwrite a frame until the speaker accepts all its bytes.
    fill_pcm_frames();
    if(s_pcm_queued==0){
      if(s_audio_frame_written){
        if(!s_audio_waiting){
          s_audio_waiting=true;
          if(s_audio_empty_events<65535)s_audio_empty_events++;
        }
        s_audio_empty_ms+=20;
      }
      // Do not close after a 1.5s Bluetooth pause; the next verified
      // chunks may still be on their way. Only the explicit stream end can
      // permit a normal close.
      schedule_close_timer();
      s_playback_timer=app_timer_register(20,playback_timer_callback,NULL);
      return;
    }
    s_audio_waiting=false;
    cancel_close_timer();
    uint8_t slot=s_pcm_read;
    uint32_t remaining=s_pcm_lengths[slot]-s_pending_offset;
    uint32_t accepted=speaker_stream_write(
      ((uint8_t*)s_pcm_frames[slot])+s_pending_offset,remaining);
    if(accepted>remaining)accepted=remaining;
    if(accepted<remaining && s_audio_partial_writes<65535)s_audio_partial_writes++;
    if(!accepted && s_audio_zero_writes<65535)s_audio_zero_writes++;
    if(accepted){
      s_audio_frame_written=true;
      if(s_audio_frames_written<65535)s_audio_frames_written++;
    }
    s_pending_offset+=accepted;
    if(s_pending_offset<s_pcm_lengths[slot]){
      s_playback_timer=app_timer_register(15,playback_timer_callback,NULL);
      return;
    }
    s_pcm_lengths[slot]=0;
    s_pending_offset=0;
    s_pcm_read^=1;
    s_pcm_queued--;
    fill_pcm_frames();
    // Pace full 200 ms frames to real-time playback; the short retry timer
    // above is exclusively for a partial speaker write.
    s_playback_timer=app_timer_register(PLAYBACK_INTERVAL_MS,
                                        playback_timer_callback,NULL);
  }

  static void stop_audio() {
    if (s_speaker_open) {
      speaker_stream_close();                   
      s_speaker_open = false;                   
    }
    if (s_playback_timer) {
      app_timer_cancel(s_playback_timer);       
      s_playback_timer = NULL;                  
    }
    cancel_close_timer();
    cancel_idle_timer();
    s_stream_end_received = false;
    s_buffer_count = 0;                         
    s_head = 0;                                 
    s_tail = 0;                                 
    reset_adpcm_state();                        
    s_pending_offset = 0;
    s_pcm_read = 0;
    s_pcm_write = 0;
    s_pcm_queued = 0;
    s_sentence_end_pending = false;
    s_pcm_lengths[0] = 0;
    s_pcm_lengths[1] = 0;

  }


static void clear_stats(void){
  s_audio_frame_written=false;s_audio_waiting=false;
  s_audio_empty_events=0;s_audio_empty_ms=0;
  s_audio_partial_writes=0;s_audio_zero_writes=0;
  s_audio_frames_written=0;s_audio_max_queued=0;
  s_transport_packets=0;s_transport_waits=0;s_transport_duplicates=0;
}
void universal_tts_init(void){clear_stats();s_ignore_audio=false;reset_adpcm_state();}
bool universal_tts_supported(void){return true;}
void universal_tts_stop(void){stop_audio();s_ignore_audio=true;}
void universal_tts_deinit(void){universal_tts_stop();}
void universal_tts_set_volume(float v){
  if(v<0) v=0;
  if(v>1) v=1;
  s_volume=v;
}
bool universal_tts_is_playing(void){return s_speaker_open||s_buffer_count||s_pcm_queued;}
// Parse decimal tags without sscanf: Pebble's freestanding C linker cannot
// link Newlib's scanf/stdio syscall machinery into a watch application.
static bool parse_u32_decimal(const char **cursor,uint32_t *value){
  const char *p=*cursor;
  if(!p || *p<'0' || *p>'9')return false;
  uint32_t n=0;
  while(*p>='0'&&*p<='9'){
    uint32_t digit=(uint32_t)(*p-'0');
    if(n>429496729U || (n==429496729U && digit>5U))return false;
    n=n*10U+digit;
    p++;
  }
  *cursor=p;
  *value=n;
  return true;
}
static bool parse_transport_tag(DictionaryIterator *iter,
                                uint32_t *token,uint32_t *sequence){
  Tuple *t=dict_find(iter,MESSAGE_KEY_TEXT);
  if(!t||t->type!=TUPLE_CSTRING)return false;
  const char *p=t->value->cstring;
  if(!parse_u32_decimal(&p,token) || !*token || *p!=':')return false;
  ++p;
  if(!parse_u32_decimal(&p,sequence) || *p!='\0')return false;
  return true;
}
static bool parse_stream_id(DictionaryIterator *iter,uint32_t *token){
  Tuple *t=dict_find(iter,MESSAGE_KEY_TEXT);
  if(!t||t->type!=TUPLE_CSTRING)return false;
  const char *p=t->value->cstring;
  return parse_u32_decimal(&p,token) && *token && *p=='\0';
}
static void send_transport_reply(const char *command,
                                 uint32_t token,uint32_t sequence){
  DictionaryIterator *out=NULL;
  if(app_message_outbox_begin(&out)!=APP_MSG_OK || !out)return;
  char tag[48];
  snprintf(tag,sizeof(tag),"%lu:%lu",
           (unsigned long)token,(unsigned long)sequence);
  dict_write_cstring(out,MESSAGE_KEY_COMMAND,command);
  dict_write_cstring(out,MESSAGE_KEY_TEXT,tag);
  app_message_outbox_send();
}
bool universal_tts_handle_message(DictionaryIterator *iter){
  if(!iter)return false;
  Tuple *cmd=dict_find(iter,MESSAGE_KEY_COMMAND);
  if(!cmd||cmd->type!=TUPLE_CSTRING)return false;
  const char *c=cmd->value->cstring;
  if(!strcmp(c,"AUDIO_RESET")){
    stop_audio();clear_stats();s_ignore_audio=false;
    s_transport_token=0;s_expected_sequence=0;
    uint32_t token=0;
    if(parse_stream_id(iter,&token))s_transport_token=token;
    return true;
  }
  if(!strcmp(c,"AUDIO_STOP")){
    uint32_t token=0;
    if(s_transport_token && parse_stream_id(iter,&token) &&
       token!=s_transport_token)return true;
    universal_tts_stop();return true;
  }
  bool is_chunk=!strcmp(c,"AUDIO_CHUNK");
  bool is_sentence_end=!strcmp(c,"AUDIO_SENTENCE_END");
  bool is_stream_end=!strcmp(c,"AUDIO_STREAM_END");
  if(!is_chunk&&!is_sentence_end&&!is_stream_end)return false;
  if(s_ignore_audio)return true;
  uint32_t token=0,sequence=0;
  bool ack_mode=parse_transport_tag(iter,&token,&sequence);
  if(ack_mode){
    if(!s_transport_token||token!=s_transport_token)return true;
    if(sequence<s_expected_sequence){
      s_transport_duplicates++;
      send_transport_reply("AUDIO_ACK",token,sequence);
      return true;
    }
    if(sequence>s_expected_sequence){
      s_transport_waits++;
      send_transport_reply("AUDIO_WAIT",token,sequence);
      return true;
    }
  }
  if(is_chunk){
    Tuple *payload=dict_find(iter,MESSAGE_KEY_CHUNK);
    if(!payload||!payload->length){
      if(ack_mode)send_transport_reply("AUDIO_WAIT",token,sequence);
      return true;
    }
    if(payload->length>RING_BUFFER_SIZE-s_buffer_count){
      // Do not drop ADPCM; ask the sender to retry the same sequence once
      // the playback ring has drained. Old untagged callers remain supported.
      s_transport_waits++;
      if(ack_mode)send_transport_reply("AUDIO_WAIT",token,sequence);
      else APP_LOG(APP_LOG_LEVEL_ERROR,"Audio ring full on legacy sender");
      return true;
    }
    reset_idle_timer();
    push_to_ring_buffer(payload->value->data,payload->length);
    if(!s_speaker_open && s_buffer_count>=START_BUFFER_THRESHOLD)
      start_playback();
  }else if(is_sentence_end){
    reset_idle_timer();
    s_sentence_end_pending=s_buffer_count>0;
    if(!s_speaker_open && s_buffer_count>0)start_playback();
  }else{
    s_stream_end_received=true;
    cancel_idle_timer();
    s_sentence_end_pending=s_buffer_count>0;
    if(!s_speaker_open && s_buffer_count>0)start_playback();
    if(s_speaker_open && s_buffer_count==0 && s_pcm_queued==0)
      schedule_close_timer();
  }
  if(ack_mode){
    s_transport_packets++;
    s_expected_sequence++;
    send_transport_reply("AUDIO_ACK",token,sequence);
  }
  return true;
}
#else
void universal_tts_init(void){}
bool universal_tts_supported(void){return false;}
void universal_tts_deinit(void){}
void universal_tts_stop(void){}
void universal_tts_set_volume(float v){(void)v;}
bool universal_tts_is_playing(void){return false;}
bool universal_tts_handle_message(DictionaryIterator *iter){(void)iter;return false;}
#endif
