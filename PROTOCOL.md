# Signal Lab audio protocol v2

An experimental format for data over audio. It is separate from EAS/SAME and is not encryption.

## Modulation

Continuous-phase binary FSK (custom tone transitions are cosine-smoothed over the first 10% of each bit): 0 = 1,200 Hz, 1 = 2,400 Hz. Profiles use 100, 300, or 600 bit/s. Bytes are transmitted least significant bit first without start, stop, or parity bits. The encoder adds 180 ms silence at each end of each copy and 650 ms between padded copies.

### Experimental phase modulation

Custom data can also use differential binary PSK (DBPSK) or differential QPSK (DQPSK), with the same packet format and bit rates. Both use a selectable 1,800 Hz or experimental 20,500 Hz carrier, with a short amplitude taper at each symbol boundary. DBPSK encodes bit 0 as no phase change and 1 as a half-turn. DQPSK maps the two transmitted bits (least significant bit first) as follows: 00 → 0°, 10 → 90°, 11 → 180°, 01 → 270°. Here the pairs are written in transmitted order; adjacent phase choices differ in one bit. The first symbol has no prior reference and is discarded during acquisition, so the preamble provides that reference.

DQPSK sends two bits per symbol: at the same bit rate its symbol rate is half that of DBPSK and BFSK. The phase receiver compares successive symbols and tracks timing using symbol energy. It still requires CRC validation. The sender and receiver must select the same modulation and phase carrier; the high-frequency carrier requires a sample rate of at least 44,100 Hz and may be filtered by hardware or audio routing. An acquisition estimate compensates constant carrier offset at 20.5 kHz; neither carrier has a guarantee of inaudibility. The sender and receiver should remain still; an older version can receive BFSK only. These modes are experimental, and no real-world reliability is guaranteed.

## Frame

All multi-byte integers are unsigned big-endian.

| Bytes | Field |
| --- | --- |
| 8–256 | Preamble, 0x55 repeated (long first copy, shorter subsequent copies) |
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
7. At end of recording or live listening, mark missing copies incomplete. During live reception, estimate the remaining declared transfer window from profile, frame lengths, and copy index; an expired window also marks incomplete. The deadline conservatively allows the older long-preamble repeats, and only changes that transfer’s state; it does not stop live capture. A late valid copy can subsequently complete the same transfer.

Available checksum-valid bytes from an incomplete transfer may be downloaded with the incomplete status still visible. No automatic acknowledgement or retry is implemented.

## Metadata examples

Text: `{"kind":"text","mime":"text/plain"}`; payload is UTF-8.

JSON: `{"kind":"json","mime":"application/json"}`; payload is UTF-8 JSON.

File: `{"kind":"file","name":"example.bin","mime":"application/octet-stream"}`; payload is original bytes. Unknown kinds are treated as file data. The receiver never automatically executes content.

## Timing recovery

The BFSK demodulator compares quadrature energies over 80% of a bit, sampling eight timing phases. All candidates search for sync. Custom tone energies are balanced using leaky peak estimates learned from the alternating preamble. The app sends max(8, ceil(baud × 1.8 / 8)) preamble bytes on copy 0 and max(8, ceil(baud × 0.32 / 8)) on subsequent copies; older 32-byte preambles remain decodable. Lower sensitivity requires exact sync and a tone-power floor of 1e-7; Normal uses 1e-9 and tolerates one sync-bit error; Higher uses 1e-11 and tolerates two. Tolerant sync requires a preceding 32-bit alternating pattern with at most six errors. No damaged payload or header is accepted without its existing CRC checks. Sensitivity changes take effect without restarting an active frame.

Locked frames use tone transitions to follow modest differences between device sample clocks. Tests include ±0.1% clock drift on an 8 KiB payload.

## Compatibility

Version 1 bodies begin with the same 7-byte version/length fields followed immediately by metadata and payload, then full-body CRC. They use the same whitening. The decoder accepts v1 but labels it as legacy: no total, copy index, transfer ID, or opening checksum exists in that format.

SAME uses its original preamble, frequencies, data rate, and three-burst repetition. The decoder counts separate burst sample positions, compares parsed headers, and reports incomplete or conflicting sets. SAME has no CRC field, and Signal Lab does not add one.
