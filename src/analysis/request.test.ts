import { type AnalysisConfig, analysisConfig } from "../config/analysis";
import { ANALYSIS_PROMPT } from "./prompt";
import { type AnalysisRequest, buildAnalysisRequest, type RequestInput } from "./request";

const input: RequestInput = {
  apiAddress: "https://api.example.test",
  model: "claude-test-model",
  apiKey: "sk-test-key",
  imageBase64: "/9j/4AAQSkZJRg==",
};

/** The request built for an input that passes every check. */
function built(requestInput: RequestInput, config?: AnalysisConfig): AnalysisRequest {
  const result = buildAnalysisRequest(requestInput, config);
  if (!result.ok) {
    throw new Error(`expected a request, got ${result.error.kind}`);
  }
  return result.request;
}

function parsedBody(body: string): unknown {
  return JSON.parse(body);
}

const userMessage = {
  role: "user",
  content: [
    {
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AAQSkZJRg==" },
    },
    { type: "text", text: ANALYSIS_PROMPT },
  ],
};

describe("buildAnalysisRequest", () => {
  it("posts to the Messages endpoint of the address", () => {
    const request = built(input);
    expect(request.url).toBe("https://api.example.test/v1/messages");
    expect(request.method).toBe("POST");
  });

  it("does not double the slash after an address that ends in one", () => {
    expect(built({ ...input, apiAddress: "https://api.example.test/" }).url).toBe(
      "https://api.example.test/v1/messages",
    );
  });

  it("sends the key, the API version of the analysis config and the content type, and no other header", () => {
    expect(built(input).headers).toEqual({
      authorization: "Bearer sk-test-key",
      "anthropic-version": "2026-10-21",
      "content-type": "application/json",
    });
  });

  it("sends the API version of the config it is given", () => {
    const config: AnalysisConfig = { ...analysisConfig, apiVersion: "2099-01-01" };
    expect(built(input, config).headers["anthropic-version"]).toBe("2099-01-01");
  });

  it("does not send the legacy x-api-key header", () => {
    expect(Object.keys(built(input).headers)).not.toContain("x-api-key");
  });

  it("sends none of the sampling parameters that version 2026-10-21 refuses", () => {
    const body = parsedBody(built(input).body);
    for (const parameter of ["temperature", "top_p", "top_k"]) {
      expect(body).not.toHaveProperty(parameter);
    }
  });

  it("sends no document block and no citations, which version 2026-10-21 refuses", () => {
    const body = built(input).body;
    expect(body).not.toContain('"document"');
    expect(body).not.toContain('"citations"');
  });

  it("sends only the model, max_tokens and one user message", () => {
    expect(parsedBody(built(input).body)).toEqual({
      model: "claude-test-model",
      max_tokens: 16_000,
      messages: [userMessage],
    });
  });

  it("sends the max_tokens of the config it is given", () => {
    const config: AnalysisConfig = { ...analysisConfig, maxTokens: 1234 };
    expect(parsedBody(built(input, config).body)).toHaveProperty("max_tokens", 1234);
  });

  it.each(["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"])(
    "sends no thinking or effort setting for %s, so it runs with its own default",
    (model) => {
      expect(parsedBody(built({ ...input, model }).body)).toEqual({
        model,
        max_tokens: 16_000,
        messages: [userMessage],
      });
    },
  );

  it("leaves the key out of the body", () => {
    expect(built(input).body).not.toContain("sk-test-key");
  });

  it("gives the same request for the same input", () => {
    expect(buildAnalysisRequest(input)).toEqual(buildAnalysisRequest(input));
  });
});

