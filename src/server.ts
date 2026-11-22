// Production HTTP service: versioned protected API + same-origin chat UI.
// Zero runtime dependencies.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { accessSync, constants as fsConstants } from "node:fs";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAgent } from "./agent.js";
import { envInt, loadEnv } from "./config.js";
import { loadPolicies } from "./rag.js";
import type { AgentResponse, ChatMessage } from "./types.js";

// IMPORTANT: load .env before reading any process.env values.
loadEnv();

const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
const PORT = envInt("PORT", 8787);
const API_ACCESS_KEY = process.env.API_ACCESS_KEY ?? "";
const RATE_LIMIT = envInt("RATE_LIMIT_PER_MIN", 60);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

interface RateBucket {
  count: number;
  resetAt: number;
}
const rateBuckets = new Map<string, RateBucket>();

interface CachedResponse {
  expiresAt: number;
  response: AgentResponse;
}
const idempotencyCache = new Map<string, CachedResponse>();
const IDEMPOTENCY_TTL_MS = 10 * 60_000;

function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

function rateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  if (rateBuckets.size > 5000) {
    for (const [key, bucket] of rateBuckets) if (bucket.resetAt < now) rateBuckets.delete(key);
  }

  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    const fresh: RateBucket = { count: 1, resetAt: now + 60_000 };
    rateBuckets.set(ip, fresh);
    return { allowed: true, remaining: RATE_LIMIT - 1, resetAt: fresh.resetAt };
  }
  if (bucket.count >= RATE_LIMIT) return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  bucket.count += 1;
  return { allowed: true, remaining: RATE_LIMIT - bucket.count, resetAt: bucket.resetAt };
}

function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!API_ACCESS_KEY) return false;
  const match = (req.headers.authorization ?? "").match(/^Bearer\s+(.+)$/i);
  return Boolean(match && safeEqual(match[1].trim(), API_ACCESS_KEY));
}

function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Vary", "Origin");
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Request-ID": requestId,
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, maxBytes = 64_000): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += String(chunk);
    if (body.length > maxBytes) throw new Error("Request body too large");
  }
  return body;
}

interface ValidChatInput {
  message: string;
  history: ChatMessage[];
  sessionId: string;
}

function validateChatBody(parsed: unknown): ValidChatInput | { error: string } {
  if (!parsed || typeof parsed !== "object") return { error: "Invalid JSON body" };
  const body = parsed as Record<string, unknown>;

  if (typeof body.message !== "string" || !body.message.trim()) return { error: "message is required" };
  if (body.message.length > 4000) return { error: "message must be 4000 characters or fewer" };

  const history: ChatMessage[] = [];
  if (body.history !== undefined) {
    if (!Array.isArray(body.history) || body.history.length > 20) return { error: "history must be an array of at most 20 messages" };
    for (const item of body.history) {
      if (!item || typeof item !== "object") return { error: "invalid history item" };
      const entry = item as Record<string, unknown>;
      if ((entry.role !== "user" && entry.role !== "assistant") || typeof entry.content !== "string" || entry.content.length > 4000) {
        return { error: "invalid history item" };
      }
      history.push({ role: entry.role, content: entry.content });
    }
  }

  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.slice(0, 64) : "default";
  return { message: body.message.trim(), history, sessionId };
}

function logRequest(req: IncomingMessage, status: number, requestId: string, started: number): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      requestId,
      method: req.method,
      path: req.url,
      status,
      ms: Math.round(performance.now() - started),
    }),
  );
}

