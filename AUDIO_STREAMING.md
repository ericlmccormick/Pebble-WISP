# Shared audio transport

WISP 2.2 delegates synthesis, WAV integrity verification, resampling, IMA-ADPCM encoding and Bluetooth speaker playback to the [Universal TTS SDK](https://github.com/ericlmccormick/Pebble-Universal-TTS). It does not maintain a private packet transport.

WISP sends the displayed text to the shared SDK only after the watch acknowledges its answer. The SDK segments long text into at most 480-character requests, then performs `tts_prepare`, `tts_chunk`, and `tts_release` against the user's selected TTS provider via Universal TTS. Native `universal_tts_handle_message` owns `AUDIO_RESET`, `AUDIO_CHUNK`, `AUDIO_SENTENCE_END` and `AUDIO_STOP`. WISP's volume handlers call `universal_tts_set_volume`.

Speech errors are logged on the phone and reported by WISP as `TTS_FAILURE`. Successful text replies remain readable even if audio fails. For codec and transport implementation, see `src/pkjs/universal_tts.js` and `src/c/universal_tts.c`.

## Direct Google TTS legacy

The `google_tts_legacy.js` compatibility adapter retains the user's saved Google API key and voice, requests LINEAR16 audio directly from Google, and normalizes the returned WAV into the shared SDK's canonical 44-byte 8kHz mono PCM16 format. It exposes a local action façade consumed by the **same** `universal_tts.js` sender. The watch uses the same `universal_tts.c` audio receiver. No second watch-side codec or Bluetooth framing path is introduced.

## Verified watch ACK protocol (2.2.3)

The phone waits for `AUDIO_ACK` with a matching `TEXT=stream-token:sequence` before proceeding to the next 360-byte encoded audio packet. `AUDIO_WAIT` means the watch ring is full, not that the packet has been received. The phone retries with the **same sequence**; the watch discards duplicate retries without decoding them twice. When all sentences and chunks have been acknowledged, the phone sends `AUDIO_STREAM_END` and waits for its acknowledgment. The manifest's existing `COMMAND`, `TEXT` and `CHUNK` keys suffice—no additional keys are needed. The new SDK supports older untagged senders, but old SDK combinations lack these reliability guarantees.

The phone stores `UNIVERSAL_TTS_DIAG_V1_TRANSPORT` (status, acknowledged bytes, packet counts, last failure) and `UNIVERSAL_TTS_DIAG_V1_WATCH` (watch playback statistics, packet waits, duplicate count). WISP phone logs summarize these values; no credentials are included.
