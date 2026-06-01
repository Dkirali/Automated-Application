import { describe, it, expect } from "vitest";
import {
  formatPhone,
  parsePhone,
  detectProvider,
  maskKey,
  COUNTRIES,
  PROVIDERS,
  type Provider,
} from "@/lib/setup-helpers";

describe("formatPhone", () => {
  it("combines dial code and digits", () => {
    expect(formatPhone("+90", "5550001122")).toBe("+90 5550001122");
  });

  it("strips non-digit characters from number", () => {
    expect(formatPhone("+1", "(555) 000-1234")).toBe("+1 5550001234");
  });

  it("returns empty string when number is empty", () => {
    expect(formatPhone("+1", "")).toBe("");
    expect(formatPhone("+1", "   ")).toBe("");
  });

  it("throws when dial code does not start with +", () => {
    expect(() => formatPhone("90", "5550001122")).toThrow();
  });
});

describe("parsePhone", () => {
  it("splits a stored phone into dial code and number", () => {
    expect(parsePhone("+90 5322860461")).toEqual({
      dialCode: "+90",
      number: "5322860461",
      countryCode: "TR",
    });
  });

  it("returns the first matching country when a dial code is shared", () => {
    // +1 is both US and CA — the first hit (US) is returned
    const parsed = parsePhone("+1 5555550100");
    expect(parsed?.dialCode).toBe("+1");
    expect(parsed?.number).toBe("5555550100");
    expect(["US", "CA"]).toContain(parsed?.countryCode);
  });

  it("returns null for empty or whitespace input", () => {
    expect(parsePhone("")).toBeNull();
    expect(parsePhone("   ")).toBeNull();
  });

  it("returns null when no '+' prefix is present", () => {
    expect(parsePhone("905322860461")).toBeNull();
  });

  it("returns null when the dial code is not in the country list", () => {
    expect(parsePhone("+999 1234567")).toBeNull();
  });

  it("strips non-digit characters from the number part", () => {
    expect(parsePhone("+90 (532) 286-0461")?.number).toBe("5322860461");
  });
});

describe("detectProvider", () => {
  it("identifies anthropic keys by prefix", () => {
    expect(detectProvider("sk-ant-api03-abc")).toBe("anthropic");
  });

  it("identifies groq keys by prefix", () => {
    expect(detectProvider("gsk_abc123")).toBe("groq");
  });

  it("identifies openrouter keys by prefix", () => {
    expect(detectProvider("sk-or-v1-abc")).toBe("openrouter");
  });

  it("returns unknown for unrecognized format", () => {
    expect(detectProvider("random-key")).toBe("unknown");
  });

  it("returns unknown for empty input", () => {
    expect(detectProvider("")).toBe("unknown");
  });

  it("trims whitespace before matching", () => {
    expect(detectProvider("  gsk_abc  ")).toBe("groq");
  });
});

describe("maskKey", () => {
  it("returns empty string for empty input", () => {
    expect(maskKey("")).toBe("");
  });

  it("returns only dots for very short keys (<=8 chars)", () => {
    expect(maskKey("abc")).toBe("•••");
    expect(maskKey("12345678")).toBe("••••••••");
  });

  it("shows first 4 + 8 dots + last 4 for long keys", () => {
    expect(maskKey("gsk_TEST_DUMMY_KEY_NOT_A_REAL_SECRET_MWKI"))
      .toBe("gsk_••••••••MWKI");
    expect(maskKey("sk-ant-api03-abcdefghijklmnop")).toBe("sk-a••••••••mnop");
  });

  it("never reveals more than 8 plaintext characters", () => {
    const long = "abcdefghijklmnopqrstuvwxyz";
    const masked = maskKey(long);
    const visible = masked.replace(/•/g, "");
    expect(visible.length).toBeLessThanOrEqual(8);
  });

  it("trims whitespace before masking", () => {
    expect(maskKey("  gsk_abcdefghMWKI  ")).toBe("gsk_••••••••MWKI");
  });
});

describe("COUNTRIES", () => {
  it("contains commonly used countries", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(codes).toContain("US");
    expect(codes).toContain("TR");
    expect(codes).toContain("GB");
    expect(codes).toContain("DE");
  });

  it("has at least 30 entries", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(30);
  });

  it("every dial code is well-formed", () => {
    for (const c of COUNTRIES) {
      expect(c.dialCode).toMatch(/^\+\d{1,4}$/);
    }
  });

  it("every entry has a non-empty name, flag, and ISO code", () => {
    for (const c of COUNTRIES) {
      expect(c.name).not.toBe("");
      expect(c.flag).not.toBe("");
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("ISO codes are unique", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("PROVIDERS", () => {
  it("includes anthropic, groq, openrouter", () => {
    const ids = PROVIDERS.map((p) => p.id);
    expect(ids).toContain<Provider>("anthropic");
    expect(ids).toContain<Provider>("groq");
    expect(ids).toContain<Provider>("openrouter");
  });

  it("each provider maps to a unique submit field name", () => {
    const fields = PROVIDERS.map((p) => p.fieldName);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it("each provider has a non-empty placeholder", () => {
    for (const p of PROVIDERS) {
      expect(p.placeholder).not.toBe("");
    }
  });
});
