// Golden-set evaluation harness. Runs the deterministic agent against labelled
// cases and writes a machine-readable report to reports/eval-latest.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runAgent } from "../agent.js";
import { loadEnv } from "../config.js";
import type { CaseResult, EvalReport, GoldenCase } from "../types.js";

loadEnv();

const GOLDEN_PATH = fileURLToPath(new URL("../../tests/golden.json", import.meta.url));
const REPORT_PATH = fileURLToPath(new URL("../../reports/eval-latest.json", import.meta.url));

const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as GoldenCase[];
const results: CaseResult[] = [];

function includesAll(haystack: string[], needles: string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

for (const testCase of golden) {
  const response = await runAgent({
    message: testCase.query,
    history: testCase.history ?? [],
    sessionId: "eval",
    mode: "mock",
  });

  const answer = response.answer.toLowerCase();
  const actualTools = response.tools.map((tool) => tool.name);
  const actualCitations = response.citations.map((citation) => citation.docId);
  const checks: Record<string, boolean> = {
    intent: response.intent === testCase.intent,
    tools: !testCase.tools || includesAll(actualTools, testCase.tools),
    citations: !testCase.citations || includesAll(actualCitations, testCase.citations),
    phrases: !testCase.required || testCase.required.every((phrase) => answer.includes(phrase.toLowerCase())),
    forbidden: !testCase.forbidden || testCase.forbidden.every((phrase) => !answer.includes(phrase.toLowerCase())),
    latency: response.meta.latencyMs < 1500,
  };

  if (testCase.mustApprove) {
    checks.policy = response.meta.guardrails.includes("refund-above-limit") && !actualTools.includes("draftRefund");
  }

  const failures = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  results.push({
    id: testCase.id,
    query: testCase.query,
    passed: failures.length === 0,
    checks,
    failures,
    actual: {
      intent: response.intent,
      tools: actualTools,
      citations: actualCitations,
      latencyMs: response.meta.latencyMs,
      guardrails: response.meta.guardrails,
    },
  });
}

const avg = (values: number[]): number =>
  values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)) : 0;
const rate = (predicate: (result: CaseResult, index: number) => boolean): number =>
  Number(((results.filter(predicate).length / results.length) * 100).toFixed(1));

const report: EvalReport = {
  generatedAt: new Date().toISOString(),
  cases: results.length,
  passed: results.filter((result) => result.passed).length,
  metrics: {
    intentAccuracy: rate((result) => result.checks.intent),
    toolAccuracy: rate((result) => result.checks.tools),
    citationCoverage: rate((result) => result.checks.citations),
    policyCompliance: rate((result, index) => {
      const testCase = golden[index];
      if (testCase.mustApprove) return Boolean(result.checks.policy);
      return result.checks.forbidden;
    }),
    phraseAccuracy: rate((result) => result.checks.phrases),
    passRate: rate((result) => result.passed),
    avgLatencyMs: avg(results.map((result) => result.actual.latencyMs)),
    totalCostUsd: 0,
  },
  results,
};

mkdirSync(fileURLToPath(new URL("../../reports/", import.meta.url)), { recursive: true });
writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

console.log("Support & Ops Agent — golden evaluation\n");
console.log("ID                     RESULT  INTENT                 TOOLS");
console.log("─".repeat(78));
for (const result of results) {
  console.log(
    `${result.id.padEnd(22)} ${(result.passed ? "PASS" : "FAIL").padEnd(7)} ` +
      `${result.actual.intent.padEnd(21)} ${result.actual.tools.join(", ") || "-"}` +
      (result.failures.length ? `  [${result.failures.join(",")}]` : ""),
  );
}
console.log("─".repeat(78));
console.log(`Passed: ${report.passed}/${report.cases} (${report.metrics.passRate}%)\n`);
console.log("Metrics:");
for (const [key, value] of Object.entries(report.metrics)) {
  console.log(`  ${key.padEnd(20)} ${value}`);
}
console.log(`\nReport written to ${REPORT_PATH}`);

if (report.passed < report.cases) process.exitCode = 1;
