# Changelog

All notable changes to this project are documented here.

## [1.0.0] - 2026-11-23

### Added
- Versioned, bearer-token-protected API: `POST /v1/chat`, `GET /v1/agent`, `GET /v1/health`, public `GET /healthz`.
- Optional OpenAI live tool-calling mode with timeout, retry, per-request cost cap and graceful fallback to the deterministic engine.
- RAG over six policy documents with citations and an explicit "I don't know" path.
- Tools: `lookupOrder`, `draftRefund`, `createTicket`, `escalateToHuman`.
- Guardrails: prompt-injection blocking, PII redaction, refund approval threshold, double-charge escalation.
- Append-only audit log with redaction and size rotation.
- Rate limiting, idempotency keys, request IDs, structured JSON logs, CORS allowlist, security headers and CSP.
- OpenAPI 3.1 spec at `/openapi.json` and human-readable docs at `/docs`.
- Golden eval harness (32 cases) with committed report, HTTP smoke test and live-fallback test.
- Multi-stage Dockerfile, `.env.example`, SECURITY.md, LICENSE and professional README.

### Changed
- Removed all demo-oriented wording; service is presented as a production-shaped agent API.
- Tool IDs now include a time component to avoid collisions across restarts.
- Health probe verifies knowledge-base load and data-directory writability.

[1.0.0]: https://github.com/example/support-ops-agent/releases/tag/v1.0.0
