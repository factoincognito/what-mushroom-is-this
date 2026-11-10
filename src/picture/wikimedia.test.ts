import entitiesChanterelle from "./__tests__/fixtures/entities-chanterelle.json";
import entitiesHomonyms from "./__tests__/fixtures/entities-homonyms.json";
import fileInfoChanterelle from "./__tests__/fixtures/fileinfo-chanterelle.json";
import fileInfoMissing from "./__tests__/fixtures/fileinfo-missing.json";
import fileInfoSmallPd from "./__tests__/fixtures/fileinfo-small-pd.json";
import searchChanterelle from "./__tests__/fixtures/search-chanterelle.json";
import searchNone from "./__tests__/fixtures/search-none.json";
import thumbChanterelle from "./__tests__/fixtures/thumb-chanterelle.json";
import {
  chooseImageFile,
  entitiesUrl,
  fileInfoUrl,
  isMediaUrl,
  pictureUserAgent,
  plainText,
  readFileInfo,
  readSearch,
  readThumbnail,
  searchUrl,
  sendableName,
  standardWidthFor,
  thumbnailUrl,
} from "./wikimedia";

/** A fixture changed for one case, the fixture itself left as it is. */
function changed<T>(fixture: T, change: (copy: T) => void): T {
  const copy: T = JSON.parse(JSON.stringify(fixture));
  change(copy);
  return copy;
}

/** The query of an address, as its parameters. */
function query(url: string): Record<string, string> {
  const at = url.indexOf("?");
  return Object.fromEntries(new URLSearchParams(url.slice(at + 1)).entries());
}

describe("sendableName (docs/SPEC.md 3.9: only the Latin name is sent)", () => {
  it.each([
    ["Cantharellus cibarius", "Cantharellus cibarius"],
    ["  Cantharellus   cibarius ", "Cantharellus cibarius"],
    ["Amanita muscaria var. formosa", "Amanita muscaria var. formosa"],
    ["Mentha × piperita", "Mentha × piperita"],
    ["Hygrophoropsis aurantiaca", "Hygrophoropsis aurantiaca"],
  ])("sends %j as %j", (name, sent) => {
    expect(sendableName(name)).toBe(sent);
  });

  it.each([
    ["an empty name", ""],
    ["blanks", "   "],
    ["a quote, which would end the search's phrase", 'Cantharellus" OR "x'],
    ["a search keyword's colon", "haswbstatement:P31=Q5"],
    ["a backslash", "Cantharellus\\ cibarius"],
    ["a digit", "Cantharellus 2"],
    ["a line break", "Cantharellus\ncibarius"],
    ["a name past 200 characters", `Cantharellus ${"a".repeat(200)}`],
  ])("sends nothing for %s", (_name, name) => {
    expect(sendableName(name)).toBeNull();
  });
});

describe("the calls (product office phase-2-checks.md, section 5)", () => {
  it("searches Wikidata by the taxon name, P225, and nothing else", () => {
    const url = searchUrl("Cantharellus cibarius");
    expect(url.startsWith("https://www.wikidata.org/w/api.php?")).toBe(true);
    expect(query(url)).toEqual({
      action: "query",
      list: "search",
      srsearch: 'haswbstatement:"P225=Cantharellus cibarius"',
      srlimit: "50",
      format: "json",
      formatversion: "2",
    });
  });

  it("reads the items' claims and sitelinks", () => {
    const url = entitiesUrl(["Q1001", "Q1002"]);
    expect(url.startsWith("https://www.wikidata.org/w/api.php?")).toBe(true);
    expect(query(url)).toEqual({
      action: "wbgetentities",
      ids: "Q1001|Q1002",
      props: "claims|sitelinks",
      format: "json",
      formatversion: "2",
    });
  });

  it("reads the Commons file's size, address, page, author and licence templates", () => {
    const url = fileInfoUrl("Chanterelle Cantharellus cibarius.jpg");
    expect(url.startsWith("https://commons.wikimedia.org/w/api.php?")).toBe(true);
    expect(query(url)).toEqual({
      action: "query",
      titles: "File:Chanterelle Cantharellus cibarius.jpg",
      prop: "imageinfo|templates",
      iiprop: "url|size|mime|extmetadata",
      iiextmetadatafilter: "Artist",
      iiextmetadatalanguage: "en",
      tlnamespace: "10",
      tllimit: "max",
      format: "json",
      formatversion: "2",
    });
  });

  it("asks for the thumbnail at the width given", () => {
    const url = thumbnailUrl("Chanterelle Cantharellus cibarius.jpg", 1280);
    expect(query(url)).toEqual({
      action: "query",
      titles: "File:Chanterelle Cantharellus cibarius.jpg",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "1280",
      format: "json",
      formatversion: "2",
    });
  });
});

