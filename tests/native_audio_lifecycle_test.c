/* Host-only native speaker lifecycle regression, compiled without SDK.
 * Exercises the exact Universal TTS native implementation used by WISP.
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "mock/pebble.h"
static uint32_t now_ms=0;
static AppTimer timers[16];
static int speaker_opens=0,speaker_closes=0;
static uint32_t accepted_pcm=0;
static bool speaker_open=false;
AppTimer *app_timer_register(uint32_t delay,void(*cb)(void*),void *ctx){
  for(size_t i=0;i<sizeof(timers)/sizeof(timers[0]);i++){
    if(!timers[i].active){
      timers[i]=(AppTimer){.active=true,.due=now_ms+delay,.cb=cb,.ctx=ctx};
      return &timers[i];
    }
  }
  assert(!"Mock timer capacity exceeded");
  return NULL;
}
void app_timer_cancel(AppTimer *timer){if(timer)timer->active=false;}
void advance_ms(uint32_t delta){
  uint32_t target=now_ms+delta;
  unsigned callbacks=0;
  for(;;){
    AppTimer *next=NULL;
    for(size_t i=0;i<sizeof(timers)/sizeof(timers[0]);i++){
      if(timers[i].active&&timers[i].due<=target &&
         (!next||timers[i].due<next->due))next=&timers[i];
    }
    if(!next)break;
    assert(++callbacks<100000);
    now_ms=next->due;
    void(*callback)(void*)=next->cb;
    void *context=next->ctx;
    next->active=false;
    callback(context);
  }
  now_ms=target;
}
bool speaker_stream_open(SpeakerPcmFormat fmt,uint8_t volume){
  (void)volume;assert(fmt==SpeakerPcmFormat_8kHz_16bit);
  assert(!speaker_open);
  speaker_open=true;speaker_opens++;
  return true;
}
uint32_t speaker_stream_write(const void *data,uint32_t n){
  assert(data&&speaker_open);accepted_pcm+=n;return n;
}
void speaker_stream_close(void){
  assert(speaker_open);speaker_open=false;speaker_closes++;
}
static DictionaryIterator outbox;
static char last_reply_command[48],last_reply_tag[48];
int app_message_outbox_begin(DictionaryIterator **iter){
  last_reply_command[0]=last_reply_tag[0]=0;
  *iter=&outbox;return APP_MSG_OK;
}
int app_message_outbox_send(void){return APP_MSG_OK;}
int dict_write_cstring(DictionaryIterator *iter,int key,const char *value){
  (void)iter;
  if(key==MESSAGE_KEY_COMMAND)snprintf(last_reply_command,sizeof(last_reply_command),"%s",value);
  if(key==MESSAGE_KEY_TEXT)snprintf(last_reply_tag,sizeof(last_reply_tag),"%s",value);
  return 0;
}
Tuple *dict_find(DictionaryIterator *iter,int key){
  if(key==MESSAGE_KEY_COMMAND)return iter->command;
  if(key==MESSAGE_KEY_CHUNK)return iter->chunk;
  if(key==MESSAGE_KEY_TEXT)return iter->text;
  return NULL;
}
// Include the production C file in this translation unit so static timers
// and state go through exactly the same callbacks as the watch SDK build.
#include "../src/c/universal_tts.c"
static void deliverTagged(const char *name,size_t n,const char *tag){
  TupleValue commandValue={0},chunkValue={0};
  Tuple command={.type=TUPLE_CSTRING,.length=1,.value=&commandValue};
  Tuple chunk={.type=1,.length=(uint16_t)n,.value=&chunkValue};
  TupleValue tagValue={0};
  Tuple text={.type=TUPLE_CSTRING,.length=tag?(uint16_t)strlen(tag)+1:0,.value=&tagValue};
  if(tag)snprintf(tagValue.cstring,sizeof(tagValue.cstring),"%s",tag);
  DictionaryIterator message={.command=&command,.chunk=n?&chunk:NULL,
    .text=tag?&text:NULL};
  strcpy(commandValue.cstring,name);
  for(size_t i=0;i<n;i++)chunkValue.data[i]=(uint8_t)(i&255);
  assert(universal_tts_handle_message(&message));
}
static void deliver(const char *name,size_t n){deliverTagged(name,n,NULL);}
int main(void){
  universal_tts_init();
  deliver("AUDIO_RESET",0);
  for(int i=0;i<6;i++)deliver("AUDIO_CHUNK",700);
  assert(speaker_opens==1);
  assert(speaker_closes==0);
  advance_ms(3500);
  assert(speaker_closes==0 && speaker_open &&
    "The watch must NOT close after a 1.5s gap while more speech is expected");
  deliver("AUDIO_SENTENCE_END",0);
  advance_ms(2700);
  assert(speaker_closes==0 && speaker_open &&
    "Multi-sentence synthesis gaps must not close the speaker");
  for(int i=0;i<6;i++)deliver("AUDIO_CHUNK",700);
  advance_ms(1000);
  assert(accepted_pcm>0);
  assert(speaker_closes==0);
  deliver("AUDIO_SENTENCE_END",0);
  deliver("AUDIO_STREAM_END",0);
  advance_ms(3000);
  assert(speaker_closes==1 && !speaker_open &&
    "A fully delivered response must close once after draining");
  assert(speaker_opens==1);

  // A missing final packet is handled by a bounded 30s watchdog.
  deliver("AUDIO_RESET",0);
  for(int i=0;i<5;i++)deliver("AUDIO_CHUNK",700);
  assert(speaker_opens==2);
  advance_ms(29500);
  assert(speaker_closes==1 && speaker_open);
  advance_ms(3000);
  assert(speaker_closes==2 && !speaker_open);
  // Watch-origin ACK is mandatory for tagged packets, and retried packets
  // must never enter the audio buffer twice.
  deliverTagged("AUDIO_RESET",0,"29108");
  deliverTagged("AUDIO_CHUNK",360,"29108:0");
  assert(strcmp(last_reply_command,"AUDIO_ACK")==0);
  assert(strcmp(last_reply_tag,"29108:0")==0);
  assert(s_expected_sequence==1);
  uint32_t before_duplicate=s_buffer_count;
  deliverTagged("AUDIO_CHUNK",360,"29108:0");
  assert(strcmp(last_reply_command,"AUDIO_ACK")==0);
  assert(s_buffer_count==before_duplicate && s_transport_duplicates==1);
  deliverTagged("AUDIO_CHUNK",360,"29108:2");
  assert(strcmp(last_reply_command,"AUDIO_WAIT")==0);
  assert(s_expected_sequence==1);
  last_reply_command[0]=0; // A stale session must not generate a reply.
  deliverTagged("AUDIO_CHUNK",360,"11111:1");
  assert(last_reply_command[0]==0 && s_expected_sequence==1);
  deliverTagged("AUDIO_CHUNK",360,"29108:1");
  assert(strcmp(last_reply_command,"AUDIO_ACK")==0);
  assert(s_expected_sequence==2);
  deliverTagged("AUDIO_SENTENCE_END",0,"29108:2");
  assert(strcmp(last_reply_command,"AUDIO_ACK")==0 && s_expected_sequence==3);
  deliverTagged("AUDIO_STREAM_END",0,"29108:3");
  assert(strcmp(last_reply_command,"AUDIO_ACK")==0 && s_expected_sequence==4);
  advance_ms(2500);
  universal_tts_deinit();
  printf("PASS: native watch speaker stays live across gaps, confirms ordered packet ACKs and drops duplicates\n");
  return 0;
}
