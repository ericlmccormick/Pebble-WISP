# WISP — Wrist Intelligence & Speech Portal

**WISP** is a voice-driven AI assistant for Pebble watches. Dictate a question, view the response, and hear it on a speaker-capable Pebble via **Universal TTS**.

This repository is the canonical home for WISP, imported from the verified WISP 2.1.6 branch of [Pebble_Gemini](https://github.com/ericlmccormick/Pebble_Gemini). It retains the same watchapp UUID `426c68c7-bdd7-445a-860a-ea587a188993` for in-place upgrades.

## Plugins

- [AI Conversation](https://github.com/ericlmccormick/Pebble-AI-Conversation) or another installed compatible `send_to_agent` plugin supplies the response. Configure the provider/model and authorization in that plugin.
- [Universal TTS](https://github.com/ericlmccormick/Pebble-Universal-TTS) supplies optional spoken output. Configure any supported speech provider, key, and voice **in Universal TTS**, not in WISP.

WISP now uses Universal TTS v1.2 SDK `universal_tts.speak(displayText)` on the phone and `universal_tts_handle_message()` on the watch. The SDK handles 500-character segmentation, provider selection, WAV verification, IMA ADPCM encoding, Bluetooth transfer, playback and cancellation. **Every non-error text response displayed to the watch is eligible for speech**, including responses categorized as delivery receipts. Diagnostic errors remain text-only. WISP still supports silent/text-only mode and the previous direct Gemini *conversation* option; direct Google TTS and hardcoded TTS voices have been removed.

Pebble Time 2 and Pebble 2 Duo support speech; watch models without a speaker receive text only. Universal TTS is optional; the AI conversation plugin can still return text without it.

## Build and release

GitHub Actions builds basalt, chalk, diorite, flint, emery and gabbro, validates icon assets, and runs JavaScript tests. Successful `main` pushes publish a direct-install `WISP_preview.pbw` in [builds/previews](https://github.com/ericlmccormick/Pebble-WISP/tree/builds/previews).

The original WISP 2.1.6 Bluetooth audio behavior remains available as a historical reference in the earlier repository, but WISP 2.2 uses the shared Universal TTS transport. Device testing is required before public store release.

## Store listing

**Name:** WISP — Wrist Intelligence & Speech Portal

**Description:** Talk to your Pebble and get answers from your preferred AI conversation agent. WISP displays answers and, on speaker-capable watches, speaks the displayed response through the separate Universal TTS plugin. Choose your preferred AI and speech providers in their plugin settings. Includes adjustable volume, font size, day/night/automatic appearance and configurable response style.

Support development: https://ko-fi.com/ericmccormick

## SDK attribution

The vendored `src/pkjs/universal_tts.js`, `src/c/universal_tts.c` and `src/c/universal_tts.h` are copied from the Universal TTS 1.2 SDK, distributed under the MIT license (see `src/c/UNIVERSAL_TTS_LICENSE.txt`). The plugin and WISP are maintained separately.
