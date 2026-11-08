import { ANALYSIS_PROMPT } from "./prompt";

/**
 * The Messages API request for one photo (docs/SPEC.md 3.3): one user message
 * with the photo as a base64 image block, followed by the text prompt. Only
 * the photo and the prompt are sent.
 */

/**
 * The API version and the key's header, as the Claude API docs recommend when
 * calling without an SDK (read 2026-11-08): "Versions",
 * https://platform.claude.com/docs/en/api/versioning ("Anthropic recommends using the
 * latest API version whenever possible"; latest `2026-10-21`), and "API overview",
 * https://platform.claude.com/docs/en/api/overview (`Authorization: Bearer <key>`;
 * `x-api-key` is a legacy fallback). The request uses nothing `2026-10-21` refuses: no
 * `temperature`, `top_p` or `top_k`, no document block, no citations
 * (https://platform.claude.com/docs/en/api/migration-2026-10-21).
 */
export const ANTHROPIC_VERSION = "2026-10-21";
export const AUTHORIZATION_HEADER = "authorization";
export const AUTHORIZATION_SCHEME = "Bearer";

/** Room for the answer's JSON object in three languages, with its look-alikes. */
export const MAX_TOKENS = 4096;

/** Printable ASCII, 0x21 to 0x7E: what the key may hold to go in the `authorization` header. */
const SENDABLE_KEY = /^[\x21-\x7e]+$/;

/**
 * Whether a key, already trimmed, can be sent as a header value. A key with a
 * zero-width space, a smart quote, a non-ASCII letter or an inner blank cannot:
 * fetch would refuse it before sending, which would look like no network.
 */
export function isSendableKey(key: string): boolean {
  return SENDABLE_KEY.test(key);
}

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
      [AUTHORIZATION_HEADER]: `${AUTHORIZATION_SCHEME} ${input.apiKey}`,
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
