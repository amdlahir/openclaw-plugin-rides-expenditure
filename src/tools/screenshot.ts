import {
  parseGeminiResponse,
  validateExtractionResult,
  isSupportedImageType,
  isValidFileSize,
} from "../parsers/screenshotParser";

const EXTRACTION_PROMPT = `Extract ride receipt data from this screenshot. Singapore and Malaysia ride-hailing apps only (Grab, Gojek, Zig/CDG).

Return ONLY valid JSON, no markdown code blocks or other text:
{
  "provider": "grab" | "gojek" | "zig",
  "amount": <number in dollars, e.g., 15.50 not 1550>,
  "date": "<ISO 8601 format or null if unclear>",
  "pickup": "<pickup address or null>",
  "dropoff": "<dropoff address or null>",
  "confidence": <0.0-1.0, your confidence in the extraction>
}

If this is not a valid ride receipt from Grab, Gojek, or Zig, return:
{"error": "not_a_receipt"}`;

export async function handleParseReceiptScreenshot(
  imageUrl: string,
  googleAiApiKey?: string,
) {
  if (!googleAiApiKey) {
    return { error: "screenshot_parsing_disabled" };
  }

  // Fetch image
  let imageResponse: Response;
  try {
    imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return { error: `Failed to fetch image: ${imageResponse.status}` };
    }
  } catch (err) {
    return { error: `Failed to fetch image: ${err instanceof Error ? err.message : "Unknown"}` };
  }

  // Validate MIME type
  const contentType = imageResponse.headers.get("content-type") || "";
  const mimeType = contentType.split(";")[0].trim();
  if (!isSupportedImageType(mimeType)) {
    return { error: `Unsupported image type: ${mimeType}` };
  }

  // Read and validate size
  const imageBuffer = await imageResponse.arrayBuffer();
  if (!isValidFileSize(imageBuffer.byteLength)) {
    return { error: "Image too large (max 10MB)" };
  }

  // Convert to base64
  const base64Image = Buffer.from(imageBuffer).toString("base64");

  // Call Gemini 2.0 Flash
  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${googleAiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: EXTRACTION_PROMPT },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
        }),
      },
    );

    if (!geminiResponse.ok) {
      return { error: `Gemini API error: ${geminiResponse.status}` };
    }

    const geminiData = (await geminiResponse.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { error: "Empty response from Gemini" };
    }

    const parsed = parseGeminiResponse(text);
    const result = validateExtractionResult(parsed);
    return result;
  } catch (err) {
    return { error: `Gemini API error: ${err instanceof Error ? err.message : "Unknown"}` };
  }
}
