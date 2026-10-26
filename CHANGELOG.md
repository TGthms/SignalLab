# Changes

## 0.2.1

- Corrected an acquisition/clock-tracking floor that discarded quiet, otherwise valid custom-modem audio. Regression tests include microphone-level attenuation, ambient noise, and simulated room echoes for Balanced and Resilient profiles.
- Added an original-level RMS/dBFS meter, tone-energy detection, decoder progress, and an automatically scaled microphone waveform. Ordinary breath, ambient sound, carrier tones, and decoded packets are distinguished.
- Resume audio after microphone routing changes and handle interrupted as well as suspended states. A watchdog reports paused/stalled capture and offers an explicit restart instead of silently remaining LIVE.
- Let the browser choose its native audio-context sample rate and decode at the returned rate.
- Added bounded, local-only diagnostic PCM history with a manual last-30-seconds WAV export.
- Added versioned browser-module URLs so cached pre-fix decoder code cannot be mixed with the updated app.

Physical speaker-to-phone behavior still depends on the microphone path and acoustics. These automated regression tests do not replace testing a specific phone.
