// Production API smoke test. Run with: node tests/api-smoke.mjs
// Reads API_ACCESS_KEY from the environment or from .env (never prints it).

import { readFileSync, existsSync } from "node:fs";

const base = process.env.SMOKE_BASE_URL ?? "http://localhost:8787";

function loadKeyFromEnvFile() {
  if (process.env.API_ACCESS_KEY) return process.env.API_ACCESS_KEY;
  if (!existsSync(".env")) return "";
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*API_ACCESS_KEY\s*=\s*(.*?)\s*$/);
    if (match) return match[1].replace(/^["']|["']$/g, "");
  }
  return "";
}

const key = loadKeyFromEnvFile();
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(path, options = {}) {
  const response = await fetch(base + path, options);
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

try {
  const health = await request("/healthz");
  check("public health probe", health.status === 200 && health.body?.ok === true, `status ${health.status}`);

  const chatBody = { message: "Refund order ORD-0998 please", sessionId: "smoke" };
  const headers = { "Content-Type": "application/json" };

  const unauth = await request("/v1/chat", { method: "POST", headers, body: JSON.stringify(chatBody) });
  check("protected API rejects missing key", unauth.status === 401, `status ${unauth.status}`);

  if (key) {
    const auth = await request("/v1/chat", {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${key}` },
      body: JSON.stringify(chatBody),
    });
    check("protected API accepts key", auth.status === 200, `status ${auth.status}`);
    check("request id echoed", Boolean(auth.body?.meta?.requestId));
    check(
      "refund above limit is escalated, not drafted",
      auth.body?.meta?.guardrails?.includes("refund-above-limit") &&
        !auth.body?.tools?.some((tool) => tool.name === "draftRefund"),
    );
  } else {
    check("API_ACCESS_KEY available for protected test", false, "set it in .env");
  }

  if (key) {
    const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${key}` };
    const agentInfo = await request("/v1/agent", { headers: authHeaders });
    check("agent metadata endpoint", agentInfo.status === 200 && agentInfo.body?.tools?.length === 4);

    const idemHeaders = { ...authHeaders, "Idempotency-Key": "smoke-fixed-key-1" };
    const first = await fetch(base + "/v1/chat", {
      method: "POST",
      headers: idemHeaders,
      body: JSON.stringify({ message: "Where is order ORD-1042?" }),
    });
    const firstBody = await first.json();
    const second = await fetch(base + "/v1/chat", {
      method: "POST",
      headers: idemHeaders,
      body: JSON.stringify({ message: "Where is order ORD-1042?" }),
    });
    check("idempotent replay", first.status === 200 && second.status === 200 && second.headers.get("x-idempotent-replay") === "true");
    check("idempotent answer identical", firstBody.answer === (await second.json()).answer);

    const invalid = await request("/v1/chat", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ message: "" }),
    });
    check("invalid body returns 400", invalid.status === 400);
  }

  const spec = await request("/openapi.json");
  check("OpenAPI spec served", spec.status === 200 && spec.body?.openapi === "3.1.0");

  const ui = await fetch(base + "/");
  check("chat UI served", ui.status === 200);
  const docs = await fetch(base + "/docs");
  check("API docs served", docs.status === 200);
} catch (error) {
  check("server reachable", false, error instanceof Error ? error.message : String(error));
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
