import { creditedLicence, licenceDisplay, licenceOfTemplate } from "./licences";

describe("licenceOfTemplate (docs/SPEC.md Known unknown 15: the file page's licence templates)", () => {
  it.each([
    ["Template:Cc-zero", { family: "cc0", version: null, port: null }],
    ["Template:CC-zero", { family: "cc0", version: null, port: null }],
    ["Template:PD-self", { family: "pd", version: null, port: null }],
    ["Template:PD-user", { family: "pd", version: null, port: null }],
    ["Template:PD-author", { family: "pd", version: null, port: null }],
    ["Template:PD-user-w", { family: "pd", version: null, port: null }],
    ["Template:PD-user-at-project", { family: "pd", version: null, port: null }],
    ["Template:Cc-by-4.0", { family: "cc-by", version: "4.0", port: null }],
    ["Template:Cc-by-2.0", { family: "cc-by", version: "2.0", port: null }],
    ["Template:Cc-by-sa-3.0", { family: "cc-by-sa", version: "3.0", port: null }],
    ["Template:Cc-by-sa-2.5", { family: "cc-by-sa", version: "2.5", port: null }],
    ["Template:Cc-by-sa-3.0-nl", { family: "cc-by-sa", version: "3.0", port: "nl" }],
    ["Template:Cc-by-3.0-de", { family: "cc-by", version: "3.0", port: "de" }],
    ["Template:Cc-by-sa-3.0-igo", { family: "cc-by-sa", version: "3.0", port: "igo" }],
    ["Template:CC-BY-SA-4.0", { family: "cc-by-sa", version: "4.0", port: null }],
    // Any version of CC BY and CC BY-SA, and their ports (SPEC Known unknown 15, #72).
    ["Template:Cc-by-1.0", { family: "cc-by", version: "1.0", port: null }],
    ["Template:Cc-by-sa-1.0", { family: "cc-by-sa", version: "1.0", port: null }],
    ["Template:Cc-by-sa-2.1-jp", { family: "cc-by-sa", version: "2.1", port: "jp" }],
    ["Template:Cc-by-sa-2.5-scotland", { family: "cc-by-sa", version: "2.5", port: "scotland" }],
  ] as const)("maps %s to its licence", (title, licence) => {
    expect(licenceOfTemplate(title)).toEqual(licence);
  });

  it.each([
    // Not licences on the allowlist (Adam, 2026-11-09 21:27).
    "Template:GFDL",
    "Template:Cc-by-nc-sa-3.0",
    "Template:Cc-by-nd-4.0",
    // Public domain with a country limit, or unclear.
    "Template:PD-US",
    "Template:PD-old-70",
    "Template:PD-Art",
    "Template:PD-USGov",
    "Template:PD",
    // A version Creative Commons never published, and what only looks like a port.
    "Template:Cc-by-sa-9.9",
    "Template:Cc-by-sa-3.0-migrated",
    "Template:Cc-by-sa-3.0-n1",
    // Templates that are not licences, or not in the template namespace.
    "Template:Self",
    "Template:Information",
    "Template:Cc-by-sa-layout",
    "Cc-by-sa-4.0",
    "Category:CC-BY-SA-4.0",
    "",
  ])("maps %s to no licence on the list", (title) => {
    expect(licenceOfTemplate(title)).toBeNull();
  });
});

describe("creditedLicence (docs/SPEC.md 3.9: the first listed licence, in the order CC0, public domain, CC BY, CC BY-SA)", () => {
  it.each([
    [
      ["Template:Information", "Template:Self", "Template:GFDL", "Template:Cc-by-sa-3.0"],
      "cc-by-sa-3.0",
    ],
    [["Template:Cc-by-sa-4.0", "Template:Cc-by-4.0"], "cc-by-4.0"],
    [["Template:Cc-by-4.0", "Template:PD-self"], "pd"],
    [["Template:PD-self", "Template:Cc-zero"], "cc0"],
    // Within a family, the newest version, and the unported licence before a port (Crog's choice).
    [
      ["Template:Cc-by-sa-2.5", "Template:Cc-by-sa-3.0-nl", "Template:Cc-by-sa-3.0"],
      "cc-by-sa-3.0",
    ],
    [["Template:Cc-by-sa-3.0-nl", "Template:Cc-by-sa-3.0-de"], "cc-by-sa-3.0-de"],
    [["Template:Cc-by-sa-3.0-nl"], "cc-by-sa-3.0-nl"],
  ])("credits %j under %s", (titles, code) => {
    expect(creditedLicence(titles)).toBe(code);
  });

  it.each([
    [[]],
    [["Template:GFDL"]],
    [["Template:Information", "Template:PD-US", "Template:Cc-by-nc-4.0"]],
  ])("gives none for %j, whose templates map to no licence on the list", (titles) => {
    expect(creditedLicence(titles)).toBeNull();
  });
});

describe("licenceDisplay (docs/SPEC.md 3.9: the licence shown with the picture, linked to its deed)", () => {
  it.each([
    [
      "cc0",
      {
        kind: "named",
        name: "CC0 1.0",
        deed: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    ],
    [
      "cc-by-4.0",
      { kind: "named", name: "CC BY 4.0", deed: "https://creativecommons.org/licenses/by/4.0/" },
    ],
    [
      "cc-by-sa-2.5",
      {
        kind: "named",
        name: "CC BY-SA 2.5",
        deed: "https://creativecommons.org/licenses/by-sa/2.5/",
      },
    ],
    [
      "cc-by-sa-3.0-nl",
      {
        kind: "named",
        name: "CC BY-SA 3.0 NL",
        deed: "https://creativecommons.org/licenses/by-sa/3.0/nl/",
      },
    ],
    [
      "cc-by-3.0-igo",
      {
        kind: "named",
        name: "CC BY 3.0 IGO",
        deed: "https://creativecommons.org/licenses/by/3.0/igo/",
      },
    ],
    [
      "cc-by-1.0",
      { kind: "named", name: "CC BY 1.0", deed: "https://creativecommons.org/licenses/by/1.0/" },
    ],
    [
      "cc-by-sa-2.5-scotland",
      {
        kind: "named",
        name: "CC BY-SA 2.5 SCOTLAND",
        deed: "https://creativecommons.org/licenses/by-sa/2.5/scotland/",
      },
    ],
  ] as const)("names %s and links its deed", (code, display) => {
    expect(licenceDisplay(code)).toEqual(display);
  });

  it("gives public domain, which has no deed, as such", () => {
    expect(licenceDisplay("pd")).toEqual({ kind: "public-domain" });
  });

  it("shows a code it does not know as it is, without a link, as only a damaged file holds one", () => {
    expect(licenceDisplay("CC BY-SA 4.0")).toEqual({
      kind: "named",
      name: "CC BY-SA 4.0",
      deed: null,
    });
    expect(licenceDisplay("cc-by-sa-9.9")).toEqual({
      kind: "named",
      name: "cc-by-sa-9.9",
      deed: null,
    });
  });
});
