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
const ICC = segment(0xe2, [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]);
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
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0xff], JFIF, [0xff], DQT, SCAN))).toEqual({
      ok: true,
    });
  });

  it("skips the standalone markers TEM and RSTn without a length", () => {
    expect(checkJpegSegments(jpeg(SOI, [0xff, 0x01], [0xff, 0xd3], JFIF, SCAN))).toEqual({
      ok: true,
    });
  });

  it("passes a Uint8Array view onto part of a larger buffer, reading only the view", () => {
    const backing = jpeg(EXIF, SOI, JFIF, SCAN, EOI);
    const view = new Uint8Array(backing.buffer, EXIF.length);
    expect(checkJpegSegments(view)).toEqual({ ok: true });
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
