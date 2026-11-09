// =========================================================================
// SECTION 1: SYSTEM HEADERS & PREPROCESSOR MACROS
// =========================================================================

#include <pebble.h>
#include "universal_tts.h" 

#define MAX_TEXT_LENGTH 2048 

#ifdef PBL_SPEAKER
  #define PERSIST_KEY_VOLUME 100
#endif

// =========================================================================
// SECTION 2: GLOBAL UI STATE MACHINE VARIABLES & POINTERS
// =========================================================================

typedef enum { UI_STATE_IDLE, UI_STATE_THINKING, UI_STATE_RESULTS } UIState;

static UIState s_current_state = UI_STATE_IDLE; 
static Window *s_main_window;                   
static ScrollLayer *s_scroll_layer;             
static TextLayer *s_text_layer;                 
static TextLayer *s_status_layer;               
static Layer *s_idle_layer;                     
static GBitmap *s_logo_bitmap;                  
static BitmapLayer *s_logo_layer;               
static TextLayer *s_title_layer;
static TextLayer *s_byline_layer;
static char s_agent_title[32] = "WISP";
static int s_agent_icon = 0;                
static TextLayer *s_prompt_layer;               
static Layer *s_arrow_layer;                    
static Layer *s_pinwheel_layer;                 
static AppTimer *s_pinwheel_timer = NULL;       
static int s_pinwheel_angle = 0;                
static DictationSession *s_dictation_session;   
static char s_gemini_text[MAX_TEXT_LENGTH];
#define PERSIST_KEY_APPEARANCE 101
static int s_appearance_mode = 0; // auto / day / night
static time_t s_sunrise = 0, s_sunset = 0;
static bool s_is_night = true;
#ifdef PBL_SPEAKER
static TextLayer *s_volume_text_layer;
#endif

static bool appearance_is_night(void) {
  if (s_appearance_mode == 1) return false;
  if (s_appearance_mode == 2) return true;
  time_t now = time(NULL);
  struct tm *local = localtime(&now);
  int minute = local ? local->tm_hour * 60 + local->tm_min : 720;
  if (s_sunrise > 0 && s_sunset > s_sunrise) {
    struct tm *rise = localtime(&s_sunrise);
    int rise_min = rise ? rise->tm_hour * 60 + rise->tm_min : 420;
    struct tm *set = localtime(&s_sunset);
    int set_min = set ? set->tm_hour * 60 + set->tm_min : 1140;
    if (rise_min < set_min) return minute < rise_min || minute >= set_min;
  }
  return minute < 420 || minute >= 1140;
}

static void update_appearance(void) {
  bool dark = appearance_is_night();
  s_is_night = dark;
  GColor fg = dark ? GColorWhite : GColorBlack;
  GColor bg = dark ? GColorBlack : GColorWhite;
  if (s_main_window) window_set_background_color(s_main_window, bg);
  if (s_text_layer) {
    text_layer_set_text_color(s_text_layer, fg);
    text_layer_set_background_color(s_text_layer, bg);
  }
  if (s_status_layer) {
    text_layer_set_text_color(s_status_layer, fg);
    text_layer_set_background_color(s_status_layer, bg);
  }
  if (s_title_layer) text_layer_set_text_color(s_title_layer, fg);
  if (s_byline_layer) text_layer_set_text_color(s_byline_layer, fg);
  if (s_prompt_layer) text_layer_set_text_color(s_prompt_layer, fg);
#ifdef PBL_SPEAKER
  if (s_volume_text_layer) {
    text_layer_set_text_color(s_volume_text_layer, fg);
    text_layer_set_background_color(s_volume_text_layer, bg);
  }
#endif
  if (s_arrow_layer) layer_mark_dirty(s_arrow_layer);
  if (s_pinwheel_layer) layer_mark_dirty(s_pinwheel_layer);
}
static void appearance_tick(struct tm *tick_time, TimeUnits units_changed) {
  if (s_appearance_mode == 0 && appearance_is_night() != s_is_night) update_appearance();
}
     

// Universal TTS owns all audio buffers, streaming, and speaker state.
#ifdef PBL_SPEAKER
static float s_volume=1.0f;
static AppTimer *s_volume_timer=NULL;
#endif

