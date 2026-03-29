export interface ParsedRide {
  amount: number; // in cents
  currency: string;
  date: number; // Unix timestamp ms
  pickup: string | null;
  dropoff: string | null;
  confidence: number;
}

export type RideProvider = "grab" | "gojek";

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|td|th|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function parseGrabReceipt(
  emailBody: string,
  internalDate: string,
): ParsedRide | null {
  const cleaned = stripHtml(emailBody);
  const body = cleaned.toLowerCase();

  if (
    !body.includes("grab") ||
    (!body.includes("receipt") && !body.includes("trip"))
  ) {
    return null;
  }

  let amount: number | null = null;
  let currency = "SGD";
  let pickup: string | null = null;
  let dropoff: string | null = null;
  let confidence = 0.5;

  // SGD amount patterns
  const sgdPatterns = [
    /total[:\s]*s?\$\s*(\d+(?:\.\d{2})?)/i,
    /paid[:\s]*s?\$\s*(\d+(?:\.\d{2})?)/i,
    /fare[:\s]*s?\$\s*(\d+(?:\.\d{2})?)/i,
    /s\$\s*(\d+(?:\.\d{2})?)/i,
    /sgd\s*(\d+(?:\.\d{2})?)/i,
  ];

  // MYR amount patterns
  const myrPatterns = [
    /total[:\s]*rm\s*(\d+(?:\.\d{2})?)/i,
    /paid[:\s]*rm\s*(\d+(?:\.\d{2})?)/i,
    /fare[:\s]*rm\s*(\d+(?:\.\d{2})?)/i,
    /rm\s*(\d+(?:\.\d{2})?)/i,
    /myr\s*(\d+(?:\.\d{2})?)/i,
  ];

  // Try SGD first
  for (const pattern of sgdPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      amount = Math.round(parseFloat(match[1]) * 100);
      currency = "SGD";
      confidence += 0.2;
      break;
    }
  }

  // Try MYR if no SGD match
  if (amount === null) {
    for (const pattern of myrPatterns) {
      const match = cleaned.match(pattern);
      if (match) {
        amount = Math.round(parseFloat(match[1]) * 100);
        currency = "MYR";
        confidence += 0.2;
        break;
      }
    }
  }

  // Fallback to generic dollar
  if (amount === null) {
    const fallback = cleaned.match(/\$(\d+(?:\.\d{2})?)/);
    if (fallback) {
      amount = Math.round(parseFloat(fallback[1]) * 100);
      confidence += 0.1;
    }
  }

  // Extract pickup/dropoff — Grab emails have two address+time pairs after "Your Trip"
  // Format: "address\ntime\naddress\ntime" (e.g. "143 Pasir Ris Grove\n9:34PM\n647 Pasir Ris Drive 10\n9:43PM")
  const tripMatch = cleaned.match(
    /Your Trip[^\n]*\n[^\n]*(?:km|mi)[^\n]*\n\s*([^\n]+)\n\s*\d{1,2}:\d{2}\s*[AP]M\s*\n\s*([^\n]+)\n\s*\d{1,2}:\d{2}\s*[AP]M/i,
  );
  if (tripMatch) {
    const p = tripMatch[1].trim();
    const d = tripMatch[2].trim();
    if (p.length > 3) { pickup = p.substring(0, 200); confidence += 0.1; }
    if (d.length > 3) { dropoff = d.substring(0, 200); confidence += 0.1; }
  }

  // Fallback to generic patterns if "Your Trip" section not found
  if (!pickup) {
    const pickupPatterns = [
      /pick[\s-]*up[:\s]*([^\n]+)/i,
      /picked up at[:\s]*([^\n]+)/i,
    ];
    for (const pattern of pickupPatterns) {
      const match = cleaned.match(pattern);
      if (match && match[1].trim().length > 3) {
        pickup = match[1].trim().substring(0, 200);
        confidence += 0.1;
        break;
      }
    }
  }

  if (!dropoff) {
    const dropoffPatterns = [
      /drop[\s-]*off[:\s]*([^\n]+)/i,
      /dropped off at[:\s]*([^\n]+)/i,
      /destination[:\s]*([^\n]+)/i,
    ];
    for (const pattern of dropoffPatterns) {
      const match = cleaned.match(pattern);
      if (match && match[1].trim().length > 3) {
        dropoff = match[1].trim().substring(0, 200);
        confidence += 0.1;
        break;
      }
    }
  }

  if (amount === null) return null;

  const date = parseInt(internalDate, 10);

  return {
    amount,
    currency,
    date,
    pickup,
    dropoff,
    confidence: Math.min(confidence, 1.0),
  };
}

export function parseGojekReceipt(
  emailBody: string,
  internalDate: string,
): ParsedRide | null {
  const cleaned = stripHtml(emailBody);
  const body = cleaned.toLowerCase();

  if (
    !body.includes("gojek") &&
    !body.includes("gocar") &&
    !body.includes("goride")
  ) {
    return null;
  }

  if (
    !body.includes("receipt") &&
    !body.includes("trip") &&
    !body.includes("fare") &&
    !body.includes("perjalanan")
  ) {
    return null;
  }

  let amount: number | null = null;
  let pickup: string | null = null;
  let dropoff: string | null = null;
  let confidence = 0.5;

  // SGD amount patterns only
  const amountPatterns = [
    /total[:\s]*s?\$\s*(\d+(?:\.\d{2})?)/i,
    /fare[:\s]*s?\$\s*(\d+(?:\.\d{2})?)/i,
    /s\$\s*(\d+(?:\.\d{2})?)/i,
    /sgd\s*(\d+(?:\.\d{2})?)/i,
    /\$(\d+(?:\.\d{2})?)/,
  ];

  for (const pattern of amountPatterns) {
    const match = cleaned.match(pattern);
    if (match) {
      amount = Math.round(parseFloat(match[1]) * 100);
      confidence += 0.2;
      break;
    }
  }

  // Extract pickup location
  const pickupPatterns = [
    /pick[\s-]*up[:\s]*([^\n]+)/i,
    /from[:\s]*([^\n]+)/i,
    /penjemputan[:\s]*([^\n]+)/i,
    /titik jemput[:\s]*([^\n]+)/i,
    /lokasi awal[:\s]*([^\n]+)/i,
  ];

  for (const pattern of pickupPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1].trim().length > 3) {
      pickup = match[1].trim().substring(0, 200);
      confidence += 0.1;
      break;
    }
  }

  // Extract dropoff location
  const dropoffPatterns = [
    /drop[\s-]*off[:\s]*([^\n]+)/i,
    /tujuan[:\s]*([^\n]+)/i,
    /titik antar[:\s]*([^\n]+)/i,
    /lokasi akhir[:\s]*([^\n]+)/i,
    /destination[:\s]*([^\n]+)/i,
    /(?:^|\n)\s*to[:\s]+([^\n]+)/i,
  ];

  for (const pattern of dropoffPatterns) {
    const match = cleaned.match(pattern);
    if (match && match[1].trim().length > 3) {
      dropoff = match[1].trim().substring(0, 200);
      confidence += 0.1;
      break;
    }
  }

  if (amount === null) return null;

  const date = parseInt(internalDate, 10);

  return {
    amount,
    currency: "SGD",
    date,
    pickup,
    dropoff,
    confidence: Math.min(confidence, 1.0),
  };
}
