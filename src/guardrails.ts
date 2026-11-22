// Guardrails: cheap, deterministic checks that run BEFORE and AFTER the model.
// In production these would be a mix of regex/classifier rules and a policy engine.

export interface InjectionCheck {
  detected: boolean;
  pattern?: string;
}

const INJECTION_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "instruction-override", re: /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions|rules|prompts?)/i },
  { label: "prompt-exfiltration", re: /(reveal|show|print|display|repeat)\s+(me\s+)?(your\s+|the\s+)?(system|developer|internal)\s+(prompt|message|instructions)/i },
  { label: "role-hijack", re: /\byou are now\b|\bpretend (you are|to be)\b|\bact as (an?|the) (unrestricted|unfiltered|admin)/i },
  { label: "jailbreak", re: /\bjailbreak\b|\bbypass (the )?(rules|guardrails|safety|limits)\b|\bno (rules|limits|restrictions)\b/i },
  { label: "unauthorized-refund", re: /\bapprove (my|the) refund\b.*\b(without|skip|ignore)\b|\bno approval needed\b/i },
];

export function detectPromptInjection(text: string): InjectionCheck {
  for (const { label, re } of INJECTION_PATTERNS) {
    if (re.test(text)) return { detected: true, pattern: label };
  }
  return { detected: false };
}

/** Replace common PII with stable tokens. Applied to answers AND traces. */
export function redactPII(text: string): string {
  return text
    .replace(/\+?92[\s-]?3\d{2}[\s-]?\d{7}\b/g, "[REDACTED_PHONE]")
    .replace(/\b3\d{2}[\s-]?\d{7}\b/g, "[REDACTED_PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[REDACTED_EMAIL]")
    .replace(/\b\d{5}[- ]?\d{7}[- ]?\d\b/g, "[REDACTED_CNIC]")
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[REDACTED_CARD]");
}

export function containsPII(text: string): boolean {
  return redactPII(text) !== text;
}

export interface RefundDecision {
  requiresApproval: boolean;
  limit: number;
  amount: number;
}

export function checkRefundLimit(amount: number, limit: number): RefundDecision {
  return { requiresApproval: amount > limit, limit, amount };
}

export function mentionsDoubleCharge(text: string): boolean {
  return /(double[\s-]?charg|charged twice|charge twice|two charges|duplicate (payment|charge)|charged (me )?two times)/i.test(text);
}
