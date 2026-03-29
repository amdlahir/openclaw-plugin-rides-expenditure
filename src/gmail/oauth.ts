import * as crypto from "crypto";

export type OAuthConfig = {
  googleClientId: string;
  googleClientSecret: string;
  baseUrl: string;
};

export function buildGmailAuthUrl(config: OAuthConfig, nonce: string): string {
  const redirectUri = `${config.baseUrl}/rides/gmail/callback`;
  const params = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent",
    state: nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function exchangeCodeForTokens(
  code: string,
  config: OAuthConfig,
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const redirectUri = `${config.baseUrl}/rides/gmail/callback`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