// =========================================================================
// SECTION 4: FUNCTION PROTOTYPES & FORWARD DECLARATIONS
// =========================================================================

static void set_ui_state(UIState state);       
static void window_click_config_provider(void *context);

 
#ifdef PBL_SPEAKER
  static void up_volume_handler(ClickRecognizerRef recognizer, void *context);   
  static void down_volume_handler(ClickRecognizerRef recognizer, void *context); 
#endif

// =========================================================================
// SECTION 5: SPLASH GRAPHICS & PROCESSING DRAW VECTORS
// =========================================================================

static void pinwheel_timer_callback(void *data) {
  s_pinwheel_timer = NULL;                      
  s_pinwheel_angle = (s_pinwheel_angle + 30) % 360; 
  if (s_pinwheel_layer) layer_mark_dirty(s_pinwheel_layer);           
  if (s_current_state == UI_STATE_THINKING) {    
    s_pinwheel_timer = app_timer_register(100, pinwheel_timer_callback, NULL); 
  }
}

static void pinwheel_update_proc(Layer *layer, GContext *ctx) {
  if (s_current_state != UI_STATE_THINKING) return; 
  GRect bounds = layer_get_bounds(layer);        
  GPoint center = grect_center_point(&bounds);  
  int radius = 9;                               
  graphics_context_set_stroke_color(ctx, s_is_night ? GColorWhite : GColorBlack); 
  graphics_context_set_stroke_width(ctx, 3);    
  for(int i = 0; i < 4; i++) {                  
     int32_t angle = TRIG_MAX_ANGLE * (s_pinwheel_angle + i * 90) / 360; 
     int y = -cos_lookup(angle) * radius / TRIG_MAX_RATIO + center.y;   
     int x = sin_lookup(angle) * radius / TRIG_MAX_RATIO + center.x;     
     graphics_draw_line(ctx, center, GPoint(x, y));                     
  }
}

static void arrow_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);        
  graphics_context_set_stroke_color(ctx, s_is_night ? GColorWhite : GColorBlack); 
  graphics_context_set_stroke_width(ctx, 3);    
  int y = bounds.size.h / 2;                    
  int x_start = 0;                              
  int x_end = bounds.size.w - 5;                
  graphics_draw_line(ctx, GPoint(x_start, y), GPoint(x_end, y));         
  graphics_draw_line(ctx, GPoint(x_end, y), GPoint(x_end - 6, y - 6));   
  graphics_draw_line(ctx, GPoint(x_end, y), GPoint(x_end - 6, y + 6));   
}

static void set_status(const char* status) {
  if (status == NULL) {                         
    layer_set_hidden(text_layer_get_layer(s_status_layer), true); 
  } else {
    text_layer_set_text(s_status_layer, status); 
    layer_set_hidden(text_layer_get_layer(s_status_layer), false); 
  }
}

static void update_text_layout() {
  Layer *window_layer = window_get_root_layer(s_main_window); 
  int16_t screen_width = layer_get_bounds(window_layer).size.w; 
  int16_t text_width = screen_width - 10;       
  text_layer_set_size(s_text_layer, GSize(text_width, 2000)); 
  GSize max_size = text_layer_get_content_size(s_text_layer); 
  max_size.h += 30;                             
  text_layer_set_size(s_text_layer, max_size);  
  scroll_layer_set_content_size(s_scroll_layer, GSize(screen_width, max_size.h + 10)); 
}

// =========================================================================
// SECTION 6: UNIVERSAL TTS VOLUME & WATCH CAPABILITY STATUS
// =========================================================================
#ifdef PBL_SPEAKER
  static void hide_volume_layer_callback(void *data) {
    s_volume_timer = NULL;                      
    layer_set_hidden(text_layer_get_layer(s_volume_text_layer), true); 
  }

  static void show_volume_indicator() {
    static char vol_buf[16];                    
    int percentage = (int)(s_volume * 100.0f + 0.5f); 
    if (percentage > 100) percentage = 100;     
    if (percentage < 0) percentage = 0;         

    snprintf(vol_buf, sizeof(vol_buf), "Vol: %d%%", percentage); 
    text_layer_set_text(s_volume_text_layer, vol_buf); 
    layer_set_hidden(text_layer_get_layer(s_volume_text_layer), false); 

    if (s_volume_timer) {
      app_timer_cancel(s_volume_timer);
      s_volume_timer = NULL;
    } 
    s_volume_timer = app_timer_register(2000, hide_volume_layer_callback, NULL); 
  }


