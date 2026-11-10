import { LANGUAGES } from "../i18n/languages";
import { STRINGS, type Strings } from "../i18n/strings";
import { preparePhotoForAnalysis } from "../image/prepareForAnalysis";
import type { FindFailure } from "../store/find";
import {
  analysisFailure,
  encoderOf,
  http,
  JPEG,
  jpeg,
  jpegWith,
  messageBody,
  photoFailure,
  unloadableEncoder,
} from "../testing/failureDetails";
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
  { reason: "key-not-scoped" },
  { reason: "no-credit" },
  { reason: "model-unknown" },
  { reason: "answer", findMarkedFailed: true },
  { reason: "answer", findMarkedFailed: false },
  { reason: "internal-error" },
  { reason: "other", status: 418 },
];

const NOTICES: readonly QueueNotice[] = [
  { kind: "paused", cause: "network" },
  { kind: "paused", cause: "time-out" },
  { kind: "paused", cause: "server" },
  { kind: "paused", cause: "picture-source" },
  ...STOPS.map((stop): QueueNotice => ({ kind: "stopped", stop })),
  { kind: "find-failed", failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" } },
  { kind: "find-failed", failure: { cause: "request", detail: "request-wrong (status 400)" } },
  { kind: "find-failed", failure: { cause: "answer", detail: "the answer is not JSON" } },
  { kind: "find-failed", failure: { cause: "photo", detail: "the image could not be loaded" } },
  {
    kind: "find-failed",
    failure: { cause: "refused", detail: "the answer was refused (stop_reason refusal)" },
  },
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

  it.each(LANGUAGES)(
    "says in %s that a picture waits for Wikimedia Commons, not for the Claude API (PBI-2.9)",
    (language) => {
      const message = noticeMessage(
        { kind: "paused", cause: "picture-source" },
        STRINGS[language],
        formatTime,
      );
      expect(message).toBe(STRINGS[language].queue.paused.pictureSource);
      expect(message).toContain("Wikimedia Commons");
      expect(message).not.toContain("Claude");
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

  it.each(LANGUAGES)("names the marker the segment check refused in %s, in words", (language) => {
    const message = noticeMessage(
      {
        kind: "find-failed",
        failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
      },
      STRINGS[language],
      formatTime,
    );
    expect(message).toBe(STRINGS[language].queue.failed.segmentCheck.app1);
    expect(message).toContain("APP1");
    expect(message).not.toContain("0xFFE1");
  });

  it.each(LANGUAGES)(
    "gives the internal-error stop its own text in %s, which tells the user to analyse now",
    (language) => {
      const message = noticeMessage(
        { kind: "stopped", stop: { reason: "internal-error" } },
        STRINGS[language],
        formatTime,
      );
      expect(message).toBe(STRINGS[language].queue.stopped.internalError);
      expect(message).toContain(STRINGS[language].queue.analyseNow);
    },
  );
});

/**
 * The failures as the app stores them, each made by the module that writes it (fix 2 of the
 * review of #24), and the plain words each is shown in (fix 1). `expected` picks the sentence.
 */
type Failed = Strings["queue"]["failed"];
const STORED: readonly {
  readonly name: string;
  readonly make: () => Promise<FindFailure>;
  readonly expected: (t: Failed) => string;
}[] = [
  {
    name: "an APP1 segment (EXIF, XMP)",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.EXIF))),
    expected: (t) => t.segmentCheck.app1,
  },
  {
    name: "an APP0 segment that is not JFIF (a JFIF extension)",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.JFXX))),
    expected: (t) => t.segmentCheck.app0,
  },
  {
    name: "an APP2 segment that is not a colour profile",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.MPF))),
    expected: (t) => t.segmentCheck.app2,
  },
  {
    name: "an APP13 segment (IPTC)",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.IPTC))),
    expected: (t) => t.segmentCheck.app13,
  },
  {
    name: "another application segment (APP5)",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.APP5))),
    expected: (t) => t.segmentCheck.otherApp.replace("{number}", "5"),
  },
  {
    name: "a comment",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.COM))),
    expected: (t) => t.segmentCheck.comment,
  },
  {
    name: "another marker off the allowlist (DNL)",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(JPEG.DNL))),
    expected: (t) => t.segmentCheck.otherMarker,
  },
  {
    name: "data after the end of the image",
    make: () =>
      photoFailure(
        preparePhotoForAnalysis,
        encoderOf(jpeg(JPEG.SOI, JPEG.JFIF, JPEG.DQT, JPEG.SOF0, JPEG.SCAN, JPEG.EOI, JPEG.SOI)),
      ),
    expected: (t) => t.segmentCheck.trailingData,
  },
  {
    name: "a JPEG cut short",
    make: () =>
      photoFailure(preparePhotoForAnalysis, encoderOf(jpeg(JPEG.SOI, JPEG.JFIF, JPEG.DQT))),
    expected: (t) => t.segmentCheck.truncated,
  },
  {
    name: "a JPEG with no scan before its end",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpeg(JPEG.SOI, JPEG.EOI))),
    expected: (t) => t.segmentCheck.malformed,
  },
  {
    name: "bytes that are not a JPEG",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(Uint8Array.from([0x89, 0x50]))),
    expected: (t) => t.segmentCheck.notJpeg,
  },
  {
    name: "an encoder output that is not bytes",
    make: () =>
      photoFailure(preparePhotoForAnalysis, {
        async load() {
          return {
            width: 4032,
            height: 3024,
            // The encoder's output as it could come from native code, not typed bytes.
            encodeJpeg: async () => JSON.parse("[255, 216]"),
            release: () => undefined,
          };
        },
      }),
    expected: (t) => t.segmentCheck.invalidInput,
  },
  {
    name: "a photo the encoder cannot load, with a native message that names its file",
    make: () =>
      photoFailure(
        preparePhotoForAnalysis,
        unloadableEncoder(
          new Error("Could not load the image: file:///data/user/0/app/files/photos/p1.jpg"),
        ),
      ),
    expected: (t) => t.photo.loadFailed,
  },
  {
    name: "a photo the encoder cannot load, with no message",
    make: () => photoFailure(preparePhotoForAnalysis, unloadableEncoder(new Error(""))),
    expected: (t) => t.photo.loadFailed,
  },
  {
    name: "a photo whose decoded size cannot be used",
    make: () => photoFailure(preparePhotoForAnalysis, encoderOf(jpegWith(), 0, 3024)),
    expected: (t) => t.photo.invalidSize,
  },
  {
    name: "a 400 for a wrong request",
    make: () =>
      analysisFailure(
        http(
          400,
          JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "x" } }),
        ),
      ),
    expected: (t) => t.request.wrong,
  },
  {
    name: "a 413 for a request too large",
    make: () => analysisFailure(http(413, "")),
    expected: (t) => t.request.tooLarge,
  },
  {
    name: "an answer that is not from the API (a Wi-Fi sign-in page)",
    make: () => analysisFailure(http(200, "<html>Sign in to the Wi-Fi</html>")),
    expected: (t) => t.answer.notApi,
  },
  {
    name: "an answer cut off at max_tokens",
    make: () =>
      analysisFailure(
        http(200, messageBody([{ type: "text", text: '{"result":"ma' }], "max_tokens")),
      ),
    expected: (t) => t.answer.cutOff,
  },
  {
    name: "an answer cut off at the context window",
    make: () =>
      analysisFailure(
        http(200, messageBody([{ type: "text", text: "{" }], "model_context_window_exceeded")),
      ),
    expected: (t) => t.answer.cutOff,
  },
  {
    name: "an answer that is not JSON",
    make: () => analysisFailure(http(200, messageBody([{ type: "text", text: "A chanterelle." }]))),
    expected: (t) => t.answer.shape,
  },
  {
    name: "an answer that does not fit the shape",
    make: () =>
      analysisFailure(http(200, messageBody([{ type: "text", text: '{"result":"maybe"}' }]))),
    expected: (t) => t.answer.shape,
  },
  {
    name: "a refusal",
    make: () => analysisFailure(http(200, messageBody([], "refusal"))),
    expected: (t) => t.refused,
  },
];

