// Verifies graceful degradation when live mode is misconfigured or unreachable.
// Uses an invalid key and a short timeout; it never reaches a real model.

import { runAgent } from "../src/agent.js";

async function main(): Promise<void> {
  process.env.OPENAI_API_KEY = "sk-invalid-for-fallback-test";
  process.env.OPENAI_TIMEOUT_MS = "1500";

  const response = await runAgent({
    message: "What is the refund policy?",
    mode: "live",
    sessionId: "fallback-check",
  });

  const checks: Array<[string, boolean]> = [
    ["returns a response", Boolean(response.answer)],
    ["marks degraded", response.meta.degraded === true],
    ["records fallback guardrail", response.meta.guardrails.includes("live-fallback")],
    ["records error in trace", response.trace.some((step) => step.kind === "error")],
    ["still cites policy", response.citations.some((citation) => citation.docId === "refunds")],
  ];

  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1;
}

void main();
