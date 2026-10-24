import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/huggingface_transformers";
import { Chroma } from "@langchain/community/vectorstores/chroma";
import { Document } from "@langchain/core/documents";
import { ChromaClient, ChromaNotFoundError } from "chromadb";
import { toMetadata } from "../campaign/conditions.js";
import type { AppConfig } from "../config.js";
import { type GuestProfile, profileText } from "../domain/guest-profile.js";

/** Small open embedding model, runs locally via Transformers.js (no API key, no cost). */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

type ChromaConfig = Pick<AppConfig, "chromaHost" | "chromaPort" | "chromaCollection">;

// Loading the model takes seconds, so one instance is shared per process.
let sharedEmbeddings: HuggingFaceTransformersEmbeddings | undefined;
const embeddings = () => (sharedEmbeddings ??= new HuggingFaceTransformersEmbeddings({ model: EMBEDDING_MODEL }));

const chromaClient = (config: ChromaConfig) => new ChromaClient({ host: config.chromaHost, port: config.chromaPort });

const storeOptions = (config: ChromaConfig, client: ChromaClient) => ({
  index: client,
  collectionName: config.chromaCollection,
  collectionConfiguration: { hnsw: { space: "cosine" as const } },
});

export function openVectorStore(config: ChromaConfig): Chroma {
  return new Chroma(embeddings(), storeOptions(config, chromaClient(config)));
}

/** Probe only: reports reachability rather than throwing, so callers can explain what to start. */
export async function isChromaReachable(config: ChromaConfig): Promise<boolean> {
  try {
    await chromaClient(config).heartbeat();
    return true;
  } catch {
    return false;
  }
}

export function toDocument(profile: GuestProfile): Document {
  return new Document({ pageContent: profileText(profile), metadata: { ...toMetadata(profile) } });
}

/** Drops and rebuilds the collection so the index always mirrors the CSV exactly. */
export async function rebuildIndex(config: ChromaConfig, profiles: readonly GuestProfile[]): Promise<Chroma> {
  const client = chromaClient(config);
  try {
    await client.deleteCollection({ name: config.chromaCollection });
  } catch (error) {
    if (!(error instanceof ChromaNotFoundError)) throw error;
  }
  const store = new Chroma(embeddings(), storeOptions(config, client));
  await store.addDocuments(profiles.map(toDocument), { ids: profiles.map((p) => p.guestId) });
  return store;
}
