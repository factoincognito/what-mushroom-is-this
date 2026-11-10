/**
 * The queue's messages in plain words (docs/SPEC.md 3.3): one for each error class and stop, in the
 * app's language.
 */

import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
import type { JpegSegmentFailure } from "../image/jpegSegments";
import type { FindFailure } from "../store/find";
import type { QueueNotice, QueueStop } from "./queue";

/** Formats a time, ms since the epoch, for a message. */
export type FormatTime = (ms: number) => string;

/** The phone's local date and time in the language, for example "1 Dec 2026, 01:00". */
export function formatTimeIn(language: Language): FormatTime {
  const format = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
  return (ms) => format.format(ms);
}

/** Fills the `{name}` placeholders of a string. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/**
 * What a lookup analysed: a photo, or for a lookup without photos its description (docs/SPEC.md
 * 3.9), which some messages name in place of the photo.
 */
export type LookupSubject = "photo" | "described";

export function noticeMessage(
  notice: QueueNotice,
  strings: Strings,
  formatTime: FormatTime,
  subject: LookupSubject = "photo",
): string {
  const t = strings.queue;
  switch (notice.kind) {
    case "paused":
      return {
        network: t.paused.network,
        "time-out": t.paused.timeOut,
        server: t.paused.server,
        "picture-source": t.paused.pictureSource,
      }[notice.cause];
    case "stopped":
      return stopMessage(notice.stop, strings, formatTime);
    case "find-failed":
      return failureMessage(notice.failure, strings, subject);
  }
}

function stopMessage(stop: QueueStop, strings: Strings, formatTime: FormatTime): string {
  const t = strings.queue.stopped;
  switch (stop.reason) {
    case "rate-limited":
      if (stop.retryAtMs !== null) {
        return fill(t.rateLimitedUntil, { time: formatTime(stop.retryAtMs) });
      }
      if (stop.accessResumesAtMs !== null) {
        return fill(t.spendLimitUntil, { time: formatTime(stop.accessResumesAtMs) });
      }
      return t.rateLimited;
    case "no-key":
      return t.noKey;
    case "key-refused":
      return t.keyRefused;
    case "key-not-scoped":
      return t.keyNotScoped;
    case "no-credit":
      return t.noCredit;
    case "model-unknown":
      return t.modelUnknown;
    case "answer":
      return t.answer;
    case "internal-error":
      return t.internalError;
    case "other":
      return fill(t.other, { status: String(stop.status) });
  }
}

/**
 * Why a find failed, in plain words (docs/SPEC.md 3.3; the review of #24, fix 1). The stored
 * detail is read for its form, as the modules that write it give it, and each form has its own
 * sentence; nothing of the detail itself is shown, so no code, marker number, status, native
 * message or file path reaches the user. A form the app does not know gets the cause's general
 * sentence. Details already stored in these forms are read the same way. For a lookup without
 * photos, a refusal names the description, not the photo (PBI-2.4). A photo's failure on a find
 * with several photos names the photo: its detail is `photo <n>: <detail>` (`queue.ts`), and the
 * message gives the number and the sentence of the rest (docs/SPEC.md 3.9, Batches; PBI-2.5).
 */