static void up_volume_handler(ClickRecognizerRef recognizer,void *context){
  s_volume+=0.1f;if(s_volume>1.0f)s_volume=1.0f;
  universal_tts_set_volume(s_volume);
  persist_write_int(PERSIST_KEY_VOLUME,(int)(s_volume*100.0f+0.5f));
  vibes_short_pulse();show_volume_indicator();
}
static void down_volume_handler(ClickRecognizerRef recognizer,void *context){
  s_volume-=0.1f;if(s_volume<0.0f)s_volume=0.0f;
  universal_tts_set_volume(s_volume);
  persist_write_int(PERSIST_KEY_VOLUME,(int)(s_volume*100.0f+0.5f));
  vibes_short_pulse();show_volume_indicator();
}
#endif

static void send_watch_status(void) {
  DictionaryIterator *out = NULL;
  if (app_message_outbox_begin(&out) != APP_MSG_OK || !out) return;
  dict_write_cstring(out, MESSAGE_KEY_COMMAND, "WATCH_STATUS");
#ifdef PBL_SPEAKER
  dict_write_int32(out, MESSAGE_KEY_SPEAKER_CAPABLE, 1);
  dict_write_int32(out, MESSAGE_KEY_VOLUME, (int)(s_volume * 100.0f + 0.5f));
#else
  dict_write_int32(out, MESSAGE_KEY_SPEAKER_CAPABLE, 0);
  dict_write_int32(out, MESSAGE_KEY_VOLUME, 0);
#endif
  app_message_outbox_send();
}
static void watch_status_timer(void *data) {
  send_watch_status();
}

// =========================================================================
// SECTION 7: HARDWARE KEY BOARD REGISTRATION & INTERCEPT MAPPINGS
// =========================================================================

static void select_short_click_handler(ClickRecognizerRef recognizer, void *context) {
  universal_tts_stop();
  set_status(NULL);
  send_watch_status();
  dictation_session_start(s_dictation_session); 
}

static void select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  universal_tts_stop();
  set_status(NULL);
  vibes_double_pulse();
  set_ui_state(UI_STATE_IDLE);
}

static void window_click_config_provider(void *context) {
  if (s_current_state == UI_STATE_RESULTS) {    
    window_set_click_context(BUTTON_ID_UP, s_scroll_layer); 
    window_set_click_context(BUTTON_ID_DOWN, s_scroll_layer);

    window_single_repeating_click_subscribe(BUTTON_ID_UP, 100, (ClickHandler) scroll_layer_scroll_up_click_handler);
    window_single_repeating_click_subscribe(BUTTON_ID_DOWN, 100, (ClickHandler) scroll_layer_scroll_down_click_handler);
    
    window_single_click_subscribe(BUTTON_ID_SELECT, select_short_click_handler); 
    window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long_click_handler, NULL); 
    
    #ifdef PBL_SPEAKER
      window_long_click_subscribe(BUTTON_ID_UP, 500, up_volume_handler, NULL);
      window_long_click_subscribe(BUTTON_ID_DOWN, 500, down_volume_handler, NULL);
    #endif
  } else {
    window_single_click_subscribe(BUTTON_ID_SELECT, select_short_click_handler); 
    window_long_click_subscribe(BUTTON_ID_SELECT, 500, select_long_click_handler, NULL); 
    
    #ifdef PBL_SPEAKER
      window_single_click_subscribe(BUTTON_ID_UP, up_volume_handler);    
      window_single_click_subscribe(BUTTON_ID_DOWN, down_volume_handler);  
    #endif
  }
}

// =========================================================================
// SECTION 8: STATE ROUTING ENGINE
// =========================================================================

