import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExifApp1Segment, embedJpegExif } from '../src/embed.js';
import { parseJpegExif } from '../src/exif.js';
import type { ExifData } from '../src/types.js';
import { asciiEntry, buildJpegWithExif, buildJpegWithoutExif } from './helpers.js';

const sampleExif: ExifData = {
  make: 'Canon',
  model: 'EOS R6',
  orientation: 1,
  software: 'Test 1.0',
  dateTime: '2026:03:11 14:22:05',
  exposureTime: { numerator: 1, denominator: 250 },
  fNumber: { numerator: 14, denominator: 5 },
  iso: 400,
  focalLength: { numerator: 50, denominator: 1 },
  dateTimeOriginal: '2026:03:11 14:22:05',
  dateTimeDigitized: '2026:03:11 14:22:06',
  lensModel: 'RF 24-70mm F2.8',
  pixelXDimension: 6000,
  pixelYDimension: 4000,
  gpsLatitudeRef: 'N',
  gpsLatitude: [
    { numerator: 40, denominator: 1 },
    { numerator: 44, denominator: 1 },
    { numerator: 3010, denominator: 100 },
  ],
  gpsLongitudeRef: 'W',
  gpsLongitude: [
    { numerator: 73, denominator: 1 },
    { numerator: 59, denominator: 1 },
    { numerator: 858, denominator: 100 },
  ],
  gpsAltitudeRef: 0,
  gpsAltitude: { numerator: 15, denominator: 1 },
};

test('embedJpegExif inserts a new APP1 segment that parseJpegExif reads back unchanged', () => {
  const jpeg = buildJpegWithoutExif();
  const withExif = embedJpegExif(jpeg, sampleExif);

  assert.deepEqual(parseJpegExif(withExif), sampleExif);
  // the JFIF APP0 segment and EOI from the original file must survive
  assert.equal(withExif[withExif.length - 2], 0xff);
  assert.equal(withExif[withExif.length - 1], 0xd9);
});

test('embedJpegExif replaces an existing EXIF APP1 segment instead of duplicating it', () => {
  const original = buildJpegWithExif([asciiEntry(0x010f, 'Nikon')]);
  const replaced = embedJpegExif(original, sampleExif);

  assert.deepEqual(parseJpegExif(replaced), sampleExif);

  let app1Count = 0;
  for (let offset = 2; offset + 4 <= replaced.length; ) {
    if (replaced[offset] !== 0xff) break;
    const marker = replaced[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (replaced[offset + 2] << 8) | replaced[offset + 3];
    if (marker === 0xe1) app1Count++;
    offset += 2 + length;
  }
  assert.equal(app1Count, 1);
});

test('embedJpegExif only writes the fields present on the given ExifData', () => {
  const jpeg = buildJpegWithoutExif();
  const withExif = embedJpegExif(jpeg, { make: 'Fujifilm' });

  assert.deepEqual(parseJpegExif(withExif), { make: 'Fujifilm' });
});

test('embedJpegExif throws for bytes that are not a JPEG', () => {
  assert.throws(() => embedJpegExif(new Uint8Array([0, 1, 2, 3]), { make: 'Canon' }), RangeError);
});

test('buildExifApp1Segment starts with the APP1 marker and an Exif header', () => {
  const segment = buildExifApp1Segment({ make: 'Canon' });
  assert.equal(segment[0], 0xff);
  assert.equal(segment[1], 0xe1);
  const header = new TextDecoder().decode(segment.subarray(4, 10));
  assert.equal(header, 'Exif\0\0');
});
