import {packet, customPreambleBytes} from './codec.mjs?v=0.2.4';

// Estimate duration without allocating the audio waveform.
export function customDuration(data, meta, profile, total) {
  const length = packet(data, meta, {preambleBytes: customPreambleBytes(profile)}).length;
  return Array.from({length: total}, (_, index) =>
    (length - customPreambleBytes(profile) + customPreambleBytes(profile, index)) * 8 / profile.baud + .36
  ).reduce((sum, seconds) => sum + seconds, 0) + (total - 1) * .65;
}
