import { describe, it, expect } from "vitest";
import {
  parseGeminiResponse,
  validateExtractionResult,
  isValidProvider,
  isValidAmount,
  isValidConfidence,
  normalizeConfidence,
  normalizeDate,
  normalizeStringField,
  isSupportedImageType,
  isValidFileSize,
  MAX_SCREENSHOT_SIZE_BYTES,
} from "../src/parsers/screenshotParser";

describe("parseGeminiResponse", () => {
  it("parses plain JSON", () => {
    const result = parseGeminiResponse('{"provider": "grab", "amount": 15.50}');
    expect(result).toEqual({ provider: "grab", amount: 15.5 });
  });

  it("strips markdown code blocks", () => {
    const result = parseGeminiResponse('```json\n{"provider": "grab"}\n```');
    expect(result).toEqual({ provider: "grab" });
  });

  it("returns null for invalid JSON", () => {
    expect(parseGeminiResponse("not json")).toBeNull();
  });

  it("handles empty string", () => {
    expect(parseGeminiResponse("")).toBeNull();
  });
});

describe("validateExtractionResult", () => {
  it("validates a correct extraction", () => {
    const result = validateExtractionResult({
      provider: "grab",
      amount: 15.5,
      date: "2026-03-15",
      pickup: "Orchard",
      dropoff: "Bugis",
      confidence: 0.9,
    });
    expect("error" in result).toBe(false);
  });

  it("returns error for null", () => {
    const result = validateExtractionResult(null);
    expect("error" in result && result.error).toBe("not_a_receipt");
  });

  it("returns error for invalid data", () => {
    const result = validateExtractionResult({ provider: "uber", amount: -5 });
    expect("error" in result && result.error).toBe("not_a_receipt");
  });

  it("passes through not_a_receipt error", () => {
    const result = validateExtractionResult({ error: "not_a_receipt" });
    expect("error" in result && result.error).toBe("not_a_receipt");
  });
});

describe("validation helpers", () => {
  it("validates providers", () => {
    expect(isValidProvider("grab")).toBe(true);
    expect(isValidProvider("gojek")).toBe(true);
    expect(isValidProvider("uber")).toBe(false);
    expect(isValidProvider(null)).toBe(false);
  });

  it("validates amounts", () => {
    expect(isValidAmount(15.5)).toBe(true);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-5)).toBe(false);
    expect(isValidAmount("15")).toBe(false);
  });

  it("validates confidence", () => {
    expect(isValidConfidence(0.5)).toBe(true);
    expect(isValidConfidence(0)).toBe(true);
    expect(isValidConfidence(1)).toBe(true);
    expect(isValidConfidence(1.5)).toBe(false);
    expect(isValidConfidence(-0.1)).toBe(false);
  });

  it("normalizes confidence", () => {
    expect(normalizeConfidence(0.5)).toBe(0.5);
    expect(normalizeConfidence(1.5)).toBe(1);
    expect(normalizeConfidence(-0.5)).toBe(0);
    expect(normalizeConfidence("bad")).toBe(0.5);
  });
});

describe("normalizeDate", () => {
  it("normalizes valid ISO date", () => {
    const result = normalizeDate("2026-03-15");
    expect(result).toContain("2026-03-15");
  });

  it("returns null for invalid date", () => {
    expect(normalizeDate("not-a-date")).toBeNull();
  });

  it("returns null for null/undefined/empty", () => {
    expect(normalizeDate(null)).toBeNull();
    expect(normalizeDate(undefined)).toBeNull();
    expect(normalizeDate("")).toBeNull();
  });
});

describe("normalizeStringField", () => {
  it("trims whitespace", () => {
    expect(normalizeStringField("  Orchard  ")).toBe("Orchard");
  });

  it("returns null for empty/null", () => {
    expect(normalizeStringField("")).toBeNull();
    expect(normalizeStringField(null)).toBeNull();
    expect(normalizeStringField("   ")).toBeNull();
  });
});

describe("image validation", () => {
  it("accepts supported image types", () => {
    expect(isSupportedImageType("image/png")).toBe(true);
    expect(isSupportedImageType("image/jpeg")).toBe(true);
    expect(isSupportedImageType("image/heic")).toBe(true);
  });

  it("rejects unsupported types", () => {
    expect(isSupportedImageType("application/pdf")).toBe(false);
    expect(isSupportedImageType("text/plain")).toBe(false);
  });

  it("validates file size", () => {
    expect(isValidFileSize(1024)).toBe(true);
    expect(isValidFileSize(MAX_SCREENSHOT_SIZE_BYTES)).toBe(true);
    expect(isValidFileSize(MAX_SCREENSHOT_SIZE_BYTES + 1)).toBe(false);
    expect(isValidFileSize(0)).toBe(false);
  });
});
