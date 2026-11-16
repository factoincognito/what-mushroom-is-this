/**
 * The strip of the app's own re-encoded copy of a photo, before the segment check
 * (docs/SPEC.md 3.3). It removes:
 * - every application segment the check does not pass: APP1 (EXIF, XMP), APP13 (IPTC), an APP0
 *   that is not JFIF, an APP2 that is not a colour profile, and the other APPn;
 * - every comment;
 * - every byte after the end of the image.
 * Everything else is copied byte for byte: the structural markers and their segments, the
 * entropy-coded data with its 0xFF00 stuffing and restart markers, and 0xFF fill bytes.
 *
 * The JPEG is read by the check's own rules (`jpegSegments.ts`): where a marker may stand, where a
 * scan ends, which APP0 and APP2 pass. Nothing is repaired and nothing else is removed. The input
 * is passed on unchanged, as the same array, for the check to fail, when
 * - it is not structurally sound: not a JPEG, cut short or malformed, a segment's length below
 *   two or past the end among them;
 * - it holds, before its end, a marker the check refuses that is neither an application segment
 *   nor a comment: JPG and JPGn, DHP, EXP, DNL, TEM, a restart marker outside a scan, a reserved
 *   marker. Removing a segment that stands between a scan and such a marker, or bytes that are no
 *   marker, would turn them into scan data, which the check does not look into.
 * So the output is either the input itself or bytes the check passes.
 *
 * The strip is not the guarantee: the check runs on its output, and only bytes that pass the
 * check are sent (`prepareForAnalysis.ts`). The strip never throws.
 */

import { endOfScan, hasAllowedPayload, isAllowedSegment } from "./jpegSegments";

const MARKER_PREFIX = 0xff;
const SOI = 0xd8;
const EOI = 0xd9;
const SOS = 0xda;
const APP0 = 0xe0;
const APP15 = 0xef;
const COM = 0xfe;

/** An application segment or a comment: what the strip removes unless the check passes it. */
function isApplicationOrComment(markerByte: number): boolean {
  return (markerByte >= APP0 && markerByte <= APP15) || markerByte === COM;
}

/** The bytes of `ranges`, each from its start up to its end, one after the other. */
function joined(bytes: Uint8Array, ranges: readonly (readonly [number, number])[]): Uint8Array {
  const output = new Uint8Array(ranges.reduce((total, [start, end]) => total + end - start, 0));
  let offset = 0;
  for (const [start, end] of ranges) {
    output.set(bytes.subarray(start, end), offset);
    offset += end - start;
  }
  return output;
}

/**
 * The JPEG without the segments and trailing bytes named above, or `bytes` itself, the same
 * array, when there is nothing to remove or the JPEG is passed on unchanged. `bytes` is never
 * written to.
 */
export function stripJpegSegments(bytes: Uint8Array): Uint8Array {
  // What an encoder gives comes from native code: anything but bytes is left to the check.
  if (!(bytes instanceof Uint8Array)) {
    return bytes;
  }
  const end = bytes.length;
  if (end < 2 || bytes[0] !== MARKER_PREFIX || bytes[1] !== SOI) {
    return bytes;
  }

  /** The ranges kept so far, and where the next one starts. */
  const kept: [number, number][] = [];
  let keptFrom = 0;
  let position = 2;
  let sawScan = false;
  while (position < end) {
    if (bytes[position] !== MARKER_PREFIX) {
      return bytes;
    }
    // A marker may be preceded by any number of 0xFF fill bytes, which are kept.
    while (position < end && bytes[position] === MARKER_PREFIX) {
      position += 1;
    }
    const markerByte = bytes[position];
    if (markerByte === undefined) {
      return bytes;
    }
    const markerStart = position - 1;
    position += 1;

    if (markerByte === EOI && sawScan) {
      // The end of the image: what follows it is dropped.
      if (keptFrom === 0 && position === end) {
        return bytes;
      }
      kept.push([keptFrom, position]);
      return joined(bytes, kept);
    }
    // Any other marker the check refuses, or that breaks the syntax: nothing is removed.
    if (!isAllowedSegment(markerByte) && !isApplicationOrComment(markerByte)) {
      return bytes;
    }

    const high = bytes[position];
    const low = bytes[position + 1];
    if (high === undefined || low === undefined) {
      return bytes;
    }
    const length = (high << 8) | low;
    if (length < 2 || position + length > end) {
      return bytes;
    }
    const passes =
      isAllowedSegment(markerByte) &&
      hasAllowedPayload(markerByte, bytes, position + 2, length - 2);
    position += length;
    if (!passes) {
      // An application segment or a comment the check refuses: from its marker to its end.
      kept.push([keptFrom, markerStart]);
      keptFrom = position;
    }

    if (markerByte === SOS) {
      sawScan = true;
      const scanEnd = endOfScan(bytes, position);
      if (scanEnd === null) {
        return bytes;
      }
      position = scanEnd;
    }
  }
  return bytes;
}
