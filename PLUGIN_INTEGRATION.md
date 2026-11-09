# WISP plugin integration (2.2)

WISP uses two distinct plugins, each configured by the user:

1. AI Conversation or another installed `send_to_agent({message})` provider returns the text. WISP does not demand specific reply metadata before displaying and speaking text. Errors are distinct from successful text.
2. Universal TTS (`2c5edc42-b096-4f76-b284-1f27907e6502`) synthesizes *the exact displayed text* via its standard SDK. WISP declares `InvokeAction` and `UniversalTtsSpeak`. Universal TTS owns provider, voice and credentials. WISP does not call vendors directly for speech.

Phone: `universalTts.speak(displayText)`, `universalTts.stop()`, `universalTts.handleMessage(dict)`.
Watch: `universal_tts_init()`, `universal_tts_handle_message(iterator)`, `universal_tts_stop()`, `universal_tts_set_volume()`, `universal_tts_deinit()`.

The app delivers `TEXT_RESPONSE_8_16` to the watch first. The send acknowledgment triggers the SDK speech request; the SDK resets the watch audio and streams verified audio. `TEXT_RESPONSE_NO_AUDIO` is used for disabled voice or diagnostic errors. The display is not dependent on audio service success.

The TTS SDK automatically splits long answers into <=480-character segments. No direct TTS API keys, Google voice lists, or app-specific ADPCM/BLE framing remain in WISP. On watches without speakers, speech is skipped. 

The canonical repository is https://github.com/ericlmccormick/Pebble-WISP and the Universal TTS SDK originates at https://github.com/ericlmccormick/Pebble-Universal-TTS.

## Backward compatibility: Google direct speech

WISP 2.2.1 supports three speech choices: `plugin` (Universal TTS), `direct` (legacy Google Cloud TTS using the original app-held API key and voice), and `none`. On upgrade, preserve `TTS_BACKEND`, `TTS_API_KEY`, and `TTS_VOICE`; never silently migrate an existing direct setup to plugin mode or delete an app-level key.

The direct adapter at `src/pkjs/google_tts_legacy.js` uses the original Google REST TTS endpoint and API key, converts the PCM16 WAV response to the verified canonical 8kHz format expected by the shared Universal TTS SDK, and exposes local `tts_prepare`/`tts_chunk`/`tts_release` actions via a compatibility façade. It does **not** invoke or depend on the Universal TTS phone plugin when Direct Google TTS is selected; the SDK's phone-to-watch audio transport is reused. Existing Google voices and invalid-voice fallback are maintained. The app includes `texttospeech.googleapis.com` in its Internet permission.

WISP 2.2.0 deleted direct TTS keys during initialization, so already-deleted values may need manual re-entry; this release does not claim to recover them.