static void set_ui_state(UIState state) {
  s_current_state = state;
  if (state != UI_STATE_THINKING && s_pinwheel_timer) {
    app_timer_cancel(s_pinwheel_timer);
    s_pinwheel_timer = NULL;
  }                      
  
  window_set_click_config_provider(s_main_window, window_click_config_provider);

  switch (state) {
    case UI_STATE_IDLE:                         
      layer_set_hidden(s_idle_layer, false);    
      layer_set_hidden(scroll_layer_get_layer(s_scroll_layer), true); 
      layer_set_hidden(s_arrow_layer, false);   
      layer_set_hidden(s_pinwheel_layer, true);  
      text_layer_set_text(s_prompt_layer, "Select to talk"); 
      break;
    case UI_STATE_THINKING:                     
      layer_set_hidden(s_idle_layer, false);    
      layer_set_hidden(scroll_layer_get_layer(s_scroll_layer), true); 
      layer_set_hidden(s_arrow_layer, true);    
      layer_set_hidden(s_pinwheel_layer, false); 
      text_layer_set_text(s_prompt_layer, "Thinking..."); 
      if (!s_pinwheel_timer) {                   
        s_pinwheel_timer = app_timer_register(100, pinwheel_timer_callback, NULL); 
      }
      break;
    case UI_STATE_RESULTS:                      
      layer_set_hidden(s_idle_layer, true);     
      layer_set_hidden(scroll_layer_get_layer(s_scroll_layer), false); 
      if (s_pinwheel_timer) {                   
        app_timer_cancel(s_pinwheel_timer);     
        s_pinwheel_timer = NULL;                
      }
      break;
  }
}

// =========================================================================
// SECTION 9: APP MESSAGE COMMUNICATIONS RECEIVER & PARSING STRUCTURES
// =========================================================================

