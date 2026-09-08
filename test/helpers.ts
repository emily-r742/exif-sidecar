// Builds synthetic JPEG byte arrays with a hand-encoded EXIF APP1
// segment, so tests exercise parseJpegExif against real byte layouts
// instead of mocking it away.

export interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array;
}

function u16(value: number, little: boolean): Uint8Array {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setUint16(0, value, little);
  return buf;
}

function u32(value: number, little: boolean): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, value, little);
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

export function asciiEntry(tag: number, value: string): TiffEntry {
  const data = new TextEncoder().encode(`${value}\0`);
  return { tag, type: 2, count: data.length, data };
}

export function shortEntry(tag: number, value: number, little: boolean): TiffEntry {
  return { tag, type: 3, count: 1, data: u16(value, little) };
}

export function longEntry(tag: number, value: number, little: boolean): TiffEntry {
  return { tag, type: 4, count: 1, data: u32(value, little) };
}

export function rationalEntry(
  tag: number,
  numerator: number,
  denominator: number,
  little: boolean,
): TiffEntry {
  const data = new Uint8Array(8);
  data.set(u32(numerator, little), 0);
  data.set(u32(denominator, little), 4);
  return { tag, type: 5, count: 1, data };
}

// Encodes one IFD (header + inline entries + out-of-line entry data)
// starting at `baseOffset` bytes from the start of the TIFF block.
function encodeIfd(baseOffset: number, entries: TiffEntry[], little: boolean): Uint8Array {
  const ifdSize = 2 + entries.length * 12 + 4;
  const header = new Uint8Array(ifdSize);
  const view = new DataView(header.buffer);
  view.setUint16(0, entries.length, little);

  const extraChunks: Uint8Array[] = [];
  let extraOffset = baseOffset + ifdSize;
  entries.forEach((entry, i) => {
    const entryOffset = 2 + i * 12;
    view.setUint16(entryOffset, entry.tag, little);
    view.setUint16(entryOffset + 2, entry.type, little);
    view.setUint32(entryOffset + 4, entry.count, little);
    if (entry.data.length <= 4) {
      header.set(entry.data, entryOffset + 8);
    } else {
      view.setUint32(entryOffset + 8, extraOffset, little);
      extraChunks.push(entry.data);
      extraOffset += entry.data.length;
    }
  });
  view.setUint32(ifdSize - 4, 0, little); // no next IFD

  return concatBytes([header, ...extraChunks]);
}

// Builds a minimal JPEG (SOI, one APP1 "Exif\0\0" segment, EOI) whose
// TIFF block holds `ifd0Entries` in IFD0 and, if given, `exifIfdEntries`
// in the EXIF SubIFD pointed to from IFD0 tag 0x8769.
export function buildJpegWithExif(
  ifd0Entries: TiffEntry[],
  exifIfdEntries: TiffEntry[] = [],
  little = true,
): Uint8Array {
  const byteOrder = little ? [0x49, 0x49] : [0x4d, 0x4d];
  const tiffHeader = new Uint8Array(8);
  tiffHeader.set(byteOrder, 0);
  const headerView = new DataView(tiffHeader.buffer);
  headerView.setUint16(2, 0x002a, little);
  headerView.setUint32(4, 8, little); // IFD0 starts right after this header

  const hasExifIfd = exifIfdEntries.length > 0;
  // Size the pointer entry with a placeholder offset first: its data is
  // always 4 inline bytes, so the placeholder doesn't change IFD0's size.
  const sizingEntries = hasExifIfd ? [...ifd0Entries, longEntry(0x8769, 0, little)] : ifd0Entries;
  const ifd0Size =
    2 +
    sizingEntries.length * 12 +
    4 +
    ifd0Entries.reduce((sum, entry) => sum + (entry.data.length > 4 ? entry.data.length : 0), 0);
  const exifIfdOffset = 8 + ifd0Size;

  const finalIfd0Entries = hasExifIfd
    ? [...ifd0Entries, longEntry(0x8769, exifIfdOffset, little)]
    : ifd0Entries;

  const ifd0Bytes = encodeIfd(8, finalIfd0Entries, little);
  const exifIfdBytes = hasExifIfd ? encodeIfd(exifIfdOffset, exifIfdEntries, little) : new Uint8Array(0);

  const tiff = concatBytes([tiffHeader, ifd0Bytes, exifIfdBytes]);
  const exifHeader = new TextEncoder().encode('Exif\0\0');
  const app1Payload = concatBytes([exifHeader, tiff]);
  const app1Length = u16(app1Payload.length + 2, false); // JPEG lengths are always big-endian

  return concatBytes([
    new Uint8Array([0xff, 0xd8]), // SOI
    new Uint8Array([0xff, 0xe1]), // APP1
    app1Length,
    app1Payload,
    new Uint8Array([0xff, 0xd9]), // EOI
  ]);
}

// A JPEG with a JFIF APP0 segment but no EXIF APP1 at all.
export function buildJpegWithoutExif(): Uint8Array {
  const jfifPayload = new TextEncoder().encode('JFIF\0');
  const app0Length = u16(jfifPayload.length + 2, false);
  return concatBytes([
    new Uint8Array([0xff, 0xd8]), // SOI
    new Uint8Array([0xff, 0xe0]), // APP0
    app0Length,
    jfifPayload,
    new Uint8Array([0xff, 0xd9]), // EOI
  ]);
}
