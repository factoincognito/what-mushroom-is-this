import { type Match, parseAnswerText, readMessageBody, shownEdibility } from "./answer";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function matchJson(): { [key: string]: Json } {
  return {
    result: "match",
    names: {
      sv: "Kantarell",
      en: "Chanterelle",
      la: "Cantharellus cibarius",
      it: "Gallinaccio",
    },
    edibility: "edible",
    confidence: "high",
    general_information: {
      sv: "En gul svamp i barr- och lövskog.",
      en: "A yellow mushroom of coniferous and deciduous woods.",
      it: "Un fungo giallo dei boschi di conifere e di latifoglie.",
    },
    look_alikes: [
      {
        names: {
          sv: "Orange narrkantarell",
          en: "False chanterelle",
          la: "Hygrophoropsis aurantiaca",
          it: "Falso gallinaccio",
        },
        edibility: "not_edible",
      },
    ],
  };
}

const expectedMatch: Match = {
  result: "match",
  names: {
    sv: "Kantarell",
    en: "Chanterelle",
    la: "Cantharellus cibarius",
    it: "Gallinaccio",
  },
  edibility: "edible",
  confidence: "high",
  generalInformation: {
    sv: "En gul svamp i barr- och lövskog.",
    en: "A yellow mushroom of coniferous and deciduous woods.",
    it: "Un fungo giallo dei boschi di conifere e di latifoglie.",
  },
  lookAlikes: [
    {
      names: {
        sv: "Orange narrkantarell",
        en: "False chanterelle",
        la: "Hygrophoropsis aurantiaca",
        it: "Falso gallinaccio",
      },
      edibility: "not_edible",
    },
  ],
};

function withChange(change: (answer: { [key: string]: Json }) => void): string {
  const answer = matchJson();
  change(answer);
  return JSON.stringify(answer);
}

function record(value: Json | undefined): { [key: string]: Json } {
  if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("test data is not an object");
  }
  return value;
}

function firstLookAlike(answer: { [key: string]: Json }): { [key: string]: Json } {
  const list = answer.look_alikes;
  if (!Array.isArray(list)) {
    throw new Error("test data has no look-alikes");
  }
  return record(list[0]);
}

function expectFailure(text: string, detail: string): void {
  const result = parseAnswerText(text);
  expect(result).toEqual({ ok: false, reason: "shape", detail });
}

describe("parseAnswerText, accepted answers", () => {
  it("reads a match into the answer", () => {
    expect(parseAnswerText(JSON.stringify(matchJson()))).toEqual({
      ok: true,
      answer: expectedMatch,
    });
  });

  it("accepts a match without look-alikes", () => {
    const result = parseAnswerText(
      withChange((a) => {
        a.look_alikes = [];
      }),
    );
    expect(result).toEqual({ ok: true, answer: { ...expectedMatch, lookAlikes: [] } });
  });

  it.each([
    "edible",
    "edible_after_preparation",
    "not_edible",
    "poisonous",
    "deadly_poisonous",
    "unknown",
  ])("accepts the edibility %s", (edibility) => {
    const result = parseAnswerText(
      withChange((a) => {
        a.edibility = edibility;
      }),
    );
    expect(result.ok && result.answer.result === "match" && result.answer.edibility).toBe(
      edibility,
    );
  });

  it.each(["low", "medium", "high"])("accepts the confidence %s", (confidence) => {
    const result = parseAnswerText(
      withChange((a) => {
        a.confidence = confidence;
      }),
    );
    expect(result.ok && result.answer.result === "match" && result.answer.confidence).toBe(
      confidence,
    );
  });

  it("reads the no-mushroom form", () => {
    expect(parseAnswerText('{"result":"no_mushroom"}')).toEqual({
      ok: true,
      answer: { result: "no_mushroom" },
    });
  });

  it("reads the cannot-tell form", () => {
    expect(parseAnswerText('{"result":"cannot_tell"}')).toEqual({
      ok: true,
      answer: { result: "cannot_tell" },
    });
  });

  it("tolerates whitespace around the object", () => {
    expect(parseAnswerText(`\n  ${JSON.stringify(matchJson())}  \n`)).toEqual({
      ok: true,
      answer: expectedMatch,
    });
  });
});

describe("parseAnswerText, text that is not one JSON object", () => {
  it.each([
    ["a code fence", '```json\n{"result":"no_mushroom"}\n```'],
    ["text before the object", 'Here it is: {"result":"no_mushroom"}'],
    ["text after the object", '{"result":"no_mushroom"} Hope this helps.'],
    ["an empty text", ""],
    ["plain words", "I cannot see a mushroom."],
    ["a cut-off object", '{"result":"match","names":{'],
  ])("fails %s as not JSON", (_label, text) => {
    expectFailure(text, "the answer is not JSON");
  });

  it.each([
    ["an array", "[]"],
    ["a string", '"no_mushroom"'],
    ["a number", "1"],
    ["null", "null"],
  ])("fails %s as not an object", (_label, text) => {
    expectFailure(text, "the answer is not an object");
  });
});

