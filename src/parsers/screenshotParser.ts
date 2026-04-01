import { ExtractionResultSchema, type ExtractionResult } from "../types";

export function validateExtractionResult(rawResponse: unknown): ExtractionResult {
  if (rawResponse === null || rawResponse === undefined) {
    return { error: "not_a_receipt" };
  }

  if (
    typeof rawResponse === "object" &&
    rawResponse !== null &&
    "error" in rawResponse &&
    (rawResponse as { error: unknown }).error === "not_a_receipt"
  ) {
    return { error: "not_a_receipt" };
  }

  const parseResult = ExtractionResultSchema.safeParse(rawResponse);
  if (parseResult.success) {
    return parseResult.data;
  }

  return { error: "not_a_receipt" };
}

export function parseGeminiResponse(text: string): unknown {
  let jsonText = text.trim();

  if (jsonText.startsWith("```")) {
    const lines = jsonText.split("\n");
    lines.shift();
    if (lines[lines.length - 1]?.trim() === "```") {
      lines.pop();
    }
    jsonText = lines.join("\n").trim();
  }

  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

export function isValidProvider(provider: unknown): provider is "grab" | "gojek" | "zig" {
  return typeof provider === "string" && ["grab", "gojek", "zig"].includes(provider);
}

export function isValidAmount(amount: unknown): amount is number {
  return typeof amount === "number" && !isNaN(amount) && amount > 0;
}

export function isValidConfidence(confidence: unknown): confidence is number {
  return typeof confidence === "number" && !isNaN(confidence) && confidence >= 0 && confidence <= 1;
}

export function normalizeConfidence(value: unknown): number {
  if (typeof value !== "number" || isNaN(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function normalizeDate(date: unknown): string | null {
  if (date === null || date === undefined || date === "") return null;
  if (typeof date !== "string") return null;
  const parsed = Date.parse(date);
  if (isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

export function normalizeStringField(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const SUPPORTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/heic",
  "image/heif",
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImageType(mimeType: string): mimeType is SupportedImageType {
  return SUPPORTED_IMAGE_TYPES.includes(mimeType.toLowerCase() as SupportedImageType);
}

export const MAX_SCREENSHOT_SIZE_BYTES = 10 * 1024 * 1024;

export function isValidFileSize(bytes: number): boolean {
  return bytes > 0 && bytes <= MAX_SCREENSHOT_SIZE_BYTES;
}
