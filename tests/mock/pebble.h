#ifndef MOCK_PEBBLE_H
#define MOCK_PEBBLE_H
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#define PBL_SPEAKER 1
#define APP_LOG_LEVEL_WARNING 2
#define APP_LOG_LEVEL_ERROR 3
#define APP_LOG(...) do {} while(0)
#define MESSAGE_KEY_COMMAND 1
#define MESSAGE_KEY_TEXT 2
#define MESSAGE_KEY_CHUNK 3
#define TUPLE_CSTRING 0
#define APP_MSG_OK 0
typedef struct AppTimer AppTimer;
struct AppTimer {
  bool active;
  uint32_t due;
  void (*cb)(void *);
  void *ctx;
};
typedef struct {char cstring[256]; uint8_t data[1024];} TupleValue;
typedef struct {int type; uint16_t length; TupleValue *value;} Tuple;
typedef struct {Tuple *command;Tuple *chunk;Tuple *text;} DictionaryIterator;
typedef enum {SpeakerPcmFormat_8kHz_16bit=2} SpeakerPcmFormat;
AppTimer *app_timer_register(uint32_t delay,void(*cb)(void*),void *data);
void app_timer_cancel(AppTimer *timer);
int app_message_outbox_begin(DictionaryIterator **iter);
int app_message_outbox_send(void);
int dict_write_cstring(DictionaryIterator *iter,int key,const char *string);
Tuple *dict_find(DictionaryIterator *iter,int key);
bool speaker_stream_open(SpeakerPcmFormat fmt,uint8_t volume);
uint32_t speaker_stream_write(const void *data,uint32_t num_bytes);
void speaker_stream_close(void);
#endif
