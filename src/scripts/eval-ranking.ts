import { loadConfig } from "../config.js";
import { loadGuestProfiles } from "../domain/load-profiles.js";
import { evaluateRanking } from "../rag/ranking-eval.js";
import { SEMANTIC_WEIGHT } from "../rag/rerank.js";
import { isChromaReachable, openVectorStore } from "../rag/vector-store.js";

// Scores every preset's ranking against hand-labelled ground truth (Spearman, top-1 hit).
// Run after changing profile text, embeddings, SEMANTIC_WEIGHT or intent signals.
const config = loadConfig();

if (!(await isChromaReachable(config))) {
  process.stderr.write(`Chroma is not reachable at ${config.chromaHost}:${config.chromaPort}. Start it with: npm run chroma\n`);
  process.exit(1);
}

const report = await evaluateRanking(openVectorStore(config), loadGuestProfiles(config.invoicesCsv));
const lines = report.rows.map(
  (r) =>
    `${r.campaignId.padEnd(34)} spearman ${r.spearman.toFixed(2).padStart(5)}  ${r.top1Hit ? "top1 ok  " : "top1 MISS"}  ${r.order.join(" > ")}`,
);
process.stdout.write(
  [
    `Ranking eval (semantic weight ${SEMANTIC_WEIGHT})`,
    ...lines,
    `mean spearman ${report.meanSpearman.toFixed(2)} | top-1 hits ${report.top1Hits}/${report.rows.length}`,
    "",
  ].join("\n"),
);