describe("readSearch", () => {
  it("gives the items found, in the search's order", () => {
    expect(readSearch(searchChanterelle)).toEqual(["Q1001"]);
    expect(readSearch(searchNone)).toEqual([]);
  });

  it("passes over a result that is not an item", () => {
    const answer = changed(searchChanterelle, (copy) => {
      copy.query.search.unshift({ ...copy.query.search[0], title: "Property:P225" } as never);
    });
    expect(readSearch(answer)).toEqual(["Q1001"]);
  });

  it.each([
    ["no query", { batchcomplete: true }],
    ["an API error", { error: { code: "badvalue", info: "x" } }],
    ["a search that is not a list", { query: { search: {} } }],
    ["not an object", "Cantharellus"],
    ["null", null],
  ])("gives null for %s, which is not of the shape", (_name, answer) => {
    expect(readSearch(answer)).toBeNull();
  });
});

describe("chooseImageFile (Clead's decisions 1 and 2)", () => {
  it("takes the species item's image", () => {
    expect(chooseImageFile(entitiesChanterelle, ["Q1001"], "Cantharellus cibarius")).toEqual({
      ok: true,
      file: "Chanterelle Cantharellus cibarius.jpg",
    });
  });

  it("among the items of the name, ignoring case, takes those of species rank, with an image, and of them the one with the most sitelinks; not a deprecated name, another name or a missing item", () => {
    const ids = ["Q1101", "Q1102", "Q1103", "Q1104", "Q1105", "Q1106", "Q1107"];
    expect(chooseImageFile(entitiesHomonyms, ids, "Amanita virosa")).toEqual({
      ok: true,
      file: "Most sitelinks.jpg",
    });
  });

  it("takes the first of the search's order when two have as many sitelinks", () => {
    const answer = changed(entitiesHomonyms, (copy) => {
      copy.entities.Q1104.sitelinks = copy.entities.Q1103.sitelinks as never;
    });
    expect(chooseImageFile(answer, ["Q1104", "Q1103"], "Amanita virosa")).toEqual({
      ok: true,
      file: "Fewer sitelinks.jpg",
    });
  });

  it("gives no item when none of the name is of species rank", () => {
    expect(
      chooseImageFile(entitiesHomonyms, ["Q1101", "Q1105", "Q1106"], "Amanita virosa"),
    ).toEqual({ ok: false, reason: "no-item" });
    expect(chooseImageFile(entitiesChanterelle, ["Q1001"], "Cantharellus friesii")).toEqual({
      ok: false,
      reason: "no-item",
    });
  });

  it("gives no image when the species items of the name have none", () => {
    expect(chooseImageFile(entitiesHomonyms, ["Q1102"], "Amanita virosa")).toEqual({
      ok: false,
      reason: "no-image",
    });
  });

  it("does not count a deprecated rank claim", () => {
    const answer = changed(entitiesChanterelle, (copy) => {
      const [rank] = copy.entities.Q1001.claims.P105;
      if (rank !== undefined) {
        rank.rank = "deprecated";
      }
    });
    expect(chooseImageFile(answer, ["Q1001"], "Cantharellus cibarius")).toEqual({
      ok: false,
      reason: "no-item",
    });
  });

  it("takes the first image of preferred rank, else the first of normal rank, never a deprecated one", () => {
    const image = (value: string, rank: string) => ({
      mainsnak: { snaktype: "value", property: "P18", datavalue: { value, type: "string" } },
      type: "statement",
      rank,
    });
    const withImages = (images: unknown[]) =>
      changed(entitiesChanterelle, (copy) => {
        copy.entities.Q1001.claims.P18 = images as never;
      });
    const choose = (images: unknown[]) =>
      chooseImageFile(withImages(images), ["Q1001"], "Cantharellus cibarius");
    expect(
      choose([
        image("Deprecated.jpg", "deprecated"),
        image("Normal 1.jpg", "normal"),
        image("Preferred 1.jpg", "preferred"),
        image("Preferred 2.jpg", "preferred"),
      ]),
    ).toEqual({ ok: true, file: "Preferred 1.jpg" });
    expect(
      choose([image("Deprecated.jpg", "deprecated"), image("Normal 1.jpg", "normal")]),
    ).toEqual({ ok: true, file: "Normal 1.jpg" });
    expect(choose([image("Deprecated.jpg", "deprecated")])).toEqual({
      ok: false,
      reason: "no-image",
    });
    // A claim with no value ("somevalue") is no image.
    expect(
      choose([{ mainsnak: { snaktype: "somevalue", property: "P18" }, rank: "preferred" }]),
    ).toEqual({ ok: false, reason: "no-image" });
  });

  it.each([
    ["no entities", { success: 1 }],
    ["an API error", { error: { code: "no-such-entity" } }],
    ["not an object", []],
  ])("gives an answer not of the shape for %s", (_name, answer) => {
    expect(chooseImageFile(answer, ["Q1001"], "Cantharellus cibarius")).toEqual({
      ok: false,
      reason: "answer",
    });
  });
});

