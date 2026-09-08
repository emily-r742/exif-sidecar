import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseJpegExif } from '../src/exif.js';
import { asciiEntry, buildJpegWithExif, buildJpegWithoutExif, longEntry, rationalEntry, shortEntry } from './helpers.js';

test('parseJpegExif returns null for bytes that are not a JPEG', () => {
  assert.equal(parseJpegExif(new Uint8Array([0, 1, 2, 3])), null);
});

test('parseJpegExif returns null for a JPEG with no EXIF APP1 segment', () => {
  assert.equal(parseJpegExif(buildJpegWithoutExif()), null);
});

function sampleIfd0(little: boolean) {
  return [
    asciiEntry(0x010f, 'Canon'),
    asciiEntry(0x0110, 'EOS R6'),
    shortEntry(0x0112, 1, little),
    asciiEntry(0x0131, 'Test 1.0'),
    asciiEntry(0x0132, '2026:03:11 14:22:05'),
  ];
}

function sampleExifIfd(little: boolean) {
  return [
    rationalEntry(0x829a, 1, 250, little),
    rationalEntry(0x829d, 14, 5, little),
    shortEntry(0x8827, 400, little),
    rationalEntry(0x920a, 50, 1, little),
    asciiEntry(0x9003, '2026:03:11 14:22:05'),
    asciiEntry(0x9004, '2026:03:11 14:22:06'),
    asciiEntry(0xa434, 'RF 24-70mm F2.8'),
    longEntry(0xa002, 6000, little),
    longEntry(0xa003, 4000, little),
  ];
}

for (const little of [true, false]) {
  test(`parseJpegExif reads IFD0 and EXIF SubIFD tags (${little ? 'little' : 'big'}-endian)`, () => {
    const jpeg = buildJpegWithExif(sampleIfd0(little), sampleExifIfd(little), little);
    const exif = parseJpegExif(jpeg);

    assert.ok(exif);
    assert.equal(exif.make, 'Canon');
    assert.equal(exif.model, 'EOS R6');
    assert.equal(exif.orientation, 1);
    assert.equal(exif.software, 'Test 1.0');
    assert.equal(exif.dateTime, '2026:03:11 14:22:05');
    assert.deepEqual(exif.exposureTime, { numerator: 1, denominator: 250 });
    assert.deepEqual(exif.fNumber, { numerator: 14, denominator: 5 });
    assert.equal(exif.iso, 400);
    assert.deepEqual(exif.focalLength, { numerator: 50, denominator: 1 });
    assert.equal(exif.dateTimeOriginal, '2026:03:11 14:22:05');
    assert.equal(exif.dateTimeDigitized, '2026:03:11 14:22:06');
    assert.equal(exif.lensModel, 'RF 24-70mm F2.8');
    assert.equal(exif.pixelXDimension, 6000);
    assert.equal(exif.pixelYDimension, 4000);
  });
}

test('parseJpegExif ignores an IFD0 with no EXIF SubIFD pointer', () => {
  const jpeg = buildJpegWithExif([asciiEntry(0x010f, 'Nikon')], []);
  const exif = parseJpegExif(jpeg);

  assert.ok(exif);
  assert.equal(exif.make, 'Nikon');
  assert.equal(exif.exposureTime, undefined);
});