/** What no message may show: the stored codes, markers, statuses, stop reasons and file paths. */
const INTERNAL =
  /0x|forbidden-segment|trailing-data|not-jpeg|truncated|malformed|invalid-input|load-failed|invalid-size|request-wrong|request-too-large|stop_reason|max_tokens|status|file:|Messages API message|not JSON|is not one of/;

describe("failureMessage: a failure as the app stores it, in plain words (PBI-1.8)", () => {
  it.each(
    LANGUAGES.flatMap((language) => STORED.map((item) => [item.name, language, item] as const)),
  )("shows %s in %s as its sentence, with no code or path", async (_name, language, item) => {
    const failure = await item.make();
    const message = failureMessage(failure, STRINGS[language]);
    expect(message).toBe(item.expected(STRINGS[language].queue.failed));
    expect(message).not.toMatch(INTERNAL);
    expect(message).not.toMatch(/[{}]/);
  });

  it("is fed the details exactly as the modules write them", async () => {
    const details = await Promise.all(STORED.map(async (item) => (await item.make()).detail));
    expect(details.slice(0, 7)).toEqual([
      "forbidden-segment 0xFFE1",
      "forbidden-segment 0xFFE0",
      "forbidden-segment 0xFFE2",
      "forbidden-segment 0xFFED",
      "forbidden-segment 0xFFE5",
      "forbidden-segment 0xFFFE",
      "forbidden-segment 0xFFDC",
    ]);
    expect(details).toContain("trailing-data");
    expect(details).toContain(
      "load-failed: Could not load the image: file:///data/user/0/app/files/photos/p1.jpg",
    );
    expect(details).toContain("load-failed");
    expect(details).toContain("request-wrong (status 400)");
    expect(details).toContain("request-too-large (status 413)");
    expect(details.some((detail) => detail.startsWith("invalid-size: "))).toBe(true);
  });

  it.each(LANGUAGES)("gives an unknown detail of each cause a general sentence in %s", (lang) => {
    const t = STRINGS[lang].queue.failed;
    const unknown = (cause: FindFailure["cause"], detail: string) =>
      failureMessage({ cause, detail }, STRINGS[lang]);
    expect(unknown("segment-check", "a new reason 0xFFE1")).toBe(t.segmentCheck.unknown);
    expect(unknown("segment-check", "forbidden-segment")).toBe(t.segmentCheck.unknown);
    expect(unknown("segment-check", "forbidden-segment 0xFFE1 more")).toBe(t.segmentCheck.unknown);
    expect(unknown("photo", "the photo could not be read")).toBe(t.photo.unknown);
    expect(unknown("request", "request-wrong")).toBe(t.request.unknown);
    expect(unknown("answer", "something else")).toBe(t.answer.shape);
    expect(unknown("refused", "anything")).toBe(t.refused);
  });

  it.each(LANGUAGES)("gives each sentence its own text in %s", (lang) => {
    const texts = STORED.map((item) => item.expected(STRINGS[lang].queue.failed));
    const t = STRINGS[lang].queue.failed;
    const all = new Set([...texts, t.segmentCheck.unknown, t.photo.unknown, t.request.unknown]);
    // Two photo loads share a sentence, two cut-off answers and two answers off the shape; the
    // rest, and the three general sentences, are each their own.
    expect(all.size).toBe(STORED.length - 3 + 3);
  });
});

