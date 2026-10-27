import assert from 'node:assert/strict';
import {PROFILES, packet, modulate, joinAudio, customPreambleBytes} from '../dist/codec.mjs';
import {customDuration} from '../dist/signal-plan.mjs';
const data = new TextEncoder().encode('A short test');
const meta = {kind: 'text', mime: 'text/plain'};
for (const profile of [PROFILES.balanced, PROFILES.resilient, PROFILES.fast]) {
  for (const total of [1, 2, 3]) {
    const parts = Array.from({length: total}, (_, index) => modulate(packet(data, meta, {total, index, preambleBytes: customPreambleBytes(profile, index)}), profile, 12000));
    const actual = joinAudio(parts, 12000, .65).length / 12000;
    assert(Math.abs(actual - customDuration(data, meta, profile, total)) < .01, 'Estimate must match generated audio');
  }
}
assert(customDuration(new Uint8Array(8192), {kind:'file'}, PROFILES.resilient, 3) > 300);
console.log('PASS audio-duration estimates, including transfers longer than five minutes');
