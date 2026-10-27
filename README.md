# Signal Lab

A compact browser app for sending data through sound and learning how audio modems work. Includes EAS / SAME studies and International Morse code.

**Live app:** https://tgthms.github.io/SignalLab/

**Repository:** https://github.com/TGthms/SignalLab

## Use it

Choose **Encoder** to compose text, emoji, JSON, or a small file and turn it into audio. Choose **Decoder** on another device, start the microphone, then transmit. Both devices can use the same live app. No pairing or account is required. Start with a short message in a quiet room.

For a one-device experiment, use **Run a demo** or the encoder's **Test in decoder** button (↻). These feed the actual generated audio waveform into the receiver, without microphone permission.

- **Light, dark, and system themes** with a saved preference.
- **Three modem profiles:** Resilient (100 bit/s), Balanced (300 bit/s), Fast (600 bit/s).
- **Declared repetition:** 1×, 2×, or 3×. The checksummed opening header declares a transfer ID, total copies, and copy index before the payload arrives. Each full copy must pass CRC-32. The receiver compares metadata and original payload bytes, counting only distinct indices. Missing copies remain incomplete; differing copies produce a conflict.
- **WAV export and recording import**, plus original-byte payload downloads. Files are limited to 8 KiB; custom-data transmissions to five minutes; recordings to five minutes / 50 MB.
- **Morse:** text at 5–35 WPM and a 700 Hz keyed tone, dots/dashes preview, WAV export and streaming microphone/file decoding at a matching receive speed. Learn includes complete supported-character tables with tap-to-hear examples, timing explanations and ITU/ARRL resources. Morse has no checksum or copy plan; results are labelled decoded, never CRC-verified.
- **SAME studies:** actual SAME modulation, editable header fields, three repeated headers/end bursts, optional attention signal, attached announcement audio, and browser speech during live playback.
- **Local educational lookup:** a bundled NOAA SAME directory names geographic areas and explains PSSCCC, FIPS state/county identifiers, and locally defined county partitions.
- **Learn:** interactive bit tones, a UTF-8 byte inspector, annotated SAME headers, verification explanations, and reception tips.
- **Input diagnostics:** real dBFS level, tone-energy detection, auto-scaled waveform, paused-capture recovery, and a local WAV export of the last 30 seconds. The capture history is bounded and is never uploaded.
- **Receive log:** in-memory results from the current tab.

## Run locally

Python 3 is required:

```sh
python3 serve.py
```

The browser opens at http://127.0.0.1:5194/. On macOS, you can also double-click **Start Signal Lab.command**. Keep the terminal running while using the local app. Press Control-C to stop it. If the port is busy, run `python3 serve.py --port 5195`.

Opening `dist/index.html` directly from disk is unsupported: ES modules and workers need an HTTP origin. Microphone access requires HTTPS or localhost and browser permission.

## Microphone capture

The decoder accepts quiet microphone-level tones; acquisition is not gated at generated-WAV amplitude. The scope automatically scales quiet input for visibility, while the level meter reports the original RMS amplitude.

AudioWorklet capture is loaded from bundled code through a Blob URL, avoiding a separate worklet-script download. If the host blocks AudioWorklet, the app uses a ScriptProcessor compatibility path when available. Diagnostics show the secure-origin status, microphone API, capture engine, sample rate, and selected input. Microphone input is not monitored through speakers.

Embedded browsers can impose additional permission or audio restrictions. Open the live HTTPS app in a current Safari, Chrome, Firefox, or Edge browser if necessary. Hardware, noise, speaker distortion, and room echoes still affect physical reception; automated waveform tests cannot certify every device or room.

## Development and checks

No build step or npm dependencies are needed. `npm start` launches the local Python server; `npm test` runs all checks below. Node.js 24 is used in CI:

```sh
node tests/codec.test.mjs
node tests/transfers.test.mjs
node tests/locations.test.mjs
node tests/capture.test.mjs
node tests/acoustic.test.mjs
```

Tests cover noisy unaligned transfers at 44.1/48 kHz; UTF-8 and binary round trips; checksum failure; 8 KiB transfers at ±0.1% clock drift; header-first repeat plans; independent copy counts; missing, corrupt, and conflicting copies; live timeout; SAME physical-burst counting; geographic lookup; actual worklet processor batching; capture fallback; and cleanup.

GitHub Actions also runs browser workflow checks with Playwright, including mobile layout, demo preservation, accessibility state, and allocation guidance. GitHub Actions runs these checks before deploying `dist/` to GitHub Pages. Pushes to `main` publish the HTTPS app. No secrets or server services are required.

## Limits

Custom data uses Signal Lab protocol v2; v1 packets can still be decoded, with a legacy indicator because they do not declare a repetition plan. There is no encryption, sender authentication, forward error correction, automatic acknowledgement, or retransmission. CRC-32 checks accidental corruption; it is not an authenticity check.

SAME is a study implementation, not certified emergency alert equipment. It compares distinct complete parsed headers and counts repeated end markers. It does not reconstruct partially corrupt SAME headers by bitwise majority or transcribe speech. SAME's fixed three-burst format is preserved; custom repetition fields are never inserted into SAME audio.

