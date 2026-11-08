import { checkJpegSegments } from "./jpegSegments";

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** One marker segment: 0xFF, the marker byte, a two-byte length that counts itself, the payload. */
function segment(marker: number, payload: number[] = []): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** A start-of-scan header followed by a few entropy-coded bytes. */
const SCAN = [...segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), 0x12, 0x34, 0xff, 0x00, 0x56];
const JFIF = segment(
  0xe0,
  [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01],
);
/** "ICC_PROFILE\0", then the chunk number and count, then the start of a profile. */
const ICC_ID = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00];
const ICC = segment(0xe2, [...ICC_ID, 0x01, 0x01, 0x00, 0x00, 0x02, 0x0c]);
/** "MPF\0", the Multi-Picture Format index that points to images appended after EOI. */
const MPF = segment(0xe2, [0x4d, 0x50, 0x46, 0x00, 0x4d, 0x4d, 0x00, 0x2a]);
const COM = segment(0xfe, [0x68, 0x69]);
const DHT = segment(0xc4, [0x00, 0x01, 0x02]);
const SOF2 = segment(0xc2, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
const EXIF = segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
const DQT = segment(0xdb, [0x00, 0x01, 0x02, 0x03]);
const SOF0 = segment(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);

function jpeg(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

describe("checkJpegSegments: passing input", () => {
  it("passes a JPEG with only APP0 (JFIF) and APP2 (colour profile) before the scan", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, ICC, DQT, SOF0, SCAN, EOI))).toEqual({ ok: true });
  });

  it("passes a JPEG with no application segment at all", () => {
    expect(checkJpegSegments(jpeg(SOI, DQT, SOF0, SCAN, EOI))).toEqual({ ok: true });
  });

  it("passes a JPEG whose markers are preceded by 0xFF fill bytes", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xff], JFIF, [0xff], DQT, SCAN, EOI))).toEqual({
      ok: true,
    });
  });

  it("skips the standalone markers TEM and RSTn without a length", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0x01], [0xff, 0xd3], JFIF, SCAN, EOI))).toEqual({
      ok: true,
    });
  });

  it("passes a Uint8Array view onto part of a larger buffer, reading only the view", () => {
    const image = jpeg(SOI, JFIF, SCAN, EOI);
    const backing = jpeg(EXIF, Array.from(image), EXIF);
    const view = new Uint8Array(backing.buffer, EXIF.length, image.length);
    expect(checkJpegSegments(view)).toEqual({ ok: true });
  });

  it("passes a progressive JPEG with tables and several scans before EOI", () => {
    expect(
      checkJpegSegments(jpeg(SOI, JFIF, ICC, DQT, SOF2, DHT, SCAN, DHT, SCAN, SCAN, EOI)),
    ).toEqual({ ok: true });
  });

  it("reads 0xFF00 stuffing and RST0 to RST7 inside a scan as data", () => {
    const entropy = [0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd7, 0x44, 0xff, 0x00];
    expect(checkJpegSegments(jpeg(SOI, JFIF, SCAN, entropy, EOI))).toEqual({ ok: true });
  });

  it("reads 0xFF fill bytes before the marker that ends a scan", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, [0xff, 0xff, 0xff], EOI))).toEqual({ ok: true });
  });
});

describe("checkJpegSegments: segments between and after scans", () => {
  it("fails APP1 between two scans", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, SCAN, EXIF, SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe1,
    });
  });

  it("fails APP13 that follows the stuffed and restart bytes of a scan", () => {
    const entropy = [0x11, 0xff, 0x00, 0xff, 0xd3, 0x22];
    expect(checkJpegSegments(jpeg(SOI, SCAN, entropy, segment(0xed, [0x50]), SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffed,
    });
  });

  it("fails COM between two scans", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, DHT, COM, SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xfffe,
    });
  });

  it("fails a second SOI that ends a scan", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, SOI, EOI))).toEqual({
      ok: false,
      reason: "malformed",
      marker: 0xffd8,
    });
  });

  it("fails a byte other than 0xFF where a marker should start after a table between scans", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, DHT, [0x00], SCAN, EOI))).toEqual({
      ok: false,
      reason: "malformed",
      marker: null,
    });
  });
});

describe("checkJpegSegments: data after EOI", () => {
  it("fails one byte after EOI as trailing data", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, SCAN, EOI, [0x00]))).toEqual({
      ok: false,
      reason: "trailing-data",
      marker: null,
    });
  });

  it("fails a second image appended after EOI, as the Multi-Picture Format appends one", () => {
    const appended = jpeg(SOI, EXIF, SCAN, EOI);
    expect(checkJpegSegments(jpeg(SOI, JFIF, SCAN, EOI, Array.from(appended)))).toEqual({
      ok: false,
      reason: "trailing-data",
      marker: null,
    });
  });
});

describe("checkJpegSegments: APP2 and COM", () => {
  it("fails APP2 holding the Multi-Picture Format index (MPF)", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, MPF, SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe2,
    });
  });

  it("fails APP2 shorter than the ICC_PROFILE identifier", () => {
    expect(checkJpegSegments(jpeg(SOI, segment(0xe2, ICC_ID.slice(0, 11)), SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe2,
    });
  });

  it("fails APP2 whose identifier lacks the closing NUL byte of ICC_PROFILE", () => {
    const id = [...ICC_ID.slice(0, 11), 0x20, 0x01, 0x01];
    expect(checkJpegSegments(jpeg(SOI, segment(0xe2, id), SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe2,
    });
  });

  it("passes APP2 holding exactly the ICC_PROFILE identifier", () => {
    expect(checkJpegSegments(jpeg(SOI, segment(0xe2, ICC_ID), SCAN, EOI))).toEqual({ ok: true });
  });

  it("fails COM before the scan", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, COM, SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xfffe,
    });
  });
});

