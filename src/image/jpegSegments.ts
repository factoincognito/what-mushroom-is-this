/**
 * The check that a JPEG to be sent carries no metadata (docs/SPEC.md 3.3): every
 * application segment (APP0 to APP15) before the start of scan must be APP0 (JFIF)
 * or APP2 (the colour profile). APP1 (EXIF, XMP), APP13 (IPTC) and every other
 * APPn fail, since they can carry a position.
 *
 * The check never throws: bad input gives a failing result with its own reason.
 */

export type JpegSegmentFailure =
  /** The input is not a Uint8Array. */
  | "invalid-input"
  /** The bytes do not start with SOI (0xFFD8). */
  | "not-jpeg"
  /** The bytes end before the start of scan, or a segment runs past the end. */
  | "truncated"
  /** The structure before the start of scan breaks the JPEG syntax. */
  | "malformed"
  /** An application segment other than APP0 and APP2 comes before the start of scan. */
  | "forbidden-segment";

export type JpegSegmentCheck =
  | { ok: true }
  /** `marker` is the two-byte marker at fault (0xFFE1 for APP1), or null where there is none. */
  | { ok: false; reason: JpegSegmentFailure; marker: number | null };

const MARKER_PREFIX = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const TEM = 0x01;
const RST0 = 0xd0;
const RST7 = 0xd7;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP15 = 0xef;

function fail(reason: JpegSegmentFailure, marker: number | null): JpegSegmentCheck {
  return { ok: false, reason, marker };
}

function fullMarker(markerByte: number): number {
  return (MARKER_PREFIX << 8) | markerByte;
}

function isStandalone(markerByte: number): boolean {
  return markerByte === TEM || (markerByte >= RST0 && markerByte <= RST7);
}

function isApplicationSegment(markerByte: number): boolean {
  return markerByte >= APP0 && markerByte <= APP15;
}

export function checkJpegSegments(bytes: unknown): JpegSegmentCheck {
  if (!(bytes instanceof Uint8Array)) {
    return fail("invalid-input", null);
  }
  const end = bytes.length;
  if (end < 2 || bytes[0] !== MARKER_PREFIX || bytes[1] !== SOI) {
    return fail("not-jpeg", null);
  }

  let position = 2;
  while (position < end) {
    if (bytes[position] !== MARKER_PREFIX) {
      return fail("malformed", null);
    }
    // A marker may be preceded by any number of 0xFF fill bytes.
    while (position < end && bytes[position] === MARKER_PREFIX) {
      position += 1;
    }
    const markerByte = bytes[position];
    if (markerByte === undefined) {
      return fail("truncated", null);
    }
    const marker = fullMarker(markerByte);
    position += 1;

    if (isStandalone(markerByte)) {
      continue;
    }
    if (markerByte === 0x00 || markerByte === SOI || markerByte === EOI) {
      return fail("malformed", marker);
    }

    const high = bytes[position];
    const low = bytes[position + 1];
    if (high === undefined || low === undefined) {
      return fail("truncated", marker);
    }
    const length = (high << 8) | low;
    if (length < 2) {
      return fail("malformed", marker);
    }
    if (position + length > end) {
      return fail("truncated", marker);
    }

    if (markerByte === SOS) {
      return { ok: true };
    }
    if (isApplicationSegment(markerByte) && markerByte !== APP0 && markerByte !== APP2) {
      return fail("forbidden-segment", marker);
    }
    position += length;
  }
  return fail("truncated", null);
}
