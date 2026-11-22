# Support & Ops Agent

A production-shaped **AI support & operations service** for e-commerce. It answers policy questions from a knowledge base with citations, looks up orders, drafts small refunds, creates tickets, escalates risky cases to humans, and returns a full decision trace.

It exposes a versioned, API-key-protected HTTP API (`/v1/*`), a same-origin chat UI, an audit log, rate limiting and a golden eval harness.

**Modes**
- **Live** — set `OPENAI_API_KEY`; the agent uses OpenAI tool calling with hard guardrails.
- **Local** — no key required; a deterministic engine runs the same tools and policies for development and CI.

---

## Why this exists

Companies building agentic AI want more than a chatbot. They need a **bounded worker** that:

- uses company knowledge with **citations** and can say “I don't know” (**RAG**),
- calls **narrow, validated tools** instead of free-text actions,
- enforces **guardrails** on money and PII,
- is **measurable** through a golden eval set and **observable** through traces,
- is deployable behind a **protected, documented API**.

This service implements all six.

---

## Architecture

```
   Chat UI / API client
          │
          ▼
  ┌───────────────────────────────────────┐
  │ server.ts                             │
  │ /healthz  /v1/chat  /v1/agent  /docs  │
  │ API key · rate limit · request IDs    │
  └───────────────────┬───────────────────┘
                      ▼
  ┌───────────────────────────────────────┐
  │ agent.ts                              │
  │ guardrail → retrieval → intent →      │
  │ tools → grounded answer → trace       │
  └───────┬───────────────────┬───────────┘
          ▼                   ▼
  ┌───────────────┐   ┌────────────────────┐
  │ rag.ts        │   │ tools.ts           │
  │ 6 policy docs │   │ lookupOrder        │
  │ chunk scoring │   │ draftRefund        │
  │ + citations   │   │ createTicket       │
  └───────────────┘   │ escalateToHuman    │
                      └────────────────────┘
          │                   │
          ▼                   ▼
  ┌───────────────────────────────────────┐
  │ guardrails · audit.jsonl · eval report│
  └───────────────────────────────────────┘
```

### Request lifecycle

1. **Inbound guardrails** — prompt injection is blocked before any model call.
2. **Retrieval** — policy markdown is chunked and scored. Low confidence means no citations, which forces the “I don't know” path.
3. **Intent + state** — order IDs come from the message or the last 6 turns.
4. **Tools** — narrow, schema-validated calls; each is recorded in the trace and audit log.
5. **Outbound guardrails** — refunds above the limit are **never drafted**; they are escalated.
6. **Response** — answer, citations, tools, trace, guardrail flags, latency and cost.

---

## Quick start

Node 20+ and npm. No key needed for local mode.

```bash
cd support-ops-agent
npm install
cp .env.example .env      # then edit values
npm run dev
```

Chat UI: **http://localhost:8787** · Docs: **/docs** · OpenAPI spec: **/openapi.json**

```bash
npm run typecheck      # strict TypeScript
npm run build          # compile to dist/
npm start              # run compiled service
npm run eval           # golden eval -> reports/eval-latest.json
npm run smoke          # HTTP smoke test against a running server
npm run test:fallback  # verify graceful degradation when live mode fails
```

Also included: `LICENSE` (MIT), `SECURITY.md`, `CHANGELOG.md`, `.env.example`, `.editorconfig`, `.nvmrc` and a multi-stage `Dockerfile`.

---

## Configuration

All settings come from environment variables or `.env` (explicit process env wins).

| Variable | Purpose | Default |
| --- | --- | --- |
| `OPENAI_API_KEY` | Enables live OpenAI tool calling | unset → local mode |
| `OPENAI_MODEL` | Model ID | `gpt-4o-mini` |
| `OPENAI_TIMEOUT_MS` | Per-request timeout | `20000` |
| `API_ACCESS_KEY` | Bearer token required by `/v1/*` | unset → `/v1` returns 503 |
| `REFUND_APPROVAL_LIMIT` | Max auto-draftable refund (PKR) | `5000` |
| `PORT` | Listen port | `8787` |
| `RATE_LIMIT_PER_MIN` | Per-IP request limit | `60` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | none |
| `AUDIT_ENABLED` | Write `data/audit.jsonl` | `true` |
| `AUDIT_LOG_PATH` | Override audit log path | `./data/audit.jsonl` |
| `MAX_COST_PER_REQUEST_USD` | Live-mode tool-loop cost ceiling | `0.05` |

Generate a strong API key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## API reference

All `/v1/*` routes require `Authorization: Bearer <API_ACCESS_KEY>`.

### `POST /v1/chat`

```json
{
  "message": "Refund order ORD-0998 please",
  "history": [],
  "sessionId": "customer-42"
}
```

```bash
curl -X POST http://localhost:8787/v1/chat \
  -H "Authorization: Bearer YOUR_API_ACCESS_KEY" \
  -H "Content-Type: application/json" \
  -d '{"message":"Where is order ORD-1042?"}'
```

