import type { ExifData, Rational, TagValue } from './types.js';

// Byte size of one value for each TIFF field type we might encounter.
// Types we don't decode (BYTE, UNDEFINED, SBYTE, ...) are still sized
// here so we can skip over their entries without misreading the IFD.
const TAG_TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

const EXIF_IFD_POINTER = 0x8769;

function readTagValue(
  view: DataView,
  type: number,
  count: number,
  offset: number,
  little: boolean,
): TagValue | undefined {
  switch (type) {
    case 2: {
      // ASCII, NUL-terminated; TIFF stores the terminator inside `count`.
      const chars: number[] = [];
      for (let i = 0; i < count; i++) {
        const byte = view.getUint8(offset + i);
        if (byte === 0) break;
        chars.push(byte);
      }
      return String.fromCharCode(...chars);
    }
    case 3: {
      // SHORT — only the first value matters for the fields we read.
      return view.getUint16(offset, little);
    }
    case 4: {
      // LONG
      return view.getUint32(offset, little);
    }
    case 5: {
      // RATIONAL
      return {
        numerator: view.getUint32(offset, little),
        denominator: view.getUint32(offset + 4, little),
      };
    }
    default:
      return undefined;
  }
}

function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
): Map<number, TagValue> {
  const entries = new Map<number, TagValue>();
  const entryCount = view.getUint16(tiffStart + ifdOffset, little);
  for (let i = 0; i < entryCount; i++) {
    const entryOffset = tiffStart + ifdOffset + 2 + i * 12;
    const tag = view.getUint16(entryOffset, little);
    const type = view.getUint16(entryOffset + 2, little);
    const valueCount = view.getUint32(entryOffset + 4, little);
    const typeSize = TAG_TYPE_SIZES[type];
    if (!typeSize) continue;

    const byteLength = typeSize * valueCount;
    // Values that fit in 4 bytes live inline; larger ones are stored
    // elsewhere in the TIFF block and referenced by offset.
    const dataOffset =
      byteLength <= 4 ? entryOffset + 8 : tiffStart + view.getUint32(entryOffset + 8, little);

    const value = readTagValue(view, type, valueCount, dataOffset, little);
    if (value !== undefined) entries.set(tag, value);
  }
  return entries;
}

function parseTiff(
  view: DataView,
  tiffStart: number,
): { ifd0: Map<number, TagValue>; exifIfd: Map<number, TagValue> } {
  const byteOrderMark = view.getUint16(tiffStart, false);
  const little = byteOrderMark === 0x4949; // "II"; "MM" is big-endian

  const ifd0Offset = view.getUint32(tiffStart + 4, little);
  const ifd0 = readIfd(view, tiffStart, ifd0Offset, little);

  const exifIfdPointer = ifd0.get(EXIF_IFD_POINTER);
  const exifIfd =
    typeof exifIfdPointer === 'number' ? readIfd(view, tiffStart, exifIfdPointer, little) : new Map();

  return { ifd0, exifIfd };
}

// Walks JPEG markers looking for the APP1 segment that carries an
// "Exif\0\0" header, and returns the offset where the TIFF block
// inside it starts. Returns undefined if the file isn't a JPEG or
// carries no EXIF APP1 segment.
function findTiffStart(view: DataView): number | undefined {
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return undefined;

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);

    // Markers with no payload: TEM/RST/SOI have no length field.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of scan / end of image: entropy-coded data follows, no
    // more markers worth reading.
    if (marker === 0xd9 || marker === 0xda) break;

    const length = view.getUint16(offset + 2, false);
    if (marker === 0xe1 && offset + 4 + 6 <= view.byteLength) {
      const headerStart = offset + 4;
      const isExifHeader =
        view.getUint8(headerStart) === 0x45 && // E
        view.getUint8(headerStart + 1) === 0x78 && // x
        view.getUint8(headerStart + 2) === 0x69 && // i
        view.getUint8(headerStart + 3) === 0x66 && // f
        view.getUint8(headerStart + 4) === 0x00 &&
        view.getUint8(headerStart + 5) === 0x00;
      if (isExifHeader) return headerStart + 6;
    }
    offset += 2 + length;
  }
  return undefined;
}

function isRational(value: TagValue | undefined): value is Rational {
  return typeof value === 'object' && value !== null && 'numerator' in value;
}

function buildExifData(ifd0: Map<number, TagValue>, exifIfd: Map<number, TagValue>): ExifData {
  const data: ExifData = {};

  const make = ifd0.get(0x010f);
  if (typeof make === 'string') data.make = make;
  const model = ifd0.get(0x0110);
  if (typeof model === 'string') data.model = model;
  const software = ifd0.get(0x0131);
  if (typeof software === 'string') data.software = software;
  const orientation = ifd0.get(0x0112);
  if (typeof orientation === 'number') data.orientation = orientation;
  const dateTime = ifd0.get(0x0132);
  if (typeof dateTime === 'string') data.dateTime = dateTime;

  const dateTimeOriginal = exifIfd.get(0x9003);
  if (typeof dateTimeOriginal === 'string') data.dateTimeOriginal = dateTimeOriginal;
  const dateTimeDigitized = exifIfd.get(0x9004);
  if (typeof dateTimeDigitized === 'string') data.dateTimeDigitized = dateTimeDigitized;
  const exposureTime = exifIfd.get(0x829a);
  if (isRational(exposureTime)) data.exposureTime = exposureTime;
  const fNumber = exifIfd.get(0x829d);
  if (isRational(fNumber)) data.fNumber = fNumber;
  const iso = exifIfd.get(0x8827);
  if (typeof iso === 'number') data.iso = iso;
  const focalLength = exifIfd.get(0x920a);
  if (isRational(focalLength)) data.focalLength = focalLength;
  const lensModel = exifIfd.get(0xa434);
  if (typeof lensModel === 'string') data.lensModel = lensModel;
  const pixelXDimension = exifIfd.get(0xa002);
  if (typeof pixelXDimension === 'number') data.pixelXDimension = pixelXDimension;
  const pixelYDimension = exifIfd.get(0xa003);
  if (typeof pixelYDimension === 'number') data.pixelYDimension = pixelYDimension;

  return data;
}

// Pure: reads only from the given bytes, never touches disk. Callers
// are responsible for getting file contents into memory first.
export function parseJpegExif(bytes: Uint8Array): ExifData | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tiffStart = findTiffStart(view);
  if (tiffStart === undefined) return null;

  const { ifd0, exifIfd } = parseTiff(view, tiffStart);
  return buildExifData(ifd0, exifIfd);
}
