/**
 * The answer's shape (docs/SPEC.md 3.3, and 3.9 "Answers") and its validation. The model's text is
 * one JSON object of the shape `ANALYSIS_PROMPT` asks for; anything else is a
 * failed analysis with a reason.
 */

import { config } from "../config/config";

export const EDIBILITIES = [
  "edible",
  "edible_after_preparation",
  "not_edible",
  "poisonous",
  "deadly_poisonous",
  "unknown",
] as const;
export type Edibility = (typeof EDIBILITIES)[number];

/** The confidence levels of Phase 1 (docs/SPEC.md 3.3), which a find analysed then keeps (3.9). */
export const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** The range of a confidence from Phase 2 on (docs/SPEC.md 3.9): a whole number, low to high. */
export const MIN_CONFIDENCE_SCORE = 1;
export const MAX_CONFIDENCE_SCORE = 100;

/**
 * Claude's confidence in a match: a whole number from 1 to 100 (docs/SPEC.md 3.9), or the level
 * of an answer given in Phase 1, which the find keeps until it is analysed again.
 */
export type Confidence = number | ConfidenceLevel;

/** A species' names in Swedish, English, Latin and Italian. */
export interface SpeciesNames {
  sv: string;
  en: string;
  la: string;
  it: string;
}

/** A text in the three app languages. */
export interface Texts {
  sv: string;
  en: string;
  it: string;
}

export interface LookAlike {
  names: SpeciesNames;
  edibility: Edibility;
}

/**
 * The best match, as Claude gave it. `C` is the form its confidence may take: either form for an
 * answer the store holds, a number alone for one from the API (`ApiMatch`).
 */
export interface Match<C extends Confidence = Confidence> {
  result: "match";
  names: SpeciesNames;
  edibility: Edibility;
  confidence: C;
  generalInformation: Texts;
  lookAlikes: LookAlike[];
}

export type Answer<C extends Confidence = Confidence> =
  | Match<C>
  | { result: "no_mushroom" }
  | { result: "cannot_tell" };

/**
 * An answer as the API gives it, from Phase 2 on (docs/SPEC.md 3.9): its confidence a whole number
 * from 1 to 100, never a Phase 1 level, so that the type check holds that a level is never written
 * again (PBI-2.12). It is an `Answer` too, so whatever reads an answer reads it.
 */
export type ApiMatch = Match<number>;
export type ApiAnswer = Answer<number>;

/**
 * Why an answer was not accepted: not from the API at all, not of the shape, or refused by
 * Claude (`stop_reason` `refusal`), which is not a shape failure.
 */
export type AnswerFailure = { ok: false; reason: "not-api" | "shape" | "refused"; detail: string };
/** An answer read, of the form `A`, or why it was not accepted. */
export type AnswerResult<A extends Answer = Answer> = { ok: true; answer: A } | AnswerFailure;

/**
 * The edibility to show (docs/SPEC.md 3.9): "unknown" below a confidence of `line`, the
 * configuration's 70 unless another is given, whatever the answer said; for a Phase 1 find's
 * level, "unknown" when it is low (3.3), whatever the line. It takes the edibility and the
 * confidence alone, so that a match and the Log's summary of one follow the same rule.
 */
export function shownEdibility(
  match: Pick<Match, "edibility" | "confidence">,
  line: number = config.edibilityConfidenceLine,
): Edibility {
  const { confidence } = match;
  // Written as "not at or above the line", so a number no answer can hold (NaN) shows "unknown".
  const tooLow = typeof confidence === "number" ? !(confidence >= line) : confidence === "low";
  return tooLow ? "unknown" : match.edibility;
}

/**
 * The `stop_reason` values of a truncated answer (Claude docs, "Stop reasons and fallback",
 * https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons, read 2026-11-09):
 * `max_tokens`, "The response reached your max_tokens limit", and
 * `model_context_window_exceeded`, "Treat the response as truncated".
 */
export const CUT_OFF_STOP_REASONS = ["max_tokens", "model_context_window_exceeded"];

/**
 * The `stop_reason` of a refusal (the same page): "Claude declined to respond", returned "as a
 * normal HTTP 200 response, not an error".
 */
export const REFUSAL_STOP_REASON = "refusal";