/** Every leaf of a nested strings object, by its key path. */
function leavesOf(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") {
    return [[path, value]];
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leavesOf(child, path === "" ? key : `${path}.${key}`),
  );
}

describe("failureMessage: a failure that names one of the find's photos (SPEC 3.9, Batches; PBI-2.5)", () => {
  it.each(LANGUAGES)("names the photo and says why it failed in %s, with no code", (language) => {
    const t = STRINGS[language];
    const named = (cause: FindFailure["cause"], detail: string) =>
      failureMessage({ cause, detail }, t);
    const cases = [
      [named("photo", "photo 2: load-failed"), "2", t.queue.failed.photo.loadFailed],
      [named("photo", "photo 5: invalid-size: 0 x 0"), "5", t.queue.failed.photo.invalidSize],
      [
        named("segment-check", "photo 3: forbidden-segment 0xFFE1"),
        "3",
        t.queue.failed.segmentCheck.app1,
      ],
      [
        named("segment-check", "photo 1: trailing-data"),
        "1",
        t.queue.failed.segmentCheck.trailingData,
      ],
    ] as const;
    for (const [message, number, reason] of cases) {
      expect(message).toBe(
        t.queue.failed.numbered.replace("{number}", number).replace("{reason}", reason),
      );
      expect(message).toContain(number);
      expect(message).not.toMatch(INTERNAL);
      expect(message).not.toMatch(/[{}]/);
    }
  });

  it("reads a detail of another form, or a photo number that is no number, by its general sentence", () => {
    const t = STRINGS.en.queue.failed;
    expect(failureMessage({ cause: "photo", detail: "photo x: load-failed" }, STRINGS.en)).toBe(
      t.photo.unknown,
    );
    expect(failureMessage({ cause: "photo", detail: "photo 0: load-failed" }, STRINGS.en)).toBe(
      t.photo.unknown,
    );
    expect(
      failureMessage({ cause: "segment-check", detail: "photo 2: something new" }, STRINGS.en),
    ).toBe(t.numbered.replace("{number}", "2").replace("{reason}", t.segmentCheck.unknown));
  });

  it("names no photo for a cause that is not about a photo", () => {
    const failure: FindFailure = {
      cause: "request",
      detail: "photo 2: request-wrong (status 400)",
    };
    expect(failureMessage(failure, STRINGS.en)).toBe(STRINGS.en.queue.failed.request.unknown);
  });
});

describe("the placeholders of the queue's strings", () => {
  const placeholders = (text: string) => (text.match(/\{[a-z]+\}/g) ?? []).sort();

  it.each(LANGUAGES)("are those of English in %s", (language) => {
    const other = new Map(leavesOf(STRINGS[language].queue));
    for (const [path, text] of leavesOf(STRINGS.en.queue)) {
      expect(placeholders(other.get(path) ?? "")).toEqual(placeholders(text));
    }
  });
});