describe("parseAnswerText, the result field", () => {
  it.each([
    ["missing", "{}"],
    ["unknown", '{"result":"maybe"}'],
    ["not a string", '{"result":1}'],
  ])("fails a result that is %s", (_label, text) => {
    expectFailure(text, "result is not one of match, no_mushroom, cannot_tell");
  });

  it.each(["no_mushroom", "cannot_tell"])("fails the %s form with another key", (result) => {
    expectFailure(JSON.stringify({ result, confidence: "low" }), "the answer has an unknown key");
  });
});

describe("parseAnswerText, the fields of a match", () => {
  it.each(["sv", "en", "la", "it"])("fails a match whose name %s is missing", (language) => {
    expectFailure(
      withChange((a) => {
        delete record(a.names)[language];
      }),
      `names.${language} is not a non-empty string`,
    );
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["a number", 7],
    ["null", null],
  ])("fails a match whose Latin name is %s", (_label, value) => {
    expectFailure(
      withChange((a) => {
        record(a.names).la = value;
      }),
      "names.la is not a non-empty string",
    );
  });

  it("fails a match whose names are not an object", () => {
    expectFailure(
      withChange((a) => {
        a.names = "Kantarell";
      }),
      "names is not an object",
    );
  });

  it("fails a match whose names have an extra language", () => {
    expectFailure(
      withChange((a) => {
        record(a.names).de = "Pfifferling";
      }),
      "names has an unknown key",
    );
  });

  it.each([
    ["an unknown value", "toxic"],
    ["another case", "Edible"],
    ["the spec's words", "edible only after preparation"],
    ["a number", 1],
  ])("fails a match whose edibility is %s", (_label, value) => {
    expectFailure(
      withChange((a) => {
        a.edibility = value;
      }),
      "edibility is not one of the six values",
    );
  });

  it.each([
    ["an unknown value", "very high"],
    ["a number", 0.9],
    ["missing", undefined],
  ])("fails a match whose confidence is %s", (_label, value) => {
    expectFailure(
      withChange((a) => {
        if (value === undefined) {
          delete a.confidence;
        } else {
          a.confidence = value;
        }
      }),
      "confidence is not one of low, medium, high",
    );
  });

  it.each(["sv", "en", "it"])(
    "fails a match whose general information in %s is empty",
    (language) => {
      expectFailure(
        withChange((a) => {
          record(a.general_information)[language] = "";
        }),
        `general_information.${language} is not a non-empty string`,
      );
    },
  );

  it("fails general information in Latin, which the shape does not have", () => {
    expectFailure(
      withChange((a) => {
        record(a.general_information).la = "Fungus";
      }),
      "general_information has an unknown key",
    );
  });

  it("fails a match whose general information is missing", () => {
    expectFailure(
      withChange((a) => {
        delete a.general_information;
      }),
      "general_information is not an object",
    );
  });

  it("fails a match whose look-alikes are not an array", () => {
    expectFailure(
      withChange((a) => {
        a.look_alikes = {};
      }),
      "look_alikes is not an array",
    );
  });

  it("fails a look-alike that is not an object", () => {
    expectFailure(
      withChange((a) => {
        a.look_alikes = ["Hygrophoropsis aurantiaca"];
      }),
      "look_alikes[0] is not an object",
    );
  });

  it("fails a look-alike without its Italian name", () => {
    expectFailure(
      withChange((a) => {
        delete record(firstLookAlike(a).names).it;
      }),
      "look_alikes[0].names.it is not a non-empty string",
    );
  });

  it("fails a look-alike with an unknown edibility", () => {
    expectFailure(
      withChange((a) => {
        firstLookAlike(a).edibility = "bad";
      }),
      "look_alikes[0].edibility is not one of the six values",
    );
  });

  it("fails a look-alike with an extra key", () => {
    expectFailure(
      withChange((a) => {
        firstLookAlike(a).confidence = "high";
      }),
      "look_alikes[0] has an unknown key",
    );
  });

  it("names the position of the failing look-alike", () => {
    expectFailure(
      withChange((a) => {
        const list = a.look_alikes;
        if (Array.isArray(list)) {
          list.push({ names: "none", edibility: "poisonous" });
        }
      }),
      "look_alikes[1].names is not an object",
    );
  });

  it("fails a match with an extra key", () => {
    expectFailure(
      withChange((a) => {
        a.position = "59.6, 17.1";
      }),
      "the answer has an unknown key",
    );
  });

  it("fails an own __proto__ key as an extra key", () => {
    const text = JSON.stringify(matchJson()).replace(/^\{/, '{"__proto__":{},');
    expectFailure(text, "the answer has an unknown key");
  });
});

function messageBody(content: Json, stopReason: Json = "end_turn"): string {
  return JSON.stringify({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-test",
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

/** A thinking block as Claude 5 models return it by default: `display` "omitted". */
const omittedThinking = { type: "thinking", thinking: "", signature: "EosnCkYICxIMMb3LzNrMu" };
const redactedThinking = { type: "redacted_thinking", data: "EmwKAhgBEgy3va3pzix" };

describe("readMessageBody, thinking before the text", () => {
  it("reads the text after an omitted thinking block, as Claude 5 models return it", () => {
    const body = messageBody([
      omittedThinking,
      { type: "text", text: JSON.stringify(matchJson()) },
    ]);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: expectedMatch });
  });

  it("reads the text after several thinking blocks and a redacted one", () => {
    const body = messageBody([
      omittedThinking,
      redactedThinking,
      { type: "thinking", thinking: '{"result":"no_mushroom"}', signature: "x" },
      { type: "text", text: '{"result":"cannot_tell"}' },
    ]);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: { result: "cannot_tell" } });
  });

  it("fails a message with thinking only and no text, though it ended its turn", () => {
    expect(readMessageBody(messageBody([omittedThinking]))).toEqual({
      ok: false,
      reason: "shape",
      detail: "the message has no text block",
    });
  });
});