/**
 * Reads the body of a 2xx answer of the Messages API. The answer is the text of its text
 * blocks, joined in their order with nothing between them; the thinking blocks that Claude 5
 * models put before it (`thinking`, `redacted_thinking`; Claude docs, "Thinking",
 * https://platform.claude.com/docs/en/build-with-claude/thinking, read 2026-11-09) and any other
 * block are skipped. A cut-off answer and a refusal each fail with their own detail, whatever
 * the text holds; a refusal fails with its own reason, `refused`.
 */
export function readMessageBody(body: string): AnswerResult<ApiAnswer> {
  const notApi: AnswerFailure = {
    ok: false,
    reason: "not-api",
    detail: "the body is not a Messages API message",
  };
  const parsed = parseJson(body);
  if (!parsed.ok || !isRecord(parsed.value) || parsed.value.type !== "message") {
    return notApi;
  }
  const content = parsed.value.content;
  if (!Array.isArray(content)) {
    return notApi;
  }
  const texts: unknown[] = [];
  for (const block of content) {
    if (!isRecord(block)) {
      return notApi;
    }
    if (block.type === "text") {
      texts.push(block.text);
    }
  }
  const stopReason = parsed.value.stop_reason;
  if (typeof stopReason === "string" && CUT_OFF_STOP_REASONS.includes(stopReason)) {
    return shapeFailure(`the answer was cut off (stop_reason ${stopReason})`);
  }
  if (stopReason === REFUSAL_STOP_REASON) {
    return {
      ok: false,
      reason: "refused",
      detail: `the answer was refused (stop_reason ${REFUSAL_STOP_REASON})`,
    };
  }
  if (texts.length === 0) {
    return shapeFailure("the message has no text block");
  }
  let text = "";
  for (const part of texts) {
    if (typeof part !== "string") {
      return shapeFailure("a text block's text is not a string");
    }
    text += part;
  }
  return parseAnswerText(text);
}

/**
 * Reads the model's text: one JSON object, with whitespace around it and nothing else. Its
 * confidence is a whole number from 1 to 100 (docs/SPEC.md 3.9); a level fails the shape.
 */
export function parseAnswerText(text: string): AnswerResult<ApiAnswer> {
  return parseText(text, readScore);
}

/**
 * Reads an answer the store holds, as `parseAnswerText` reads one from the API, but its confidence
 * may also be the level of an answer given in Phase 1, which the find keeps until it is analysed
 * again (docs/SPEC.md 3.9).
 */
export function parseStoredAnswerText(text: string): AnswerResult {
  return parseText(text, readStoredConfidence);
}

/** Whether a value is a confidence from Phase 2 on: a whole number from 1 to 100. */
export function isConfidenceScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_CONFIDENCE_SCORE &&
    value <= MAX_CONFIDENCE_SCORE
  );
}

/** Reads the text as an answer whose confidence `readConfidence` reads. */
function parseText<C extends Confidence>(
  text: string,
  readConfidence: (value: unknown) => Read<C>,
): AnswerResult<Answer<C>> {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return shapeFailure("the answer is not JSON");
  }
  if (!isRecord(parsed.value)) {
    return shapeFailure("the answer is not an object");
  }
  const answer = readAnswer(parsed.value, readConfidence);
  return answer.ok ? { ok: true, answer: answer.value } : shapeFailure(answer.detail);
}

type Read<T> = { ok: true; value: T } | { ok: false; detail: string };

function fail(detail: string): { ok: false; detail: string } {
  return { ok: false, detail };
}

const MATCH_KEYS = [
  "result",
  "names",
  "edibility",
  "confidence",
  "general_information",
  "look_alikes",
];

function readAnswer<C extends Confidence>(
  value: Record<string, unknown>,
  readConfidence: (value: unknown) => Read<C>,
): Read<Answer<C>> {
  const result = value.result;
  if (result === "no_mushroom" || result === "cannot_tell") {
    return hasOnlyKeys(value, ["result"])
      ? { ok: true, value: { result } }
      : fail("the answer has an unknown key");
  }
  if (result !== "match") {
    return fail("result is not one of match, no_mushroom, cannot_tell");
  }
  if (!hasOnlyKeys(value, MATCH_KEYS)) {
    return fail("the answer has an unknown key");
  }
  const names = readNames(value.names, "names");
  if (!names.ok) {
    return names;
  }
  const edibility = readEdibility(value.edibility, "edibility");
  if (!edibility.ok) {
    return edibility;
  }
  const confidence = readConfidence(value.confidence);
  if (!confidence.ok) {
    return confidence;
  }
  const generalInformation = readTexts(value.general_information, "general_information");
  if (!generalInformation.ok) {
    return generalInformation;
  }
  const lookAlikes = readLookAlikes(value.look_alikes);
  if (!lookAlikes.ok) {
    return lookAlikes;
  }
  return {
    ok: true,
    value: {
      result: "match",
      names: names.value,
      edibility: edibility.value,
      confidence: confidence.value,
      generalInformation: generalInformation.value,
      lookAlikes: lookAlikes.value,
    },
  };
}

