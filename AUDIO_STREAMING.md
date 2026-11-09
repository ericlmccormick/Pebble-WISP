# Shared audio transport

WISP 2.2 delegates synthesis, WAV integrity verification, resampling, IMA-ADPCM encoding and Bluetooth speaker playback to the [Universal TTS SDK](https://github.com/ericlmccormick/Pebble-Universal-TTS). It does not maintain a private packet transport.

WISP sends the displayed text to the shared SDK only after the watch acknowledges its answer. The SDK segments long text into at most 480-character requests, then performs `tts_prepare`, `tts_chunk`, and `tts_release` against the user's selected TTS provider via Universal TTS. Native `universal_tts_handle_message` owns `AUDIO_RESET`, `AUDIO_CHUNK`, `AUDIO_SENTENCE_END` and `AUDIO_STOP`. WISP's volume handlers call `universal_tts_set_volume`.

Speech errors are logged on the phone and reported by WISP as `TTS_FAILURE`. Successful text replies remain readable even if audio fails. For codec and transport implementation, see `src/pkjs/universal_tts.js` and `src/c/universal_tts.c`.
