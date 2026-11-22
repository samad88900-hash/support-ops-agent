# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | ✅ |

## Reporting a vulnerability

Do **not** open a public issue for security problems. Report privately with:

- affected version / endpoint,
- steps to reproduce,
- potential impact,
- suggested fix if you have one.

Include a non-sensitive reproduction. Never attach real API keys, customer data or audit logs.

## Key handling

- `OPENAI_API_KEY` and `API_ACCESS_KEY` belong in environment variables or `.env` only.
- `.env` is gitignored; `.env.example` contains placeholders exclusively.
- Rotate `API_ACCESS_KEY` immediately if it is exposed. Rotate `OPENAI_API_KEY` in the OpenAI dashboard.
- Use a long random value for `API_ACCESS_KEY`:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Deployment checklist

- [ ] `API_ACCESS_KEY` set; `/v1` returns 401 without it.
- [ ] `OPENAI_API_KEY` set only if live mode is intended; otherwise leave unset for local mode.
- [ ] `ALLOWED_ORIGINS` limited to your real frontends.
- [ ] `RATE_LIMIT_PER_MIN` tuned for expected traffic.
- [ ] `REFUND_APPROVAL_LIMIT` reviewed by the business owner.
- [ ] HTTPS terminated at the proxy/load balancer.
- [ ] `data/audit.jsonl` mounted on persistent storage and access-restricted.
- [ ] `/healthz` wired into uptime monitoring.
- [ ] Logs shipped to a central store; verify no PII appears in them.

## Built-in controls

- Prompt injection is blocked before any model call, and over-limit refunds are blocked even if the model requests them.
- PII is redacted from answers, traces and audit records.
- Bearer tokens are compared in constant time; `/v1` fails closed when no key is configured.
- Request size limits, per-IP rate limiting, CORS allowlist, security headers and CSP are enabled.
- Static file handler strips path traversal sequences.
