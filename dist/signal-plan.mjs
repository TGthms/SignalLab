import {packet, customPreambleBytes} from './codec.mjs?v=0.2.4';

// Keep generated buffers bounded on phones. This estimate matches modulate's
// symbol and padding lengths; it is computed before allocating audio samples.
export const MAX_SIGNAL_SECONDS = 300;
export function customDuration(data, meta, profile, total) {
  const length = packet(data, meta, {preambleBytes: customPreambleBytes(profile)}).length;
  return Array.from({length: total}, (_, index) =>
    (length - customPreambleBytes(profile) + customPreambleBytes(profile, index)) * 8 / profile.baud + .36
  ).reduce((sum, seconds) => sum + seconds, 0) + (total - 1) * .65;
}
export function validateSignalDuration(seconds) {
  if (seconds > MAX_SIGNAL_SECONDS) throw new Error('This transfer exceeds the 5-minute audio limit. Use fewer copies, a faster profile, or a smaller message.');
}
