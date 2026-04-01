import * as fs from "fs";
import * as path from "path";

export type TokenData = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

export function getTokensPath(dbPath: string): string {
  return path.join(path.dirname(dbPath), "tokens.json");
}

export function readTokens(tokensPath: string): TokenData | null {
  if (!fs.existsSync(tokensPath)) return null;
  try {
    const raw = fs.readFileSync(tokensPath, "utf-8");
    const data = JSON.parse(raw);
    if (data.accessToken && data.refreshToken && data.expiresAt) {
      return data as TokenData;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeTokens(tokensPath: string, tokens: TokenData): void {
  const dir = path.dirname(tokensPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

export function clearTokens(tokensPath: string): void {
  if (fs.existsSync(tokensPath)) {
    fs.unlinkSync(tokensPath);
  }
}
