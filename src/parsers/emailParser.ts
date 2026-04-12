export interface ParsedRide {
  amount: number; // in cents
  currency: string;
  date: number; // Unix timestamp ms
  pickup: string | null;
  dropoff: string | null;
  confidence: number;
}

export type RideProvider = "grab" | "gojek" | "zig";

export type ParseResult =
  | { status: "parsed"; data: ParsedRide }
  | { status: "skipped"; reason: string }
  | { status: "failed" };

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
): ParseResult {
  const cleaned = stripHtml(emailBody);
  const body = cleaned.toLowerCase();

  if (
    !body.includes("grab") ||
    (!body.includes("receipt") && !body.includes("trip"))
  ) {
    return { status: "skipped", reason: "not a Grab receipt" };
  }

  // Reject GrabFood, GrabMart, and other non-ride receipts
  if (body.includes("grabfood") || body.includes("grab food")) {
    return { status: "skipped", reason: "GrabFood receipt" };
  }
  if (body.includes("grabmart") || body.includes("grab mart")) {
    return { status: "skipped", reason: "GrabMart receipt" };
  }
  if (
    body.includes("order summary") ||
    body.includes("delivery fee") ||
    body.includes("your order")
  ) {
    return { status: "skipped", reason: "non-ride receipt (delivery/order)" };
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

  const tripSection = cleaned.match(/Your Trip[\s\S]*$/i);
  if (tripSection) {
    const section = tripSection[0];
    const locations: string[] = [];
    const pairRegex = /([^\n]{5,})\n\s*\d{1,2}:\d{2}\s*[AP]M/gi;
    let m;
    while ((m = pairRegex.exec(section)) !== null) {
      const loc = m[1].trim();
      if (loc.length > 5) {
        locations.push(loc.substring(0, 200));
      }
    }
    if (locations.length >= 2) {
      if (!pickup) { pickup = locations[0]; confidence += 0.1; }
      if (!dropoff) { dropoff = locations[1]; confidence += 0.1; }
    } else if (locations.length === 1 && !pickup) {
      pickup = locations[0];
      confidence += 0.05;
    }
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

  if (amount === null) return { status: "failed" };

  const date = parseInt(internalDate, 10);

  return {
    status: "parsed",
    data: {
      amount,
      currency,
      date,
      pickup,
      dropoff,
      confidence: Math.min(confidence, 1.0),
    },
  };
}

export function parseGojekReceipt(
  emailBody: string,
  internalDate: string,
): ParseResult {
  const cleaned = stripHtml(emailBody);
  const body = cleaned.toLowerCase();

  if (
    !body.includes("gojek") &&
    !body.includes("gocar") &&
    !body.includes("goride")
  ) {
    return { status: "skipped", reason: "not a Gojek receipt" };
  }

  if (
    !body.includes("receipt") &&
    !body.includes("trip") &&
    !body.includes("fare") &&
    !body.includes("perjalanan")
  ) {
    return { status: "skipped", reason: "not a ride receipt" };
  }

  let amount: number | null = null;
  let pickup: string | null = null;
  let dropoff: string | null = null;
  let confidence = 0.5;

  // SGD amount patterns — prefer "total paid/payment" over line items like "trip fare"
  const amountPatterns = [
    /total\s+paid[\s\S]*?s?\$\s*(\d+(?:\.\d{2})?)/i,
    /total\s+payment[\s\S]*?s?\$\s*(\d+(?:\.\d{2})?)/i,
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

  // Extract pickup location — Gojek SG uses "Picked up on <date> from\n<address>"
  const pickupPatterns = [
    /Picked up[\s\S]*?from\s*\n\s*([^\n]+)/i,
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

  // Extract dropoff location — Gojek SG uses "Arrived on <date> at\n<address>"
  const dropoffPatterns = [
    /Arrived[\s\S]*?at\s*\n\s*([^\n]+)/i,
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

  if (amount === null) return { status: "failed" };

  const date = parseInt(internalDate, 10);

  return {
    status: "parsed",
    data: {
      amount,
      currency: "SGD",
      date,
      pickup,
      dropoff,
      confidence: Math.min(confidence, 1.0),
    },
  };
}

export function parseZigReceipt(
  emailBody: string,
  internalDate: string,
): ParseResult {
  const cleaned = stripHtml(emailBody);
  const body = cleaned.toLowerCase();

  if (
    !body.includes("zig") &&
    !body.includes("cdg") &&
    !body.includes("comfortdelgro")
  ) {
    return { status: "skipped", reason: "not a Zig receipt" };
  }

  let amount: number | null = null;
  let pickup: string | null = null;
  let dropoff: string | null = null;
  let confidence = 0.5;

  // Amount patterns — prefer "You paid" (final total) over line items
  const amountPatterns = [
    /You paid[\s\S]*?\$\s*(\d+(?:\.\d{2})?)/i,
    /Amount Paid[\s\S]*?\$\s*(\d+(?:\.\d{2})?)/i,
    /Balance Due[\s\S]*?\$\s*(\d+(?:\.\d{2})?)/i,
    /s\$\s*(\d+(?:\.\d{2})?)/i,
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

  // Pickup — Zig uses "Pick Up / Drop Off Point @ <location>"
  const pickupMatch = cleaned.match(
    /Pick Up\s*\/\s*Drop Off Point\s*@\s*([^\n]+)/i,
  );
  if (pickupMatch && pickupMatch[1].trim().length > 3) {
    pickup = pickupMatch[1].trim().substring(0, 200);
    confidence += 0.1;
  }

  // Dropoff — the line after pickup icon/text is the destination address
  // In stripped text it appears as a standalone address line after the pickup
  if (!dropoff) {
    const tripSection = cleaned.match(
      /TRIP DETAILS[\s\S]*$/i,
    );
    if (tripSection) {
      const section = tripSection[0];
      // Find all Singapore address-like lines (contain "Singapore" + postal code)
      const addressLines = section.match(
        /^[ \t]*(\d+[^,\n]*,\s*Singapore\s+\d{6})$/gim,
      );
      if (addressLines && addressLines.length >= 1) {
        // The last standalone Singapore address that isn't the pickup
        for (const addr of addressLines) {
          const trimmed = addr.trim();
          if (pickup && trimmed === pickup) continue;
          // Skip if this is part of the pickup line
          if (pickup && pickup.includes(trimmed)) continue;
          dropoff = trimmed.substring(0, 200);
          confidence += 0.1;
          break;
        }
      }
    }
  }

  if (amount === null) return { status: "failed" };

  const date = parseInt(internalDate, 10);

  return {
    status: "parsed",
    data: {
      amount,
      currency: "SGD",
      date,
      pickup,
      dropoff,
      confidence: Math.min(confidence, 1.0),
    },
  };
}
