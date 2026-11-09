import {
  type Answer,
  type Match,
  parseAnswerText,
  parseStoredAnswerText,
} from "../analysis/answer";
import { answerToJson } from "./answerJson";

const match: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [
    {
      names: {
        sv: "Falsk kantarell",
        en: "False chanterelle",
        la: "Hygrophoropsis aurantiaca",
        it: "Falso gallinaccio",
      },
      edibility: "not_edible",
    },
  ],
};

describe("answerToJson", () => {
  it.each<[string, Answer]>([
    ["a match with look-alikes", match],
    ["a match without look-alikes", { ...match, lookAlikes: [] }],
    ["no mushroom", { result: "no_mushroom" }],
    ["cannot tell", { result: "cannot_tell" }],
  ])("writes %s so that the analysis module's validation reads it back unchanged", (_, answer) => {
    expect(parseAnswerText(answerToJson(answer))).toEqual({ ok: true, answer });
  });

  it("writes the answer in the API's own key names", () => {
    const written: unknown = JSON.parse(answerToJson(match));
    expect(written).toEqual({
      result: "match",
      names: match.names,
      edibility: "edible",
      confidence: 90,
      general_information: match.generalInformation,
      look_alikes: [{ names: match.lookAlikes[0]?.names, edibility: "not_edible" }],
    });
  });

  it("writes a Phase 1 answer's level as it was, so the store reads it back unchanged (SPEC 3.9)", () => {
    const phaseOne: Match = { ...match, confidence: "low" };
    expect(JSON.parse(answerToJson(phaseOne))).toMatchObject({ confidence: "low" });
    expect(parseStoredAnswerText(answerToJson(phaseOne))).toEqual({ ok: true, answer: phaseOne });
  });

  it("writes only the known keys of an answer that carries others at run time", () => {
    const names = { ...match.names, extra: "x" };
    const withExtra: Match = { ...match, names, lookAlikes: [] };
    expect(parseAnswerText(answerToJson(withExtra))).toEqual({
      ok: true,
      answer: { ...match, lookAlikes: [] },
    });
  });
});
