import { type AnalysisConfig, analysisConfig, requestSettingsFor } from "../config/analysis";
import { checkModelId } from "../config/modelSetting";
import type { AnalysisError } from "./errors";
import { ANALYSIS_PROMPT } from "./prompt";

/**
 * The Messages API request for one photo (docs/SPEC.md 3.3): one user message
 * with the photo as a base64 image block, followed by the text prompt. Only
 * the photo and the prompt are sent.
 */

/**
 * The key's header, as the Claude API docs recommend when calling without an SDK (read
 * 2026-11-08): "API overview", https://platform.claude.com/docs/en/api/overview
 * (`Authorization: Bearer <key>`; `x-api-key` is a legacy fallback). The API version is
 * configuration (`src/config/analysis.ts`). The request uses nothing `2026-10-21` refuses: no
 * `temperature`, `top_p` or `top_k`, no document block, no citations
 * (https://platform.claude.com/docs/en/api/migration-2026-10-21).
 */
export const AUTHORIZATION_HEADER = "authorization";
export const AUTHORIZATION_SCHEME = "Bearer";

/** Printable ASCII, 0x21 to 0x7E: what the key may hold to go in the `authorization` header. */
const SENDABLE_KEY = /^[\x21-\x7e]+$/;

/**
 * An `https` address with a host name and an optional port, and no user, path, query or
 * fragment; trailing slashes are dropped. Plain `http` is refused: it would send the key
 * unencrypted.
 */
const API_ADDRESS =
  /^https:\/\/([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*)(:(\d{1,5}))?\/*$/i;

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

export type BuildResult =
  | { ok: true; request: AnalysisRequest }
  | { ok: false; error: Extract<AnalysisError, { kind: "key-refused" | "model-unknown" }> };

/**
 * Builds the request, after checking what goes into it. An API address that is not valid is a
 * programming error (it is configuration) and throws a RangeError. A key that cannot be sent as
 * a header value, after the trim, gives `key-refused` with `status: null`; a model ID that is
 * not valid, after the trim, gives `model-unknown`. Either way nothing is built.
 */
export function buildAnalysisRequest(
  input: RequestInput,
  config: AnalysisConfig = analysisConfig,
): BuildResult {
  const address = API_ADDRESS.exec(input.apiAddress);
  const port = address?.[6];
  if (address === null || (port !== undefined && !isPort(Number(port)))) {
    throw new RangeError("apiAddress must be an https address with a host and no path");
  }
  const apiKey = input.apiKey.trim();
  if (!isSendableKey(apiKey)) {
    return { ok: false, error: { kind: "key-refused", status: null } };
  }
  const model = checkModelId(input.model);
  if (!model.ok) {
    return { ok: false, error: { kind: "model-unknown" } };
  }
  const { effort, thinking } = requestSettingsFor(model.id, config);
  return {
    ok: true,
    request: {
      url: `${input.apiAddress.replace(/\/+$/, "")}/v1/messages`,
      method: "POST",
      headers: {
        [AUTHORIZATION_HEADER]: `${AUTHORIZATION_SCHEME} ${apiKey}`,
        "anthropic-version": config.apiVersion,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model.id,
        max_tokens: config.maxTokens,
        ...(thinking === undefined ? {} : { thinking }),
        ...(effort === undefined ? {} : { output_config: { effort } }),
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
    },
  };
}

function isPort(value: number): boolean {
  return value >= 1 && value <= 65_535;
}
