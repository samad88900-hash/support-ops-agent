// Append-only audit log. Sensitive values are redacted before they reach disk.
// This is what a compliance reviewer would inspect after a refund escalation.

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { envBool } from "./config.js";
import { redactPII } from "./guardrails.js";

function logPath(): string {
  const configured = process.env.AUDIT_LOG_PATH;
  if (!configured) return fileURLToPath(new URL("../data/audit.jsonl", import.meta.url));
  return configured.startsWith("file:") ? fileURLToPath(configured) : resolve(configured);
}

export interface AuditEvent {
  timestamp: string;
  requestId?: string;
  actor: string;
  action: string;
  outcome: "success" | "blocked" | "error";
  detail?: string;
}

export function audit(event: Omit<AuditEvent, "timestamp">): void {
  if (!envBool("AUDIT_ENABLED", true)) return;

  const entry: AuditEvent = { timestamp: new Date().toISOString(), ...event };
  if (entry.detail) entry.detail = redactPII(entry.detail).slice(0, 1000);

  try {
    const path = logPath();
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path) && statSync(path).size > 5_000_000) {
      renameSync(path, `${path}.1`); // keep one rotated file
    }
    appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Auditing must never break a customer-facing request.
  }
}
