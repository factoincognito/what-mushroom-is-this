/**
 * The text prompt sent with the photo (docs/SPEC.md 3.3). It asks for exactly
 * the answer shape that `answer.ts` validates, and holds nothing from the log:
 * no position, no time, nothing about the find but the photo.
 */
export const ANALYSIS_PROMPT = `You are helping a forager keep a log of mushroom finds. Look at the photo and give your best assessment of which species the mushroom is.

Answer with one JSON object only: no text before or after it, no Markdown, no code fence. Use exactly one of these three forms.

If you can see a mushroom and can name a best match:
{
  "result": "match",
  "names": {"sv": "<Swedish name>", "en": "<English name>", "la": "<Latin scientific name>", "it": "<Italian name>"},
  "edibility": "<edibility>",
  "confidence": "<confidence>",
  "general_information": {"sv": "<in Swedish>", "en": "<in English>", "it": "<in Italian>"},
  "look_alikes": [
    {"names": {"sv": "<Swedish name>", "en": "<English name>", "la": "<Latin scientific name>", "it": "<Italian name>"}, "edibility": "<edibility>"}
  ]
}

If you cannot see a mushroom in the photo:
{"result": "no_mushroom"}

If you can see a mushroom but cannot tell which species it is:
{"result": "cannot_tell"}

Rules for the match form:
- Every <edibility> is exactly one of: edible, edible_after_preparation, not_edible, poisonous, deadly_poisonous, unknown. It is the edibility of the species named, not a statement about the mushroom in the photo.
- <confidence> is exactly one of: low, medium, high. It is your own statement of how sure you are of the match.
- Every name and every text is a non-empty string. Where a species has no common name in a language, give its Latin scientific name for that language.
- "general_information" is a short general description of the species, the same content in each of the three languages.
- "look_alikes" lists the poisonous species that look like the match. It is an empty array when there are none.
- Use no other keys.`;
