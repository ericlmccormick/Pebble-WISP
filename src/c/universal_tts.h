/* Universal TTS reusable watch audio SDK v1. MIT License.
 * Copy universal_tts.h and universal_tts.c into src/c.
 * App owns AppMessage registration and must declare COMMAND, TEXT and CHUNK keys.
 * Handles native playback on watches with a speaker.
 * The app owns AppMessage registration; pass received dictionaries to
 * universal_tts_handle_message(). Provider credentials remain in the phone plugin.
 */
#ifndef UNIVERSAL_TTS_H
#define UNIVERSAL_TTS_H
#include <pebble.h>
void universal_tts_init(void);
bool universal_tts_supported(void);
void universal_tts_deinit(void);
void universal_tts_stop(void);
bool universal_tts_handle_message(DictionaryIterator *iterator);
void universal_tts_set_volume(float volume);
bool universal_tts_is_playing(void);
#endif
