/**
 * The self-check's comparison (docs/SPEC.md 3.9, "The self-check of a text lookup"): the text
 * answer's species against the species the photo lookup on its picture names.
 */

import type { Answer, Match, SpeciesNames } from "./answer";
import { sameSpecies, selfCheckOutcome } from "./selfCheck";

const CHANTERELLE: SpeciesNames = {
  sv: "Kantarell",
  en: "Chanterelle",
  la: "Cantharellus cibarius",
  it: "Gallinaccio",
};

function match(names: SpeciesNames, confidence = 90): Match {
  return {
    result: "match",
    names,
    edibility: "edible",
    confidence,
    generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
    lookAlikes: [],
  };
}

describe("sameSpecies (SPEC 3.9: the first two words of the Latin names, ignoring case)", () => {
  it.each([
    ["the same name", "Cantharellus cibarius", "Cantharellus cibarius"],
    ["another case", "Cantharellus cibarius", "cantharellus CIBARIUS"],
    ["an author after the two words", "Cantharellus cibarius", "Cantharellus cibarius Fr."],
    ["a variety after the two words", "Amanita muscaria var. formosa", "Amanita muscaria"],
    ["blanks around and between", "  Cantharellus   cibarius ", "Cantharellus\tcibarius"],
  ])("match for %s", (_name, a, b) => {
    expect(sameSpecies(a, b)).toBe(true);
    expect(sameSpecies(b, a)).toBe(true);
  });

  it.each([
    ["another species of the genus", "Cantharellus cibarius", "Cantharellus amethysteus"],
    ["another genus with the same epithet", "Boletus edulis", "Suillus edulis"],
    ["a genus alone on one side", "Russula", "Russula emetica"],
    ["a genus alone on both sides", "Russula", "Russula"],
    ["an empty name", "", "Russula emetica"],
    ["blanks alone", "   ", "   "],
  ])("do not match for %s", (_name, a, b) => {
    expect(sameSpecies(a, b)).toBe(false);
    expect(sameSpecies(b, a)).toBe(false);
  });
});

describe("selfCheckOutcome (SPEC 3.9: what the check came to)", () => {
  it("agrees when the check names the same species, whatever its own confidence", () => {
    expect(selfCheckOutcome(CHANTERELLE, match(CHANTERELLE, 1))).toEqual({ state: "agreed" });
    expect(
      selfCheckOutcome(CHANTERELLE, match({ ...CHANTERELLE, en: "Golden chanterelle" }, 100)),
    ).toEqual({ state: "agreed" });
  });

  it("disagrees when the check names another species, and keeps the names it gave", () => {
    const porcini = { sv: "Karljohanssvamp", en: "Porcini", la: "Boletus edulis", it: "Porcino" };
    expect(selfCheckOutcome(CHANTERELLE, match(porcini))).toEqual({
      state: "disagreed",
      names: porcini,
    });
  });

  it.each([
    ["no mushroom", { result: "no_mushroom" }],
    ["cannot tell", { result: "cannot_tell" }],
  ] as const)("could not name a species for %s", (_name, answer: Answer) => {
    expect(selfCheckOutcome(CHANTERELLE, answer)).toEqual({ state: "no-species" });
  });
});
