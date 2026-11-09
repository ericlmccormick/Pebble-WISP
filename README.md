# WISP — Wrist Intelligence & Speech Portal

**WISP** is a voice-driven AI assistant for Pebble watches. Dictate a question, view the response, and hear it on a speaker-capable Pebble via **Universal TTS** or the preserved **Direct Google Cloud TTS (legacy)** option.

This repository is the canonical home for WISP, imported from the verified WISP 2.1.6 branch of [Pebble_Gemini](https://github.com/ericlmccormick/Pebble_Gemini). It retains the same watchapp UUID `426c68c7-bdd7-445a-860a-ea587a188993` for in-place upgrades.

## Plugins

- [AI Conversation](https://github.com/ericlmccormick/Pebble-AI-Conversation) or another installed compatible `send_to_agent` plugin supplies the response. Configure the provider/model and authorization in that plugin.
- [Universal TTS](https://github.com/ericlmccormick/Pebble-Universal-TTS) supplies optional spoken output. Configure any supported speech provider, key, and voice **in Universal TTS**, not in WISP.

WISP now uses Universal TTS v1.2 SDK `universal_tts.speak(displayText)` on the phone and `universal_tts_handle_message()` on the watch. The SDK handles 500-character segmentation, provider selection, WAV verification, IMA ADPCM encoding, Bluetooth transfer, playback and cancellation. **Every non-error text response displayed to the watch is eligible for speech**, including responses categorized as delivery receipts. Diagnostic errors remain text-only. WISP supports silent/text-only mode, the prior direct Gemini *conversation* option, **and** the original Direct Google Cloud TTS option for existing users. The Google API key and voice remain saved in WISP when using legacy direct speech, while the Universal TTS provider and voice are configured in its separate plugin.

Pebble Time 2 and Pebble 2 Duo support speech; watch models without a speaker receive text only. Universal TTS is optional for users choosing Direct Google Cloud TTS or text-only responses; the AI conversation plugin can still return text without either TTS service.

## Build and release

GitHub Actions builds basalt, chalk, diorite, flint, emery and gabbro, validates icon assets, and runs JavaScript tests. Successful `main` pushes publish a direct-install `WISP_preview.pbw` in [builds/previews](https://github.com/ericlmccormick/Pebble-WISP/tree/builds/previews).

The original WISP 2.1.6 Bluetooth audio behavior remains available as a historical reference in the earlier repository. WISP 2.2.3 uses the shared Universal TTS audio transport for both Universal TTS and legacy Direct Google TTS. Device testing is required before public store release.

## Store listing

**Name:** WISP — Wrist Intelligence & Speech Portal

**Description:** Talk to your Pebble and get answers from your preferred AI conversation agent. WISP displays answers and, on speaker-capable watches, speaks the displayed response through the separate Universal TTS plugin. Choose your preferred AI provider in its plugin settings, and select Universal TTS or retain your existing Direct Google TTS setup. Includes adjustable volume, font size, day/night/automatic appearance and configurable response style.

Support development: https://ko-fi.com/ericmccormick

## SDK attribution

The vendored `src/pkjs/universal_tts.js`, `src/c/universal_tts.c` and `src/c/universal_tts.h` are copied from the Universal TTS 1.2 SDK, distributed under the MIT license (see `src/c/UNIVERSAL_TTS_LICENSE.txt`). The plugin and WISP are maintained separately.

## Upgrade compatibility

WISP 2.2.3 preserves the original watchapp UUID, the Direct Gemini API selection, the original Direct Google Cloud TTS option, saved `TTS_BACKEND=direct`, `TTS_API_KEY`, `TTS_VOICE`, and explicit text-only settings. Existing direct users need not install Universal TTS to retain Google voice playback. The direct adapter uses the legacy Google API request and streams audio through the same common native TTS receiver as the plugin. Fresh installs use Universal TTS by default.

**If WISP 2.2.0 already ran on your device:** that build removed `TTS_API_KEY` and `TTS_VOICE` from app local storage and switched direct mode to plugin mode. Deleted credentials cannot reliably be restored; select **Direct Google Cloud TTS (legacy)** in WISP settings and re-enter your key and voice if necessary. WISP 2.2.1 will preserve them thereafter. Do not uninstall/reinstall the app when upgrading, since reinstalling can clear stored settings.

## WISP 2.2.3 audio continuity fix

The watch no longer closes its speaker after 1.5 seconds of silence while a response is still streaming. The shared phone SDK now sends an explicit `AUDIO_STREAM_END` message after the final audio packet; the watch drains and closes normally only then. A 30-second idle watchdog handles disconnected phones and flushes final partial PCM frames. The app reports speaker playback statistics in its phone console for troubleshooting. Both Universal TTS and Direct Google Cloud TTS use this same upgraded transport. Device testing is still required before a public release.

## WISP 2.2.3 watch-level audio delivery reliability

The previous automatic 1.5-second speaker shutdown was not the whole problem: WISP 2.2.2 still used a phone-side estimate of the watch's playback buffer and advanced after the *phone* accepted a Bluetooth packet. WISP 2.2.3 restores per-packet acknowledgement from the **watch**, using the `AUDIO_ACK` / `AUDIO_WAIT` commands and an ordered token/sequence in the already-required `TEXT` AppMessage key. Every audio packet is retransmitted on a lost acknowledgment without playing a duplicate. The receiver rejects stale-session packets and applies real ring-buffer backpressure. The previous explicit `AUDIO_STREAM_END` and inactivity watchdog remain.

The SDK now logs exact bytes acknowledged by the watch and reports packets, waits and duplicate counts in the phone console. A 10-second synthetic speech stream (40,000 bytes ADPCM) is tested end-to-end, including a simulated full buffer, lost ACK and BLE failure. Upgrade both matching C and JS SDK files in any dependent app; the **Universal TTS plugin itself** does not change its TTS provider API. Legacy direct Google TTS and existing user settings are preserved.