function readLookAlikes(value: unknown): Read<LookAlike[]> {
  if (!Array.isArray(value)) {
    return fail("look_alikes is not an array");
  }
  const lookAlikes: LookAlike[] = [];
  for (const [index, item] of value.entries()) {
    const path = `look_alikes[${index}]`;
    if (!isRecord(item)) {
      return fail(`${path} is not an object`);
    }
    if (!hasOnlyKeys(item, ["names", "edibility"])) {
      return fail(`${path} has an unknown key`);
    }
    const names = readNames(item.names, `${path}.names`);
    if (!names.ok) {
      return names;
    }
    const edibility = readEdibility(item.edibility, `${path}.edibility`);
    if (!edibility.ok) {
      return edibility;
    }
    lookAlikes.push({ names: names.value, edibility: edibility.value });
  }
  return { ok: true, value: lookAlikes };
}

/**
 * The confidence of an answer from the API: a whole number from 1 to 100. JSON gives a number
 * written as 85.0 or 1e2 as 85 and 100, so those are whole numbers too; nothing is coerced from
 * text.
 */
function readScore(value: unknown): Read<number> {
  return isConfidenceScore(value)
    ? { ok: true, value }
    : fail("confidence is not a whole number from 1 to 100");
}

/** The confidence of an answer the store holds: as `readScore` reads it, or a Phase 1 level. */
function readStoredConfidence(value: unknown): Read<Confidence> {
  if (isConfidenceScore(value) || isConfidenceLevel(value)) {
    return { ok: true, value };
  }
  return fail("confidence is neither a whole number from 1 to 100 nor one of low, medium, high");
}

function readEdibility(value: unknown, path: string): Read<Edibility> {
  return isEdibility(value) ? { ok: true, value } : fail(`${path} is not one of the six values`);
}

function readNames(value: unknown, path: string): Read<SpeciesNames> {
  if (!isRecord(value)) {
    return fail(`${path} is not an object`);
  }
  if (!hasOnlyKeys(value, ["sv", "en", "la", "it"])) {
    return fail(`${path} has an unknown key`);
  }
  const sv = readText(value, "sv", path);
  if (!sv.ok) {
    return sv;
  }
  const en = readText(value, "en", path);
  if (!en.ok) {
    return en;
  }
  const la = readText(value, "la", path);
  if (!la.ok) {
    return la;
  }
  const it = readText(value, "it", path);
  if (!it.ok) {
    return it;
  }
  return { ok: true, value: { sv: sv.value, en: en.value, la: la.value, it: it.value } };
}

function readTexts(value: unknown, path: string): Read<Texts> {
  if (!isRecord(value)) {
    return fail(`${path} is not an object`);
  }
  if (!hasOnlyKeys(value, ["sv", "en", "it"])) {
    return fail(`${path} has an unknown key`);
  }
  const sv = readText(value, "sv", path);
  if (!sv.ok) {
    return sv;
  }
  const en = readText(value, "en", path);
  if (!en.ok) {
    return en;
  }
  const it = readText(value, "it", path);
  if (!it.ok) {
    return it;
  }
  return { ok: true, value: { sv: sv.value, en: en.value, it: it.value } };
}

/** A non-empty string; one of blanks only counts as empty. */
function readText(record: Record<string, unknown>, key: string, path: string): Read<string> {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? { ok: true, value }
    : fail(`${path}.${key} is not a non-empty string`);
}

function shapeFailure(detail: string): AnswerFailure {
  return { ok: false, reason: "shape", detail };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** A plain JSON object, not an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isEdibility(value: unknown): value is Edibility {
  return EDIBILITIES.some((edibility) => edibility === value);
}

/** Whether a value is a Phase 1 level; only a stored answer's confidence may be one. */
function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return CONFIDENCE_LEVELS.some((level) => level === value);
}
