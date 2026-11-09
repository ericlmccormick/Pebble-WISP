# WISP — Wrist Intelligence & Speech Portal

> **WISP 2.0.0 — release candidate.** Version 2.0.0 is the first public WISP-branded version requested for store submission. It retains the stable audio and functionality tested internally as WISP 2.2.5; only the release version and artwork changed.

WISP is a Pebble voice-assistant app that supports installed AI conversation agents, direct Gemini API (legacy), Universal TTS plugin speech, and direct Google Cloud TTS (legacy). It runs on Pebble Time 2 and other supported microphone-equipped Pebble platforms; spoken playback requires a speaker-capable watch.

## Audio implementation history (retained in 2.0.0)

The original 2.1.6 watch-tested audio stack was restored from [Pebble_Gemini feature/gemini-plugin-integration](https://github.com/ericlmccormick/Pebble_Gemini/tree/feature/gemini-plugin-integration) at commit `24b1d522f355a9e9104fe6fd3e1cb6452235be96`. WISP 2.2.0–2.2.3 had replaced its audio transport with a different SDK; those releases produced repeated on-device audio cutoffs after 2–3 seconds. Rather than continue modifying that replacement, 2.2.4 restores the proven implementation unchanged in the important audio paths.

The restored code has:
- Watch-origin `AUDIO_ACK` / `AUDIO_WAIT` with `STREAM_ID`, `SEQ` and `BUFFER_FREE` instead of trusting the phone Bluetooth send callback.
- Adaptive sentence prebuffering and backpressure; short PCM frames and continuous speaker power between sentences.
- The original IMA-ADPCM encoder and watch decoder, with retry and stream-end handling.
- The original Google Cloud TTS direct option and plugin session adapter, both feeding the same watch playback route.
- Displayed-text-to-speech parity, including assistant responses categorized as delivery receipts.

**What is retained from WISP:** the existing WISP watchapp UUID `426c68c7-bdd7-445a-860a-ea587a188993`, WISP name, agent selection, existing audio paths, settings page, volume, fonts, and automatic appearance. WISP's generic logo and menu artwork were refreshed for the 2.0 release.

## Audio reliability (from internal 2.2.5)

Comparison with the watch-tested Gemini with Voice branch confirmed that WISP 2.2.4 had **already restored the exact old watch audio C code and Google plugin streaming adapter**. The original sender was still limited to 360-byte Bluetooth packets with a phone/watch ACK for every packet, while the separately working Home Assistant audio path uses 700-byte packets and audio-rate pacing. As the renamed Universal TTS plugin delivers WAV chunks via separate phone plugin actions, a slower transfer can expose this bottleneck; the original watch could start after only 2,400 bytes of ADPCM and refill 40 ms of PCM every 35 ms.

WISP 2.0.0 retains the internal 2.2.5 fixes and the original `AUDIO_ACK`/`AUDIO_WAIT`/`STREAM_ID`/`SEQ` protocol and legacy Direct Google TTS path, but:
- Uses 700-byte ACKed ADPCM packets, halving round-trip overhead versus 360 bytes.
- Refills the speaker every **40 ms** for a 40-ms PCM frame (8,000 samples/s).
- Raises the minimum initial playback reserve to 5,600 ADPCM bytes and retains adaptive slow-link startup (up to 14,000 bytes).
- Logs watch backpressure, recovering retries and packet exhaustion for troubleshooting; retries transient ACK loss more generously.
- Caps each Universal TTS `tts_prepare` text segment at 450 characters, within the plugin's 500-character limit, including single long unpunctuated sentences.
- Keeps legacy Direct Gemini and Direct Google Cloud TTS usable when the phone does not provide the optional plugin action API.

The regression suite exercises **the actual WISP phone sender** with a synthesized 10-second WAV (40,000 ADPCM bytes), out-of-order Universal TTS chunk requests, simulated `AUDIO_WAIT`, an ACK loss and duplicate suppression, not the unused Universal SDK transport. This passes simulated audio transfer but real Pebble speaker playback must still be tested before a public store release.

## WISP release icons (2.0.0)

Source artwork, committed in the repository:
- `branding/WISP_icon_144.png` — supplied 144×144 transparent icon for store artwork
- `branding/WISP_icon_80.png` — supplied 80×80 transparent icon for smaller store listings
- `branding/WISP_icon_25.png` — supplied 25×25 grayscale/transparent Pebble menu icon

`tools/generate_wisp_icons.py` preserves the 144/80 artwork in `branding/WISP_color_144.png` and `branding/WISP_color_80.png`, copies the 25px file byte-for-byte into `resources/images/WISP_menu_25.png`, and creates Pebble-compatible 48px color/monochrome resources. `tools/generate_agent_icons.py` uses the same logo for the generic unknown-provider startup screen. The Pebble manifest declares the 25px file as the actual `menuIcon`. Build outputs place the 144, 80, and 25 variants alongside the PBW in the direct-download branch.

**Versioning note:** `2.0.0` is intentionally lower than the internal preview `2.2.5`; for devices already running 2.2.5, the launcher/store may not regard this as an automatic upgrade. The UUID remains unchanged for app identity and settings compatibility.

## Plugins

- [AI Conversation](https://github.com/ericlmccormick/Pebble-AI-Conversation): select an installed agent and configure its model/credentials in the plugin. The legacy direct Gemini API option remains.
- [Universal TTS](https://github.com/ericlmccormick/Pebble-Universal-TTS): choose the plugin speech backend. The plugin UUID `2c5edc42-b096-4f76-b284-1f27907e6502` is preserved from Google Cloud TTS, and its `tts_prepare`, `tts_chunk`, `tts_release` actions still work with WISP's original audio adapter. Settings for Universal TTS provider, voice and credentials live in the plugin.
- **Direct Google Cloud TTS (legacy):** WISP retains this choice and its locally stored `TTS_API_KEY` and `TTS_VOICE` for existing users.
- **Text only:** no audio requested.

New installs use the plugin speech option by default. Existing `TTS_BACKEND` settings and legacy direct credentials are preserved. Upgrades should be installed over the existing app, not via uninstall/reinstall. If version 2.2.0 previously erased a local Google TTS key, it may have to be reentered.

## Build and verification

GitHub Actions runs the restored 2.1.6 protocol, an actual WISP 10-second streaming and ACK-loss stress test, plugin streaming and UI regression tests and compiles basalt, chalk, diorite, flint, emery and gabbro. After a successful build, a direct-install `WISP_preview.pbw` is published on the [preview branch](https://github.com/ericlmccormick/Pebble-WISP/tree/builds/previews). Successful compilation does not itself prove real-device playback; confirm with a long spoken answer before publishing to the Pebble store.

## Support

Development support: https://ko-fi.com/ericmccormick
