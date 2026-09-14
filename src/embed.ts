import { findExifSegment } from './exif.js';
import type { ExifData, Rational } from './types.js';

interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array;
}

const TYPE_BYTE = 1;
const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

const EXIF_IFD_POINTER = 0x8769;
const GPS_IFD_POINTER = 0x8825;

function u16(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, true);
  return buf;
}

function u16BE(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, false); // JPEG segment lengths are always big-endian
  return buf;
}

function u32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, true);
  return buf;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function asciiEntry(tag: number, value: string): TiffEntry {
  const data = new TextEncoder().encode(`${value}\0`);
  return { tag, type: TYPE_ASCII, count: data.length, data };
}

function shortEntry(tag: number, value: number): TiffEntry {
  return { tag, type: TYPE_SHORT, count: 1, data: u16(value) };
}

function longEntry(tag: number, value: number): TiffEntry {
  return { tag, type: TYPE_LONG, count: 1, data: u32(value) };
}

function byteEntry(tag: number, value: number): TiffEntry {
  return { tag, type: TYPE_BYTE, count: 1, data: new Uint8Array([value]) };
}

function rationalBytes(value: Rational): Uint8Array {
  return concatBytes([u32(value.numerator), u32(value.denominator)]);
}

function rationalEntry(tag: number, value: Rational): TiffEntry {
  return { tag, type: TYPE_RATIONAL, count: 1, data: rationalBytes(value) };
}

function rationalArrayEntry(tag: number, values: Rational[]): TiffEntry {
  return { tag, type: TYPE_RATIONAL, count: values.length, data: concatBytes(values.map(rationalBytes)) };
}

// Encodes one IFD (entry count, entries, "no next IFD" terminator, and
// any out-of-line entry data) as it will sit at `baseOffset` bytes from
// the start of the TIFF block. Entries must be written in ascending tag
// order per the TIFF spec.
function encodeIfd(baseOffset: number, entries: TiffEntry[]): Uint8Array {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const ifdSize = 2 + sorted.length * 12 + 4;
  const header = new Uint8Array(ifdSize);
  const view = new DataView(header.buffer);
  view.setUint16(0, sorted.length, true);

  const extraChunks: Uint8Array[] = [];
  let extraOffset = baseOffset + ifdSize;
  sorted.forEach((entry, i) => {
    const entryOffset = 2 + i * 12;
    view.setUint16(entryOffset, entry.tag, true);
    view.setUint16(entryOffset + 2, entry.type, true);
    view.setUint32(entryOffset + 4, entry.count, true);
    if (entry.data.length <= 4) {
      header.set(entry.data, entryOffset + 8);
    } else {
      view.setUint32(entryOffset + 8, extraOffset, true);
      extraChunks.push(entry.data);
      extraOffset += entry.data.length;
    }
  });
  view.setUint32(ifdSize - 4, 0, true); // no next IFD

  return concatBytes([header, ...extraChunks]);
}

function buildIfd0Entries(exif: ExifData): TiffEntry[] {
  const entries: TiffEntry[] = [];
  if (exif.make !== undefined) entries.push(asciiEntry(0x010f, exif.make));
  if (exif.model !== undefined) entries.push(asciiEntry(0x0110, exif.model));
  if (exif.orientation !== undefined) entries.push(shortEntry(0x0112, exif.orientation));
  if (exif.software !== undefined) entries.push(asciiEntry(0x0131, exif.software));
  if (exif.dateTime !== undefined) entries.push(asciiEntry(0x0132, exif.dateTime));
  return entries;
}

function buildExifIfdEntries(exif: ExifData): TiffEntry[] {
  const entries: TiffEntry[] = [];
  if (exif.exposureTime !== undefined) entries.push(rationalEntry(0x829a, exif.exposureTime));
  if (exif.fNumber !== undefined) entries.push(rationalEntry(0x829d, exif.fNumber));
  if (exif.iso !== undefined) entries.push(shortEntry(0x8827, exif.iso));
  if (exif.dateTimeOriginal !== undefined) entries.push(asciiEntry(0x9003, exif.dateTimeOriginal));
  if (exif.dateTimeDigitized !== undefined) entries.push(asciiEntry(0x9004, exif.dateTimeDigitized));
  if (exif.focalLength !== undefined) entries.push(rationalEntry(0x920a, exif.focalLength));
  if (exif.pixelXDimension !== undefined) entries.push(longEntry(0xa002, exif.pixelXDimension));
  if (exif.pixelYDimension !== undefined) entries.push(longEntry(0xa003, exif.pixelYDimension));
  if (exif.lensModel !== undefined) entries.push(asciiEntry(0xa434, exif.lensModel));
  return entries;
}

