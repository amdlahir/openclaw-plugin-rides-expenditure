import type { IncomingMessage, ServerResponse } from "http";

type HttpRouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean | void> | boolean | void;
import type { Client } from "@libsql/client";
import { buildGmailAuthUrl, exchangeCodeForTokens, generateNonce, type OAuthConfig } from "../gmail/oauth";

function parseQueryParams(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

export function createAuthHandler(db: Client, config: OAuthConfig): HttpRouteHandler {
  return async (_req, res) => {
    const nonce = generateNonce();

    await db.execute({
      sql: "UPDATE sync_state SET oauth_nonce = ? WHERE id = 1",
      args: [nonce],
    });

    const authUrl = buildGmailAuthUrl(config, nonce);
    res.writeHead(302, { Location: authUrl });
    res.end();
    return true;
  };
}

export function createCallbackHandler(db: Client, config: OAuthConfig): HttpRouteHandler {
  return async (req, res) => {
    const params = parseQueryParams(req.url || "");
    const code = params.get("code");
    const state = params.get("state");

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h1>Error</h1><p>Missing authorization code.</p>");
      return true;
    }

    // Validate CSRF nonce
    const nonceResult = await db.execute({
      sql: "SELECT oauth_nonce FROM sync_state WHERE id = 1",
      args: [],
    });
    const storedNonce = nonceResult.rows[0]?.oauth_nonce;
    if (!storedNonce || storedNonce !== state) {
      res.writeHead(403, { "Content-Type": "text/html" });
      res.end("<h1>Error</h1><p>Invalid state parameter.</p>");
      return true;
    }

    try {
      const tokens = await exchangeCodeForTokens(code, config);

      await db.execute({
        sql: `UPDATE sync_state SET
                gmail_access_token = ?,
                gmail_refresh_token = ?,
                gmail_token_expires_at = ?,
                email_sync_enabled = 1,
                oauth_nonce = NULL
              WHERE id = 1`,
        args: [tokens.accessToken, tokens.refreshToken, tokens.expiresAt],
      });

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<h1>Gmail Connected</h1><p>Your Gmail account has been connected for ride receipt syncing. You can close this page.</p>",
      );
    } catch (err) {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end(
        `<h1>Error</h1><p>Failed to connect Gmail: ${err instanceof Error ? err.message : "Unknown error"}</p>`,
      );
    }
    return true;
  };
}
