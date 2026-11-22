// Mock business tools. Each tool is narrow, validates its input, and returns a
// structured result. Real integrations would replace the bodies with REST/DB calls.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkRefundLimit } from "./guardrails.js";
import type { Order, ToolCall, ToolName } from "./types.js";

const ORDERS_PATH = fileURLToPath(new URL("../data/orders.json", import.meta.url));
const orders: Order[] = JSON.parse(readFileSync(ORDERS_PATH, "utf8")) as Order[];

/** Read at call time so .env values are respected. */
export function getRefundLimit(): number {
  const value = Number(process.env.REFUND_APPROVAL_LIMIT);
  return Number.isFinite(value) && value > 0 ? value : 5000;
}

const drafts = new Map<string, Record<string, unknown>>();
const tickets = new Map<string, Record<string, unknown>>();
const escalations = new Map<string, Record<string, unknown>>();
let counter = 1000;

function nextId(prefix: string): string {
  counter += 1;
  // Time component prevents collisions across process restarts.
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${counter}`;
}

export function getOrder(orderId: string): Order | undefined {
  return orders.find((order) => order.id.toLowerCase() === orderId.trim().toLowerCase());
}

export function lookupOrder(orderId: string): { ok: boolean; order?: Omit<Order, "phone">; error?: string } {
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: `Order ${orderId} not found.` };
  const { phone: _phone, ...safeOrder } = order; // never expose phone in tool output
  return { ok: true, order: safeOrder };
}

export function draftRefund(args: {
  orderId: string;
  amount: number;
  reason: string;
}): { ok: boolean; draft?: Record<string, unknown>; approvalRequired?: boolean; error?: string } {
  const { orderId, amount, reason } = args;
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Invalid refund amount." };

  const decision = checkRefundLimit(amount, getRefundLimit());
  const id = nextId("RFD");
  const draft = {
    id,
    orderId: orderId || "unspecified",
    amount,
    reason,
    status: decision.requiresApproval ? "pending_approval" : "ready",
    createdAt: new Date().toISOString(),
  };
  drafts.set(id, draft);
  return { ok: true, draft, approvalRequired: decision.requiresApproval };
}

export function createTicket(args: {
  issue: string;
  priority: "low" | "normal" | "high";
}): { ok: boolean; ticket?: Record<string, unknown>; error?: string } {
  if (!args.issue?.trim()) return { ok: false, error: "Issue description is required." };
  const priority = ["low", "normal", "high"].includes(args.priority) ? args.priority : "normal";
  const id = nextId("TKT");
  const ticket = { id, issue: args.issue.trim(), priority, status: "open", createdAt: new Date().toISOString() };
  tickets.set(id, ticket);
  return { ok: true, ticket };
}

export function escalateToHuman(args: { reason: string }): { ok: boolean; escalation?: Record<string, unknown>; error?: string } {
  if (!args.reason?.trim()) return { ok: false, error: "Escalation reason is required." };
  const id = nextId("ESC");
  const escalation = { id, reason: args.reason.trim(), status: "queued", createdAt: new Date().toISOString() };
  escalations.set(id, escalation);
  return { ok: true, escalation };
}

export function executeTool(name: ToolName, args: Record<string, unknown>): ToolCall {
  switch (name) {
    case "lookupOrder": {
      const result = lookupOrder(String(args.orderId ?? ""));
      return { name, args, result, ok: result.ok };
    }
    case "draftRefund": {
      const result = draftRefund({
        orderId: String(args.orderId ?? ""),
        amount: Number(args.amount),
        reason: String(args.reason ?? "customer request"),
      });
      return { name, args, result, ok: result.ok };
    }
    case "createTicket": {
      const result = createTicket({
        issue: String(args.issue ?? ""),
        priority: (args.priority as "low" | "normal" | "high") ?? "normal",
      });
      return { name, args, result, ok: result.ok };
    }
    case "escalateToHuman": {
      const result = escalateToHuman({ reason: String(args.reason ?? "") });
      return { name, args, result, ok: result.ok };
    }
  }
}

/** OpenAI-compatible tool definitions, used by the optional live mode. */
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "lookupOrder",
      description: "Look up an order by its ID (e.g. ORD-1042). Returns status, totals, courier and tracking.",
      parameters: {
        type: "object",
        properties: { orderId: { type: "string", description: "Order ID" } },
        required: ["orderId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "draftRefund",
      description: "Draft a refund. Only allowed up to the approval limit; larger refunds must be escalated.",
      parameters: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          amount: { type: "number" },
          reason: { type: "string" },
        },
        required: ["orderId", "amount", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "createTicket",
      description: "Create a support ticket with a priority.",
      parameters: {
        type: "object",
        properties: {
          issue: { type: "string" },
          priority: { type: "string", enum: ["low", "normal", "high"] },
        },
        required: ["issue", "priority"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalateToHuman",
      description: "Hand the conversation to a human specialist with a reason.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
  },
] as const;