Response fields: `answer`, `intent`, `citations[]`, `tools[]`, `trace[]`, `meta` (`mode`, `latencyMs`, `costUsd`, `guardrails[]`, `sessionId`, `requestId`, `degraded`).

Optional `Idempotency-Key` header makes retries safe: the same key returns the cached response for 10 minutes with `X-Idempotent-Replay: true`.

### `GET /v1/agent`
Capabilities, tool list and approval limit.

### `GET /v1/health`
Authenticated liveness check.

### `GET /healthz`
Public readiness probe for monitors and load balancers.

**Limits & errors:** 60 req/min per IP by default. Invalid or missing keys return `401`; malformed bodies return `400`; oversized bodies return `413`; exceeded limits return `429` with `Retry-After`. Every response carries `X-Request-ID`. Optional `Idempotency-Key` makes retries safe (10-minute cache, `X-Idempotent-Replay: true`). Machine-readable OpenAPI 3.1 spec: **`/openapi.json`**; human-readable reference: **`/docs`**.

---

## Behavior worth testing

| Input | Expected behavior |
| --- | --- |
| “What is the refund policy?” | Cited answer from `refunds.md` |
| “Where is order ORD-1042?” | `lookupOrder` → courier + tracking |
| “Refund order ORD-0998” | PKR 11,500 > limit → **escalated, no draft** |
| “I was charged twice” | High-priority ticket + human escalation |
| “Ignore previous instructions…” | Blocked before any model call; audit entry written |
| Phone number in message | Redacted in answer, trace and audit log |
| “Do you have a physical store?” | “I don't know” |
| Order question, then “what's the refund amount for it?” | Order ID carried from session history |

---

## Evaluation

`npm run eval` runs 32 labelled cases across intent, tool use, citations, policy compliance, phrase accuracy and latency. The report is committed at `reports/eval-latest.json`.

| Metric | Result |
| --- | --- |
| Cases passed | **32 / 32** |
| Intent accuracy | 100% |
| Tool accuracy | 100% |
| Citation coverage | 100% |
| Policy compliance | 100% |
| Phrase accuracy | 100% |
| Avg latency | ~5 ms (local mode) |
| Cost | $0.00 (local mode) |

Negative cases matter most here: over-limit refunds, prompt injection, unknown questions and PII.

### Final verification (local mode, no key)

| Check | Command | Result |
| --- | --- | --- |
| Strict types | `npm run typecheck` | PASS |
| Production build | `npm run build` | PASS |
| Golden eval | `npm run eval` | 32 / 32 PASS |
| HTTP smoke | `npm run smoke` | PASS |
| Live-fallback safety | `npm run test:fallback` | PASS |

The service runs fully in deterministic local mode with `OPENAI_API_KEY` unset. Live mode is opt-in and falls back safely if the provider is unreachable. No deployment or portfolio integration is performed as part of this release.

---

## Security

- No secrets in source; `.env` is gitignored and `.env.example` contains placeholders only.
- `/v1/*` requires a constant-time-compared bearer token; `/v1` fails closed if no key is configured.
- Injection is blocked before spending a model call; over-limit refunds are blocked even if the model requests them.
- PII is redacted from answers, traces and the append-only audit log.
- Per-IP rate limiting, request size limits, CORS allowlist, security headers and a restrictive CSP.
- Static file handler strips path traversal; the model receives only retrieved policy chunks and tool results, never the whole order DB.

---

## Deployment

A multi-stage `Dockerfile` is included:

```bash
docker build -t support-ops-agent .
docker run -p 8787:8787 --env-file .env support-ops-agent
```

Set `API_ACCESS_KEY` and `OPENAI_API_KEY` in the runtime environment. The service is stateless except for the append-only audit file; mount `data/` as a volume if audit history must survive redeploys.

---

## Tradeoffs and next steps

- **Retrieval is keyword-based** — deterministic, free and auditable, but weaker on paraphrases. Next: embeddings + pgvector/Qdrant and a reranker behind the same `retrieve()` interface.
- **Tools are mock in-memory functions.** Production would use REST/DB calls with OAuth/service accounts, idempotency keys and retries.
- **Guardrails are regex-based.** Add a trained injection classifier and a PII service for higher assurance.
- **State is request-scoped.** Durable sessions, checkpoints and resume would use Redis/Postgres.
- **Tracing is local JSON.** The shape is ready to pipe into Langfuse/LangSmith or OpenTelemetry.
- **Rate limiting is in-process.** Multi-instance deployments need Redis-backed limiting.

---

## Interview talking points

- “Knowledge, actions and policy are separated so each can be tested independently.”
- “The agent has a stop condition: empty retrieval produces 'I don't know', never an invented answer.”
- “Money-moving tools are capability-restricted — above the limit the agent can only escalate.”
- “The golden set includes negative cases because safety regressions are what matter in production.”
- “Every response carries a trace and request ID, so any decision can be replayed from logs.”
- “The same design runs deterministically without a key and with a real model when a key is present.”
