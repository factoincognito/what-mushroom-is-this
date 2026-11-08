/**
 * The check that a JPEG to be sent carries no metadata (docs/SPEC.md 3.3). The whole
 * file is parsed to EOI, scans included, and every segment found, before the first
 * scan or between scans, is checked:
 * - APP0 (JFIF) passes;
 * - APP2 passes only when it is a colour profile, its identifier "ICC_PROFILE\0";
 *   any other APP2, such as the Multi-Picture Format index "MPF\0", fails;
 * - every other application segment (APP1 for EXIF and XMP, APP13 for IPTC, ...) and
 *   COM (a comment, which can carry text) fail;
 * - any byte after EOI fails, which catches images appended after the first one.
 *
 * The check never throws: bad input gives a failing result with its own reason.
 */

export type JpegSegmentFailure =
  /** The input is not a Uint8Array. */
  | "invalid-input"
  /** The bytes do not start with SOI (0xFFD8). */
  | "not-jpeg"
  /** The bytes end before EOI, or a segment runs past the end. */
  | "truncated"
  /** The marker structure breaks the JPEG syntax, or EOI comes before any scan. */
  | "malformed"
  /** A segment that can carry metadata: an APPn other than APP0 and an ICC APP2, or COM. */
  | "forbidden-segment"
  /** Bytes follow EOI. */
  | "trailing-data";

export type JpegSegmentCheck =
  | { ok: true }
  /** `marker` is the two-byte marker at fault (0xFFE1 for APP1), or null where there is none. */
  | { ok: false; reason: JpegSegmentFailure; marker: number | null };

const MARKER_PREFIX = 0xff;
const STUFFED_ZERO = 0x00;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const COM = 0xfe;
const TEM = 0x01;
const RST0 = 0xd0;
const RST7 = 0xd7;
const APP0 = 0xe0;
const APP2 = 0xe2;
const APP15 = 0xef;
/** "ICC_PROFILE" and its closing NUL byte. */
const ICC_PROFILE_ID = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00];

function fail(reason: JpegSegmentFailure, marker: number | null): JpegSegmentCheck {
  return { ok: false, reason, marker };
}

function fullMarker(markerByte: number): number {
  return (MARKER_PREFIX << 8) | markerByte;
}

function isRestart(markerByte: number): boolean {
  return markerByte >= RST0 && markerByte <= RST7;
}

function isApplicationSegment(markerByte: number): boolean {
  return markerByte >= APP0 && markerByte <= APP15;
}

/** Whether the payload starting at `start`, `length` bytes long, opens with "ICC_PROFILE\0". */
function isIccProfile(bytes: Uint8Array, start: number, length: number): boolean {
  return (
    length >= ICC_PROFILE_ID.length &&
    ICC_PROFILE_ID.every((value, index) => bytes[start + index] === value)
  );
}

/** Whether a segment can carry metadata and so must not be sent. */
function isForbidden(
  markerByte: number,
  bytes: Uint8Array,
  start: number,
  length: number,
): boolean {
  if (markerByte === COM) {
    return true;
  }
  if (!isApplicationSegment(markerByte) || markerByte === APP0) {
    return false;
  }
  return !(markerByte === APP2 && isIccProfile(bytes, start, length));
}

/**
 * Skips the entropy-coded data of a scan, from `start`. 0xFF00 stuffing and RST0 to
 * RST7 are data; 0xFF fill bytes may come before a marker; any other marker ends the
 * scan. Gives the position of the 0xFF that starts that marker, or null when the bytes
 * end first.
 */
function endOfScan(bytes: Uint8Array, start: number): number | null {
  let position = start;
  while (position < bytes.length) {
    if (bytes[position] !== MARKER_PREFIX) {
      position += 1;
      continue;
    }
    let next = position + 1;
    while (bytes[next] === MARKER_PREFIX) {
      next += 1;
    }
    const markerByte = bytes[next];
    if (markerByte === undefined) {
      return null;
    }
    if (markerByte === STUFFED_ZERO || isRestart(markerByte)) {
      position = next + 1;
      continue;
    }
    return next - 1;
  }
  return null;
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
  let sawScan = false;
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

    if (markerByte === TEM || isRestart(markerByte)) {
      continue;
    }
    if (markerByte === EOI && sawScan) {
      return position === end ? { ok: true } : fail("trailing-data", null);
    }
    if (markerByte === STUFFED_ZERO || markerByte === SOI || markerByte === EOI) {
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
    if (isForbidden(markerByte, bytes, position + 2, length - 2)) {
      return fail("forbidden-segment", marker);
    }
    position += length;

    if (markerByte === SOS) {
      sawScan = true;
      const scanEnd = endOfScan(bytes, position);
      if (scanEnd === null) {
        return fail("truncated", null);
      }
      position = scanEnd;
    }
  }
  return fail("truncated", null);
}
