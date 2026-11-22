// Tiny local RAG: markdown policy docs -> bullets -> keyword/IDF-free scoring.
// No vector DB or API key needed. Swappable with embeddings + pgvector later.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PolicyDoc, RetrievedChunk } from "./types.js";

const POLICY_DIR = fileURLToPath(new URL("../data/policies/", import.meta.url));
const MIN_SCORE = 2;

const STOPWORDS = new Set(
  `a an the and or but if then than so of to in on at by for from with about into over under
   is are was were be been being am do does did done have has had having
   i me my mine we us our you your yours it its this that these those he she they them their
   what which who whom when where why how can could would should will shall may might must
   not no nor as per via please thanks thank just also very more most some any all each every
   other another such only own same too policy policies policy's`
    .split(/\s+/)
    .filter(Boolean),
);

function stem(token: string): string {
  return token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/(\d),(\d)/g, "$1$2")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map(stem);
}

export function loadPolicies(): PolicyDoc[] {
  return readdirSync(POLICY_DIR)
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const content = readFileSync(join(POLICY_DIR, file), "utf8");
      const title = content.match(/^#\s+(.+)$/m)?.[1] ?? file;
      return { id: file.replace(/\.md$/, ""), title, path: file, content };
    });
}

interface ScoredChunk {
  doc: PolicyDoc;
  text: string;
  score: number;
}

export function retrieve(query: string, docs: PolicyDoc[] = loadPolicies(), topK = 4): RetrievedChunk[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  const scored: ScoredChunk[] = [];

  for (const doc of docs) {
    const titleTokens = new Set(tokenize(doc.title));
    const lines = doc.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (line.startsWith("#")) continue; // titles are metadata, not answer chunks
      const text = line.replace(/^[-*]\s*/, "").replace(/\*\*/g, "");
      if (text.length < 12) continue;

      const chunkTokens = new Set(tokenize(line));
      let score = 0;

      for (const token of queryTokens) {
        if (titleTokens.has(token)) score += 2;
        if (chunkTokens.has(token)) score += 1;
        if (/^\d+$/.test(token) && chunkTokens.has(token)) score += 1;
      }

      if (score >= MIN_SCORE) scored.push({ doc, text, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((item) => ({
    docId: item.doc.id,
    title: item.doc.title,
    text: item.text,
    score: item.score,
  }));
}
