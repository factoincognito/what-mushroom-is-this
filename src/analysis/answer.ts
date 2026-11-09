/**
 * The answer's shape (docs/SPEC.md 3.3) and its validation. The model's text is
 * one JSON object of the shape `ANALYSIS_PROMPT` asks for; anything else is a
 * failed analysis with a reason.
 */

export const EDIBILITIES = [
  "edible",
  "edible_after_preparation",
  "not_edible",
  "poisonous",
  "deadly_poisonous",
  "unknown",
] as const;
export type Edibility = (typeof EDIBILITIES)[number];

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

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

/** The best match, as Claude gave it. */
export interface Match {
  result: "match";
  names: SpeciesNames;
  edibility: Edibility;
  confidence: Confidence;
  generalInformation: Texts;
  lookAlikes: LookAlike[];
}

export type Answer = Match | { result: "no_mushroom" } | { result: "cannot_tell" };

/**
 * Why an answer was not accepted: not from the API at all, not of the shape, or refused by
 * Claude (`stop_reason` `refusal`), which is not a shape failure.
 */
export type AnswerFailure = { ok: false; reason: "not-api" | "shape" | "refused"; detail: string };
export type AnswerResult = { ok: true; answer: Answer } | AnswerFailure;

/** The edibility to show: "unknown" whenever the confidence is low. */
export function shownEdibility(match: Match): Edibility {
  return match.confidence === "low" ? "unknown" : match.edibility;
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
export function readMessageBody(body: string): AnswerResult {
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

/** Reads the model's text: one JSON object, with whitespace around it and nothing else. */
export function parseAnswerText(text: string): AnswerResult {
  const parsed = parseJson(text);
  if (!parsed.ok) {
    return shapeFailure("the answer is not JSON");
  }
  if (!isRecord(parsed.value)) {
    return shapeFailure("the answer is not an object");
  }
  const answer = readAnswer(parsed.value);
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

function readAnswer(value: Record<string, unknown>): Read<Answer> {
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
  const confidence = value.confidence;
  if (!isConfidence(confidence)) {
    return fail("confidence is not one of low, medium, high");
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
      confidence,
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

function isConfidence(value: unknown): value is Confidence {
  return CONFIDENCES.some((confidence) => confidence === value);
}