describe("readFileInfo (Clead's decisions 3 and 4)", () => {
  it("reads the size, the original's address, the page, the author as text and the licence to credit", () => {
    expect(readFileInfo(fileInfoChanterelle)).toEqual({
      ok: true,
      width: 4000,
      height: 3000,
      url: "https://upload.wikimedia.org/wikipedia/commons/1/1a/Chanterelle_Cantharellus_cibarius.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=original",
      page: "https://commons.wikimedia.org/wiki/File:Chanterelle_Cantharellus_cibarius.jpg",
      author: "Example Photographer & Ann Exempel",
      licence: "cc-by-sa-3.0",
    });
    expect(readFileInfo(fileInfoSmallPd)).toMatchObject({
      ok: true,
      width: 800,
      author: "Ann Exempel",
      licence: "pd",
    });
  });

  it("gives no image for a file Commons does not have", () => {
    expect(readFileInfo(fileInfoMissing)).toEqual({ ok: false, reason: "no-image" });
  });

  it("gives a licence not allowed for a file whose templates map to none on the list", () => {
    const answer = changed(fileInfoChanterelle, (copy) => {
      const [page] = copy.query.pages;
      if (page !== undefined) {
        page.templates = page.templates.filter((each) => each.title !== "Template:Cc-by-sa-3.0");
      }
    });
    expect(readFileInfo(answer)).toEqual({ ok: false, reason: "licence" });
  });

  it.each([
    [
      "no Artist",
      (info: Record<string, unknown>) => {
        info.extmetadata = {};
      },
    ],
    [
      "no extmetadata",
      (info: Record<string, unknown>) => {
        delete info.extmetadata;
      },
    ],
    [
      "an Artist of markup alone",
      (info: Record<string, unknown>) => {
        info.extmetadata = { Artist: { value: "<span> &nbsp; </span>", source: "x" } };
      },
    ],
    [
      "an Artist that is not text",
      (info: Record<string, unknown>) => {
        info.extmetadata = { Artist: { value: 7, source: "x" } };
      },
    ],
  ])(
    "gives no author for %s: no machine-readable author, no picture (Adam, 2026-11-10 00:10)",
    (_name, change) => {
      const answer = changed(fileInfoChanterelle, (copy) => {
        const info = copy.query.pages[0]?.imageinfo[0];
        if (info !== undefined) {
          change(info as unknown as Record<string, unknown>);
        }
      });
      expect(readFileInfo(answer)).toEqual({ ok: false, reason: "no-author" });
    },
  );

  it.each([
    [
      "a page that is not on Commons",
      (info: Record<string, unknown>) => {
        info.descriptionurl = "https://example.org/wiki/File:X.jpg";
      },
    ],
    [
      "a page that is not https",
      (info: Record<string, unknown>) => {
        info.descriptionurl = "http://commons.wikimedia.org/wiki/File:X.jpg";
      },
    ],
    [
      "an original not on a Wikimedia host",
      (info: Record<string, unknown>) => {
        info.url = "https://example.org/X.jpg";
      },
    ],
    [
      "a width of nought",
      (info: Record<string, unknown>) => {
        info.width = 0;
      },
    ],
    [
      "a height that is not whole",
      (info: Record<string, unknown>) => {
        info.height = 3000.5;
      },
    ],
  ])("gives an answer not of the shape for %s", (_name, change) => {
    const answer = changed(fileInfoChanterelle, (copy) => {
      const info = copy.query.pages[0]?.imageinfo[0];
      if (info !== undefined) {
        change(info as unknown as Record<string, unknown>);
      }
    });
    expect(readFileInfo(answer)).toEqual({ ok: false, reason: "answer" });
  });

  it.each([
    ["no pages", { query: {} }],
    ["a page without imageinfo", { query: { pages: [{ ns: 6, title: "File:X.jpg" }] } }],
    [
      "templates that are not a list",
      changed(fileInfoChanterelle, (copy) => {
        const [page] = copy.query.pages;
        if (page !== undefined) {
          page.templates = "Template:Cc-zero" as never;
        }
      }),
    ],
    ["not an object", 3],
  ])("gives an answer not of the shape for %s", (_name, answer) => {
    expect(readFileInfo(answer)).toEqual({ ok: false, reason: "answer" });
  });
});

