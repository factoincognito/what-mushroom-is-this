import { fs, PROJECT_ROOT, path } from "../testing/projectFiles";
import { MAP_USER_AGENT_ID, mapUserAgent, setMapUserAgent } from "./mapRequests";

const appJson: { expo: { name: string; version: string } } = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "app.json"), "utf8"),
);

describe("mapUserAgent: the app's own User-Agent for the map's requests (SPEC 3.9)", () => {
  it("names the app, its version and the repository's address, from the app's config", () => {
    expect(mapUserAgent({ name: "Wushroom", version: "0.1.0" })).toBe(
      "Wushroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this)",
    );
  });

  it("is built from app.json's name and version as the build gives them", () => {
    expect(mapUserAgent(appJson.expo)).toBe(
      `${appJson.expo.name}/${appJson.expo.version} (https://github.com/factoincognito/what-mushroom-is-this)`,
    );
  });

  it.each<[string, unknown]>([
    ["no config", null],
    ["no config at all", undefined],
    ["a config without a name", { version: "0.1.0" }],
    ["a config without a version", { name: "Wushroom" }],
    ["an empty name", { name: "", version: "0.1.0" }],
    ["a name that is not a string", { name: 7, version: "0.1.0" }],
    ["a name with a space, which a product token cannot hold", { name: "Wush room", version: "1" }],
    ["a name with a slash", { name: "Wush/room", version: "1" }],
    ["a version with a character outside ASCII", { name: "Wushroom", version: "0.1.0é" }],
  ])("is null for %s, so the library's own User-Agent stays", (_name, expoConfig) => {
    expect(mapUserAgent(expoConfig)).toBeNull();
  });
});

describe("setMapUserAgent", () => {
  function manager() {
    return { addHeader: jest.fn((options: { id?: string }) => options.id ?? "generated") };
  }

  it("sets the header on every request of the map library, by one fixed transform ID", () => {
    const requests = manager();
    expect(setMapUserAgent(requests, { name: "Wushroom", version: "0.1.0" })).toBe(true);
    expect(requests.addHeader).toHaveBeenCalledTimes(1);
    expect(requests.addHeader).toHaveBeenCalledWith({
      id: MAP_USER_AGENT_ID,
      name: "User-Agent",
      value: "Wushroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this)",
    });
    expect(requests.addHeader.mock.calls[0]?.[0]).not.toHaveProperty("match");
  });

  it("sets it again under the same ID, which replaces the earlier one in place", () => {
    const requests = manager();
    setMapUserAgent(requests, { name: "Wushroom", version: "0.1.0" });
    setMapUserAgent(requests, { name: "Wushroom", version: "0.1.0" });
    const ids = requests.addHeader.mock.calls.map(([options]) => options.id);
    expect(ids).toEqual([MAP_USER_AGENT_ID, MAP_USER_AGENT_ID]);
  });

  it("sets nothing when the User-Agent cannot be built", () => {
    const requests = manager();
    expect(setMapUserAgent(requests, null)).toBe(false);
    expect(requests.addHeader).not.toHaveBeenCalled();
  });

  it("gives false when the library refuses the header, and does not throw", () => {
    const requests = {
      addHeader: jest.fn(() => {
        throw new Error("native module missing");
      }),
    };
    expect(setMapUserAgent(requests, { name: "Wushroom", version: "0.1.0" })).toBe(false);
  });
});
