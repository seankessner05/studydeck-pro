import path from "node:path";
import { checkClaude, runClaude } from "./claude.js";
import { GranolaConnection } from "./granola/api.js";
import { formatDirectSync, runDirectSync } from "./granola/sync.js";
import { NOTES_DIR } from "./notes.js";
import { DATA_DIR } from "./paths.js";
import { loadRegistry } from "./registry.js";
import { formatSyncResult, runSync } from "./sync.js";

const courses = loadRegistry(DATA_DIR);
const granola = new GranolaConnection(path.join(DATA_DIR, "granola-auth.json"));
const port = process.env.PORT ?? "3000";

async function viaGranola() {
  const result = await granola.withApi(`http://localhost:${port}/api/granola/callback`, (api) =>
    runDirectSync({ api, courses, onProgress: (m) => console.log(m) }),
  );
  console.log("\n" + formatDirectSync(result));
}

async function viaClaude() {
  const c = checkClaude();
  if (!c.ok) throw new Error(c.error);
  const r = await runSync({ runner: runClaude, courses, onProgress: (m) => console.log(m) });
  console.log("\n" + formatSyncResult(r));
}

try {
  if (process.argv.includes("--via-claude")) {
    await viaClaude();
  } else if (granola.isConnected()) {
    await viaGranola();
  } else {
    console.log("Granola isn't connected directly yet, so this uses the slower Claude-based sync (last 14 days only).");
    console.log(`For the whole semester: run \`npm start\`, open http://localhost:${port} and click “Connect Granola”.\n`);
    await viaClaude();
  }
} catch (e) {
  console.error(`\n✖ Sync failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
