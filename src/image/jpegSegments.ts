/**
 * The check that a JPEG to be sent carries no metadata (docs/SPEC.md 3.3). The whole
 * file is parsed to EOI, scans included, and every marker found outside the
 * entropy-coded data of a scan is checked against an allowlist:
 * - the image structure passes: SOI at the start, EOI at the end, the frame markers
 *   SOFn, DHT, DAC, DQT, DRI and SOS;
 * - APP0 passes only with the identifier "JFIF\0" (a JFXX APP0 can hold a thumbnail
 *   JPEG with its own EXIF);
 * - APP2 passes only with the identifier "ICC_PROFILE\0", a colour profile (any other
 *   APP2, such as the Multi-Picture Format index "MPF\0", fails);
 * - every other marker fails: APP1 (EXIF, XMP), APP13 (IPTC) and the other APPn, COM,
 *   JPG and JPGn, DHP, EXP, DNL, TEM, RSTn outside a scan, and the reserved markers;
 * - any byte after EOI fails, which catches images appended after the first one.
 * Inside a scan, 0xFF00 stuffing and RST0 to RST7 are data.
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
  /** A marker off the allowlist, or an APP0 or APP2 without its allowed identifier. */
  | "forbidden-segment"
  /** Bytes follow EOI. */
  | "trailing-data";

export type JpegSegmentCheck =
  | { ok: true }
  /** `marker` is the two-byte marker at fault (0xFFE1 for APP1), or null where there is none. */
  | { ok: false; reason: JpegSegmentFailure; marker: number | null };

const MARKER_PREFIX = 0xff;
const STUFFED_ZERO = 0x00;
const SOF0 = 0xc0;
const DHT = 0xc4;
const JPG = 0xc8;
const DAC = 0xcc;
const SOF15 = 0xcf;
const RST0 = 0xd0;
const RST7 = 0xd7;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const DQT = 0xdb;
const DRI = 0xdd;
const APP0 = 0xe0;
const APP2 = 0xe2;
/** "JFIF" and its closing NUL byte. */
const JFIF_ID = [0x4a, 0x46, 0x49, 0x46, 0x00];
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

/** SOF0 to SOF15: 0xC0 to 0xCF, less DHT, JPG and DAC, which share that range. */
function isFrameMarker(markerByte: number): boolean {
  return (
    markerByte >= SOF0 &&
    markerByte <= SOF15 &&
    markerByte !== DHT &&
    markerByte !== JPG &&
    markerByte !== DAC
  );
}

/** Whether a marker that opens a segment with a length is on the allowlist. */
function isAllowedSegment(markerByte: number): boolean {
  return (
    isFrameMarker(markerByte) ||
    markerByte === DHT ||
    markerByte === DAC ||
    markerByte === DQT ||
    markerByte === DRI ||
    markerByte === SOS ||
    markerByte === APP0 ||
    markerByte === APP2
  );
}

/** Whether the payload starting at `start`, `length` bytes long, opens with `id`. */
function startsWith(bytes: Uint8Array, start: number, length: number, id: number[]): boolean {
  return length >= id.length && id.every((value, index) => bytes[start + index] === value);
}

/** Whether an allowed segment's payload is what its marker may hold. */
function hasAllowedPayload(
  markerByte: number,
  bytes: Uint8Array,
  start: number,
  length: number,
): boolean {
  if (markerByte === APP0) {
    return startsWith(bytes, start, length, JFIF_ID);
  }
  if (markerByte === APP2) {
    return startsWith(bytes, start, length, ICC_PROFILE_ID);
  }
  return true;
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

    if (markerByte === EOI && sawScan) {
      return position === end ? { ok: true } : fail("trailing-data", null);
    }
    if (markerByte === STUFFED_ZERO || markerByte === SOI || markerByte === EOI) {
      return fail("malformed", marker);
    }
    // A marker off the list fails whatever follows it, its length included.
    if (!isAllowedSegment(markerByte)) {
      return fail("forbidden-segment", marker);
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
    if (!hasAllowedPayload(markerByte, bytes, position + 2, length - 2)) {
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
