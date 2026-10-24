import { serve } from "@hono/node-server";
import { z } from "zod";
import { createRagApiClient } from "./api-client.js";
import { createFrontendApp } from "./app.js";

// Standalone chat frontend. Run the RAG API first (`npm run dev`, :3000), then `npm run frontend`.
const EnvSchema = z.object({
  FRONTEND_PORT: z.coerce.number().int().positive().default(3001),
  RAG_API_URL: z.url().default("http://localhost:3000"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  process.stderr.write(`Invalid frontend configuration:\n${z.prettifyError(parsed.error)}\n`);
  process.exit(1);
}
const { FRONTEND_PORT, RAG_API_URL } = parsed.data;

const app = createFrontendApp({ client: createRagApiClient(RAG_API_URL), apiUrl: RAG_API_URL });

serve({ fetch: app.fetch, port: FRONTEND_PORT }, (info) => {
  process.stdout.write(`ResortOS chat frontend on http://localhost:${info.port} -> RAG API ${RAG_API_URL}\n`);
});