Browser speech is live playback only. Attach recorded audio (up to 90 seconds) to include an announcement in WAV exports. Custom-data transmissions are capped at five minutes to bound browser memory use. Some 8 KiB messages therefore require a faster profile or fewer copies. Large payloads take minutes. Imported recordings and microphone audio stay on the device. Received data is displayed as text or offered for download; it is not automatically executed. Receptions are cleared on reload.

The NOAA location directory is a dated snapshot and includes legacy entries. Names are presented as NOAA lists them, with state names expanded; current coverage and partition definitions should be checked against NOAA's live tables. A six-digit format alone does not establish that a code is currently assigned.

## Layout

- `dist/app.mjs`: application state, playback, reception UI, themes, and education.
- `dist/signal-plan.mjs`: transfer duration estimation and the allocation guard.
- `dist/demo.mjs`: independent example waveform generation.
- `dist/style.css`, `dist/design.css`: component styles and the visual design layer.
- `dist/codec.mjs`: modulation, streaming demodulation, CRC, and framing.
- `dist/transfers.mjs`: custom repetition verification and SAME burst grouping.
- `dist/receive-worker.mjs`: decoding outside the main thread.
- `dist/capture.mjs`: bundled worklet and compatibility capture.
- `dist/locations.mjs`, `dist/data/`: local NOAA place lookup.
- `tests/`: signal, transfer, geographic, and capture tests.
- `.github/workflows/pages.yml`: check and deployment workflow.
- `PROTOCOL.md`: custom wire format.

## References

- [NOAA: SAME location-code directory](https://www.weather.gov/source/nwr/SameCode.txt)
- [NOAA: using SAME codes](https://www.weather.gov/nwr/usingsame)
- [NOAA: county partitions](https://www.weather.gov/dsb/nwr_sameenz)
- [NOAA NWSI 10-1712 (archived, 2005)](https://www.weather.gov/media/directives/010_pdfs_archived/pd01017012a.pdf)
- [MDN: microphone capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

The preserved `.openai/hosting.json` records an earlier, unavailable Sites registration. Active hosting is GitHub Pages; that Sites identity is not used by the deployment workflow.

## Receiver tuning (v0.2.4)

Wait for **Microphone ready** before transmitting. Normal sensitivity balances the two custom tone levels automatically; Higher lowers the acquisition floor and permits two damaged sync bits after a recognizable preamble. All payloads still require the full checksum. Copy slots distinguish a missed header, header-only reception, a checksum failure, and a verified copy. The first custom copy provides about 1.8 seconds of training tones; later copies use 0.32–0.64 seconds. The initial lead remains useful for settling a phone input path.

On browsers with the Audio Session API, playback declares `playback` intent and microphone capture declares `play-and-record`. This is intended to give iPhone playback media-volume behavior under Ring/Silent; older/embedded browsers may still control routing differently. The page returns the session to `auto` after use. Microphone capture has its own context, which Stop fully closes after stopping tracks and disconnecting the graph; it is not reused as an idle playback context. Before any media is playing, iOS may normally show ringtone volume. Use the side buttons during playback, or Control Center to set media volume beforehand. See [WebKit’s explanation](https://bugs.webkit.org/show_bug.cgi?id=252746) and the [Audio Session specification](https://w3c.github.io/audio-session/).

Automated checks cover channel coloration, echoes, startup truncation, sensitivity and copy diagnostics. Specific speaker/phone combinations and silent-switch behavior require physical testing.

The microphone stays enabled between results and across in-app pages. Custom transfers have independent IDs and log entries, including header-only failures; late status changes cannot replace a newer message on screen. Multiple SAME messages are counted in independent three-header sets. Imports and demos require stopping the live microphone first, so they never silently replace its decoder. A screen wake lock is requested while listening and released on Stop. Context interruptions are retried while visible; hardware disconnection or revoked permission still requires attention, and iOS may suspend capture in the background or after a manual screen lock.

## Waveform and playback display

The idle view is a 25 ms sample of the generated signal. During playback an AnalyserNode reads actual output samples; a separate labelled timeline shows elapsed/total buffer time from the audio clock. Browser speech has an elapsed timer and an explicit unavailable-waveform label because it does not pass through that audio graph. Mic input takes priority in the waveform when listening and transmitting simultaneously. Playback level is controlled with system media volume; there is no app volume slider. Stop clears the input meter and live guidance while keeping saved reception results.

## Morse learning

Choose Encoder → Morse, set a speed and transmit supported uppercase text. On the receiving device, match **Morse receive speed** (15 WPM by default). Tone detection targets 700 Hz; this is not a general arbitrary-pitch or automatic-speed CW reader. A long quiet gap ends a Morse message and the live session stays open. The supported alphabet, digits, É and punctuation appear in Learn → Morse code; tap any entry to hear it at 15 WPM.

References: [ITU-R M.1677-1](https://www.itu.int/rec/R-REC-M.1677-1-200910-I/en), [ARRL learning Morse](https://www.arrl.org/learning-morse-code/), [W1AW practice audio and text](https://www.arrl.org/code-practice-files).