export function failureMessage(
  failure: FindFailure,
  strings: Strings,
  subject: LookupSubject = "photo",
): string {
  const t = strings.queue.failed;
  const { detail } = failure;
  const numbered = NUMBERED_PHOTO.exec(detail);
  if (
    numbered !== null &&
    (failure.cause === "photo" || failure.cause === "segment-check") &&
    numbered[1] !== undefined &&
    numbered[2] !== undefined
  ) {
    const reason = failureMessage({ cause: failure.cause, detail: numbered[2] }, strings, subject);
    return fill(t.numbered, { number: numbered[1], reason });
  }
  switch (failure.cause) {
    case "segment-check":
      return segmentCheckMessage(detail, t.segmentCheck);
    case "photo":
      // `prepareForAnalysis.ts`: "load-failed", "load-failed: <the encoder's message>",
      // "invalid-size: <what>".
      if (detail === "load-failed" || detail.startsWith("load-failed: ")) {
        return t.photo.loadFailed;
      }
      return detail.startsWith("invalid-size: ") ? t.photo.invalidSize : t.photo.unknown;
    case "request":
      // `queue.ts`: "<reason> (status <status>)".
      if (REQUEST_WRONG.test(detail)) {
        return t.request.wrong;
      }
      return REQUEST_TOO_LARGE.test(detail) ? t.request.tooLarge : t.request.unknown;
    case "answer":
      // `answer.ts`: the not-API detail, a cut-off answer's, and the shape's many details.
      if (detail === NOT_API_DETAIL) {
        return t.answer.notApi;
      }
      return CUT_OFF.test(detail) ? t.answer.cutOff : t.answer.shape;
    case "refused":
      return subject === "described" ? t.refusedDescribed : t.refused;
  }
}

/** `queue.ts`: a photo's failure on a find with several photos, numbered from 1. */
const NUMBERED_PHOTO = /^photo ([1-9][0-9]*): (.+)$/s;
const REQUEST_WRONG = /^request-wrong \(status \d+\)$/;
const REQUEST_TOO_LARGE = /^request-too-large \(status \d+\)$/;
/** `readMessageBody`'s detail for a body that is not a Messages API message. */
const NOT_API_DETAIL = "the body is not a Messages API message";
/** `readMessageBody`'s detail for a cut-off answer, with its `stop_reason`. */
const CUT_OFF = /^the answer was cut off \(stop_reason [a-z_]+\)$/;
/** `prepareForAnalysis.ts`: "<reason>" or "<reason> 0xFFxx", the reason the segment check's. */
const SEGMENT_DETAIL = /^([a-z-]+)(?: 0x([0-9A-F]{4}))?$/;

const APP0 = 0xffe0;
const APP15 = 0xffef;
const COM = 0xfffe;

type SegmentStrings = Strings["queue"]["failed"]["segmentCheck"];

function segmentCheckMessage(detail: string, t: SegmentStrings): string {
  const match = SEGMENT_DETAIL.exec(detail);
  const reason = match?.[1];
  if (reason === undefined || !isSegmentFailure(reason)) {
    return t.unknown;
  }
  const hex = match?.[2];
  const marker = hex === undefined ? null : Number.parseInt(hex, 16);
  switch (reason) {
    case "forbidden-segment":
      return marker === null ? t.unknown : forbiddenMarkerMessage(marker, t);
    case "trailing-data":
      return t.trailingData;
    case "truncated":
      return t.truncated;
    case "malformed":
      return t.malformed;
    case "not-jpeg":
      return t.notJpeg;
    case "invalid-input":
      return t.invalidInput;
  }
}

/** The marker the check refused, in words: the segments that carry metadata by name. */
function forbiddenMarkerMessage(marker: number, t: SegmentStrings): string {
  if (marker === APP0) {
    return t.app0;
  }
  if (marker === APP0 + 1) {
    return t.app1;
  }
  if (marker === APP0 + 2) {
    return t.app2;
  }
  if (marker === APP0 + 13) {
    return t.app13;
  }
  if (marker > APP0 + 2 && marker <= APP15) {
    return fill(t.otherApp, { number: String(marker - APP0) });
  }
  return marker === COM ? t.comment : t.otherMarker;
}

const SEGMENT_FAILURES: readonly JpegSegmentFailure[] = [
  "invalid-input",
  "not-jpeg",
  "truncated",
  "malformed",
  "forbidden-segment",
  "trailing-data",
];

function isSegmentFailure(value: string): value is JpegSegmentFailure {
  return SEGMENT_FAILURES.some((known) => known === value);
}

/** Whether a stop names a setting, so that its message links to Settings. */
export function stopNeedsSettings(stop: QueueStop): boolean {
  return (
    stop.reason === "no-key" ||
    stop.reason === "key-refused" ||
    stop.reason === "key-not-scoped" ||
    stop.reason === "model-unknown"
  );
}
