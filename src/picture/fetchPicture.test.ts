/**
 * The fetch of a text answer's representative picture (docs/SPEC.md 3.9; PBI-2.9), on recorded
 * answers of the Wikidata and Commons APIs (`__tests__/fixtures/`, shaped as the product office's
 * phase-2-checks.md section 5 gives their fields): the calls, one at a time, with the app's
 * User-Agent; the width asked for; the type read from the bytes; the licence and the author; the
 * resize and the metadata check; and Wikimedia's failures, classed. No request leaves the test.
 */

import { imageLimitsFor } from "../config/modelSetting";
import { wikimediaConfig } from "../config/wikimedia";
import entitiesChanterelle from "./__tests__/fixtures/entities-chanterelle.json";
import fileInfoChanterelle from "./__tests__/fixtures/fileinfo-chanterelle.json";
import fileInfoMissing from "./__tests__/fixtures/fileinfo-missing.json";
import fileInfoSmallPd from "./__tests__/fixtures/fileinfo-small-pd.json";
import searchChanterelle from "./__tests__/fixtures/search-chanterelle.json";
import searchNone from "./__tests__/fixtures/search-none.json";
import thumbChanterelle from "./__tests__/fixtures/thumb-chanterelle.json";
import {
  fetchPicture,
  type PictureDeps,
  type PictureResponse,
  type PreparedPicture,
} from "./fetchPicture";

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const UA = "Washroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this) expo-fetch";
const NAME = "Cantharellus cibarius";
const HIGH_TIER_MODEL = "claude-opus-5-5";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const RESIZED = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
const SVG = new TextEncoder().encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>',
);
const TIFF = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);

type Step = "search" | "entities" | "fileinfo" | "thumb" | "download";

/** What a stand-in answer is: a status with JSON, text or bytes, a refusal, or none ever. */
type Reply =
  | {
      status: number;
      headers?: Record<string, string>;
      json?: unknown;
      text?: string;
      bytes?: Uint8Array;
    }
  | { reject: Error }
  | { hang: true };

/** The step of the lookup an address is for. */
function stepOf(url: string): Step {
  if (url.includes("list=search")) {
    return "search";
  }
  if (url.includes("action=wbgetentities")) {
    return "entities";
  }
  if (url.includes("iiurlwidth=")) {
    return "thumb";
  }
  if (url.startsWith(wikimediaConfig.commonsApiUrl)) {
    return "fileinfo";
  }
  return "download";
}

/** The query of an address, as its parameters. */
function query(url: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(url.slice(url.indexOf("?") + 1)).entries());
}