const server = createServer(async (req, res) => {
  const started = performance.now();
  const requestId = typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"].slice(0, 64) : randomUUID();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  applyCors(req, res);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(key, value);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "X-Request-ID": requestId });
    res.end();
    logRequest(req, 204, requestId, started);
    return;
  }

  const ip = clientIp(req);
  const limit = rateLimit(ip);
  const limitHeaders = {
    "X-RateLimit-Limit": String(RATE_LIMIT),
    "X-RateLimit-Remaining": String(limit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(limit.resetAt / 1000)),
  };

  if (path === "/healthz" || path === "/api/health") {
    let ready = true;
    let policyCount = 0;
    try {
      policyCount = loadPolicies().length;
      if (policyCount === 0) ready = false;
      accessSync(fileURLToPath(new URL("../data/", import.meta.url)), fsConstants.W_OK);
    } catch {
      ready = false;
    }
    sendJson(
      res,
      ready ? 200 : 503,
      {
        ok: ready,
        service: "support-ops-agent",
        version: "1.0.0",
        mode: process.env.OPENAI_API_KEY ? "live" : "local",
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        apiAuthConfigured: Boolean(API_ACCESS_KEY),
        policyCount,
        timestamp: new Date().toISOString(),
      },
      requestId,
      limitHeaders,
    );
    logRequest(req, ready ? 200 : 503, requestId, started);
    return;
  }

  if (path.startsWith("/v1/")) {
    if (!API_ACCESS_KEY) {
      sendJson(res, 503, { error: "API_ACCESS_KEY is not configured on this server" }, requestId);
      logRequest(req, 503, requestId, started);
      return;
    }
    if (!isAuthorized(req)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendJson(res, 401, { error: "Unauthorized. Send Authorization: Bearer <API_ACCESS_KEY>" }, requestId);
      logRequest(req, 401, requestId, started);
      return;
    }
  }

  if (!limit.allowed) {
    res.setHeader("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
    sendJson(res, 429, { error: "Rate limit exceeded" }, requestId, limitHeaders);
    logRequest(req, 429, requestId, started);
    return;
  }

  if (path === "/v1/health" && req.method === "GET") {
    sendJson(res, 200, { ok: true, authenticated: true, requestId }, requestId, limitHeaders);
    logRequest(req, 200, requestId, started);
    return;
  }

  if (path === "/v1/agent" && req.method === "GET") {
    sendJson(
      res,
      200,
      {
        name: "Support & Ops Agent",
        version: "1.0.0",
        tools: ["lookupOrder", "draftRefund", "createTicket", "escalateToHuman"],
        capabilities: ["rag_with_citations", "tool_calling", "guardrails", "human_escalation", "tracing"],
        refundApprovalLimit: Number(process.env.REFUND_APPROVAL_LIMIT ?? 5000),
        endpoints: ["/v1/chat", "/v1/agent", "/v1/health"],
      },
      requestId,
      limitHeaders,
    );
    logRequest(req, 200, requestId, started);
    return;
  }

  if ((path === "/v1/chat" || path === "/api/chat") && req.method === "POST") {
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].slice(0, 128) : "";
    const cacheKey = idempotencyKey ? `${ip}:${idempotencyKey}` : "";

    if (cacheKey) {
      const cached = idempotencyCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        sendJson(res, 200, cached.response, requestId, { ...limitHeaders, "X-Idempotent-Replay": "true" });
        logRequest(req, 200, requestId, started);
        return;
      }
      if (idempotencyCache.size > 2000) {
        for (const [key, value] of idempotencyCache) if (value.expiresAt <= Date.now()) idempotencyCache.delete(key);
      }
    }

    try {
      const input = validateChatBody(JSON.parse(await readBody(req)) as unknown);
      if ("error" in input) {
        sendJson(res, 400, { error: input.error }, requestId, limitHeaders);
        logRequest(req, 400, requestId, started);
        return;
      }

      const result = await runAgent({
        message: input.message,
        history: input.history,
        sessionId: input.sessionId,
        requestId,
      });
      if (cacheKey) idempotencyCache.set(cacheKey, { expiresAt: Date.now() + IDEMPOTENCY_TTL_MS, response: result });
      sendJson(res, 200, result, requestId, limitHeaders);
      logRequest(req, 200, requestId, started);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Internal error";
      const tooLarge = /too large/i.test(rawMessage);
      const status = tooLarge ? 413 : 500;
      sendJson(res, status, { error: rawMessage, requestId }, requestId, limitHeaders);
      logRequest(req, status, requestId, started);
    }
    return;
  }

  // Static assets (UI, docs, OpenAPI spec). Path traversal is neutralised.
  let rawPath: string;
  try {
    rawPath = path === "/" ? "index.html" : path === "/docs" ? "docs.html" : path === "/openapi.json" ? "openapi.json" : decodeURIComponent(path).replace(/^\/+/, "");
  } catch {
    sendJson(res, 400, { error: "Malformed path", requestId }, requestId);
    logRequest(req, 400, requestId, started);
    return;
  }
  const safePath = rawPath.split("..").join("");
  const filePath = join(WEB_DIR, safePath || "index.html");

  try {
    const data = await readFile(filePath);
    const headers: Record<string, string> = {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "X-Request-ID": requestId,
      ...SECURITY_HEADERS,
    };
    if (extname(filePath) === ".html") {
      headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'";
    }
    res.writeHead(200, headers);
    res.end(data);
    logRequest(req, 200, requestId, started);
  } catch {
    sendJson(res, 404, { error: "Not found", requestId }, requestId);
    logRequest(req, 404, requestId, started);
  }
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "server_started", port: PORT, apiAuth: Boolean(API_ACCESS_KEY) }));
  console.log(`Support & Ops Agent API ready at http://localhost:${PORT} (docs: /docs)`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "server_shutdown", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
