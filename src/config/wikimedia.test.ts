import { wikimediaConfig } from "./wikimedia";

/** A product token or contact of a User-Agent: printable ASCII without spaces (OkHttp refuses others). */
const ASCII_NO_SPACE = /^[\x21-\x7E]+$/;

describe("wikimediaConfig (docs/SPEC.md 3.9, Known unknown 15; PBI-2.9)", () => {
  it("asks only for Wikimedia's standard thumbnail widths, smallest first (SPEC 3.9)", () => {
    expect(wikimediaConfig.thumbnailWidths).toEqual([
      20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840,
    ]);
  });

  it("calls the Action APIs of Wikidata and Commons over https", () => {
    expect(wikimediaConfig.wikidataApiUrl).toBe("https://www.wikidata.org/w/api.php");
    expect(wikimediaConfig.commonsApiUrl).toBe("https://commons.wikimedia.org/w/api.php");
    expect(wikimediaConfig.pageHost).toBe("commons.wikimedia.org");
    expect(wikimediaConfig.mediaHostSuffix).toBe(".wikimedia.org");
  });

  it("names the repository and the library in the User-Agent, in ASCII (SPEC Known unknown 15)", () => {
    expect(wikimediaConfig.userAgentContact).toBe(
      "https://github.com/factoincognito/what-mushroom-is-this",
    );
    expect(wikimediaConfig.userAgentLibrary).toBe("expo-fetch");
    expect(wikimediaConfig.userAgentContact).toMatch(ASCII_NO_SPACE);
    expect(wikimediaConfig.userAgentLibrary).toMatch(ASCII_NO_SPACE);
  });

  it("takes the species rank by its Wikidata item, and at most the 50 items wbgetentities takes", () => {
    expect(wikimediaConfig.speciesRank).toBe("Q7432");
    expect(wikimediaConfig.searchLimit).toBe(50);
  });

  it("accepts every version of CC BY and CC BY-SA, and the ports not named by a country code (SPEC Known unknown 15, #72)", () => {
    expect(wikimediaConfig.ccVersions).toEqual(["1.0", "2.0", "2.1", "2.5", "3.0", "4.0"]);
    expect(wikimediaConfig.ccNamedPorts).toEqual(["igo", "scotland"]);
    expect(Object.isFrozen(wikimediaConfig.ccNamedPorts)).toBe(true);
  });

  it("counts as public domain only templates that say they apply worldwide, and as CC0 Commons' own", () => {
    expect(wikimediaConfig.cc0Templates).toEqual(["Cc-zero"]);
    expect(wikimediaConfig.publicDomainTemplates).toEqual([
      "PD-self",
      "PD-user",
      "PD-author",
      "PD-user-w",
      "PD-user-at-project",
    ]);
    // Templates with a country limit are not on it.
    for (const limited of ["PD-US", "PD-old", "PD-old-70", "PD-Art", "PD-USGov"]) {
      expect(wikimediaConfig.publicDomainTemplates).not.toContain(limited);
    }
  });

  it("has a time limit a timer can hold, a wait after a 429 or 503 of at least 5 s, and bounds", () => {
    const { requestTimeoutMs, retryWaitMinMs, retryAfterMaxMs, pictureMaxBytes } = wikimediaConfig;
    expect(Number.isInteger(requestTimeoutMs)).toBe(true);
    expect(requestTimeoutMs).toBeGreaterThan(0);
    expect(requestTimeoutMs).toBeLessThanOrEqual(2 ** 31 - 1);
    expect(retryWaitMinMs).toBe(5_000);
    expect(retryAfterMaxMs).toBe(24 * 60 * 60 * 1_000);
    expect(pictureMaxBytes).toBe(25 * 1024 * 1024);
  });

  it("counts as temporary only the API errors MediaWiki documents as such (Clead, #71)", () => {
    expect(wikimediaConfig.temporaryApiErrors).toEqual(["ratelimited", "maxlag", "readonly"]);
    expect(Object.isFrozen(wikimediaConfig.temporaryApiErrors)).toBe(true);
  });

  it("cannot be changed at run time", () => {
    expect(Object.isFrozen(wikimediaConfig)).toBe(true);
    expect(Object.isFrozen(wikimediaConfig.thumbnailWidths)).toBe(true);
    expect(Object.isFrozen(wikimediaConfig.publicDomainTemplates)).toBe(true);
  });
});
