import {PROFILES, customPreambleBytes, packet, modulate, joinAudio} from './codec.mjs?v=0.2.4';

// A self-contained example so a demonstration never mutates the user's draft.
export function makeDemo(id, sr = 48000) {
  const profile = PROFILES.balanced;
  const data = new TextEncoder().encode('Signal received. Three copies, same message. 🌊');
  const meta = {kind: 'text', mime: 'text/plain'};
  const total = 3;
  const parts = Array.from({length: total}, (_, index) =>
    modulate(packet(data, meta, {total, index, id, preambleBytes: customPreambleBytes(profile, index)}), profile, sr)
  );
  return {samples: joinAudio(parts, sr, .65), sr};
}