describe("readMessageBody, a refusal", () => {
  it.each([
    ["no blocks", []],
    ["thinking only", [omittedThinking]],
    ["a text that is not JSON", [{ type: "text", text: "I can't help with that." }]],
    ["a JSON text that fits the shape", [{ type: "text", text: '{"result":"no_mushroom"}' }]],
    [
      "two text blocks that join into JSON that fits the shape",
      [
        { type: "text", text: '{"result":' },
        { type: "text", text: '"no_mushroom"}' },
      ],
    ],
  ])("says it was refused, apart from a shape failure, when it holds %s", (_label, content) => {
    expect(readMessageBody(messageBody(content, "refusal"))).toEqual({
      ok: false,
      reason: "refused",
      detail: "the answer was refused (stop_reason refusal)",
    });
  });

  it("still fails a body that is not from the API as not from the API", () => {
    const body = JSON.stringify({ type: "page", stop_reason: "refusal" });
    expect(readMessageBody(body)).toMatchObject({ ok: false, reason: "not-api" });
  });
});

describe("readMessageBody, a cut-off answer", () => {
  it.each([
    ["thinking only", [omittedThinking]],
    ["thinking and part of the JSON", [omittedThinking, { type: "text", text: '{"result":"ma' }]],
    ["part of the JSON", [{ type: "text", text: '{"result":"match","names":{' }]],
    ["no blocks", []],
  ])("says it was cut off at max_tokens when it holds %s", (_label, content) => {
    expect(readMessageBody(messageBody(content, "max_tokens"))).toEqual({
      ok: false,
      reason: "shape",
      detail: "the answer was cut off (stop_reason max_tokens)",
    });
  });

  it("says it was cut off when the context window was filled", () => {
    const body = messageBody([omittedThinking], "model_context_window_exceeded");
    expect(readMessageBody(body)).toEqual({
      ok: false,
      reason: "shape",
      detail: "the answer was cut off (stop_reason model_context_window_exceeded)",
    });
  });

  it("does not accept a complete-looking JSON text when the answer was cut off", () => {
    const body = messageBody([{ type: "text", text: '{"result":"no_mushroom"}' }], "max_tokens");
    expect(readMessageBody(body)).toMatchObject({ ok: false, reason: "shape" });
  });

  it("still fails a body that is not from the API as not from the API", () => {
    const body = JSON.stringify({ type: "page", stop_reason: "max_tokens" });
    expect(readMessageBody(body)).toMatchObject({ ok: false, reason: "not-api" });
  });

  it.each([
    ["no stop_reason", undefined],
    ["a null stop_reason", null],
    ["a stop_reason that is not a string", 5],
    ["another stop_reason", "stop_sequence"],
  ])("reads the answer with %s", (_label, stopReason) => {
    const content = [{ type: "text", text: '{"result":"no_mushroom"}' }];
    const body =
      stopReason === undefined
        ? JSON.stringify({ type: "message", content })
        : messageBody(content, stopReason);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: { result: "no_mushroom" } });
  });
});

