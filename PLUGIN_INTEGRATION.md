# WISP plugin integration (2.2)

WISP uses two distinct plugins, each configured by the user:

1. AI Conversation or another installed `send_to_agent({message})` provider returns the text. WISP does not demand specific reply metadata before displaying and speaking text. Errors are distinct from successful text.
2. Universal TTS (`2c5edc42-b096-4f76-b284-1f27907e6502`) synthesizes *the exact displayed text* via its standard SDK. WISP declares `InvokeAction` and `UniversalTtsSpeak`. Universal TTS owns provider, voice and credentials. WISP does not call vendors directly for speech.

Phone: `universalTts.speak(displayText)`, `universalTts.stop()`, `universalTts.handleMessage(dict)`.
Watch: `universal_tts_init()`, `universal_tts_handle_message(iterator)`, `universal_tts_stop()`, `universal_tts_set_volume()`, `universal_tts_deinit()`.

The app delivers `TEXT_RESPONSE_8_16` to the watch first. The send acknowledgment triggers the SDK speech request; the SDK resets the watch audio and streams verified audio. `TEXT_RESPONSE_NO_AUDIO` is used for disabled voice or diagnostic errors. The display is not dependent on audio service success.

The TTS SDK automatically splits long answers into <=480-character segments. No direct TTS API keys, Google voice lists, or app-specific ADPCM/BLE framing remain in WISP. On watches without speakers, speech is skipped. 

The canonical repository is https://github.com/ericlmccormick/Pebble-WISP and the Universal TTS SDK originates at https://github.com/ericlmccormick/Pebble-Universal-TTS.
