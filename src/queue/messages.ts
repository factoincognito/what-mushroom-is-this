/**
 * The queue's messages in plain words (docs/SPEC.md 3.3): one for each error class and stop, in the
 * app's language.
 */

import type { Language } from "../i18n/languages";
import type { Strings } from "../i18n/strings";
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

export function noticeMessage(
  notice: QueueNotice,
  strings: Strings,
  formatTime: FormatTime,
): string {
  const t = strings.queue;
  switch (notice.kind) {
    case "paused":
      return {
        network: t.paused.network,
        "time-out": t.paused.timeOut,
        server: t.paused.server,
      }[notice.cause];
    case "stopped":
      return stopMessage(notice.stop, strings, formatTime);
    case "find-failed":
      return failureMessage(notice.failure, strings);
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

/** Why a find failed; for the segment check, the detail names the refused marker. */
export function failureMessage(failure: FindFailure, strings: Strings): string {
  const t = strings.queue.failed;
  const template = {
    "segment-check": t.segmentCheck,
    request: t.request,
    answer: t.answer,
    photo: t.photo,
    refused: t.refused,
  }[failure.cause];
  return fill(template, { detail: failure.detail });
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
