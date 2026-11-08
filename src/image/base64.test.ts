import { bytesToBase64 } from "./base64";

/** The JavaScript runtime's own base64 of a binary string, as the reference. */
const reference = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));

describe("bytesToBase64", () => {
  it("gives the RFC 4648 test vectors", () => {
    const text = (value: string) => new TextEncoder().encode(value);
    expect(bytesToBase64(text(""))).toBe("");
    expect(bytesToBase64(text("f"))).toBe("Zg==");
    expect(bytesToBase64(text("fo"))).toBe("Zm8=");
    expect(bytesToBase64(text("foo"))).toBe("Zm9v");
    expect(bytesToBase64(text("foob"))).toBe("Zm9vYg==");
    expect(bytesToBase64(text("fooba"))).toBe("Zm9vYmE=");
    expect(bytesToBase64(text("foobar"))).toBe("Zm9vYmFy");
  });

  it("uses the standard alphabet, with + and /", () => {
    expect(bytesToBase64(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe("+/+/");
  });

  it("gives what btoa gives for every byte value and for lengths around a block", () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);
    expect(bytesToBase64(all)).toBe(reference(all));
    for (let length = 0; length < 10; length += 1) {
      const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      expect(bytesToBase64(bytes)).toBe(reference(bytes));
    }
  });

  it("encodes a photo-sized input", () => {
    const bytes = Uint8Array.from({ length: 300_001 }, (_, index) => (index * 7919) % 256);
    expect(bytesToBase64(bytes)).toBe(reference(bytes));
  });

  it("refuses input that is not bytes", () => {
    expect(() => bytesToBase64([1, 2, 3] as unknown as Uint8Array)).toThrow(TypeError);
  });
});
