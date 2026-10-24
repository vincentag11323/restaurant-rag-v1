import { loadConfig } from "../config.js";
import { loadGuestProfiles } from "../domain/load-profiles.js";
import { isChromaReachable, rebuildIndex } from "../rag/vector-store.js";

// Rebuilds the Chroma collection from data/mock/invoices.csv. Re-run after any CSV change.
const config = loadConfig();

if (!(await isChromaReachable(config))) {
  process.stderr.write(`Chroma is not reachable at ${config.chromaHost}:${config.chromaPort}. Start it with: npm run chroma\n`);
  process.exit(1);
}

const profiles = loadGuestProfiles(config.invoicesCsv);
await rebuildIndex(config, profiles);
process.stdout.write(`Indexed ${profiles.length} guest profiles into Chroma collection "${config.chromaCollection}".\n`);
