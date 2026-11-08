import { ANALYSIS_PROMPT } from "./prompt";

/**
 * The Messages API request for one photo (docs/SPEC.md 3.3): one user message
 * with the photo as a base64 image block, followed by the text prompt. Only
 * the photo and the prompt are sent.
 */

/** The `anthropic-version` header (Claude API docs, "Versions"). */
export const ANTHROPIC_VERSION = "2023-06-01";

/** Room for the answer's JSON object in three languages, with its look-alikes. */
export const MAX_TOKENS = 4096;

export interface RequestInput {
  /** The API address from the config module, such as `https://api.anthropic.com`. */
  apiAddress: string;
  /** The model ID of the model setting. */
  model: string;
  apiKey: string;
  /** The JPEG to send, base64, already resized and checked by the image module. */
  imageBase64: string;
}

export interface AnalysisRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export function buildAnalysisRequest(input: RequestInput): AnalysisRequest {
  return {
    url: `${input.apiAddress.replace(/\/+$/, "")}/v1/messages`,
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: input.imageBase64 },
            },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  };
}
