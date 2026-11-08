import { ANALYSIS_PROMPT } from "./prompt";
import { ANTHROPIC_VERSION, buildAnalysisRequest, MAX_TOKENS } from "./request";

const input = {
  apiAddress: "https://api.example.test",
  model: "claude-test-model",
  apiKey: "sk-test-key",
  imageBase64: "/9j/4AAQSkZJRg==",
};

function parsedBody(body: string): unknown {
  return JSON.parse(body);
}

describe("buildAnalysisRequest", () => {
  it("posts to the Messages endpoint of the address", () => {
    const request = buildAnalysisRequest(input);
    expect(request.url).toBe("https://api.example.test/v1/messages");
    expect(request.method).toBe("POST");
  });

  it("does not double the slash after an address that ends in one", () => {
    const request = buildAnalysisRequest({ ...input, apiAddress: "https://api.example.test/" });
    expect(request.url).toBe("https://api.example.test/v1/messages");
  });

  it("sends the key, the API version and the content type, and no other header", () => {
    expect(buildAnalysisRequest(input).headers).toEqual({
      "x-api-key": "sk-test-key",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    });
    expect(ANTHROPIC_VERSION).toBe("2023-06-01");
  });

  it("sends the model, the token limit and one user message, and nothing else", () => {
    expect(parsedBody(buildAnalysisRequest(input).body)).toEqual({
      model: "claude-test-model",
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AAQSkZJRg==" },
            },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    });
  });

  it("leaves the key out of the body", () => {
    expect(buildAnalysisRequest(input).body).not.toContain("sk-test-key");
  });

  it("gives the same request for the same input", () => {
    expect(buildAnalysisRequest(input)).toEqual(buildAnalysisRequest(input));
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