describe("readThumbnail", () => {
  it("gives the thumbnail's address", () => {
    expect(readThumbnail(thumbChanterelle)).toBe(
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1a/Chanterelle_Cantharellus_cibarius.jpg/3840px-Chanterelle_Cantharellus_cibarius.jpg?utm_source=commons.wikimedia.org&utm_campaign=index&utm_content=thumbnail",
    );
  });

  it("gives null for an answer without one, or one not on a Wikimedia host", () => {
    expect(readThumbnail(fileInfoMissing)).toBeNull();
    expect(
      readThumbnail(
        changed(thumbChanterelle, (copy) => {
          const [info] = copy.query.pages[0]?.imageinfo ?? [];
          if (info !== undefined) {
            info.thumburl = "https://thumb.wikimedia.org.example.com/x.jpg";
          }
        }),
      ),
    ).toBeNull();
  });
});

describe("standardWidthFor (docs/SPEC.md 3.9: the smallest standard width at or above the need)", () => {
  it.each([
    [1, 20],
    [20, 20],
    [21, 40],
    [1270, 1280],
    [1280, 1280],
    [1281, 1920],
    [2212, 3840],
    [3840, 3840],
    [5000, 3840],
  ])("gives %i px the width %i", (need, width) => {
    expect(standardWidthFor(need)).toBe(width);
  });
});

describe("isMediaUrl", () => {
  it.each([
    ["https://upload.wikimedia.org/wikipedia/commons/1/1a/X.jpg", true],
    [
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1a/X.jpg/1280px-X.jpg?utm_source=x",
      true,
    ],
    ["http://upload.wikimedia.org/X.jpg", false],
    ["https://wikimedia.org.example.com/X.jpg", false],
    ["https://example.org/upload.wikimedia.org/X.jpg", false],
    ["https://user@upload.wikimedia.org/X.jpg", false],
    ["https://upload.wikimedia.org:8443/X.jpg", false],
    ["//upload.wikimedia.org/X.jpg", false],
  ])("judges %s %s", (url, media) => {
    expect(isMediaUrl(url)).toBe(media);
  });
});

describe("plainText (Clead's decision 4: Artist, its HTML stripped to text)", () => {
  it.each([
    ["Ann Exempel", "Ann Exempel"],
    ['<a href="//commons.wikimedia.org/wiki/User:X">X&nbsp;Y</a>', "X Y"],
    ["Line one<br/>line two<br>end", "Line one line two end"],
    ["A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x46;&#70;", "A & B <c> \"d\" 'e' FF"],
    ["  spaced \n\t out  ", "spaced out"],
    ["<span>&unknown;</span>", "&unknown;"],
  ])("gives %j as %j", (html, text) => {
    expect(plainText(html)).toBe(text);
  });
});

describe("pictureUserAgent (Clead's decision 5)", () => {
  it("names the app and its version from app.json, the repository and the library", () => {
    expect(pictureUserAgent({ name: "Washroom", version: "0.1.0" })).toBe(
      "Washroom/0.1.0 (https://github.com/factoincognito/what-mushroom-is-this) expo-fetch",
    );
  });

  it.each([
    ["no config", null],
    ["no version", { name: "Washroom" }],
    ["a name with a space", { name: "Wash room", version: "0.1.0" }],
    ["a version that is not ASCII", { name: "Washroom", version: "0.1.0é" }],
    ["a version that is not text", { name: "Washroom", version: 1 }],
  ])("is null for %s, so nothing is sent with a generic agent", (_name, expoConfig) => {
    expect(pictureUserAgent(expoConfig)).toBeNull();
  });
});
