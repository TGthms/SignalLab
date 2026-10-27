# Changes

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
