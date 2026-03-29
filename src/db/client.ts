import { createClient, type Client } from "@libsql/client";
import * as fs from "fs";
import * as path from "path";

let _client: Client | null = null;

export function createDbClient(dbPath: string): Client {
  if (_client) return _client;

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _client = createClient({ url: `file:${dbPath}` });
  return _client;
}

export function createInMemoryClient(): Client {
  return createClient({ url: ":memory:" });
}

export function resetClient(): void {
  _client = null;
}
