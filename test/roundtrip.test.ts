import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJpegExif } from '../src/exif.js';
import { exifToSidecar, sidecarToExif } from '../src/sidecar.js';
import { asciiEntry, buildJpegWithExif, byteEntry, longEntry, rationalArrayEntry, rationalEntry, shortEntry } from './helpers.js';

// End-to-end: bytes -> ExifData -> SidecarRecord -> ExifData, checking
// that nothing a sidecar can represent is lost along the way.
test('a JPEG parsed to a sidecar and back preserves every representable field', () => {
  const ifd0 = [
    asciiEntry(0x010f, 'Canon'),
    asciiEntry(0x0110, 'EOS R6'),
    shortEntry(0x0112, 1, true),
    asciiEntry(0x0131, 'Test 1.0'),
    asciiEntry(0x0132, '2026:03:11 14:22:05'),
  ];
  const exifIfd = [
    rationalEntry(0x829a, 1, 250, true),
    rationalEntry(0x829d, 14, 5, true),
    shortEntry(0x8827, 400, true),
    rationalEntry(0x920a, 50, 1, true),
    asciiEntry(0x9003, '2026:03:11 14:22:05'),
    asciiEntry(0x9004, '2026:03:11 14:22:06'),
    asciiEntry(0xa434, 'RF 24-70mm F2.8'),
    longEntry(0xa002, 6000, true),
    longEntry(0xa003, 4000, true),
  ];

  const parsed = parseJpegExif(buildJpegWithExif(ifd0, exifIfd, true));
  assert.ok(parsed);

  const sidecar = exifToSidecar(parsed);
  assert.deepEqual(sidecar, {
    camera: { make: 'Canon', model: 'EOS R6', lens: 'RF 24-70mm F2.8' },
    capture: {
      dateTaken: '2026-03-11T14:22:05',
      dateDigitized: '2026-03-11T14:22:06',
      exposureTimeSeconds: 0.004,
      fNumber: 2.8,
      iso: 400,
      focalLengthMm: 50,
    },
    image: { width: 6000, height: 4000, orientation: 1 },
    software: 'Test 1.0',
    fileDateTime: '2026-03-11T14:22:05',
  });

  const backToExif = sidecarToExif(sidecar);
  assert.deepEqual(backToExif, parsed);
});

test('a JPEG with whole-degree GPS coordinates round-trips through a sidecar exactly', () => {
  const gpsIfd = [
    asciiEntry(0x0001, 'N'),
    rationalArrayEntry(
      0x0002,
      [
        [37, 1],
        [0, 1],
        [0, 1],
      ],
      true,
    ),
    asciiEntry(0x0003, 'W'),
    rationalArrayEntry(
      0x0004,
      [
        [122, 1],
        [0, 1],
        [0, 1],
      ],
      true,
    ),
    byteEntry(0x0005, 0),
    rationalEntry(0x0006, 10, 1, true),
  ];

  const parsed = parseJpegExif(buildJpegWithExif([], [], true, gpsIfd));
  assert.ok(parsed);

  const sidecar = exifToSidecar(parsed);
  assert.deepEqual(sidecar.location, { latitude: 37, longitude: -122, altitudeMeters: 10 });

  const backToExif = sidecarToExif(sidecar);
  assert.deepEqual(backToExif, parsed);
});
