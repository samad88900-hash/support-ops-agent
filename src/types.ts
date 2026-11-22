// Shared domain types for the Support & Ops Agent.
// Keeping these in one place makes the agent, tools, server and eval harness agree on shapes.

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
  price: number;
}

export interface Order {
  id: string;
  customer: string;
  phone: string;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  paid: number;
  status: string;
  courier: string | null;
  tracking: string | null;
  eta: string | null;
  address: string;
  createdAt: string;
}

export interface PolicyDoc {
  id: string;
  title: string;
  path: string;
  content: string;
}

export interface RetrievedChunk {
  docId: string;
  title: string;
  text: string;
  score: number;
}

export interface Citation {
  docId: string;
  title: string;
  excerpt: string;
}

export type ToolName = "lookupOrder" | "draftRefund" | "createTicket" | "escalateToHuman";

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
  result: unknown;
  ok: boolean;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type TraceKind = "guardrail" | "retrieval" | "decision" | "tool" | "answer" | "error";

export interface TraceStep {
  kind: TraceKind;
  label: string;
  detail: string;
  ms: number;
}

export type AgentMode = "mock" | "live";

export interface AgentRequest {
  message: string;
  history?: ChatMessage[];
  sessionId?: string;
  requestId?: string;
  /** Force a mode. Defaults to live when OPENAI_API_KEY is set, otherwise mock. */
  mode?: AgentMode;
}

export interface AgentMeta {
  mode: AgentMode;
  latencyMs: number;
  /** Estimated USD. Always 0 in deterministic mock mode. */
  costUsd: number;
  guardrails: string[];
  sessionId: string;
  requestId?: string;
  /** True when live mode failed and the deterministic engine served the request. */
  degraded?: boolean;
}

export interface AgentResponse {
  answer: string;
  intent: string;
  citations: Citation[];
  tools: ToolCall[];
  trace: TraceStep[];
  meta: AgentMeta;
}

export interface GoldenCase {
  id: string;
  query: string;
  intent: string;
  tools?: string[];
  citations?: string[];
  required?: string[];
  forbidden?: string[];
  mustApprove?: boolean;
  history?: ChatMessage[];
}

export interface CaseResult {
  id: string;
  query: string;
  passed: boolean;
  checks: Record<string, boolean>;
  failures: string[];
  actual: {
    intent: string;
    tools: string[];
    citations: string[];
    latencyMs: number;
    guardrails: string[];
  };
}

export interface EvalReport {
  generatedAt: string;
  cases: number;
  passed: number;
  metrics: {
    intentAccuracy: number;
    toolAccuracy: number;
    citationCoverage: number;
    policyCompliance: number;
    phraseAccuracy: number;
    passRate: number;
    avgLatencyMs: number;
    totalCostUsd: number;
  };
  results: CaseResult[];
}
