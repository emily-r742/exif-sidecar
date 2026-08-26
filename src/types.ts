export interface Rational {
  numerator: number;
  denominator: number;
}

// Raw values as they come out of a TIFF/EXIF IFD entry, before any
// unit conversion or renaming happens.
export type TagValue = string | number | Rational;

// Subset of EXIF fields this library understands. Anything not listed
// here is parsed but discarded — see README for what's missing.
export interface ExifData {
  make?: string;
  model?: string;
  software?: string;
  orientation?: number;
  dateTime?: string; // IFD0 0x0132, "YYYY:MM:DD HH:MM:SS"
  dateTimeOriginal?: string; // Exif SubIFD 0x9003
  dateTimeDigitized?: string; // Exif SubIFD 0x9004
  exposureTime?: Rational;
  fNumber?: Rational;
  iso?: number;
  focalLength?: Rational;
  lensModel?: string;
  pixelXDimension?: number;
  pixelYDimension?: number;
}

// Human-readable, diffable stand-in for the fields above. Dates are
// ISO 8601, rationals are collapsed to plain numbers.
export interface SidecarRecord {
  camera?: {
    make?: string;
    model?: string;
    lens?: string;
  };
  capture?: {
    dateTaken?: string;
    dateDigitized?: string;
    exposureTimeSeconds?: number;
    fNumber?: number;
    iso?: number;
    focalLengthMm?: number;
  };
  image?: {
    width?: number;
    height?: number;
    orientation?: number;
  };
  software?: string;
  fileDateTime?: string;
}
