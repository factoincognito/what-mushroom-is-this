import type { Answer, SpeciesNames } from "../analysis/answer";

/**
 * Writes an answer as the JSON the API gives it in (the shape of docs/SPEC.md 3.3, with the
 * API's key names), so that the analysis module's `parseAnswerText` validates it on the way
 * back. Only the known keys are written. An answer whose parts are not of their types at run
 * time can make it throw; the store treats that as an answer it does not accept.
 */
export function answerToJson(answer: Answer): string {
  if (answer.result !== "match") {
    return JSON.stringify({ result: answer.result });
  }
  const { sv, en, it } = answer.generalInformation;
  return JSON.stringify({
    result: "match",
    names: names(answer.names),
    edibility: answer.edibility,
    confidence: answer.confidence,
    general_information: { sv, en, it },
    look_alikes: answer.lookAlikes.map((lookAlike) => ({
      names: names(lookAlike.names),
      edibility: lookAlike.edibility,
    })),
  });
}

function names({ sv, en, la, it }: SpeciesNames): SpeciesNames {
  return { sv, en, la, it };
}