static uint32_t agent_resource_id(int agent) {
  switch(agent){
    case 1: return RESOURCE_ID_AGENT_GEMINI;
    case 2: return RESOURCE_ID_AGENT_OPENAI;
    case 3: return RESOURCE_ID_AGENT_CLAUDE;
    case 4: return RESOURCE_ID_AGENT_GROK;
    case 5: return RESOURCE_ID_AGENT_MUSE;
    case 6: return RESOURCE_ID_AGENT_OPENROUTER;
    case 7: return RESOURCE_ID_AGENT_DEEPSEEK;
    default: return RESOURCE_ID_AGENT_WISP;
  }
}
static void update_agent_display(const char *name, int agent) {
  if (agent<0 || agent>7) agent=0;
  if(name && name[0]){
    snprintf(s_agent_title,sizeof(s_agent_title),"%s",name);
    if(s_title_layer)text_layer_set_text(s_title_layer,s_agent_title);
  }
  if (agent!=s_agent_icon || !s_logo_bitmap) {
    GBitmap *replacement=gbitmap_create_with_resource(agent_resource_id(agent));
    if (replacement) {
      if(s_logo_layer) bitmap_layer_set_bitmap(s_logo_layer,replacement);
      if(s_logo_bitmap)gbitmap_destroy(s_logo_bitmap);
      s_logo_bitmap=replacement;
      s_agent_icon=agent;
    }
  }
}
static void inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *command_tuple = dict_find(iterator, MESSAGE_KEY_COMMAND); 
  if (!command_tuple) return;
  // The shared Universal TTS SDK is the sole receiver for AUDIO_RESET,
  // AUDIO_CHUNK, AUDIO_SENTENCE_END and AUDIO_STOP.
  if (universal_tts_handle_message(iterator)) {
    // The first verified audio packet means the buffering handoff started.
    // The shared SDK does not own WISP's status layer.
    if (strcmp(command_tuple->value->cstring,"AUDIO_CHUNK")==0 ||
        strcmp(command_tuple->value->cstring,"AUDIO_STOP")==0)
      set_status(NULL);
    return;
  }
  if (strcmp(command_tuple->value->cstring,"AUDIO_STATS")==0) {
    set_status(NULL);
    return;
  }
  if (strcmp(command_tuple->value->cstring,"TTS_FAILURE")==0) {
    set_status("Speech unavailable");
    return;
  }                   

  if (strcmp(command_tuple->value->cstring, "UPDATE_APPEARANCE") == 0) {
    Tuple *mode = dict_find(iterator, MESSAGE_KEY_APPEARANCE_MODE);
    Tuple *rise = dict_find(iterator, MESSAGE_KEY_SUNRISE);
    Tuple *set = dict_find(iterator, MESSAGE_KEY_SUNSET);
    if (mode && mode->value->int32 >= 0 && mode->value->int32 <= 2) {
      s_appearance_mode = mode->value->int32;
      persist_write_int(PERSIST_KEY_APPEARANCE, s_appearance_mode);
    }
    if (rise && set && rise->value->int32 > 0 && set->value->int32 > rise->value->int32) {
      s_sunrise = (time_t)rise->value->int32;
      s_sunset = (time_t)set->value->int32;
    }
    update_appearance();
    return;
  }
  if(strcmp(command_tuple->value->cstring,"AGENT_INFO")==0){
    Tuple *name=dict_find(iterator,MESSAGE_KEY_AGENT_NAME);
    Tuple *icon=dict_find(iterator,MESSAGE_KEY_AGENT_ICON);
    update_agent_display(name?name->value->cstring:NULL,
      icon?icon->value->int32:0);
    return;
  }
  if (strncmp(command_tuple->value->cstring, "TEXT_RESPONSE", 13) == 0) { 
    bool no_audio = false;
    universal_tts_stop(); // New response owns the next speech session.

    #ifdef PBL_SPEAKER
      // MULTIPLEXING INTERCEPT: Determine if the phone told us to expect audio chunks
      if (strcmp(command_tuple->value->cstring, "TEXT_RESPONSE_NO_AUDIO") == 0) {
        no_audio = true;
        // Text-only mode is intentionally silent.
      }
    #endif

    Tuple *text_tuple = dict_find(iterator, MESSAGE_KEY_TEXT); 
    if (text_tuple) {
      snprintf(s_gemini_text, sizeof(s_gemini_text), "%s", text_tuple->value->cstring); 
      text_layer_set_text(s_text_layer, s_gemini_text); 
      update_text_layout();                     
      
      set_ui_state(UI_STATE_RESULTS);          

      #ifdef PBL_SPEAKER
        if (no_audio) {
          set_status(NULL);                     // Immediately clear status strip if no audio is expected (text-only mode)
        } else {
          if (s_volume > 0.01f) {
            set_status("Buffering Audio...");   
          } else {
            set_status(NULL);                   
          }
        }
      #else
        set_status(NULL);                       
      #endif
    }
  } 
  
  else if (strcmp(command_tuple->value->cstring, "UPDATE_FONT") == 0) { 
    Tuple *font_tuple = dict_find(iterator, MESSAGE_KEY_FONT_SIZE); 
    if (font_tuple) {
      int new_size = font_tuple->value->int32;   
      if (new_size <= 14) text_layer_set_font(s_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
      else if (new_size <= 18) text_layer_set_font(s_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
      else if (new_size <= 24) text_layer_set_font(s_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));
      else text_layer_set_font(s_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28));
      update_text_layout();                     
    }
  }
}

static void dictation_session_callback(DictationSession *session, DictationSessionStatus status, char *transcription, void *context) {
  if (status == DictationSessionStatusSuccess) { 
    set_ui_state(UI_STATE_THINKING);            
    text_layer_set_text(s_text_layer, "");      
    update_text_layout();                       

    DictionaryIterator *iter;                   
    app_message_outbox_begin(&iter);            
    dict_write_cstring(iter, MESSAGE_KEY_COMMAND, "DICTATION");
#ifdef PBL_SPEAKER
    dict_write_int32(iter, MESSAGE_KEY_SPEAKER_CAPABLE, 1);
#else
    dict_write_int32(iter, MESSAGE_KEY_SPEAKER_CAPABLE, 0);
#endif 
    dict_write_cstring(iter, MESSAGE_KEY_TEXT, transcription);  
    
    #ifdef PBL_SPEAKER
      dict_write_int32(iter, MESSAGE_KEY_VOLUME, (int)(s_volume * 100.0f + 0.5f)); 
    #else
      dict_write_int32(iter, MESSAGE_KEY_VOLUME, 0); 
    #endif
    
    app_message_outbox_send();                  
  } else {
    set_ui_state(UI_STATE_IDLE);                
  }
}

