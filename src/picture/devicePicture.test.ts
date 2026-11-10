import { File, Paths } from "expo-file-system";

import { prepareJpegForAnalysis } from "../image/prepareForAnalysis";
import searchNone from "./__tests__/fixtures/search-none.json";
import { devicePictureDeps, fetchDevicePicture, removePictureCopy } from "./devicePicture";

/*
 * expo-file-system is jest-expo's in-memory file system; the encoder runs only on a phone, so the
 * image module's preparation is replaced, and the app's config is that of app.json.
 */
jest.mock("../image/prepareForAnalysis", () => ({
  ...jest.requireActual("../image/prepareForAnalysis"),
  prepareJpegForAnalysis: jest.fn(),
}));
jest.mock("expo-constants", () => {
  const actual = jest.requireActual("expo-constants");
  const appJson = jest.requireActual("../../app.json");
  return { __esModule: true, ...actual, default: { ...actual.default, expoConfig: appJson.expo } };
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 0xff, 0xd9]);
const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  jest.mocked(prepareJpegForAnalysis).mockReset();
});

describe("devicePictureDeps (PBI-2.9)", () => {
  it("names the app as app.json does, in the User-Agent", () => {
    expect(devicePictureDeps().userAgent).toBe(
      "Washroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this) expo-fetch",
    );
    expect(devicePictureDeps({ name: "Washroom" }).userAgent).toBeNull();
  });

  it("saves a copy in the cache, with the extension given, and removes it again", async () => {
    const deps = devicePictureDeps();
    const uri = await deps.saveCopy(JPEG, "png");
    expect(uri.startsWith(Paths.cache.uri)).toBe(true);
    expect(uri.endsWith(".png")).toBe(true);
    const file = new File(uri);
    expect(file.exists).toBe(true);
    await expect(file.bytes()).resolves.toEqual(JPEG);
    const other = await deps.saveCopy(JPEG, "jpg");
    expect(other).not.toBe(uri);
    deps.removeCopy(uri);
    expect(new File(uri).exists).toBe(false);
    expect(new File(other).exists).toBe(true);
    removePictureCopy(other);
    expect(new File(other).exists).toBe(false);
  });

  it("removes a copy that is not there, or an address that is not a file, without an error", () => {
    expect(() => removePictureCopy(`${Paths.cache.uri}picture-not-there.jpg`)).not.toThrow();
    expect(() => removePictureCopy("not an address")).not.toThrow();
  });

  it("prepares the copy as a photo is prepared, and gives a failure of the picture as no picture", async () => {
    const deps = devicePictureDeps();
    jest
      .mocked(prepareJpegForAnalysis)
      .mockResolvedValueOnce({ ok: true, bytes: JPEG, width: 1, height: 1 })
      .mockResolvedValueOnce({
        ok: false,
        loaded: false,
        failure: { cause: "photo", detail: "load-failed" },
      })
      .mockResolvedValueOnce({
        ok: false,
        loaded: true,
        failure: { cause: "photo", detail: "invalid-size: x" },
      })
      .mockResolvedValueOnce({
        ok: false,
        loaded: true,
        failure: { cause: "segment-check", detail: "forbidden-segment 0xFFE1" },
      });
    await expect(deps.prepare("file:///cache/a.png", "claude-opus-5-5")).resolves.toEqual({
      ok: true,
      bytes: JPEG,
    });
    await expect(deps.prepare("file:///cache/a.png", "m")).resolves.toEqual({
      ok: false,
      reason: "load",
    });
    await expect(deps.prepare("file:///cache/a.png", "m")).resolves.toEqual({
      ok: false,
      reason: "load",
    });
    await expect(deps.prepare("file:///cache/a.png", "m")).resolves.toEqual({
      ok: false,
      reason: "segment-check",
    });
    expect(jest.mocked(prepareJpegForAnalysis).mock.calls[0]?.slice(0, 2)).toEqual([
      "file:///cache/a.png",
      "claude-opus-5-5",
    ]);
  });

  it("fetches through the platform fetch, as the app's queue does", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(searchNone),
      arrayBuffer: async () => new ArrayBuffer(0),
    });
    await expect(fetchDevicePicture("Cantharellus cibarius", "claude-opus-5-5")).resolves.toEqual({
      kind: "none",
      reason: "no-item",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "GET",
      headers: {
        "User-Agent":
          "Washroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this) expo-fetch",
      },
    });
  });
});
