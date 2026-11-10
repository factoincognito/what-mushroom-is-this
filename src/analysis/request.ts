import { type AnalysisConfig, analysisConfig } from "../config/analysis";
import { config as appConfig } from "../config/config";
import { checkModelId } from "../config/modelSetting";
import type { AnalysisError } from "./errors";
import { analysisPrompt } from "./prompt";

/**
 * The Messages API request for a find (docs/SPEC.md 3.3, 3.9): one user message with the find's
 * photos as base64 image blocks, in the order added, each after its label ("Image 1:", "Image 2:"
 * and so on, also when there is one), then the find's description as a text block of its own when
 * it has one, then the prompt for what was sent. Only the photos, the description and the prompt
 * are sent. A text lookup without photos sends its description and the text lookup's prompt.
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

interface RequestBase {
  /** The API address from the config module, such as `https://api.anthropic.com`. */
  apiAddress: string;
  /** The model ID of the model setting. */
  model: string;
  apiKey: string;
}

/**
 * What is analysed (docs/SPEC.md 3.9): a find's photos, with its description when it has one, or
 * the description of a text lookup alone. A description is as written: not blank, and at most the
 * configured length in code points, as the screen and the store keep it.
 */
export type RequestInput = RequestBase &
  (
    | {
        /**
         * The JPEGs to send, base64, each already resized and checked by the image module, in the
         * order added: one at least, and at most the photos a find holds.
         */
        imagesBase64: readonly string[];
        text?: string;
      }
    | {
        text: string;
        imagesBase64?: undefined;
      }
  );

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
 * programming error (it is configuration) and throws a RangeError; so does an input with neither a
 * photo nor a text, more photos than a find holds, a photo that is not a non-empty text, or a text
 * that is blank or longer than the configured length, which the queue never gives. A key that
 * cannot be sent as a header value, after
 * the trim, gives `key-refused` with `status: null`; a model ID that is not valid, after the
 * trim, gives `model-unknown`. Either way nothing is built.
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
  const content = contentOf(input);
  const apiKey = input.apiKey.trim();
  if (!isSendableKey(apiKey)) {
    return { ok: false, error: { kind: "key-refused", status: null, cause: "refused" } };
  }
  const model = checkModelId(input.model);
  if (!model.ok) {
    return { ok: false, error: { kind: "model-unknown" } };
  }
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
        messages: [{ role: "user", content }],
      }),
    },
  };
}

type ContentBlock =
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } }
  | { type: "text"; text: string };

/**
 * The user message's blocks: each photo after its label, in order, then the description when
 * there is one, then the prompt for what was sent.
 */
function contentOf(input: RequestInput): ContentBlock[] {
  const { imagesBase64, text } = input;
  const photos = imagesBase64 ?? [];
  if (
    !Array.isArray(photos) ||
    photos.length > appConfig.maxPhotosPerFind ||
    photos.some((data: unknown) => typeof data !== "string" || data.length === 0)
  ) {
    throw new RangeError(
      `the photos must be a list of at most ${appConfig.maxPhotosPerFind} non-empty texts`,
    );
  }
  if (photos.length === 0 && typeof text !== "string") {
    throw new RangeError("the input must hold a photo or a text");
  }
  if (
    text !== undefined &&
    (typeof text !== "string" ||
      text.trim().length === 0 ||
      [...text].length > appConfig.lookupTextMaxLength)
  ) {
    throw new RangeError(
      `the text must not be blank, and at most ${appConfig.lookupTextMaxLength} characters`,
    );
  }
  const blocks: ContentBlock[] = photos.flatMap((data, index): ContentBlock[] => [
    { type: "text", text: `Image ${index + 1}:` },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data } },
  ]);
  if (text !== undefined) {
    blocks.push({ type: "text", text });
  }
  blocks.push({ type: "text", text: analysisPrompt(photos.length, text !== undefined) });
  return blocks;
}

function isPort(value: number): boolean {
  return value >= 1 && value <= 65_535;
}
