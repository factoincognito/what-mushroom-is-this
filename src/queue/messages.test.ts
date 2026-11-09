import { LANGUAGES } from "../i18n/languages";
import { STRINGS } from "../i18n/strings";
import { failureMessage, formatTimeIn, noticeMessage, stopNeedsSettings } from "./messages";
import type { QueueNotice, QueueStop } from "./queue";

const AT = Date.UTC(2026, 11, 1, 13, 45);
const formatTime = (ms: number) => `<${ms}>`;

const STOPS: readonly QueueStop[] = [
  { reason: "rate-limited", retryAtMs: AT, accessResumesAtMs: null },
  { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: AT },
  { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
  { reason: "no-key" },
  { reason: "key-refused" },
  { reason: "no-credit" },
  { reason: "model-unknown" },
  { reason: "answer" },
  { reason: "photo-unreadable" },
  { reason: "other", status: 418 },
];

const NOTICES: readonly QueueNotice[] = [
  { kind: "paused", cause: "network" },
  { kind: "paused", cause: "time-out" },
  { kind: "paused", cause: "server" },
  ...STOPS.map((stop): QueueNotice => ({ kind: "stopped", stop })),
  { kind: "find-failed", failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" } },
  { kind: "find-failed", failure: { cause: "request", detail: "request-wrong (status 400)" } },
  { kind: "find-failed", failure: { cause: "answer", detail: "the answer is not JSON" } },
];

describe("noticeMessage", () => {
  it.each(LANGUAGES)(
    "gives each error class and stop its own message in %s, with no placeholder left",
    (language) => {
      const messages = NOTICES.map((notice) =>
        noticeMessage(notice, STRINGS[language], formatTime),
      );
      expect(new Set(messages).size).toBe(NOTICES.length);
      for (const message of messages) {
        expect(message).not.toMatch(/[{}]/);
        expect(message.trim()).not.toBe("");
      }
    },
  );

  it("shows the time a 429's retry-after gives, when the queue starts again by itself", () => {
    const message = noticeMessage(
      { kind: "stopped", stop: { reason: "rate-limited", retryAtMs: AT, accessResumesAtMs: null } },
      STRINGS.en,
      formatTime,
    );
    expect(message).toBe(STRINGS.en.queue.stopped.rateLimitedUntil.replace("{time}", `<${AT}>`));
  });

  it.each(LANGUAGES)(
    "shows in %s the time access resumes after a spend limit, when the answer gives it",
    (language) => {
      const message = noticeMessage(
        {
          kind: "stopped",
          stop: { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: AT },
        },
        STRINGS[language],
        formatTime,
      );
      expect(message).toContain(`<${AT}>`);
      expect(message).toBe(
        STRINGS[language].queue.stopped.spendLimitUntil.replace("{time}", `<${AT}>`),
      );
    },
  );

  it("says nothing of a time when the answer gives none", () => {
    const message = noticeMessage(
      {
        kind: "stopped",
        stop: { reason: "rate-limited", retryAtMs: null, accessResumesAtMs: null },
      },
      STRINGS.en,
      formatTime,
    );
    expect(message).toBe(STRINGS.en.queue.stopped.rateLimited);
  });

  it("gives the status of any other answer", () => {
    expect(
      noticeMessage(
        { kind: "stopped", stop: { reason: "other", status: 418 } },
        STRINGS.en,
        formatTime,
      ),
    ).toBe(STRINGS.en.queue.stopped.other.replace("{status}", "418"));
  });

  it.each(LANGUAGES)("names the marker the segment check refused in %s", (language) => {
    const message = noticeMessage(
      {
        kind: "find-failed",
        failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
      },
      STRINGS[language],
      formatTime,
    );
    expect(message).toContain("0xFFE1");
  });
});

describe("failureMessage", () => {
  it.each([
    ["segment-check", "segmentCheck"],
    ["request", "request"],
    ["answer", "answer"],
  ] as const)("gives a failed find's cause %s its message, with the detail", (cause, key) => {
    expect(failureMessage({ cause, detail: "D" }, STRINGS.en)).toBe(
      STRINGS.en.queue.failed[key].replace("{detail}", "D"),
    );
  });
});

describe("the placeholders of the queue's strings", () => {
  const placeholders = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort();

  it.each(LANGUAGES)("are those of English in %s", (language) => {
    const groups = ["paused", "stopped", "failed"] as const;
    for (const group of groups) {
      const en: Record<string, string> = STRINGS.en.queue[group];
      const other: Record<string, string> = STRINGS[language].queue[group];
      for (const [key, text] of Object.entries(en)) {
        expect(placeholders(other[key] ?? "")).toEqual(placeholders(text));
      }
    }
  });
});

describe("stopNeedsSettings", () => {
  it.each(STOPS.map((stop) => [stop.reason, stop] as const))("%s", (reason, stop) => {
    expect(stopNeedsSettings(stop)).toBe(
      reason === "no-key" || reason === "key-refused" || reason === "model-unknown",
    );
  });
});

describe("formatTimeIn", () => {
  it.each(LANGUAGES)("gives the date and the time in %s", (language) => {
    const text = formatTimeIn(language)(AT);
    expect(text).toContain("2026");
    expect(text).not.toBe("");
  });

  it("gives different text for different times", () => {
    const format = formatTimeIn("en");
    expect(format(AT)).not.toBe(format(AT + 60 * 60_000));
  });
});