function response(reply: Extract<Reply, { status: number }>, signal: AbortSignal): PictureResponse {
  const headers = Object.fromEntries(
    Object.entries(reply.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const body =
    reply.bytes ?? new TextEncoder().encode(reply.text ?? JSON.stringify(reply.json ?? {}));
  return {
    status: reply.status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => {
      if (signal.aborted) {
        throw new Error("Aborted");
      }
      return new TextDecoder().decode(body);
    },
    arrayBuffer: async () => {
      read += 1;
      return body.slice().buffer;
    },
  };
}

let read = 0;

function setup(replies: Partial<Record<Step, Reply>> = {}) {
  const defaults: Record<Step, Reply> = {
    search: { status: 200, json: searchChanterelle },
    entities: { status: 200, json: entitiesChanterelle },
    fileinfo: { status: 200, json: fileInfoChanterelle },
    thumb: { status: 200, json: thumbChanterelle },
    download: { status: 200, bytes: JPEG },
  };
  const calls: { step: Step; url: string; init: Parameters<PictureDeps["fetch"]>[1] }[] = [];
  const saved: { uri: string; bytes: Uint8Array; extension: string }[] = [];
  const removed: string[] = [];
  const prepared: { uri: string; modelId: string }[] = [];
  let active = 0;
  let mostActive = 0;
  let preparation: () => Promise<PreparedPicture> = async () => ({ ok: true, bytes: RESIZED });
  let saving: (count: number) => void = () => undefined;
  read = 0;

  const deps: PictureDeps = {
    fetch: async (url, init) => {
      const step = stepOf(url);
      calls.push({ step, url, init });
      active += 1;
      mostActive = Math.max(mostActive, active);
      try {
        await Promise.resolve();
        const reply = replies[step] ?? defaults[step];
        if ("reject" in reply) {
          throw reply.reject;
        }
        if ("hang" in reply) {
          return await new Promise<never>((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("Aborted")));
          });
        }
        return response(reply, init.signal);
      } finally {
        active -= 1;
      }
    },
    now: () => NOW,
    userAgent: UA,
    imageLimits: (modelId) => imageLimitsFor(modelId),
    saveCopy: async (bytes, extension) => {
      saving(saved.length + 1);
      const uri = `file:///cache/copy-${saved.length + 1}.${extension}`;
      saved.push({ uri, bytes, extension });
      return uri;
    },
    removeCopy: (uri) => {
      removed.push(uri);
    },
    prepare: async (uri, modelId) => {
      prepared.push({ uri, modelId });
      return preparation();
    },
  };
  return {
    deps,
    calls,
    saved,
    removed,
    prepared,
    steps: () => calls.map((call) => call.step),
    mostActive: () => mostActive,
    setPreparation: (value: () => Promise<PreparedPicture>) => {
      preparation = value;
    },
    failSave: (on: number, error: Error) => {
      saving = (count) => {
        if (count === on) {
          throw error;
        }
      };
    },
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe("a picture found (docs/SPEC.md 3.9)", () => {
  it("finds the species' image, checks its licence and author, fetches its thumbnail and keeps it resized and checked", async () => {
    const t = setup();
    const fetched = await fetchPicture(NAME, HIGH_TIER_MODEL, t.deps);
    expect(fetched).toEqual({
      kind: "picture",
      picture: {
        uri: "file:///cache/copy-2.jpg",
        author: "Example Photographer & Ann Exempel",
        licence: "cc-by-sa-3.0",
        page: "https://commons.wikimedia.org/wiki/File:Chanterelle_Cantharellus_cibarius.jpg",
      },
    });
    expect(t.steps()).toEqual(["search", "entities", "fileinfo", "thumb", "download"]);
    // The download copy goes to the resize and is removed; the resized copy is the picture's.
    expect(t.saved.map(({ bytes, extension }) => [bytes, extension])).toEqual([
      [JPEG, "jpg"],
      [RESIZED, "jpg"],
    ]);
    expect(t.prepared).toEqual([{ uri: "file:///cache/copy-1.jpg", modelId: HIGH_TIER_MODEL }]);
    expect(t.removed).toEqual(["file:///cache/copy-1.jpg"]);
  });

  it("sends its requests one at a time, each a GET with the app's User-Agent and gzip (Clead's decision 5)", async () => {
    const t = setup();
    await fetchPicture(NAME, HIGH_TIER_MODEL, t.deps);
    expect(t.mostActive()).toBe(1);
    for (const { init } of t.calls) {
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({ "User-Agent": UA, "Accept-Encoding": "gzip" });
    }
  });

  it("sends Wikimedia only the Latin name: the search names it, and the later calls only what Wikimedia gave", async () => {
    const t = setup();
    await fetchPicture(NAME, HIGH_TIER_MODEL, t.deps);
    const [search, entities, fileinfo, thumb, download] = t.calls.map((call) => call.url);
    expect(query(search ?? "").srsearch).toBe(`haswbstatement:"P225=${NAME}"`);
    expect(query(entities ?? "").ids).toBe("Q1001");
    expect(query(fileinfo ?? "").titles).toBe("File:Chanterelle Cantharellus cibarius.jpg");
    expect(query(thumb ?? "").titles).toBe("File:Chanterelle Cantharellus cibarius.jpg");
    expect(download).toBe(thumbChanterelle.query.pages[0]?.imageinfo[0]?.thumburl);
  });

  it("asks for the smallest standard width at or above what the model's resize needs: 3840 for 2212 px on the high-resolution tier, 1280 for 1270 px on the standard one", async () => {
    const high = setup();
    await fetchPicture(NAME, HIGH_TIER_MODEL, high.deps);
    expect(query(high.calls[3]?.url ?? "").iiurlwidth).toBe("3840");
    const standard = setup();
    await fetchPicture(NAME, "a-model-the-app-does-not-list", standard.deps);
    expect(query(standard.calls[3]?.url ?? "").iiurlwidth).toBe("1280");
  });

  it("takes the original itself when it is narrower than the standard width chosen, asking for no thumbnail", async () => {
    const t = setup({
      fileinfo: { status: 200, json: fileInfoSmallPd },
      download: { status: 200, bytes: PNG },
    });
    const fetched = await fetchPicture(NAME, HIGH_TIER_MODEL, t.deps);
    expect(t.steps()).toEqual(["search", "entities", "fileinfo", "download"]);
    expect(t.calls[3]?.url).toBe(fileInfoSmallPd.query.pages[0]?.imageinfo[0]?.url);
    expect(fetched).toMatchObject({
      kind: "picture",
      picture: { author: "Ann Exempel", licence: "pd" },
    });
  });

  it("reads the type from the bytes, not from the address: a PNG served for a .jpg is saved as PNG", async () => {
    const t = setup({ download: { status: 200, bytes: PNG } });
    await fetchPicture(NAME, HIGH_TIER_MODEL, t.deps);
    expect(t.saved[0]?.extension).toBe("png");
  });
});

describe("no picture for that answer (docs/SPEC.md 3.9, Fetching it)", () => {
  it.each([
    ["no Wikidata item", { search: { status: 200, json: searchNone } }, "no-item"],
    [
      "no item of species rank",
      {
        entities: {
          status: 200,
          json: {
            ...entitiesChanterelle,
            entities: { Q1001: { id: "Q1001", claims: {}, sitelinks: {} } },
          },
        },
      },
      "no-item",
    ],
    [
      "no image",
      {
        entities: {
          status: 200,
          json: JSON.parse(
            JSON.stringify(entitiesChanterelle).replace('"P18"', '"P999"'),
          ) as unknown,
        },
      },
      "no-image",
    ],
    [
      "a file Commons does not have",
      { fileinfo: { status: 200, json: fileInfoMissing } },
      "no-image",
    ],
    [
      "a licence not allowed",
      {
        fileinfo: {
          status: 200,
          json: JSON.parse(
            JSON.stringify(fileInfoChanterelle).replace(
              "Template:Cc-by-sa-3.0",
              "Template:Cc-by-nc-3.0",
            ),
          ) as unknown,
        },
      },
      "licence",
    ],
    [
      "no machine-readable author",
      {
        fileinfo: {
          status: 200,
          json: JSON.parse(
            JSON.stringify(fileInfoChanterelle).replace('"Artist"', '"Credit"'),
          ) as unknown,
        },
      },
      "no-author",
    ],
    [
      "a thumbnail address not on a Wikimedia host",
      {
        thumb: {
          status: 200,
          json: JSON.parse(
            JSON.stringify(thumbChanterelle).replace(
              "https://thumb.wikimedia.org",
              "https://example.org",
            ),
          ) as unknown,
        },
      },
      "answer",
    ],
    ["an SVG served in place of a thumbnail", { download: { status: 200, bytes: SVG } }, "format"],
    ["a TIFF served in place of a thumbnail", { download: { status: 200, bytes: TIFF } }, "format"],
  ] as const)("%s", async (_name, replies, reason) => {
    const t = setup(replies as Partial<Record<Step, Reply>>);
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
      kind: "none",
      reason,
    });
    expect(t.saved).toEqual([]);
    expect(t.prepared).toEqual([]);
  });

  it("sends nothing for a Latin name that cannot be sent as it is", async () => {
    const t = setup();
    await expect(fetchPicture('Cantharellus" OR "x', HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
      kind: "none",
      reason: "name",
    });
    expect(t.calls).toEqual([]);
  });

  it("sends nothing without a User-Agent of the app's, since Wikimedia blocks generic agents", async () => {
    const t = setup();
    await expect(
      fetchPicture(NAME, HIGH_TIER_MODEL, { ...t.deps, userAgent: null }),
    ).resolves.toEqual({ kind: "none", reason: "user-agent" });
    expect(t.calls).toEqual([]);
  });

  it("does not read a picture whose stated size is above the limit, and refuses one read above it", async () => {
    const stated = setup({
      download: {
        status: 200,
        headers: { "Content-Length": String(wikimediaConfig.pictureMaxBytes + 1) },
        bytes: JPEG,
      },
    });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, stated.deps)).resolves.toEqual({
      kind: "none",
      reason: "too-large",
    });
    expect(read).toBe(0);
    const big = new Uint8Array(wikimediaConfig.pictureMaxBytes + 1);
    big.set(JPEG);
    const unstated = setup({ download: { status: 200, bytes: big } });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, unstated.deps)).resolves.toEqual({
      kind: "none",
      reason: "too-large",
    });
    expect(unstated.saved).toEqual([]);
  });

  it.each([
    ["cannot be loaded", { ok: false, reason: "load" }, "load"],
    [
      "fails the metadata check after its resize",
      { ok: false, reason: "segment-check" },
      "segment-check",
    ],
  ] as const)(
    "a picture that %s: no picture, and its copy is removed",
    async (_name, prepared, reason) => {
      const t = setup();
      t.setPreparation(async () => prepared);
      await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
        kind: "none",
        reason,
      });
      expect(t.saved.map((copy) => copy.uri)).toEqual(["file:///cache/copy-1.jpg"]);
      expect(t.removed).toEqual(["file:///cache/copy-1.jpg"]);
    },
  );
});