describe("stopNeedsSettings", () => {
  it.each(STOPS.map((stop) => [stop.reason, stop] as const))("%s", (reason, stop) => {
    expect(stopNeedsSettings(stop)).toBe(
      reason === "no-key" ||
        reason === "key-refused" ||
        reason === "key-not-scoped" ||
        reason === "model-unknown",
    );
  });
});

describe("the message for a refused answer (PBI-1.21)", () => {
  it.each(LANGUAGES)(
    "in %s says that Claude declined, not that the answer had the wrong form",
    (language) => {
      const message = failureMessage(
        { cause: "refused", detail: "the answer was refused (stop_reason refusal)" },
        STRINGS[language],
      );
      expect(message).toBe(STRINGS[language].queue.failed.refused);
      expect(message).not.toContain("stop_reason");
      expect(message).toContain("Claude");
    },
  );

  it.each(LANGUAGES)(
    "in %s speaks of the description, not a photo, for a lookup without photos (PBI-2.4)",
    (language) => {
      const failure: FindFailure = { cause: "refused", detail: "x" };
      const t = STRINGS[language];
      expect(failureMessage(failure, t, "described")).toBe(t.queue.failed.refusedDescribed);
      expect(failureMessage(failure, t, "photo")).toBe(t.queue.failed.refused);
      expect(
        noticeMessage({ kind: "find-failed", failure }, t, formatTimeIn(language), "described"),
      ).toBe(t.queue.failed.refusedDescribed);
    },
  );

  it("leaves every other failure's message as it is for a lookup without photos", () => {
    const failure: FindFailure = { cause: "request", detail: "request-wrong (status 400)" };
    expect(failureMessage(failure, STRINGS.en, "described")).toBe(
      failureMessage(failure, STRINGS.en),
    );
  });
});

describe("the stop for an answer not of the shape (PBI-2.14; PBI-2.16, #75)", () => {
  const marked = {
    sv: /markerat som misslyckat/,
    en: /marked failed/,
    it: /segnato come non riuscito/,
  } as const;
  const stopped = (findMarkedFailed: boolean, language: (typeof LANGUAGES)[number]) =>
    noticeMessage(
      { kind: "stopped", stop: { reason: "answer", findMarkedFailed } },
      STRINGS[language],
      formatTime,
    );

  it.each(LANGUAGES)("says in %s that a find is marked failed when one was", (language) => {
    const message = stopped(true, language);
    expect(message).toBe(STRINGS[language].queue.stopped.answer);
    expect(message).toMatch(marked[language]);
    expect(message).toContain(STRINGS[language].queue.analyseNow);
  });

  it.each(LANGUAGES)(
    "says in %s only that an answer did not fit, when no find was marked failed",
    (language) => {
      const message = stopped(false, language);
      expect(message).toBe(STRINGS[language].queue.stopped.answerNoFindFailed);
      expect(message).not.toMatch(marked[language]);
      expect(message).toContain(STRINGS[language].queue.analyseNow);
      // The rest is the same as when a find was marked failed: what the answer was, and what to
      // do. Only the sentence about the find is gone.
      const sentences = (text: string) => text.split(/(?<=\.) /);
      const withFind = sentences(stopped(true, language));
      expect(withFind.filter((sentence) => !marked[language].test(sentence))).toEqual(
        sentences(message),
      );
      expect(withFind).toHaveLength(sentences(message).length + 1);
    },
  );

  it("needs no setting either way, so neither message links to Settings", () => {
    expect(stopNeedsSettings({ reason: "answer", findMarkedFailed: true })).toBe(false);
    expect(stopNeedsSettings({ reason: "answer", findMarkedFailed: false })).toBe(false);
  });
});

describe("the message for a key not scoped to a workspace (Clead's decision on #18, note 4)", () => {
  it.each(LANGUAGES)("is its own in %s, not the message for a refused key", (language) => {
    const message = noticeMessage(
      { kind: "stopped", stop: { reason: "key-not-scoped" } },
      STRINGS[language],
      formatTime,
    );
    expect(message).toBe(STRINGS[language].queue.stopped.keyNotScoped);
    expect(message).not.toBe(STRINGS[language].queue.stopped.keyRefused);
  });

  it.each([
    ["sv", /arbetsyta/],
    ["en", /workspace/],
    ["it", /spazio di lavoro/],
  ] as const)("in %s says the key belongs to no workspace", (language, workspace) => {
    expect(STRINGS[language].queue.stopped.keyNotScoped).toMatch(workspace);
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