function buildGpsIfdEntries(exif: ExifData): TiffEntry[] {
  const entries: TiffEntry[] = [];
  if (exif.gpsLatitudeRef !== undefined) entries.push(asciiEntry(0x0001, exif.gpsLatitudeRef));
  if (exif.gpsLatitude !== undefined) entries.push(rationalArrayEntry(0x0002, exif.gpsLatitude));
  if (exif.gpsLongitudeRef !== undefined) entries.push(asciiEntry(0x0003, exif.gpsLongitudeRef));
  if (exif.gpsLongitude !== undefined) entries.push(rationalArrayEntry(0x0004, exif.gpsLongitude));
  if (exif.gpsAltitudeRef !== undefined) entries.push(byteEntry(0x0005, exif.gpsAltitudeRef));
  if (exif.gpsAltitude !== undefined) entries.push(rationalEntry(0x0006, exif.gpsAltitude));
  return entries;
}

// Builds a little-endian TIFF block (header, IFD0, and the Exif/GPS
// SubIFDs it points to) from the fields ExifData carries. Mirrors the
// structure parseJpegExif reads, just in reverse.
function buildTiffBlock(exif: ExifData): Uint8Array {
  const tiffHeader = new Uint8Array(8);
  tiffHeader.set([0x49, 0x49], 0); // "II": little-endian
  const headerView = new DataView(tiffHeader.buffer);
  headerView.setUint16(2, 0x002a, true);
  headerView.setUint32(4, 8, true); // IFD0 starts right after this header

  const exifIfdEntries = buildExifIfdEntries(exif);
  const gpsIfdEntries = buildGpsIfdEntries(exif);
  const hasExifIfd = exifIfdEntries.length > 0;
  const hasGpsIfd = gpsIfdEntries.length > 0;

  // Size IFD0 with placeholder pointer entries first: pointers are
  // always 4 inline bytes, so the placeholder value doesn't change
  // IFD0's size and we can compute the SubIFD offsets that follow it.
  const ifd0BaseEntries = buildIfd0Entries(exif);
  const placeholderPointers: TiffEntry[] = [];
  if (hasExifIfd) placeholderPointers.push(longEntry(EXIF_IFD_POINTER, 0));
  if (hasGpsIfd) placeholderPointers.push(longEntry(GPS_IFD_POINTER, 0));
  const sizingEntries = [...ifd0BaseEntries, ...placeholderPointers];
  const ifd0Size =
    2 +
    sizingEntries.length * 12 +
    4 +
    sizingEntries.reduce((sum, entry) => sum + (entry.data.length > 4 ? entry.data.length : 0), 0);

  const exifIfdOffset = 8 + ifd0Size;
  const exifIfdBytes = hasExifIfd ? encodeIfd(exifIfdOffset, exifIfdEntries) : new Uint8Array(0);
  const gpsIfdOffset = exifIfdOffset + exifIfdBytes.length;
  const gpsIfdBytes = hasGpsIfd ? encodeIfd(gpsIfdOffset, gpsIfdEntries) : new Uint8Array(0);

  const finalPointers: TiffEntry[] = [];
  if (hasExifIfd) finalPointers.push(longEntry(EXIF_IFD_POINTER, exifIfdOffset));
  if (hasGpsIfd) finalPointers.push(longEntry(GPS_IFD_POINTER, gpsIfdOffset));
  const ifd0Bytes = encodeIfd(8, [...ifd0BaseEntries, ...finalPointers]);

  return concatBytes([tiffHeader, ifd0Bytes, exifIfdBytes, gpsIfdBytes]);
}

// Pure: builds the raw bytes of a JPEG APP1 marker segment (marker,
// length, "Exif\0\0" header, TIFF block) carrying the given fields.
export function buildExifApp1Segment(exif: ExifData): Uint8Array {
  const tiff = buildTiffBlock(exif);
  const exifHeader = new TextEncoder().encode('Exif\0\0');
  const payload = concatBytes([exifHeader, tiff]);
  const length = payload.length + 2; // JPEG segment length includes itself, not the marker
  if (length > 0xffff) {
    throw new RangeError('EXIF data is too large to fit in a single APP1 segment');
  }
  return concatBytes([new Uint8Array([0xff, 0xe1]), u16BE(length), payload]);
}

// Pure: returns a new JPEG byte array with `exif` embedded as an APP1
// "Exif\0\0" segment, replacing any existing one. Callers are
// responsible for reading the source file and writing the result back.
export function embedJpegExif(bytes: Uint8Array, exif: ExifData): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new RangeError('not a JPEG: missing SOI marker');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const existing = findExifSegment(view);
  const app1 = buildExifApp1Segment(exif);

  if (existing) {
    return concatBytes([bytes.subarray(0, existing.start), app1, bytes.subarray(existing.end)]);
  }
  // No existing EXIF segment: insert right after the SOI marker, which
  // is where Exif APP1 segments conventionally live.
  return concatBytes([bytes.subarray(0, 2), app1, bytes.subarray(2)]);
}
