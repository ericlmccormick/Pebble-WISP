# WISP audio transport — 2.2.4 rollback

WISP 2.2.4 restores its last device-verified 2.1.6 audio path:

1. The AI agent/direct Gemini returns text, which WISP displays and segments for speech.
2. In Universal TTS mode, `src/pkjs/google_tts_stream.js` calls `tts_prepare` and rolling `tts_chunk` requests, verifying WAV session metadata and rolling checksums. In Direct Google legacy mode, the original Google TTS REST synthesis is used.
3. WISP's original `encodeADPCM` turns verified PCM into ordered ADPCM while retaining the predictor between chunks.
4. The original `sendPendingPacket` / `handleAudioAck` stop-and-wait protocol uses watch-origin `AUDIO_ACK` and `AUDIO_WAIT` with `STREAM_ID`, `SEQ`, `BUFFER_FREE`, `SENTENCE_TOTAL` and `BUFFER_HINT`. The phone does not treat a generic Bluetooth send success as proof the watch buffered the audio.
5. The original `src/c/main.c` receiver keeps a playback ring, tracks sentence boundaries and uses adaptive per-sentence prebuffering. It keeps speaker power on during sentence transitions and sends an explicit final stream acknowledgement.

This is not the alternative `universal_tts.js` / `universal_tts.c` transport introduced during the WISP 2.2.0 migration. Those files were removed from WISP in 2.2.4. Universal TTS **as a plugin** continues to work through the existing streaming action API.

The prior releases repeatedly cut out after 2–3 seconds on a real watch, despite automated SDK tests. A regression suite that models phone callbacks without a real watch cannot establish that the speaker works on hardware. The only definitive validation is playback of a complete long response on the Pebble Time 2.
