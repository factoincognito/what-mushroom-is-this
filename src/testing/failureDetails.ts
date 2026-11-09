/**
 * Failed finds as the app really stores them, for the tests of how a failure is shown: the
 * details come from the modules that write them, so that a change of their form breaks a test.
 *
 * - The photo's failures (`segment-check`, `photo`) come from `preparePhotoForAnalysis`, given an
 *   encoder that stands in for the phone's. The function is passed in, because a screen test
 *   mocks the module and passes the actual one.
 * - The answer's and the request's failures (`request`, `answer`, `refused`) come from the queue
 *   analysing a find, with the answer classified by `classifyOutcome`.
 */

import { classifyOutcome, type Outcome } from "../analysis/errors";
import type { JpegEncoder, preparePhotoForAnalysis } from "../image/prepareForAnalysis";
import { AnalysisQueue } from "../queue/queue";
import type { FindFailure } from "../store/find";
import { memoryFindLog } from "./memoryFindLog";

/** One JPEG marker segment: 0xFF, the marker byte, a length that counts itself, the payload. */
export function segment(marker: number, payload: number[] = []): number[] {
  const length = payload.length + 2;
  return [0xff, marker, (length >> 8) & 0xff, length & 0xff, ...payload];
}

/** The parts of a JPEG, and the segments the segment check refuses. */
export const JPEG = {
  SOI: [0xff, 0xd8],
  EOI: [0xff, 0xd9],
  JFIF: segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01]),
  DQT: segment(0xdb, [0x00, 0x01, 0x02, 0x03]),
  SOF0: segment(0xc0, [0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00]),
  SCAN: [...segment(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), 0x12, 0x34, 0xff, 0x00, 0x56],
  /** APP1 with "Exif\0\0". */
  EXIF: segment(0xe1, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]),
  /** APP0 with "JFXX\0", the JFIF extension. */
  JFXX: segment(0xe0, [0x4a, 0x46, 0x58, 0x58, 0x00, 0x10]),
  /** APP2 with "MPF\0", the Multi-Picture Format index. */
  MPF: segment(0xe2, [0x4d, 0x50, 0x46, 0x00]),
  /** APP13, where IPTC data is kept. */
  IPTC: segment(0xed, [0x50, 0x68, 0x6f, 0x74, 0x6f]),
  /** APP5, an application segment the check names by its number only. */
  APP5: segment(0xe5, [0x01]),
  /** A comment. */
  COM: segment(0xfe, [0x68, 0x69]),
  /** DNL, a marker that is not an application segment. */
  DNL: segment(0xdc, [0x00, 0x10]),
} as const;

/** The bytes of the parts, in order. */
export function jpeg(...parts: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

/** A JPEG that passes the check but for the parts put before its quantisation table. */
export function jpegWith(...extra: readonly (readonly number[])[]): Uint8Array {
  return jpeg(JPEG.SOI, JPEG.JFIF, ...extra, JPEG.DQT, JPEG.SOF0, JPEG.SCAN, JPEG.EOI);
}

/** An encoder that loads a photo of the size given and encodes it as the bytes given. */
export function encoderOf(bytes: Uint8Array, width = 4032, height = 3024): JpegEncoder {
  return {
    async load() {
      return {
        width,
        height,
        encodeJpeg: async () => bytes,
        release: () => undefined,
      };
    },
  };
}

/** An encoder that cannot load the photo, with the error given. */
export function unloadableEncoder(error: Error): JpegEncoder {
  return {
    async load() {
      throw error;
    },
  };
}

/** The failure `prepare` stores for a photo the encoder gives; it must fail. */
export async function photoFailure(
  prepare: typeof preparePhotoForAnalysis,
  encoder: JpegEncoder,
): Promise<FindFailure> {
  const prepared = await prepare("file:///data/photos/p1.jpg", "claude-opus-5-5", encoder);
  if (prepared.ok) {
    throw new Error("the photo was prepared; no failure to give");
  }
  return prepared.failure;
}

/** The body of a Messages API answer. */
export function messageBody(content: unknown[], stopReason = "end_turn"): string {
  return JSON.stringify({ type: "message", content, stop_reason: stopReason });
}

/** The failure the queue stores for a find whose analysis came back as `outcome`; it must fail. */
export async function analysisFailure(outcome: Outcome): Promise<FindFailure> {
  const log = memoryFindLog();
  log.finds.set(1, {
    id: 1,
    photoUri: "file:///data/photos/p1.jpg",
    time: { takenAtMs: 0, utcOffsetMinutes: 0, source: "saved" },
    position: null,
    analysis: { state: "waiting" },
  });
  const queue = new AnalysisQueue(
    {
      findLog: async () => log,
      readKey: async () => ({ ok: true, key: "sk-ant-api03-test" }),
      readModelId: async () => "claude-opus-5-5",
      preparePhoto: async () => ({ ok: true, imageBase64: "AAAA", width: 1, height: 1 }),
      analyse: async () => classifyOutcome(outcome, 0),
      now: () => 0,
      schedule: () => () => undefined,
    },
    { apiAddress: "https://api.anthropic.com/v1/messages", timeLimitMs: 60_000 },
  );
  await queue.analyseFind(1);
  queue.dispose();
  const analysis = log.finds.get(1)?.analysis;
  if (analysis?.state !== "failed") {
    throw new Error("the find did not fail; no failure to give");
  }
  return analysis.failure;
}

/** An HTTP answer with a status and a body, as `classifyOutcome` takes it. */
export function http(status: number, body: string): Outcome {
  return { kind: "http", status, body, retryAfter: null };
}
