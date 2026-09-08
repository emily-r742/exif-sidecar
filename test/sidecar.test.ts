import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exifDateToIso,
  exifToSidecar,
  isoDateToExif,
  numberToRational,
  rationalToNumber,
  sidecarToExif,
} from '../src/sidecar.js';
import type { ExifData } from '../src/types.js';

test('exifDateToIso converts a well-formed EXIF timestamp', () => {
  assert.equal(exifDateToIso('2026:03:11 14:22:05'), '2026-03-11T14:22:05');
});

test('exifDateToIso returns undefined for malformed input', () => {
  assert.equal(exifDateToIso('not a date'), undefined);
  assert.equal(exifDateToIso('2026-03-11 14:22:05'), undefined);
});

test('isoDateToExif converts a well-formed ISO timestamp', () => {
  assert.equal(isoDateToExif('2026-03-11T14:22:05'), '2026:03:11 14:22:05');
});

test('isoDateToExif accepts trailing precision or offset and drops it', () => {
  assert.equal(isoDateToExif('2026-03-11T14:22:05.123Z'), '2026:03:11 14:22:05');
});

test('isoDateToExif returns undefined for malformed input', () => {
  assert.equal(isoDateToExif('not a date'), undefined);
});

test('numberToRational and rationalToNumber round-trip exactly for common camera values', () => {
  for (const value of [0.004, 2.8, 50, 1 / 8000]) {
    const rational = numberToRational(value);
    assert.ok(Math.abs(rationalToNumber(rational) - value) < 1e-9);
  }
});

test('numberToRational keeps integers as denominator 1', () => {
  assert.deepEqual(numberToRational(50), { numerator: 50, denominator: 1 });
});

test('rationalToNumber treats a zero denominator as zero instead of dividing', () => {
  assert.equal(rationalToNumber({ numerator: 5, denominator: 0 }), 0);
});

test('exifToSidecar returns an empty record for empty EXIF data', () => {
  assert.deepEqual(exifToSidecar({}), {});
});

test('exifToSidecar groups fields under camera, capture, and image', () => {
  const exif: ExifData = {
    make: 'Canon',
    model: 'EOS R6',
    lensModel: 'RF 24-70mm F2.8',
    dateTimeOriginal: '2026:03:11 14:22:05',
    dateTimeDigitized: '2026:03:11 14:22:06',
    exposureTime: { numerator: 1, denominator: 250 },
    fNumber: { numerator: 14, denominator: 5 },
    iso: 400,
    focalLength: { numerator: 50, denominator: 1 },
    pixelXDimension: 6000,
    pixelYDimension: 4000,
    orientation: 1,
    software: 'Test 1.0',
    dateTime: '2026:03:11 14:22:05',
  };

  assert.deepEqual(exifToSidecar(exif), {
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
});

test('exifToSidecar and sidecarToExif round-trip an EXIF record', () => {
  const original: ExifData = {
    make: 'Canon',
    model: 'EOS R6',
    lensModel: 'RF 24-70mm F2.8',
    dateTimeOriginal: '2026:03:11 14:22:05',
    exposureTime: { numerator: 1, denominator: 250 },
    fNumber: { numerator: 14, denominator: 5 },
    iso: 400,
    focalLength: { numerator: 50, denominator: 1 },
    pixelXDimension: 6000,
    pixelYDimension: 4000,
    orientation: 1,
  };

  const roundTripped = sidecarToExif(exifToSidecar(original));

  assert.equal(roundTripped.make, original.make);
  assert.equal(roundTripped.model, original.model);
  assert.equal(roundTripped.lensModel, original.lensModel);
  assert.equal(roundTripped.dateTimeOriginal, original.dateTimeOriginal);
  assert.equal(roundTripped.iso, original.iso);
  assert.equal(roundTripped.pixelXDimension, original.pixelXDimension);
  assert.equal(roundTripped.pixelYDimension, original.pixelYDimension);
  assert.equal(roundTripped.orientation, original.orientation);
  assert.deepEqual(roundTripped.exposureTime, original.exposureTime);
  assert.deepEqual(roundTripped.fNumber, original.fNumber);
  assert.deepEqual(roundTripped.focalLength, original.focalLength);
});
