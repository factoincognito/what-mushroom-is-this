import { checkJpegSegments, type JpegSegmentFailure } from "./jpegSegments";
import { stripJpegSegments } from "./stripJpegSegments";

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** One marker segment: 0xFF, the marker byte, a two-byte length that counts itself, the payload. */
function segment(marker: number, payload: number[] = []): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

function ascii(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

function jpeg(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function hex(marker: number): string {
  return `0xFF${marker.toString(16).toUpperCase().padStart(2, "0")}`;
}

/** A start-of-scan header. */
const SOS = segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
/** A start-of-scan header followed by a few entropy-coded bytes, 0xFF00 stuffing among them. */
const SCAN = [...SOS, 0x12, 0x34, 0xff, 0x00, 0x56];
/**
 * Entropy-coded data with 0xFF00 stuffing and the restart markers RST0 to RST7. After the first
 * stuffing come the bytes of an APP1 marker and a length, which are data there.
 */
const RESTARTED = [
  0x11, 0xff, 0x00, 0xe1, 0x00, 0x04, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd1, 0x44, 0xff, 0xd2, 0x55,
  0xff, 0xd3, 0x66, 0xff, 0xd4, 0x77, 0xff, 0xd5, 0x88, 0xff, 0xd6, 0x99, 0xff, 0xd7, 0xaa, 0xff,
  0x00,
];
const JFIF_ID = [...ascii("JFIF"), 0x00];
const JFIF = segment(0xe0, [...JFIF_ID, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
const ICC_ID = [...ascii("ICC_PROFILE"), 0x00];
/** A colour profile in one APP2 chunk: the identifier, chunk 1 of 1, the start of a profile. */
const ICC = segment(0xe2, [...ICC_ID, 0x01, 0x01, 0x00, 0x00, 0x02, 0x0c]);
/** A colour profile in three APP2 chunks. */
const ICC_1_OF_3 = segment(0xe2, [...ICC_ID, 0x01, 0x03, 0x00, 0x00, 0x02, 0x0c]);
const ICC_2_OF_3 = segment(0xe2, [...ICC_ID, 0x02, 0x03, 0x61, 0x63, 0x73, 0x70]);
const ICC_3_OF_3 = segment(0xe2, [...ICC_ID, 0x03, 0x03, 0xff, 0xd9, 0x00]);
const DQT = segment(0xdb, [0x00, 0x01, 0x02, 0x03]);
const SOF0 = segment(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
const SOF2 = segment(0xc2, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
const DHT = segment(0xc4, [0x00, 0x01, 0x02]);
const DRI = segment(0xdd, [0x00, 0x04]);
const DAC = segment(0xcc, [0x00, 0x10]);

/** APP1 with "Exif\0\0" and the start of a TIFF header. */
const EXIF = segment(0xe1, [...ascii("Exif"), 0x00, 0x00, 0x4d, 0x4d, 0x00, 0x2a]);
/** APP1 with the XMP namespace and a packet. */
const XMP = segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0x00, ...ascii("<x/>")]);
/** APP1 with EXIF that holds a thumbnail, a whole JPEG with an APP1 and a comment of its own. */
const EXIF_WITH_THUMBNAIL = segment(0xe1, [
  ...ascii("Exif"),
  0x00,
  0x00,
  ...SOI,
  ...EXIF,
  ...segment(0xfe, ascii("thumb")),
  ...SCAN,
  ...EOI,
]);
/** APP13, where IPTC data is kept. */
const IPTC = segment(0xed, [...ascii("Photoshop 3.0"), 0x00, ...ascii("8BIM")]);
/** APP14 as Adobe writes it: the colour transform of the picture. */
const ADOBE = segment(0xee, [...ascii("Adobe"), 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x01]);
/** APP0 with "JFXX\0", the JFIF extension, holding a thumbnail JPEG. */
const JFXX = segment(0xe0, [...ascii("JFXX"), 0x00, 0x10, ...SOI, ...EXIF, ...SCAN, ...EOI]);
/** APP2 with "MPF\0", the Multi-Picture Format index. */
const MPF = segment(0xe2, [...ascii("MPF"), 0x00, 0x4d, 0x4d, 0x00, 0x2a]);
const COM = segment(0xfe, ascii("taken at home"));

/** The strip gives `expected`, which the check passes, and leaves the input's bytes as they were. */
function expectStripped(input: Uint8Array, expected: Uint8Array): void {
  const before = Uint8Array.from(input);
  const output = stripJpegSegments(input);
  expect(Array.from(output)).toEqual(Array.from(expected));
  expect(checkJpegSegments(output)).toEqual({ ok: true });
  expect(Array.from(input)).toEqual(Array.from(before));
}

/** The strip passes `input` on unchanged, as the same array, and the check fails it as given. */
function expectUnchanged(
  input: Uint8Array,
  reason: JpegSegmentFailure,
  marker: number | null,
): void {
  const before = Uint8Array.from(input);
  expect(stripJpegSegments(input)).toBe(input);
  expect(Array.from(input)).toEqual(Array.from(before));
  expect(checkJpegSegments(input)).toEqual({ ok: false, reason, marker });
}

describe("stripJpegSegments: what it removes (docs/SPEC.md 3.3)", () => {
  it("removes an EXIF APP1, an XMP APP1 and a comment before the scan, and the check passes what is left", () => {
    const input = jpeg(SOI, JFIF, EXIF, XMP, COM, DQT, SOF0, DHT, SCAN, EOI);
    expect(checkJpegSegments(input)).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe1,
    });
    expectStripped(input, jpeg(SOI, JFIF, DQT, SOF0, DHT, SCAN, EOI));
  });

  it("removes APP13 (IPTC) and APP14 (Adobe)", () => {
    expectStripped(
      jpeg(SOI, JFIF, IPTC, ADOBE, DQT, SOF0, DHT, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, SOF0, DHT, SCAN, EOI),
    );
  });

  it.each(
    [0xe1, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef].map(
      (marker) => [hex(marker), marker] as const,
    ),
  )("removes every application segment other than APP0 and APP2: marker %s", (_label, marker) => {
    expectStripped(
      jpeg(SOI, JFIF, segment(marker, [0x01, 0x02, 0x03]), DQT, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, SCAN, EOI),
    );
  });

  it("removes an application segment with no payload at all", () => {
    expectStripped(jpeg(SOI, segment(0xe1), SCAN, EOI), jpeg(SOI, SCAN, EOI));
  });

  it("removes a JFIF extension APP0 (JFXX), which the check alone refuses, and keeps the JFIF APP0", () => {
    const input = jpeg(SOI, JFIF, JFXX, DQT, SCAN, EOI);
    expect(checkJpegSegments(input)).toEqual({
      ok: false,
      reason: "forbidden-segment",
      marker: 0xffe0,
    });
    expectStripped(input, jpeg(SOI, JFIF, DQT, SCAN, EOI));
  });

  it.each<[string, number[]]>([
    ["with another identifier", [...ascii("AVI1"), 0x00, 0x00]],
    ["shorter than the JFIF identifier", JFIF_ID.slice(0, 4)],
    ["whose identifier lacks the closing NUL byte of JFIF", [...ascii("JFIF"), 0x20, 0x01, 0x01]],
  ])("removes an APP0 %s", (_label, payload) => {
    expectStripped(jpeg(SOI, segment(0xe0, payload), DQT, SCAN, EOI), jpeg(SOI, DQT, SCAN, EOI));
  });

  it.each<[string, number[]]>([
    ["holding the Multi-Picture Format index (MPF)", MPF.slice(4)],
    ["shorter than the ICC_PROFILE identifier", ICC_ID.slice(0, 11)],
    [
      "whose identifier lacks the closing NUL byte of ICC_PROFILE",
      [...ICC_ID.slice(0, 11), 0x20, 0x01, 0x01],
    ],
  ])("removes an APP2 %s", (_label, payload) => {
    expectStripped(
      jpeg(SOI, JFIF, segment(0xe2, payload), DQT, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, SCAN, EOI),
    );
  });

  it("removes a thumbnail JPEG inside an APP1 with its segment, by the segment's length", () => {
    expectStripped(
      jpeg(SOI, JFIF, EXIF_WITH_THUMBNAIL, DQT, SOF0, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, SOF0, SCAN, EOI),
    );
  });

  it("removes a segment of the longest length a segment can have", () => {
    const longest = segment(0xe1, new Array<number>(0xfffd).fill(0xd9));
    expectStripped(jpeg(SOI, JFIF, longest, DQT, SCAN, EOI), jpeg(SOI, JFIF, DQT, SCAN, EOI));
  });

  it("removes an APP1 and a comment between the scans of a progressive JPEG", () => {
    expectStripped(
      jpeg(SOI, JFIF, DQT, SOF2, DHT, SCAN, EXIF, DHT, COM, SCAN, RESTARTED, XMP, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, SOF2, DHT, SCAN, DHT, SCAN, RESTARTED, SCAN, EOI),
    );
  });

  it("removes segments after the last scan, before the end of the image", () => {
    expectStripped(
      jpeg(SOI, JFIF, DQT, SOF0, SCAN, RESTARTED, EXIF, COM, EOI),
      jpeg(SOI, JFIF, DQT, SOF0, SCAN, RESTARTED, EOI),
    );
  });

  it("removes several segments in a row and apart, and nothing else", () => {
    expectStripped(
      jpeg(SOI, COM, JFIF, EXIF, XMP, ICC, MPF, DQT, IPTC, SOF0, COM, DHT, ADOBE, SCAN, EOI),
      jpeg(SOI, JFIF, ICC, DQT, SOF0, DHT, SCAN, EOI),
    );
  });

  it("keeps the 0xFF fill bytes that stand before a removed segment", () => {
    expectStripped(
      jpeg(SOI, JFIF, [0xff, 0xff], EXIF, DQT, SCAN, [0xff], COM, EOI),
      jpeg(SOI, JFIF, [0xff, 0xff], DQT, SCAN, [0xff], EOI),
    );
  });
});

describe("stripJpegSegments: bytes after the end of the image", () => {
  it("removes one byte after EOI", () => {
    expectStripped(jpeg(SOI, JFIF, DQT, SCAN, EOI, [0x00]), jpeg(SOI, JFIF, DQT, SCAN, EOI));
  });

  it("removes a second image after EOI, which starts with SOI and holds an APP1", () => {
    const second = [...SOI, ...EXIF, ...DQT, ...SCAN, ...EOI];
    expectStripped(
      jpeg(SOI, JFIF, DQT, SOF0, SCAN, EOI, second),
      jpeg(SOI, JFIF, DQT, SOF0, SCAN, EOI),
    );
  });

  it("removes bytes after EOI whatever they are: fill bytes, a marker the check refuses, a cut-off segment", () => {
    const clean = jpeg(SOI, JFIF, DQT, SCAN, EOI);
    expectStripped(jpeg(SOI, JFIF, DQT, SCAN, EOI, [0xff, 0xff, 0xff]), clean);
    expectStripped(jpeg(SOI, JFIF, DQT, SCAN, EOI, segment(0xdc, [0x00, 0x10])), clean);
    expectStripped(jpeg(SOI, JFIF, DQT, SCAN, EOI, [0xff, 0xd0]), clean);
    expectStripped(jpeg(SOI, JFIF, DQT, SCAN, EOI, [0xff, 0xe1, 0x40, 0x00, 0x45]), clean);
  });

  it("takes the first EOI after a scan as the end of the image", () => {
    expectStripped(jpeg(SOI, DQT, SCAN, EOI, EOI), jpeg(SOI, DQT, SCAN, EOI));
  });

  it("removes segments and the bytes after EOI together: the output is the input less exactly those bytes", () => {
    expectStripped(
      jpeg(SOI, JFIF, EXIF, DQT, SOF0, COM, SCAN, RESTARTED, EOI, MPF, SOI, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, SOF0, SCAN, RESTARTED, EOI),
    );
  });
});

describe("stripJpegSegments: what it keeps", () => {
  it("gives back the same array for a JPEG with nothing to remove", () => {
    const input = jpeg(SOI, JFIF, ICC, DQT, SOF0, DHT, DRI, SCAN, RESTARTED, EOI);
    expect(stripJpegSegments(input)).toBe(input);
    expect(checkJpegSegments(input)).toEqual({ ok: true });
  });

  it("keeps APP0 as JFIF and APP2 as a colour profile in one chunk", () => {
    expectStripped(
      jpeg(SOI, JFIF, EXIF, ICC, COM, DQT, SOF0, SCAN, EOI),
      jpeg(SOI, JFIF, ICC, DQT, SOF0, SCAN, EOI),
    );
  });

  it("keeps a colour profile in several APP2 chunks, each as it is and in order", () => {
    expectStripped(
      jpeg(SOI, JFIF, EXIF, ICC_1_OF_3, ICC_2_OF_3, MPF, ICC_3_OF_3, DQT, SOF0, SCAN, EOI),
      jpeg(SOI, JFIF, ICC_1_OF_3, ICC_2_OF_3, ICC_3_OF_3, DQT, SOF0, SCAN, EOI),
    );
  });

  it("keeps an APP0 and an APP2 that hold exactly their identifier, as the check passes them", () => {
    expectStripped(
      jpeg(SOI, segment(0xe0, JFIF_ID), segment(0xe2, ICC_ID), COM, SCAN, EOI),
      jpeg(SOI, segment(0xe0, JFIF_ID), segment(0xe2, ICC_ID), SCAN, EOI),
    );
  });

  it("keeps entropy-coded data with 0xFF00 stuffing and RST0 to RST7 inside the scan byte for byte", () => {
    expectStripped(
      jpeg(SOI, JFIF, EXIF, DQT, SOF0, DHT, DRI, SOS, RESTARTED, COM, EOI),
      jpeg(SOI, JFIF, DQT, SOF0, DHT, DRI, SOS, RESTARTED, EOI),
    );
  });

  it("keeps a progressive JPEG with two scans, and the table between them", () => {
    expectStripped(
      jpeg(SOI, JFIF, EXIF, DQT, SOF2, DHT, SOS, RESTARTED, DHT, SCAN, EOI, [0x00]),
      jpeg(SOI, JFIF, DQT, SOF2, DHT, SOS, RESTARTED, DHT, SCAN, EOI),
    );
  });

  it("keeps the 0xFF fill bytes before a kept marker and before the marker that ends a scan", () => {
    expectStripped(
      jpeg(SOI, [0xff, 0xff], JFIF, EXIF, [0xff], DQT, SCAN, [0xff, 0xff, 0xff], EOI),
      jpeg(SOI, [0xff, 0xff], JFIF, [0xff], DQT, SCAN, [0xff, 0xff, 0xff], EOI),
    );
  });

  it.each(
    [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].map(
      (marker) => [hex(marker), marker] as const,
    ),
  )("keeps the frame marker SOFn %s", (_label, marker) => {
    const frame = segment(marker, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]);
    expectStripped(
      jpeg(SOI, JFIF, EXIF, DQT, frame, DHT, SCAN, EOI),
      jpeg(SOI, JFIF, DQT, frame, DHT, SCAN, EOI),
    );
  });

  it("keeps DQT, DHT, DAC and DRI with whatever they hold, marker bytes too", () => {
    const table = segment(0xdb, [0xff, 0xe1, 0x00, 0x02, 0xff, 0xd9]);
    expectStripped(
      jpeg(SOI, COM, table, DHT, DAC, DRI, SCAN, EOI),
      jpeg(SOI, table, DHT, DAC, DRI, SCAN, EOI),
    );
  });

  it("reads a Uint8Array view onto part of a larger buffer, and only the view", () => {
    const image = jpeg(SOI, JFIF, EXIF, DQT, SCAN, EOI);
    const backing = jpeg(COM, Array.from(image), EXIF);
    const view = new Uint8Array(backing.buffer, COM.length, image.length);
    expectStripped(view, jpeg(SOI, JFIF, DQT, SCAN, EOI));
  });

  it("gives back the same array when it is run again on its own output", () => {
    const once = stripJpegSegments(jpeg(SOI, JFIF, EXIF, DQT, SCAN, EOI, [0x00]));
    expect(stripJpegSegments(once)).toBe(once);
  });
});

describe("stripJpegSegments: a JPEG that is not structurally sound is passed on unchanged, and the check fails it", () => {
  it.each<[string, Uint8Array]>([
    ["an empty array", new Uint8Array(0)],
    ["a single byte", Uint8Array.from([0xff])],
    ["a PNG signature", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ["bytes that start with EOI, with an APP1 after it", jpeg(EOI, EXIF, SCAN, EOI)],
  ])("not a JPEG: %s", (_label, input) => {
    expectUnchanged(input, "not-jpeg", null);
  });

  it.each<[string, unknown]>([
    ["undefined", undefined],
    ["null", null],
    ["a string", "\xff\xd8\xff\xe1"],
    ["an array of numbers", [...SOI, ...EXIF, ...SCAN, ...EOI]],
    ["an ArrayBuffer", new ArrayBuffer(8)],
  ])("not bytes: %s comes back as it is, without throwing", (_label, input) => {
    expect(stripJpegSegments(input as Uint8Array)).toBe(input);
    expect(checkJpegSegments(input)).toEqual({ ok: false, reason: "invalid-input", marker: null });
  });

  it.each<[string, Uint8Array, JpegSegmentFailure, number | null]>([
    ["SOI alone", jpeg(SOI), "truncated", null],
    ["no scan and no EOI after an APP1", jpeg(SOI, JFIF, EXIF, DQT), "forbidden-segment", 0xffe1],
    ["no scan and no EOI after a comment", jpeg(SOI, JFIF, DQT, COM), "forbidden-segment", 0xfffe],
    ["a scan with no EOI", jpeg(SOI, JFIF, EXIF, DQT, SCAN), "forbidden-segment", 0xffe1],
    ["a scan with no EOI, nothing else", jpeg(SOI, JFIF, DQT, SCAN), "truncated", null],
    [
      "a scan that ends inside 0xFF fill bytes",
      jpeg(SOI, COM, SCAN, [0xff, 0xff]),
      "forbidden-segment",
      0xfffe,
    ],
    [
      "a removed segment after the last scan, with no EOI",
      jpeg(SOI, JFIF, DQT, SCAN, EXIF),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "the end inside fill bytes before a marker",
      jpeg(SOI, EXIF, [0xff, 0xff]),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "the end after an APP1 marker, before its length",
      jpeg(SOI, JFIF, [0xff, 0xe1]),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "the end inside the length of a comment",
      jpeg(SOI, JFIF, [0xff, 0xfe, 0x00]),
      "forbidden-segment",
      0xfffe,
    ],
    [
      "the end inside the length of a table, after an APP1",
      jpeg(SOI, EXIF, [0xff, 0xdb, 0x00]),
      "forbidden-segment",
      0xffe1,
    ],
  ])("cut short: %s", (_label, input, reason, marker) => {
    expectUnchanged(input, reason, marker);
  });

  it.each<[string, Uint8Array, JpegSegmentFailure, number | null]>([
    [
      "an APP1 cut off inside its payload",
      jpeg(SOI, JFIF, [0xff, 0xe1, 0x00, 0x40, 0x45, 0x78]),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "an APP1 that claims more than the rest of a whole JPEG",
      jpeg(SOI, JFIF, [0xff, 0xe1, 0x40, 0x00, 0x45, 0x78], DQT, SCAN, EOI),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "an APP1 that claims one byte more than there is",
      jpeg(SOI, JFIF, DQT, SCAN, [0xff, 0xe1, 0x00, 0x05, 0x45, 0x78]),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "a comment cut off inside its payload",
      jpeg(SOI, [0xff, 0xfe, 0x00, 0x10, 0x68]),
      "forbidden-segment",
      0xfffe,
    ],
    [
      "an APP0 cut off inside its payload",
      jpeg(SOI, [0xff, 0xe0, 0x00, 0x40, 0x4a, 0x46]),
      "truncated",
      0xffe0,
    ],
    [
      "a table cut off inside its payload, after an APP1",
      jpeg(SOI, EXIF, [0xff, 0xdb, 0x00, 0x43, 0x00]),
      "forbidden-segment",
      0xffe1,
    ],
    [
      "a start-of-scan header cut off, after a comment",
      jpeg(SOI, JFIF, COM, [0xff, 0xda, 0x00, 0x0c, 0x01]),
      "forbidden-segment",
      0xfffe,
    ],
  ])("a segment whose length runs past the end: %s", (_label, input, reason, marker) => {
    expectUnchanged(input, reason, marker);
  });

  it.each([0, 1])("an APP1 with a length of %i, below the two bytes it counts", (length) => {
    expectUnchanged(
      jpeg(SOI, JFIF, [0xff, 0xe1, 0x00, length], DQT, SCAN, EOI),
      "forbidden-segment",
      0xffe1,
    );
  });

  it.each([0, 1])("a comment with a length of %i", (length) => {
    expectUnchanged(
      jpeg(SOI, JFIF, [0xff, 0xfe, 0x00, length], DQT, SCAN, EOI),
      "forbidden-segment",
      0xfffe,
    );
  });

  it.each([0, 1])("an APP0 with a length of %i", (length) => {
    expectUnchanged(jpeg(SOI, [0xff, 0xe0, 0x00, length], DQT, SCAN, EOI), "malformed", 0xffe0);
  });

  it.each([0, 1])("a table with a length of %i, after an APP1 that would be removed", (length) => {
    expectUnchanged(
      jpeg(SOI, JFIF, EXIF, [0xff, 0xdb, 0x00, length], SCAN, EOI),
      "forbidden-segment",
      0xffe1,
    );
  });

  it.each([0, 1])(
    "a start-of-scan header with a length of %i, after an APP1 that would be removed",
    (length) => {
      expectUnchanged(
        jpeg(SOI, JFIF, EXIF, DQT, [0xff, 0xda, 0x00, length], [0x12, 0x34], EOI),
        "forbidden-segment",
        0xffe1,
      );
      expectUnchanged(
        jpeg(SOI, JFIF, DQT, [0xff, 0xda, 0x00, length], [0x12, 0x34], COM, EOI, [0x00]),
        "malformed",
        0xffda,
      );
    },
  );

  it("an APP1 whose length is shorter than what it holds, so that no marker follows it", () => {
    const lying = [0xff, 0xe1, 0x00, 0x04, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    expectUnchanged(jpeg(SOI, JFIF, lying, DQT, SCAN, EOI), "forbidden-segment", 0xffe1);
  });

  it("a byte other than 0xFF where a marker should start, after an APP1 before the scan", () => {
    expectUnchanged(jpeg(SOI, JFIF, EXIF, [0x00], DQT, SCAN, EOI), "forbidden-segment", 0xffe1);
  });

  it("a second SOI, after a comment", () => {
    expectUnchanged(jpeg(SOI, COM, SOI, SCAN, EOI), "forbidden-segment", 0xfffe);
    expectUnchanged(jpeg(SOI, JFIF, SOI, EXIF, SCAN, EOI), "malformed", 0xffd8);
  });

  it("EOI before any scan, an image with no SOS", () => {
    expectUnchanged(jpeg(SOI, JFIF, EXIF, DQT, EOI), "forbidden-segment", 0xffe1);
    expectUnchanged(jpeg(SOI, JFIF, DQT, EOI, EXIF), "malformed", 0xffd9);
  });

  it("0xFF00 outside the entropy-coded data, before the scan", () => {
    expectUnchanged(jpeg(SOI, EXIF, [0xff, 0x00], SCAN, EOI), "forbidden-segment", 0xffe1);
  });
});

describe("stripJpegSegments: removing a segment never turns what follows it into scan data", () => {
  /** The check passes these bytes: what a strip that only cut the segment out would give. */
  function expectLaundered(withoutTheSegment: Uint8Array): void {
    expect(checkJpegSegments(withoutTheSegment)).toEqual({ ok: true });
  }

  it("bytes that are not a marker after an APP1 that follows a scan: SOI SOS scan APP1 33 44 EOI is not sound", () => {
    expectLaundered(jpeg(SOI, SCAN, [0x33, 0x44], EOI));
    expectUnchanged(jpeg(SOI, SCAN, EXIF, [0x33, 0x44], EOI), "forbidden-segment", 0xffe1);
  });

  it("the sound variant, SOI SOS scan APP1 EOI: the APP1 is removed", () => {
    expectStripped(jpeg(SOI, SCAN, EXIF, EOI), jpeg(SOI, SCAN, EOI));
  });

  it("the sound variant with 33 44 as the APP1's payload: the APP1 is removed", () => {
    expectStripped(jpeg(SOI, SCAN, segment(0xe1, [0x33, 0x44]), EOI), jpeg(SOI, SCAN, EOI));
  });

  it("the variant with 33 44 as the APP1's length, which runs past the end: not sound", () => {
    expectUnchanged(jpeg(SOI, SCAN, [0xff, 0xe1, 0x33, 0x44], EOI), "forbidden-segment", 0xffe1);
  });

  it("0xFF00 after a comment that follows a scan would become stuffing: not sound", () => {
    expectLaundered(jpeg(SOI, SCAN, [0xff, 0x00, 0x12], EOI));
    expectUnchanged(jpeg(SOI, SCAN, COM, [0xff, 0x00, 0x12], EOI), "forbidden-segment", 0xfffe);
  });

  it("a restart marker before the first scan, SOI RST0 SOS scan EOI: unchanged, and the check fails it", () => {
    expectUnchanged(jpeg(SOI, [0xff, 0xd0], SCAN, EOI), "forbidden-segment", 0xffd0);
  });

  it("a restart marker after a comment that follows a scan, SOI SOS scan COM RST3 SOS scan EOI: unchanged, and the check fails it", () => {
    expectLaundered(jpeg(SOI, SCAN, [0xff, 0xd3], SCAN, EOI));
    expectUnchanged(jpeg(SOI, SCAN, COM, [0xff, 0xd3], SCAN, EOI), "forbidden-segment", 0xfffe);
  });

  it("a restart marker after an APP1 that follows the last scan, SOI SOS scan APP1 RST0 EOI: unchanged, and the check fails it", () => {
    expectLaundered(jpeg(SOI, SCAN, [0xff, 0xd0], EOI));
    expectUnchanged(jpeg(SOI, SCAN, EXIF, [0xff, 0xd0], EOI), "forbidden-segment", 0xffe1);
  });

  it.each(
    [0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7].map(
      (marker) => [hex(marker), marker] as const,
    ),
  )(
    "the restart marker %s after two removed segments and fill bytes that follow a scan",
    (_label, marker) => {
      expectUnchanged(
        jpeg(SOI, JFIF, DQT, SCAN, EXIF, COM, [0xff, 0xff, 0xff, marker], SCAN, EOI),
        "forbidden-segment",
        0xffe1,
      );
    },
  );
});

describe("stripJpegSegments: a marker the check refuses that is neither APPn nor a comment is not removed", () => {
  const REFUSED: [string, number][] = [
    ["JPG", 0xc8],
    ["DNL", 0xdc],
    ["DHP", 0xde],
    ["EXP", 0xdf],
    ["JPG0", 0xf0],
    ["JPG1", 0xf1],
    ["JPG2", 0xf2],
    ["JPG3", 0xf3],
    ["JPG4", 0xf4],
    ["JPG5", 0xf5],
    ["JPG6", 0xf6],
    ["JPG7", 0xf7],
    ["JPG8", 0xf8],
    ["JPG9", 0xf9],
    ["JPG10", 0xfa],
    ["JPG11", 0xfb],
    ["JPG12", 0xfc],
    ["JPG13", 0xfd],
    ["reserved", 0x02],
    ["reserved", 0x4f],
    ["reserved", 0xbf],
  ];
  const cases = REFUSED.map(([name, marker]) => [`${name} ${hex(marker)}`, marker] as const);

  it.each(cases)("%s before the scan: unchanged, and the check fails it", (_label, marker) => {
    expectUnchanged(
      jpeg(SOI, JFIF, segment(marker, [0x00, 0x00]), DQT, SCAN, EOI),
      "forbidden-segment",
      0xff00 | marker,
    );
  });

  it.each(cases)(
    "%s in a JPEG that also holds an APP1, a comment and bytes after EOI: nothing is removed",
    (_label, marker) => {
      const refused = segment(marker, [0x00, 0x00]);
      expectUnchanged(
        jpeg(SOI, JFIF, refused, EXIF, DQT, SCAN, COM, EOI, [0x00]),
        "forbidden-segment",
        0xff00 | marker,
      );
      expectUnchanged(
        jpeg(SOI, JFIF, EXIF, DQT, SCAN, COM, refused, EOI, [0x00]),
        "forbidden-segment",
        0xffe1,
      );
    },
  );

  it("TEM, a marker with no length: unchanged", () => {
    expectUnchanged(jpeg(SOI, [0xff, 0x01], JFIF, EXIF, SCAN, EOI), "forbidden-segment", 0xff01);
    expectUnchanged(jpeg(SOI, JFIF, EXIF, [0xff, 0x01], SCAN, EOI), "forbidden-segment", 0xffe1);
  });

  it("DNL where it would stand, after the first scan: unchanged", () => {
    expectUnchanged(
      jpeg(SOI, JFIF, SOF0, SCAN, segment(0xdc, [0x00, 0x10]), EOI, [0x00]),
      "forbidden-segment",
      0xffdc,
    );
  });

  it.each([0xd0, 0xd3, 0xd7].map((marker) => [hex(marker), marker] as const))(
    "the restart marker %s outside a scan, with an APP1 before it: unchanged",
    (_label, marker) => {
      expectUnchanged(
        jpeg(SOI, JFIF, EXIF, [0xff, marker], SCAN, EOI),
        "forbidden-segment",
        0xffe1,
      );
    },
  );
});

/**
 * A small seeded generator (the xorshift steps 13, 17 and 5 on 32 bits, written here), so that a
 * failing case can be run again from its seed.
 */
function generator(seed: number) {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  return {
    int,
    chance: (probability: number): boolean => next() < probability,
    bytes: (count: number): number[] => Array.from({ length: count }, () => int(0, 255)),
  };
}

type Generator = ReturnType<typeof generator>;

function fill(random: Generator): number[] {
  return random.chance(0.2) ? new Array<number>(random.int(1, 3)).fill(0xff) : [];
}

/** Entropy-coded data: any bytes, each 0xFF followed by a stuffed zero or a restart marker. */
function entropy(random: Generator): number[] {
  const data: number[] = [];
  const count = random.int(0, 40);
  for (let index = 0; index < count; index += 1) {
    const value = random.chance(0.25) ? 0xff : random.int(0, 254);
    data.push(value);
    if (value === 0xff) {
      data.push(random.chance(0.5) ? 0x00 : random.int(0xd0, 0xd7));
    }
  }
  return data;
}

/**
 * A sound JPEG with nothing the strip removes, as its units in order: SOI, then each segment (a
 * scan with its data), then EOI, some with fill bytes before them. Baseline with one scan or
 * progressive with several.
 */
function soundJpeg(random: Generator): number[][] {
  const units: number[][] = [SOI];
  const add = (unit: number[]) => units.push([...fill(random), ...unit]);
  if (random.chance(0.8)) {
    add(JFIF);
  }
  const chunks = random.int(0, 3);
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    add(segment(0xe2, [...ICC_ID, chunk, chunks, ...random.bytes(random.int(0, 30))]));
  }
  add(segment(0xdb, random.bytes(65)));
  const progressive = random.chance(0.5);
  add(segment(progressive ? 0xc2 : 0xc0, [0x08, ...random.bytes(5), 0x01, 0x01, 0x11, 0x00]));
  if (random.chance(0.4)) {
    add(DRI);
  }
  const scans = progressive ? random.int(2, 4) : 1;
  for (let scan = 0; scan < scans; scan += 1) {
    add(segment(0xc4, random.bytes(random.int(3, 30))));
    add([...SOS, ...entropy(random)]);
  }
  add(EOI);
  return units;
}

/** A segment the strip removes, with any payload, marker bytes and whole JPEGs among them. */
function removable(random: Generator): number[] {
  const payload = random.chance(0.2)
    ? [...SOI, ...EXIF, ...SCAN, ...EOI, ...random.bytes(random.int(0, 10))]
    : random.bytes(random.int(0, 40));
  switch (random.int(0, 4)) {
    case 0:
      return segment(0xfe, payload);
    case 1:
      // APP0 that is not JFIF: its first byte is not "J".
      return segment(0xe0, [0x58, ...payload]);
    case 2:
      // APP2 that is not a colour profile: its first byte is not "I".
      return segment(0xe2, [0x4d, ...payload]);
    case 3:
      return segment(0xe1, payload);
    default:
      return segment(0xe3 + random.int(0, 12), payload);
  }
}

/**
 * `units` with one to three removable segments put before the unit `gap`, each after fill bytes
 * of its own or none, and what the strip must make of it: the fill bytes stay, the segments go.
 */
function insertedAt(
  units: number[][],
  gaps: (gap: number) => boolean,
  random: Generator,
): { input: number[]; expected: number[] } {
  const input: number[] = [];
  const expected: number[] = [];
  units.forEach((unit, index) => {
    if (index > 0 && gaps(index)) {
      const count = random.int(1, 3);
      for (let each = 0; each < count; each += 1) {
        const before = fill(random);
        input.push(...before, ...removable(random));
        expected.push(...before);
      }
    }
    input.push(...unit);
    expected.push(...unit);
  });
  return { input, expected };
}

/** Bytes as hex digits, to name a failing case. */
function hexOf(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

const SEEDS = Array.from({ length: 120 }, (_, index) => index + 1);

describe("stripJpegSegments: strip then check, on generated JPEGs", () => {
  it("passes the check and leaves every other byte as it was, with removable segments at each legal position in turn", () => {
    let cases = 0;
    for (const seed of SEEDS) {
      const random = generator(seed);
      const units = soundJpeg(random);
      expect(checkJpegSegments(Uint8Array.from(units.flat()))).toEqual({ ok: true });
      for (let gap = 1; gap < units.length; gap += 1) {
        const { input, expected } = insertedAt(units, (index) => index === gap, random);
        const output = stripJpegSegments(Uint8Array.from(input));
        if (
          output.length !== expected.length ||
          expected.some((value, index) => output[index] !== value) ||
          !checkJpegSegments(output).ok
        ) {
          throw new Error(`seed ${seed}, gap ${gap}: ${hexOf(input)}`);
        }
        cases += 1;
      }
    }
    expect(cases).toBeGreaterThan(SEEDS.length * 6);
  });

  it("does the same with removable segments at every legal position at once and bytes after EOI", () => {
    for (const seed of SEEDS) {
      const random = generator(seed + 1000);
      const units = soundJpeg(random);
      const { input, expected } = insertedAt(units, () => true, random);
      const trailing = random.chance(0.5)
        ? soundJpeg(random).flat()
        : random.bytes(random.int(1, 20));
      const output = stripJpegSegments(Uint8Array.from([...input, ...trailing]));
      expect(`${seed}: ${hexOf(output)}`).toBe(`${seed}: ${hexOf(expected)}`);
      expect(checkJpegSegments(output)).toEqual({ ok: true });
    }
  });

  it("passes on unchanged a generated JPEG that holds, after a removable segment, something the strip does not remove", () => {
    const refused: number[][] = [
      [0xff, 0xd0],
      [0xff, 0xd7],
      [0xff, 0x00],
      [0xff, 0x01],
      [0x33, 0x44],
      SOI,
      segment(0xdc, [0x00, 0x10]),
      segment(0xc8, [0x00]),
      segment(0xf7, [0x00]),
      segment(0xde, [0x00]),
      segment(0xdf, [0x00]),
      segment(0x02, [0x00]),
    ];
    for (const seed of SEEDS) {
      const random = generator(seed + 2000);
      const units = soundJpeg(random);
      const gap = random.int(1, units.length - 1);
      const bad = refused[random.int(0, refused.length - 1)] as number[];
      const withBad = units.map((unit, index) =>
        index === gap ? [...removable(random), ...bad, ...unit] : unit,
      );
      const { input } = insertedAt(withBad, () => random.chance(0.5), random);
      const bytes = Uint8Array.from(input);
      if (stripJpegSegments(bytes) !== bytes || checkJpegSegments(bytes).ok) {
        throw new Error(`seed ${seed}, gap ${gap}: ${hexOf(input)}`);
      }
    }
  });

  it("gives, for damaged JPEGs, either the input itself or bytes the check passes, and never throws", () => {
    let changed = 0;
    for (const seed of SEEDS) {
      const random = generator(seed + 3000);
      const { input } = insertedAt(soundJpeg(random), () => random.chance(0.6), random);
      for (let round = 0; round < 25; round += 1) {
        const damaged = [...input];
        const kind = random.int(0, 3);
        if (kind === 0) {
          damaged.length = random.int(0, damaged.length);
        } else if (kind === 1) {
          damaged.splice(random.int(0, damaged.length - 1), random.int(1, 6));
        } else {
          const flips = random.int(1, 3);
          for (let flip = 0; flip < flips; flip += 1) {
            damaged[random.int(0, damaged.length - 1)] = [0xff, 0x00, 0xd0, 0xd9, 0xe1, 0xda][
              random.int(0, 5)
            ] as number;
          }
        }
        const bytes = Uint8Array.from(damaged);
        const passedBefore = checkJpegSegments(bytes).ok;
        const output = stripJpegSegments(bytes);
        if (output !== bytes) {
          changed += 1;
        }
        if (
          (output !== bytes && !checkJpegSegments(output).ok) ||
          (passedBefore && output !== bytes)
        ) {
          throw new Error(`seed ${seed}, round ${round}: ${hexOf(damaged)}`);
        }
      }
    }
    expect(changed).toBeGreaterThan(100);
  });
});
