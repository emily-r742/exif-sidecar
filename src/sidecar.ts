import type { ExifData, Rational, SidecarRecord } from './types.js';

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

export function rationalToNumber(value: Rational): number {
  return value.denominator === 0 ? 0 : value.numerator / value.denominator;
}

// Reduces a float to a rational with up to six decimal digits of
// precision, which is more than EXIF fields like exposure time need.
export function numberToRational(value: number): Rational {
  if (Number.isInteger(value)) return { numerator: value, denominator: 1 };
  const denominator = 1_000_000;
  const numerator = Math.round(value * denominator);
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

// Converts a GPS degrees/minutes/seconds triplet plus a hemisphere
// reference ("N"/"S"/"E"/"W") to signed decimal degrees.
function dmsToDecimal(dms: Rational[], ref: string): number | undefined {
  if (dms.length !== 3) return undefined;
  const [degrees, minutes, seconds] = dms.map(rationalToNumber);
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  return ref === 'S' || ref === 'W' ? -magnitude : magnitude;
}

// Inverse of dmsToDecimal: splits signed decimal degrees into a
// degrees/minutes/seconds triplet. The sign itself is carried by the
// hemisphere reference, not the triplet.
function decimalToDms(value: number): Rational[] {
  const magnitude = Math.abs(value);
  const degrees = Math.floor(magnitude);
  const minutesFull = (magnitude - degrees) * 60;
  const minutes = Math.floor(minutesFull);
  const seconds = (minutesFull - minutes) * 60;
  return [
    { numerator: degrees, denominator: 1 },
    { numerator: minutes, denominator: 1 },
    numberToRational(seconds),
  ];
}

const EXIF_DATE_PATTERN = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

export function exifDateToIso(value: string): string | undefined {
  const match = EXIF_DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

export function isoDateToExif(value: string): string | undefined {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return `${year}:${month}:${day} ${hour}:${minute}:${second}`;
}

export function exifToSidecar(exif: ExifData): SidecarRecord {
  const record: SidecarRecord = {};

  if (exif.make !== undefined || exif.model !== undefined || exif.lensModel !== undefined) {
    record.camera = {
      ...(exif.make !== undefined && { make: exif.make }),
      ...(exif.model !== undefined && { model: exif.model }),
      ...(exif.lensModel !== undefined && { lens: exif.lensModel }),
    };
  }

  const dateTaken = exif.dateTimeOriginal ? exifDateToIso(exif.dateTimeOriginal) : undefined;
  const dateDigitized = exif.dateTimeDigitized ? exifDateToIso(exif.dateTimeDigitized) : undefined;
  const hasCaptureData =
    dateTaken !== undefined ||
    dateDigitized !== undefined ||
    exif.exposureTime !== undefined ||
    exif.fNumber !== undefined ||
    exif.iso !== undefined ||
    exif.focalLength !== undefined;
  if (hasCaptureData) {
    record.capture = {
      ...(dateTaken !== undefined && { dateTaken }),
      ...(dateDigitized !== undefined && { dateDigitized }),
      ...(exif.exposureTime !== undefined && { exposureTimeSeconds: rationalToNumber(exif.exposureTime) }),
      ...(exif.fNumber !== undefined && { fNumber: rationalToNumber(exif.fNumber) }),
      ...(exif.iso !== undefined && { iso: exif.iso }),
      ...(exif.focalLength !== undefined && { focalLengthMm: rationalToNumber(exif.focalLength) }),
    };
  }

  if (
    exif.pixelXDimension !== undefined ||
    exif.pixelYDimension !== undefined ||
    exif.orientation !== undefined
  ) {
    record.image = {
      ...(exif.pixelXDimension !== undefined && { width: exif.pixelXDimension }),
      ...(exif.pixelYDimension !== undefined && { height: exif.pixelYDimension }),
      ...(exif.orientation !== undefined && { orientation: exif.orientation }),
    };
  }

  if (exif.gpsLatitude !== undefined && exif.gpsLongitude !== undefined) {
    const latitude = dmsToDecimal(exif.gpsLatitude, exif.gpsLatitudeRef ?? 'N');
    const longitude = dmsToDecimal(exif.gpsLongitude, exif.gpsLongitudeRef ?? 'E');
    if (latitude !== undefined && longitude !== undefined) {
      record.location = {
        latitude,
        longitude,
        ...(exif.gpsAltitude !== undefined && {
          altitudeMeters:
            exif.gpsAltitudeRef === 1 ? -rationalToNumber(exif.gpsAltitude) : rationalToNumber(exif.gpsAltitude),
        }),
      };
    }
  }

  if (exif.software !== undefined) record.software = exif.software;

  const fileDateTime = exif.dateTime ? exifDateToIso(exif.dateTime) : undefined;
  if (fileDateTime !== undefined) record.fileDateTime = fileDateTime;

  return record;
}

export function sidecarToExif(sidecar: SidecarRecord): ExifData {
  const exif: ExifData = {};

  if (sidecar.camera?.make !== undefined) exif.make = sidecar.camera.make;
  if (sidecar.camera?.model !== undefined) exif.model = sidecar.camera.model;
  if (sidecar.camera?.lens !== undefined) exif.lensModel = sidecar.camera.lens;

  if (sidecar.capture?.dateTaken !== undefined) {
    const converted = isoDateToExif(sidecar.capture.dateTaken);
    if (converted !== undefined) exif.dateTimeOriginal = converted;
  }
  if (sidecar.capture?.dateDigitized !== undefined) {
    const converted = isoDateToExif(sidecar.capture.dateDigitized);
    if (converted !== undefined) exif.dateTimeDigitized = converted;
  }
  if (sidecar.capture?.exposureTimeSeconds !== undefined) {
    exif.exposureTime = numberToRational(sidecar.capture.exposureTimeSeconds);
  }
  if (sidecar.capture?.fNumber !== undefined) {
    exif.fNumber = numberToRational(sidecar.capture.fNumber);
  }
  if (sidecar.capture?.iso !== undefined) exif.iso = sidecar.capture.iso;
  if (sidecar.capture?.focalLengthMm !== undefined) {
    exif.focalLength = numberToRational(sidecar.capture.focalLengthMm);
  }

  if (sidecar.image?.width !== undefined) exif.pixelXDimension = sidecar.image.width;
  if (sidecar.image?.height !== undefined) exif.pixelYDimension = sidecar.image.height;
  if (sidecar.image?.orientation !== undefined) exif.orientation = sidecar.image.orientation;

  if (sidecar.location !== undefined) {
    exif.gpsLatitude = decimalToDms(sidecar.location.latitude);
    exif.gpsLatitudeRef = sidecar.location.latitude < 0 ? 'S' : 'N';
    exif.gpsLongitude = decimalToDms(sidecar.location.longitude);
    exif.gpsLongitudeRef = sidecar.location.longitude < 0 ? 'W' : 'E';
    if (sidecar.location.altitudeMeters !== undefined) {
      exif.gpsAltitude = numberToRational(Math.abs(sidecar.location.altitudeMeters));
      exif.gpsAltitudeRef = sidecar.location.altitudeMeters < 0 ? 1 : 0;
    }
  }

  if (sidecar.software !== undefined) exif.software = sidecar.software;

  if (sidecar.fileDateTime !== undefined) {
    const converted = isoDateToExif(sidecar.fileDateTime);
    if (converted !== undefined) exif.dateTime = converted;
  }

  return exif;
}
