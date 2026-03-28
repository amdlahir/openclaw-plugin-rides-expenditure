# Installation and Loading

## Project Location

```
/home/amin/projects/openclaw-plugin-rides-expenditure/
```

## How OpenClaw Discovers the Plugin

OpenClaw discovers plugins from four sources (in order):

1. `plugins.load.paths` — Additional paths from config
2. Workspace extensions — `<workspace>/.openclaw/extensions/`
3. Global extensions — `~/.openclaw/extensions/`
4. Bundled extensions — Shipped with OpenClaw

This plugin uses method **1** — it lives in its own project directory and is linked into OpenClaw.

## Installation

### Option A: Link mode (development)

```bash
openclaw plugins install -l /home/amin/projects/openclaw-plugin-rides-expenditure
```

This adds the path to `plugins.load.paths` in `~/.openclaw/openclaw.json` without copying files. Changes to the source are picked up on OpenClaw restart.

### Option B: Manual config

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": ["/home/amin/projects/openclaw-plugin-rides-expenditure"]
    },
    "entries": {
      "rides-expenditure": {
        "enabled": true,
        "config": {
          "googleClientId": "xxx.apps.googleusercontent.com",
          "googleClientSecret": "GOCSPX-xxx",
          "googleAiApiKey": "AIzaSy-xxx",
          "baseUrl": "https://my-openclaw.example.com",
          "defaultCategory": "personal",
          "syncIntervalMinutes": 15
        }
      }
    }
  }
}
```

## TypeScript — No Build Step Required

OpenClaw uses **jiti** (v2.6.1) to load TypeScript at runtime. Plugins do **not** need to be compiled to JavaScript.

- Entry point resolution order: `index.ts` > `index.js` > `index.mjs` > `index.cjs`
- All official OpenClaw plugins use `.ts` directly
- The `package.json` points directly to `.ts` source:

```json
{
  "openclaw": {
    "extensions": ["./src/index.ts"]
  }
}
```

This means the project has **no build step** — no `tsconfig.json` outDir, no `dist/` folder, no compile-before-run. Source files are loaded directly.

## Required Files for Plugin Discovery

When OpenClaw points at a directory, it needs:

1. **`openclaw.plugin.json`** — Plugin manifest (id, configSchema)
2. **`package.json`** — With `openclaw.extensions` array pointing to entry file(s)
3. **Entry file** — `src/index.ts` (as specified in `openclaw.extensions`)

## Plugin Lifecycle

```
1. Discovery:   OpenClaw finds the directory via plugins.load.paths
2. Manifest:    Reads openclaw.plugin.json → validates config without executing code
3. Enablement:  Checks plugins.entries.rides-expenditure.enabled
4. Loading:     jiti loads src/index.ts at runtime (TypeScript → in-memory transpile)
5. Registration: Calls register(api) → plugin registers tools, commands, routes, services, hooks
6. Activation:  Registered items exposed to agent, CLI, gateway, HTTP server
```

## Database Location

The DB file is **not** in the project directory. It lives in OpenClaw's state directory:

```
~/.openclaw/rides-expenditure/rides.db
```

Resolved at runtime via `api.runtime.state.resolveStateDir()` + `/rides-expenditure/rides.db`. This ensures the database persists regardless of where the plugin source code lives.

## Dependencies

Since jiti loads the plugin in-process, dependencies must be resolvable from the plugin directory. Install them normally:

```bash
cd /home/amin/projects/openclaw-plugin-rides-expenditure
npm install
```

Required dependencies:
- `@libsql/client` — SQLite/libSQL database client
- `zod` — Schema validation
- `@google/generative-ai` — Gemini API (optional, for screenshot parsing)