describe("Wikimedia's failures, classed (docs/SPEC.md 3.9, Fetching it)", () => {
  const steps: Step[] = ["search", "entities", "fileinfo", "thumb", "download"];

  it.each(steps)(
    "at the %s: no network makes the picture wait, and nothing more is sent",
    async (step) => {
      const t = setup({ [step]: { reject: new TypeError("Network request failed") } });
      await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
        kind: "waits",
        cause: "network",
        retryAtMs: null,
      });
      expect(t.steps().at(-1)).toBe(step);
    },
  );

  it.each(steps)("at the %s: a 5xx makes the picture wait", async (step) => {
    const t = setup({ [step]: { status: 502, text: "Bad gateway" } });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
      kind: "waits",
      cause: "picture-source",
      retryAtMs: null,
    });
    expect(t.steps().at(-1)).toBe(step);
  });

  it.each(steps)(
    "at the %s: a 429 makes the picture wait until its Retry-After (Clead's decision 5)",
    async (step) => {
      const t = setup({ [step]: { status: 429, headers: { "Retry-After": "30" }, text: "" } });
      await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
        kind: "waits",
        cause: "picture-source",
        retryAtMs: NOW + 30_000,
      });
    },
  );

  it.each([
    ["a 503 without Retry-After", { status: 503, text: "" }],
    [
      "a 429 whose Retry-After is not a time",
      { status: 429, headers: { "Retry-After": "soon" }, text: "" },
    ],
    [
      "a 429 whose Retry-After is more than a day ahead",
      { status: 429, headers: { "Retry-After": String(25 * 60 * 60) }, text: "" },
    ],
  ])("%s waits the 5 seconds Wikimedia's rate-limit page asks at least", async (_name, reply) => {
    const t = setup({ search: reply });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
      kind: "waits",
      cause: "picture-source",
      retryAtMs: NOW + wikimediaConfig.retryWaitMinMs,
    });
  });

  it("a 503 with Retry-After waits until it", async () => {
    const t = setup({ fileinfo: { status: 503, headers: { "Retry-After": "120" }, text: "" } });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toMatchObject({
      retryAtMs: NOW + 120_000,
    });
  });

  it.each(steps)("at the %s: any other status gives no picture", async (step) => {
    const t = setup({ [step]: { status: 403, text: "Forbidden" } });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
      kind: "none",
      reason: "answer",
    });
    expect(t.steps().at(-1)).toBe(step);
  });

  it.each(["search", "entities", "fileinfo", "thumb"] as const)(
    "at the %s: an answer that is not JSON gives no picture",
    async (step) => {
      const t = setup({ [step]: { status: 200, text: "<html>Wi-Fi sign-in</html>" } });
      await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).resolves.toEqual({
        kind: "none",
        reason: "answer",
      });
    },
  );

  it.each(steps)("at the %s: the time limit makes the picture wait", async (step) => {
    jest.useFakeTimers({ now: NOW });
    const t = setup({ [step]: { hang: true } });
    const fetching = fetchPicture(NAME, HIGH_TIER_MODEL, t.deps);
    await jest.advanceTimersByTimeAsync(wikimediaConfig.requestTimeoutMs - 1);
    let settled = false;
    void fetching.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(fetching).resolves.toEqual({
      kind: "waits",
      cause: "picture-source",
      retryAtMs: null,
    });
  });
});

describe("errors that are not Wikimedia's", () => {
  it("passes on an error of the resize that is not the picture's, removing the copy", async () => {
    const t = setup();
    t.setPreparation(async () => {
      throw new RangeError("the JPEG quality is not in (0, 1]");
    });
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).rejects.toThrow(RangeError);
    expect(t.removed).toEqual(["file:///cache/copy-1.jpg"]);
  });

  it("passes on a copy that cannot be written, such as full storage, removing the copy before it", async () => {
    const t = setup();
    t.failSave(2, new Error("No space left on device"));
    await expect(fetchPicture(NAME, HIGH_TIER_MODEL, t.deps)).rejects.toThrow("No space left");
    expect(t.removed).toEqual(["file:///cache/copy-1.jpg"]);
  });
});
