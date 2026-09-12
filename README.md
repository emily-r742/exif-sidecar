# exif-sidecar

JPEG files carry EXIF metadata (camera model, exposure settings, capture
date, ...) inside a binary TIFF structure buried in an APP1 segment. It's
not readable, not diffable, and painful to inspect without a dedicated
tool. This library parses that structure and converts it into a plain
JSON sidecar record you can read, diff in git, or hand-edit — and back
again into the field values EXIF expects.

There are two representations:

- `ExifData` — the EXIF fields as TIFF actually stores them: dates as
  `"YYYY:MM:DD HH:MM:SS"` strings, exposure time and f-number as
  numerator/denominator rationals.
- `SidecarRecord` — the same information reshaped for humans: ISO 8601
  dates, rationals collapsed into plain numbers, fields grouped under
  `camera`, `capture`, and `image`.

## Usage

```ts
import { readFileSync } from 'node:fs';
import { parseJpegExif, exifToSidecar, sidecarToExif } from './src/index.js';

const bytes = readFileSync('photo.jpg');
const exif = parseJpegExif(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));

if (exif) {
  const sidecar = exifToSidecar(exif);
  console.log(JSON.stringify(sidecar, null, 2));
  // {
  //   "camera": { "make": "Canon", "model": "EOS R6", "lens": "RF 24-70mm F2.8" },
  //   "capture": {
  //     "dateTaken": "2026-03-11T14:22:05",
  //     "exposureTimeSeconds": 0.004,
  //     "fNumber": 2.8,
  //     "iso": 400,
  //     "focalLengthMm": 50
  //   },
  //   "image": { "width": 6000, "height": 4000, "orientation": 1 },
  //   "location": { "latitude": 40.741694, "longitude": -73.985717, "altitudeMeters": 15 }
  // }

  // round trip back to EXIF-shaped field values
  const roundTripped = sidecarToExif(sidecar);
}
```

## Design

Every exported function in `src/exif.ts` and `src/sidecar.ts` is pure:
given the same bytes or the same record, it always returns the same
result, and it never touches the filesystem. File reading lives only in
the caller (as in the example above). That split is what makes the
parsing and conversion logic straightforward to unit test — no fixture
files on disk required, just byte arrays and plain objects built in the
test itself.

## Tests

`npm test` runs the `node:test` suite in `test/`. It builds synthetic JPEG
byte arrays by hand (no fixture files) to exercise the EXIF parser, and
checks that `exifToSidecar` / `sidecarToExif` round-trip without losing
data.

## Current limitations

This is an early skeleton. Known gaps, in the order I plan to close
them, are listed in the project roadmap (not checked into this repo
yet — see commit history as it grows). Notably: there's no support for
writing a sidecar back into a JPEG's APP1 segment, and only the first
IFD and the GPS IFD are read (no thumbnail IFD, no maker notes).

## License

MIT, see [LICENSE](./LICENSE).