// =========================================================================
// SECTION 10: PRIMARY UI CANVAS STRUCT DESIGN LOADING MODULES
// =========================================================================

static void main_window_load(Window *window) {
  window_set_background_color(window, GColorBlack); 
  Layer *window_layer = window_get_root_layer(window); 
  GRect bounds = layer_get_bounds(window_layer); 

  s_scroll_layer = scroll_layer_create(bounds);
  layer_add_child(window_layer, scroll_layer_get_layer(s_scroll_layer)); 

  s_text_layer = text_layer_create(GRect(5, 5, bounds.size.w - 10, 2000));
  text_layer_set_text_alignment(s_text_layer, GTextAlignmentLeft);
  text_layer_set_text_color(s_text_layer,GColorWhite);
  text_layer_set_background_color(s_text_layer,GColorBlack);
  text_layer_set_font(s_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));

  #if defined(PBL_ROUND) 
    text_layer_enable_screen_text_flow_and_paging(s_text_layer, 5); 
  #endif

  scroll_layer_add_child(s_scroll_layer, text_layer_get_layer(s_text_layer)); 

  s_status_layer = text_layer_create(GRect(0, bounds.size.h - 24, bounds.size.w, 24));
  text_layer_set_background_color(s_status_layer, GColorBlack);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  layer_set_hidden(text_layer_get_layer(s_status_layer), true); 
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));

  s_idle_layer = layer_create(bounds);

  // Balanced, centered branding for both round and rectangular Pebbles.
  #if defined(PBL_ROUND)
    s_logo_layer = bitmap_layer_create(GRect((bounds.size.w-40)/2,14,40,40));
    s_title_layer = text_layer_create(GRect(8,58,bounds.size.w-16,32));
    s_byline_layer = text_layer_create(GRect(8,91,bounds.size.w-16,20));
    s_prompt_layer = text_layer_create(GRect(6,127,bounds.size.w-12,28));
    s_arrow_layer = layer_create(GRect(bounds.size.w-28,130,20,20));
    s_pinwheel_layer = layer_create(GRect(bounds.size.w-30,129,22,22));
  #else
    s_logo_layer = bitmap_layer_create(GRect((bounds.size.w-40)/2,8,40,40));
    s_title_layer = text_layer_create(GRect(8,51,bounds.size.w-16,32));
    s_byline_layer = text_layer_create(GRect(8,84,bounds.size.w-16,22));
    s_prompt_layer = text_layer_create(GRect(8,122,bounds.size.w-16,28));
    s_arrow_layer = layer_create(GRect(bounds.size.w-29,126,20,20));
    s_pinwheel_layer = layer_create(GRect(bounds.size.w-31,126,22,22));
  #endif
  s_logo_bitmap = gbitmap_create_with_resource(RESOURCE_ID_AGENT_WISP);
  if(s_logo_bitmap){
    bitmap_layer_set_bitmap(s_logo_layer,s_logo_bitmap);
    bitmap_layer_set_compositing_mode(s_logo_layer,GCompOpSet);
  }
  layer_add_child(s_idle_layer,bitmap_layer_get_layer(s_logo_layer));
  text_layer_set_font(s_title_layer,fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  text_layer_set_text_alignment(s_title_layer,GTextAlignmentCenter);
  text_layer_set_text_color(s_title_layer,GColorWhite);
  text_layer_set_background_color(s_title_layer,GColorClear);
  text_layer_set_text(s_title_layer,s_agent_title);
  layer_add_child(s_idle_layer,text_layer_get_layer(s_title_layer));
  text_layer_set_font(s_byline_layer,fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_byline_layer,GTextAlignmentCenter);
  text_layer_set_text_color(s_byline_layer,GColorWhite);
  text_layer_set_background_color(s_byline_layer,GColorClear);
  text_layer_set_text(s_byline_layer,"via WISP");
  layer_add_child(s_idle_layer,text_layer_get_layer(s_byline_layer));
  text_layer_set_font(s_prompt_layer,fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_prompt_layer,GTextAlignmentCenter);
  text_layer_set_text_color(s_prompt_layer,GColorWhite);
  text_layer_set_background_color(s_prompt_layer,GColorClear);
  text_layer_set_text(s_prompt_layer,"Select to talk");
  layer_add_child(s_idle_layer,text_layer_get_layer(s_prompt_layer));

  layer_set_update_proc(s_arrow_layer, arrow_update_proc); 
  layer_add_child(s_idle_layer, s_arrow_layer);

  layer_set_update_proc(s_pinwheel_layer, pinwheel_update_proc); 
  layer_add_child(s_idle_layer, s_pinwheel_layer);

  layer_add_child(window_layer, s_idle_layer); 

  #ifdef PBL_SPEAKER
    s_volume_text_layer = text_layer_create(GRect(bounds.size.w - 85, 5, 80, 24));
    text_layer_set_background_color(s_volume_text_layer, GColorBlack);
    text_layer_set_text_color(s_volume_text_layer, GColorWhite);
    text_layer_set_font(s_volume_text_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
    text_layer_set_text_alignment(s_volume_text_layer, GTextAlignmentCenter);
    layer_set_hidden(text_layer_get_layer(s_volume_text_layer), true); 
    layer_add_child(window_layer, text_layer_get_layer(s_volume_text_layer));
  #endif

  s_dictation_session = dictation_session_create(sizeof(s_gemini_text), dictation_session_callback, NULL);

  update_appearance();
  set_ui_state(UI_STATE_IDLE);
  app_timer_register(1200, watch_status_timer, NULL); 
}

static void main_window_unload(Window *window) {
  if (s_pinwheel_timer) {
    app_timer_cancel(s_pinwheel_timer);
    s_pinwheel_timer = NULL;
  }
  #ifdef PBL_SPEAKER
    universal_tts_stop();
    if (s_volume_timer) app_timer_cancel(s_volume_timer); 
    text_layer_destroy(s_volume_text_layer);    
  #endif
  
  if (s_dictation_session) {
    dictation_session_destroy(s_dictation_session);
    s_dictation_session = NULL;
  } 
  if (s_logo_bitmap) {
    gbitmap_destroy(s_logo_bitmap);
    s_logo_bitmap = NULL;
  } 
  bitmap_layer_destroy(s_logo_layer);           
  text_layer_destroy(s_title_layer);
  text_layer_destroy(s_byline_layer);            
  text_layer_destroy(s_prompt_layer);           
  layer_destroy(s_arrow_layer);                 
  layer_destroy(s_pinwheel_layer);              
  layer_destroy(s_idle_layer);                  
  text_layer_destroy(s_status_layer);           
  text_layer_destroy(s_text_layer);             
  scroll_layer_destroy(s_scroll_layer);         
}

// =========================================================================
// SECTION 11: MASTER INITIALIZATION & SYSTEM APPLICATION LIFE LOOPS ENTRY
// =========================================================================

static void init() {
  if (persist_exists(PERSIST_KEY_APPEARANCE)) {
    int mode = persist_read_int(PERSIST_KEY_APPEARANCE);
    if (mode >= 0 && mode <= 2) s_appearance_mode = mode;
  }
  s_is_night = appearance_is_night();
  tick_timer_service_subscribe(MINUTE_UNIT, appearance_tick);
  #ifdef PBL_SPEAKER
    if (persist_exists(PERSIST_KEY_VOLUME)) s_volume = persist_read_int(PERSIST_KEY_VOLUME) / 100.0f;
    else s_volume = 1.0f;
    if (s_volume < 0.0f) s_volume = 0.0f;
    if (s_volume > 1.0f) s_volume = 1.0f; 
  #endif
  
  universal_tts_init();
#ifdef PBL_SPEAKER
  universal_tts_set_volume(s_volume);
#endif
  app_message_register_inbox_received(inbox_received_callback); 
  app_message_open(12000, 1024);                
  
  s_main_window = window_create();              
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load, .unload = main_window_unload 
  });
  
  window_set_click_config_provider(s_main_window, window_click_config_provider);
  window_stack_push(s_main_window, true);       
}

static void deinit() { 
  tick_timer_service_unsubscribe();
  universal_tts_deinit();
  window_destroy(s_main_window);                
}

int main(void) { 
  init();                                       
  app_event_loop();                             
  deinit();                                     
}