# WISP plugin integration — restored verified audio transport (2.2.4)

WISP uses the installed-agent list to populate the conversation agent selector and `send_to_agent` actions. The [AI Conversation plugin](https://github.com/ericlmccormick/Pebble-AI-Conversation) retains its original UUID, so its repository rename does not change the wire-level action contract.

For speech, [Universal TTS](https://github.com/ericlmccormick/Pebble-Universal-TTS) retains the Google Cloud TTS plugin UUID `2c5edc42-b096-4f76-b284-1f27907e6502` and exposes the existing `tts_prepare`, `tts_chunk`, `tts_release` streaming interface. WISP 2.2.4 calls those actions through the restored `src/pkjs/google_tts_stream.js` adapter, which validates WAV chunks/checksums and uses WISP's original phone-to-watch audio protocol. The "Google" name in the adapter filename describes its historical origin, not a Google-only speech provider; actual provider, voice and credentials are owned by Universal TTS.

`src/pkjs/index.js` also supports `TTS_BACKEND=direct` and the original Google Cloud TTS API key/voice settings. Direct Google TTS and Universal TTS converge only after PCM verification/ADPCM encoding. On the watch, `src/c/main.c` contains the original tested playback system. No separate Universal TTS SDK audio receiver is compiled.

This is a deliberate transport rollback to the known-good WISP 2.1.6 source, retaining the visual WISP app and current plugin repository names. To preserve existing setups, do not migrate `TTS_BACKEND`, erase local credentials or change the watchapp UUID. Tests from the known-good branch protect sentence buffering, watch acknowledgements and the settings UI.