describe("checkJpegSegments: forbidden application segments", () => {
  it("fails APP1 (EXIF, XMP) and names its marker", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, EXIF, SCAN, EOI))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe1,
    });
  });

  it("fails APP13 (IPTC) and names its marker", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, segment(0xed, [0x50, 0x68]), SCAN))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffed,
    });
  });

  it.each(
    [0xe1, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef].map(
      (marker) => [`0xFF${marker.toString(16).toUpperCase()}`, marker] as const,
    ),
  )("fails every application segment other than APP0 and APP2: marker %s", (_label, marker) => {
    expect(checkJpegSegments(jpeg(SOI, segment(marker, [0x00]), SCAN))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xff00 | marker,
    });
  });

  it("fails on the first forbidden segment when there are several", () => {
    expect(checkJpegSegments(jpeg(SOI, segment(0xed, [0x00]), EXIF, SCAN))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffed,
    });
  });

  it("fails a forbidden segment that comes after the frame header but before the scan", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, DQT, SOF0, EXIF, SCAN))).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe1,
    });
  });
});

describe("checkJpegSegments: input that is not a byte array", () => {
  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a number", 0xffd8],
    ["a string", "\xff\xd8\xff\xda"],
    ["an array of numbers", [0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]],
    ["an ArrayBuffer", new ArrayBuffer(8)],
    ["a Uint16Array", new Uint16Array([0xd8ff])],
    ["a Uint8ClampedArray", new Uint8ClampedArray([0xff, 0xd8])],
    ["a plain object", { 0: 0xff, 1: 0xd8, length: 2 }],
  ])("fails %s as invalid input without throwing", (_label, input) => {
    expect(checkJpegSegments(input)).toEqual({ ok: false, reason: "invalid-input", marker: null });
  });
});

describe("checkJpegSegments: input that is not a JPEG", () => {
  it("fails an empty array", () => {
    expect(checkJpegSegments(new Uint8Array(0))).toEqual({
      ok: false,
      reason: "not-jpeg",
      marker: null,
    });
  });

  it("fails a single byte", () => {
    expect(checkJpegSegments(Uint8Array.from([0xff]))).toEqual({
      ok: false,
      reason: "not-jpeg",
      marker: null,
    });
  });

  it("fails a PNG signature", () => {
    expect(
      checkJpegSegments(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toEqual({ ok: false, reason: "not-jpeg", marker: null });
  });

  it("fails bytes that start with 0xFF but not with SOI", () => {
    expect(checkJpegSegments(jpeg([0xff, 0xd9], JFIF, SCAN))).toEqual({
      ok: false,
      reason: "not-jpeg",
      marker: null,
    });
  });
});

describe("checkJpegSegments: truncated input", () => {
  it("fails SOI alone, which ends before the scan", () => {
    expect(checkJpegSegments(jpeg(SOI))).toEqual({ ok: false, reason: "truncated", marker: null });
  });

  it("fails input that ends after a complete segment without reaching the scan", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, DQT))).toEqual({
      ok: false,
      reason: "truncated",
      marker: null,
    });
  });

  it("fails input that ends inside fill bytes before a marker", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, [0xff, 0xff]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: null,
    });
  });

  it("fails input that ends after a marker, before its length", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xe0]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: 0xffe0,
    });
  });

  it("fails input that ends inside the two-byte length", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xdb, 0x00]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: 0xffdb,
    });
  });

  it("fails a segment whose length runs past the end", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: 0xffe0,
    });
  });

  it("fails a start-of-scan header whose length runs past the end", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, [0xff, 0xda, 0x00, 0x0c, 0x01]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: 0xffda,
    });
  });

  it("fails a scan that runs to the end of the bytes with no EOI", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, SCAN))).toEqual({
      ok: false,
      reason: "truncated",
      marker: null,
    });
  });

  it("fails a scan whose bytes end on a 0xFF with no marker after it", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, [0x11, 0xff]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: null,
    });
  });

  it("fails a scan whose bytes end inside 0xFF fill bytes", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, [0xff, 0xff, 0xff]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: null,
    });
  });

  it("fails a table segment after a scan that ends before the next scan or EOI", () => {
    expect(checkJpegSegments(jpeg(SOI, SCAN, DHT))).toEqual({
      ok: false,
      reason: "truncated",
      marker: null,
    });
  });

  it("fails a cut-off APP1 as truncated: a segment is read whole before its marker is judged", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xe1, 0x00, 0x40, 0x45]))).toEqual({
      ok: false,
      reason: "truncated",
      marker: 0xffe1,
    });
  });
});

describe("checkJpegSegments: malformed input", () => {
  it("fails a byte other than 0xFF where a marker should start", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, [0x00], SCAN))).toEqual({
      ok: false,
      reason: "malformed",
      marker: null,
    });
  });

  it("fails 0xFF00 outside the entropy-coded data", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0x00], SCAN))).toEqual({
      ok: false,
      reason: "malformed",
      marker: 0xff00,
    });
  });

  it.each([0, 1])("fails a segment length of %i, below the two bytes it counts", (length) => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xe0, 0x00, length], SCAN))).toEqual({
      ok: false,
      reason: "malformed",
      marker: 0xffe0,
    });
  });

  it("fails a second SOI before the scan", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, SOI, SCAN))).toEqual({
      ok: false,
      reason: "malformed",
      marker: 0xffd8,
    });
  });

  it("fails EOI before any scan, an image with no SOS", () => {
    expect(checkJpegSegments(jpeg(SOI, JFIF, DQT, EOI))).toEqual({
      ok: false,
      reason: "malformed",
      marker: 0xffd9,
    });
  });
});