describe("buildAnalysisRequest, the key", () => {
  it("sends the key trimmed of the blanks around it", () => {
    expect(built({ ...input, apiKey: "  sk-test-key\n" }).headers.authorization).toBe(
      "Bearer sk-test-key",
    );
  });

  it.each([
    ["a zero-width space", "sk-ant-​key"],
    ["an inner space", "sk-ant- key"],
    ["a non-ASCII letter", "sk-ant-nyckelå"],
    ["nothing", ""],
    ["blanks only", " \n\t "],
  ])("refuses a key that holds %s, before any request is built", (_label, apiKey) => {
    expect(buildAnalysisRequest({ ...input, apiKey })).toEqual({
      ok: false,
      error: { kind: "key-refused", status: null, cause: "refused" },
    });
  });

  it("checks the key before the model", () => {
    expect(buildAnalysisRequest({ ...input, apiKey: "", model: "" })).toEqual({
      ok: false,
      error: { kind: "key-refused", status: null, cause: "refused" },
    });
  });
});

describe("buildAnalysisRequest, the model ID", () => {
  it("sends the model ID trimmed of the blanks around it", () => {
    expect(parsedBody(built({ ...input, model: " claude-opus-5-5\n" }).body)).toHaveProperty(
      "model",
      "claude-opus-5-5",
    );
  });

  it.each([
    ["an empty ID", ""],
    ["blanks only", "  "],
    ["an inner space", "claude opus"],
    ["a control character", "claude-\u0007opus"],
    ["a non-ASCII letter", "claude-å"],
    ["a zero-width space", "claude-​opus"],
  ])("refuses %s, so Settings asks for a model", (_label, model) => {
    expect(buildAnalysisRequest({ ...input, model })).toEqual({
      ok: false,
      error: { kind: "model-unknown" },
    });
  });
});

describe("buildAnalysisRequest, the API address", () => {
  it.each([
    ["a port", "https://api.example.test:8443", "https://api.example.test:8443/v1/messages"],
    ["capitals in the host", "https://API.Example.test", "https://API.Example.test/v1/messages"],
    [
      "several trailing slashes",
      "https://api.example.test//",
      "https://api.example.test/v1/messages",
    ],
  ])("accepts an address with %s", (_label, apiAddress, url) => {
    expect(built({ ...input, apiAddress }).url).toBe(url);
  });

  it.each([
    ["an empty address", ""],
    ["plain http, which would send the key unencrypted", "http://api.example.test"],
    ["no scheme", "api.example.test"],
    ["another scheme", "ftp://api.example.test"],
    ["credentials", "https://user:pass@api.example.test"],
    ["a path", "https://api.example.test/v1"],
    ["a query", "https://api.example.test?x=1"],
    ["a fragment", "https://api.example.test#x"],
    ["a blank", "https://api.example .test"],
    ["a leading blank", " https://api.example.test"],
    ["an empty host", "https://"],
    ["an empty label", "https://api..example.test"],
    ["a label that starts with a hyphen", "https://-api.example.test"],
    ["port 0", "https://api.example.test:0"],
    ["a port beyond 65535", "https://api.example.test:65536"],
    ["an empty port", "https://api.example.test:"],
  ])("throws a programming error for %s, as the address is configuration", (_label, apiAddress) => {
    expect(() => buildAnalysisRequest({ ...input, apiAddress })).toThrow(RangeError);
  });

  it("checks the address before the key", () => {
    expect(() =>
      buildAnalysisRequest({ ...input, apiAddress: "http://x.test", apiKey: "" }),
    ).toThrow("apiAddress");
  });
});

describe("ANALYSIS_PROMPT", () => {
  it("asks for the JSON object only", () => {
    expect(ANALYSIS_PROMPT).toContain("Answer with one JSON object only");
  });

  it.each([
    '"result": "match"',
    '"names"',
    '"edibility"',
    '"confidence"',
    '"general_information"',
    '"look_alikes"',
    '{"result": "no_mushroom"}',
    '{"result": "cannot_tell"}',
    "edible, edible_after_preparation, not_edible, poisonous, deadly_poisonous, unknown",
    "low, medium, high",
  ])("names %s from the answer's shape", (part) => {
    expect(ANALYSIS_PROMPT).toContain(part);
  });

  it("holds nothing from the log", () => {
    expect(ANALYSIS_PROMPT).not.toMatch(
      /latitude|longitude|position|coordinates|\d{4}-\d{2}-\d{2}/i,
    );
  });
});
