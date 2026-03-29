const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const PROVIDER_EMAILS: Record<string, string> = {
  grab: "no-reply@grab.com",
  gojek: "receipts@gojek.com",
};

export interface GmailMessage {
  id: string;
  threadId: string;
}

export interface GmailMessageDetail {
  id: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
    body?: { data?: string };
    parts?: Array<{
      mimeType: string;
      body?: { data?: string };
      parts?: Array<{
        mimeType: string;
        body?: { data?: string };
      }>;
    }>;
  };
  internalDate: string;
}

export async function refreshGmailToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh token: ${response.status}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function fetchGmailMessages(
  accessToken: string,
  providerEmail: string,
  afterDate?: number,
): Promise<GmailMessage[]> {
  let query = `from:${providerEmail} subject:receipt`;
  if (afterDate) {
    const dateStr = new Date(afterDate).toISOString().split("T")[0];
    query += ` after:${dateStr}`;
  }

  const allMessages: GmailMessage[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GMAIL_API_BASE}/messages`);
    url.searchParams.set("q", query);
    url.searchParams.set("maxResults", "100");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      messages?: GmailMessage[];
      nextPageToken?: string;
    };

    if (data.messages) {
      allMessages.push(...data.messages);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allMessages;
}

export async function fetchMessageDetail(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageDetail> {
  const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Gmail API error fetching message: ${response.status}`);
  }

  return (await response.json()) as GmailMessageDetail;
}

export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return atob(base64);
}

export function extractEmailBody(message: GmailMessageDetail): string {
  const payload = message.payload;

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    // Prefer text/plain
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        for (const nested of part.parts) {
          if (nested.mimeType === "text/plain" && nested.body?.data) {
            return decodeBase64Url(nested.body.data);
          }
        }
      }
    }
    // Fall back to text/html
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        for (const nested of part.parts) {
          if (nested.mimeType === "text/html" && nested.body?.data) {
            return decodeBase64Url(nested.body.data);
          }
        }
      }
    }
  }

  return "";
}
