# Changes

## Unreleased

- Confirm before enabling the optional EAS attention signal and identify it in the playback warning.

- Ask for confirmation before EAS tone playback, with a silent-test alternative and contextual safety guidance.

- Publish the privacy notice and clarify that the former draft terms are use and safety guidelines.

- Add draft privacy and terms notices covering GitHub and Cloudflare hosting, local processing and EAS limitations; add a reminder about alarming others beside EAS playback.

- Remove EAS/SAME WAV export; make the silent internal decoder test the primary study action and clarify that announcements are for playback only.

- Stream custom-data playback, WAV encoding and internal decoder tests in chunks; remove the five-minute generation limit. WAV export uses streamed file writing where supported.
- Add FCC EAS-use guidance and direct links to the rule and an enforcement example.

- Simplify the send and receive journeys, keep tuning available in disclosures, and move received content ahead of verification details.
- Preserve drafts and settings when running the demo; label generated demo and loopback results.
- Improve typography, contrast, target sizes, mobile actions, learning-topic state, and context for SAME and Morse.
- Extract duration planning and add browser workflow regressions.

## 0.2.4

- Reset input levels, live guidance and decoder state when the microphone stops. Ignore queued sync events and keep a delayed worker completion from replacing the stopped message with recording-import advice.
- Remove the app volume control; output and browser speech use system media volume.
- Read playback waveforms from an output AnalyserNode, remove the overlaid total-duration cursor and show a separate labelled audio-clock timeline. Mark unknown-duration browser speech honestly.
- Add International Morse encoding at 5–35 WPM with a 700 Hz tone, canonical text/dots-dashes preview, WAV export and streaming microphone/file decoding at a matching receive speed. Keep Morse results separate from checksum verification.
- Add supported letters, digits, É and punctuation tables with tap-to-hear examples; explain timing, WPM, receive settings and limits; link official ITU and ARRL learning/practice resources.
- Verify mixed custom/Morse/SAME messages in one session, all Morse table characters and speeds at two sample rates, live-output graph wiring and the stopped-monitor regression.

## 0.2.3

- Give microphone capture a dedicated AudioContext, and fully stop tracks, disconnect capture nodes and close the context on Stop and initialization failure. Wait for teardown before reuse and restore the audio-session category after release.
- Keep live capture running across messages and app pages. Request a screen wake lock while listening, reacquire it on foreground return and release it on Stop. Retry temporary context interruption without requiring another Start click; report unavailable input honestly.
- Keep imports/demos from silently replacing an active live decoder.
- Log independently identified messages including header-only failures; clear stale payloads on a new header, and prevent older-transfer timeout updates from taking over the latest result.
- Split successive SAME messages into independent three-header groups even when end bursts are absent.
- Keep a roughly 1.8-second training lead on the first custom copy, while shortening later-copy leads to 0.32–0.64 seconds. Shorten the Resilient first lead from 2.56 to 1.84 seconds. Preserve conservative timeout compatibility with older long-lead senders.
- Add mixed-protocol multi-message, active-result isolation, owned-context cleanup, wake-lock denial and pending-request cancellation tests.

Physical iPhone routing and background capture remain subject to Safari/iOS behavior; automated tests cannot certify device behavior.

## 0.2.2

- Balance custom tone energies to compensate for unequal speaker/microphone frequency response; regression tests include filtered audio and echo trains.
- Smooth custom frequency transitions over the first 10% of each bit; SAME modulation is unchanged.
- Give each custom copy at least 1.8 seconds of alternating training tones; single-copy tests retain decoding after 1.1 seconds of missing startup audio. Live deadlines account for the longer preamble.
- Add persistent Lower / Normal / Higher decoder sensitivity, controlling acquisition floor and guarded sync-bit tolerance. Opening-header and full-frame CRC checks remain mandatory.
- Declare playback / play-and-record audio intent on supporting browsers and release it after use; this addresses iPhone ambient-audio behavior under Ring/Silent.
- Wait for flowing microphone samples before showing Microphone ready.
- Label each copy Verified, Not detected, Header only, or CRC failed so incomplete transfers explain which indices are missing.


## 0.2.1

- Corrected an acquisition/clock-tracking floor that discarded quiet, otherwise valid custom-modem audio. Regression tests include microphone-level attenuation, ambient noise, and simulated room echoes for Balanced and Resilient profiles.
- Added an original-level RMS/dBFS meter, tone-energy detection, decoder progress, and an automatically scaled microphone waveform. Ordinary breath, ambient sound, carrier tones, and decoded packets are distinguished.
- Resume audio after microphone routing changes and handle interrupted as well as suspended states. A watchdog reports paused/stalled capture and offers an explicit restart instead of silently remaining LIVE.
- Let the browser choose its native audio-context sample rate and decode at the returned rate.
- Added bounded, local-only diagnostic PCM history with a manual last-30-seconds WAV export.
- Added versioned browser-module URLs so cached pre-fix decoder code cannot be mixed with the updated app.

Physical speaker-to-phone behavior still depends on the microphone path and acoustics. These automated regression tests do not replace testing a specific phone.
