# Signal Lab audio protocol v2

An experimental format for data over audio. It is separate from EAS/SAME and is not encryption.

## Modulation

Continuous-phase binary FSK: 0 = 1,200 Hz, 1 = 2,400 Hz. Profiles use 100, 300, or 600 bit/s. Bytes are transmitted least significant bit first without start, stop, or parity bits. The encoder adds 180 ms silence at each end of each copy and 650 ms between padded copies.

## Frame

All multi-byte integers are unsigned big-endian.

| Bytes | Field |
| --- | --- |
| 32 | Preamble, 0x55 repeated |
| 4 | Sync word, ASCII `SLAB` |
| 1 | Version, 2 |
| 2 | Metadata byte length (2–1,024) |
| 4 | Payload byte length (0–8,192) |
| 1 | Total declared copies (1, 2, or 3) |
| 1 | Zero-based index of this copy (less than total) |
| 8 | Random transfer ID, shared by every copy |
| 4 | Opening-header CRC-32 |
| variable | Metadata, UTF-8 JSON object |
| variable | Original payload bytes |
| 4 | Full-frame CRC-32 |

The opening CRC covers the first 17 body bytes (version through transfer ID). After 21 body bytes, the receiver can validate and report the copy plan before receiving the metadata or payload. The final CRC covers all body bytes, including the opening checksum, metadata, and payload, but excludes preamble, sync, and the final checksum itself.

CRC is IEEE CRC-32: reflected polynomial 0xEDB88320, initial state 0xFFFFFFFF, final XOR 0xFFFFFFFF. Test vector `123456789` = 0xCBF43926.

## Whitening

All bytes after sync, including both checksums, are XOR-whitened using xorshift32. Initialize state to 0x1A2B3C4D at each copy. Before each byte, apply `state ^= state << 13; state ^= state >>> 17; state ^= state << 5;` with unsigned 32-bit semantics, then XOR the byte with the low eight bits of state. Reverse before header parsing and CRC checks. Whitening supplies transitions for clock recovery even with repetitive files.

## Repetition verification

1. Validate the opening CRC and bounds. Record ID, total, and index.
2. Require the full-frame CRC before accepting any copy's payload.
3. Group by transfer ID. Compare expected total and payload length, metadata, and every original payload byte.
4. Count distinct copy indices only. Multiple demodulator phase candidates for one physical copy never become extra copies.
5. Mark verified only when every declared index has a valid, matching copy. One declared copy means one CRC-valid frame; two or three means that many matching frames.
6. Report a content or plan disagreement as a conflict. Do not replace the first valid payload silently.
7. At end of recording or live listening, mark missing copies incomplete. During live reception, estimate the remaining declared transfer window from profile, frame lengths, and copy index; an expired window also marks incomplete. A late valid copy can subsequently complete the same transfer.

Available checksum-valid bytes from an incomplete transfer may be downloaded with the incomplete status still visible. No automatic acknowledgement or retry is implemented.

## Metadata examples

Text: `{"kind":"text","mime":"text/plain"}`; payload is UTF-8.

JSON: `{"kind":"json","mime":"application/json"}`; payload is UTF-8 JSON.

File: `{"kind":"file","name":"example.bin","mime":"application/octet-stream"}`; payload is original bytes. Unknown kinds are treated as file data. The receiver never automatically executes content.

## Timing recovery

The demodulator compares quadrature energies over 80% of a bit, sampling eight timing phases. All candidates search for sync. Locked frames use tone transitions to follow modest differences between device sample clocks. Tests include ±0.1% clock drift on an 8 KiB payload.

## Compatibility

Version 1 bodies begin with the same 7-byte version/length fields followed immediately by metadata and payload, then full-body CRC. They use the same whitening. The decoder accepts v1 but labels it as legacy: no total, copy index, transfer ID, or opening checksum exists in that format.

SAME uses its original preamble, frequencies, data rate, and three-burst repetition. The decoder counts separate burst sample positions, compares parsed headers, and reports incomplete or conflicting sets. SAME has no CRC field, and Signal Lab does not add one.