describe("readMessageBody", () => {
  it("reads the answer from the message's text block", () => {
    const body = messageBody([{ type: "text", text: JSON.stringify(matchJson()) }]);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: expectedMatch });
  });

  it("ignores blocks other than text", () => {
    const body = messageBody([
      { type: "thinking", thinking: "..." },
      { type: "text", text: '{"result":"cannot_tell"}' },
    ]);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: { result: "cannot_tell" } });
  });

  it.each([
    ["an HTML page", "<html><body>Sign in to the Wi-Fi</body></html>"],
    ["an empty body", ""],
    ["JSON that is not a message", '{"hello":"world"}'],
    ["a message without content", JSON.stringify({ type: "message" })],
    ["a message whose content is not an array", JSON.stringify({ type: "message", content: "x" })],
    ["a content block that is not an object", messageBody(["text"])],
    ["an API error body", '{"type":"error","error":{"type":"api_error","message":"x"}}'],
  ])("fails %s as not from the API", (_label, body) => {
    expect(readMessageBody(body)).toEqual({
      ok: false,
      reason: "not-api",
      detail: "the body is not a Messages API message",
    });
  });

  it("fails a message without a text block", () => {
    expect(readMessageBody(messageBody([]))).toEqual({
      ok: false,
      reason: "shape",
      detail: "the message has no text block",
    });
  });

  it("joins two text blocks in order, with nothing between them, before parsing", () => {
    // Split inside a JSON string, so that any separator changes the value or breaks the JSON.
    const body = messageBody([
      { type: "text", text: '{"result":"no_' },
      { type: "text", text: 'mushroom"}' },
    ]);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: { result: "no_mushroom" } });
  });

  it("joins a match split over three text blocks, with other blocks between them", () => {
    const text = JSON.stringify(matchJson());
    const body = messageBody([
      omittedThinking,
      { type: "text", text: text.slice(0, 40) },
      redactedThinking,
      { type: "text", text: text.slice(40, 200) },
      { type: "text", text: text.slice(200) },
    ]);
    expect(readMessageBody(body)).toEqual({ ok: true, answer: expectedMatch });
  });

  it("joins the text blocks in their order, not another", () => {
    const body = messageBody([
      { type: "text", text: '"no_mushroom"}' },
      { type: "text", text: '{"result":' },
    ]);
    expect(readMessageBody(body)).toEqual({
      ok: false,
      reason: "shape",
      detail: "the answer is not JSON",
    });
  });

  it("fails joined text blocks that hold two JSON objects as not JSON", () => {
    const body = messageBody([
      { type: "text", text: '{"result":"no_mushroom"}' },
      { type: "text", text: '{"result":"cannot_tell"}' },
    ]);
    expect(readMessageBody(body)).toEqual({
      ok: false,
      reason: "shape",
      detail: "the answer is not JSON",
    });
  });

  it("fails joined text blocks whose answer does not fit the shape", () => {
    const body = messageBody([
      { type: "text", text: '{"result":' },
      { type: "text", text: '"mushroom"}' },
    ]);
    expect(readMessageBody(body)).toEqual({
      ok: false,
      reason: "shape",
      detail: "result is not one of match, no_mushroom, cannot_tell",
    });
  });

  it.each([
    ["a number", [{ type: "text", text: 5 }]],
    ["missing", [{ type: "text" }]],
    [
      "not a string in one of several blocks",
      [
        { type: "text", text: '{"result":' },
        { type: "text", text: null },
        { type: "text", text: '"no_mushroom"}' },
      ],
    ],
  ])("fails a text block whose text is %s, without coercing it", (_label, content) => {
    expect(readMessageBody(messageBody(content))).toEqual({
      ok: false,
      reason: "shape",
      detail: "a text block's text is not a string",
    });
  });

  it("fails a text that does not fit the shape", () => {
    expect(readMessageBody(messageBody([{ type: "text", text: '{"result":"x"}' }]))).toEqual({
      ok: false,
      reason: "shape",
      detail: "result is not one of match, no_mushroom, cannot_tell",
    });
  });
});

describe("shownEdibility", () => {
  it("shows unknown when the confidence is low, whatever the answer said", () => {
    const answer: Match = { ...expectedMatch, edibility: "edible", confidence: "low" };
    expect(shownEdibility(answer)).toBe("unknown");
  });

  it("leaves the stored answer as Claude gave it", () => {
    const answer: Match = { ...expectedMatch, edibility: "deadly_poisonous", confidence: "low" };
    shownEdibility(answer);
    expect(answer.edibility).toBe("deadly_poisonous");
    expect(answer.confidence).toBe("low");
  });

  it.each(["medium", "high"] as const)(
    "shows the answer's edibility when the confidence is %s",
    (confidence) => {
      const answer: Match = { ...expectedMatch, edibility: "poisonous", confidence };
      expect(shownEdibility(answer)).toBe("poisonous");
    },
  );

  it("takes the edibility and the confidence alone, as the Log's summary of a find has them", () => {
    const summary: { edibility: "edible"; confidence: "low" | "high" } = {
      edibility: "edible",
      confidence: "low",
    };
    expect(shownEdibility(summary)).toBe("unknown");
    expect(shownEdibility({ ...summary, confidence: "high" })).toBe("edible");
  });
});
