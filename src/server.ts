import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { loadGuestProfiles } from "./domain/load-profiles.js";
import { createCampaignRunner } from "./rag/campaign-runner.js";
import { isChromaReachable, openVectorStore } from "./rag/vector-store.js";

const config = loadConfig();
const profiles = loadGuestProfiles(config.invoicesCsv);

if (!(await isChromaReachable(config))) {
  process.stderr.write(`Chroma is not reachable at ${config.chromaHost}:${config.chromaPort}. Start it with: npm run chroma\n`);
  process.exit(1);
}

const runner = createCampaignRunner({ store: openVectorStore(config), profiles, deepseek: config.deepseek });

serve({ fetch: createApp(runner).fetch, port: config.port }, (info) => {
  const llm = config.deepseek.apiKey ? `DeepSeek (${config.deepseek.model})` : "dry-run (no DEEPSEEK_API_KEY)";
  process.stdout.write(`ResortOS RAG on http://localhost:${info.port} · ${profiles.length} guests · drafting: ${llm}\n`);
});
