const chat = document.getElementById("chat");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const welcomeScreen = document.getElementById("welcomeScreen");
const clearButtons = document.querySelectorAll(".js-clear");
const modeLabels = document.querySelectorAll(".js-mode");

const MARK = `<svg class="assistant-avatar"><use href="#claude-mark"></use></svg>`;

let history = [];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function scrollToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

function showConversation() {
  welcomeScreen?.classList.add("is-hidden");
}

function resetConversation() {
  history = [];
  chat.innerHTML = "";
  welcomeScreen?.classList.remove("is-hidden");
  input.value = "";
  autoResize();
  input.focus();
}

function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "message user";
  el.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
  chat.appendChild(el);
  scrollToBottom();
}

function addAssistantMessage(data) {
  const el = document.createElement("div");
  el.className = "message assistant";

  const tags = [];
  for (const citation of data.citations || []) tags.push(`<span class="tag cite">📄 ${escapeHtml(citation.docId)}</span>`);
  for (const tool of data.tools || []) {
    const ok = tool.ok ? "✓" : "✕";
    tags.push(`<span class="tag tool">${ok} ${escapeHtml(tool.name)}</span>`);
  }
  for (const guard of data.meta?.guardrails || []) tags.push(`<span class="tag guard">✳ ${escapeHtml(guard)}</span>`);
  tags.push(`<span class="tag">${escapeHtml(data.intent)}</span>`);
  tags.push(`<span class="tag">${data.meta?.latencyMs ?? 0} ms</span>`);
  tags.push(`<span class="tag">$${(data.meta?.costUsd ?? 0).toFixed(4)}</span>`);

  const steps = (data.trace || [])
    .map(
      (step) =>
        `<div class="trace-step"><strong>${escapeHtml(step.kind)}</strong> · ${escapeHtml(step.label)} — ${escapeHtml(step.detail)}${step.ms ? ` (${step.ms} ms)` : ""}</div>`,
    )
    .join("");

  el.innerHTML = `
    ${MARK}
    <div class="assistant-body">
      <div class="answer">${escapeHtml(data.answer)}</div>
      <div class="meta">${tags.join("")}</div>
      <details class="trace">
        <summary>Trace · ${(data.trace || []).length} steps</summary>
        <div class="trace-steps">${steps}</div>
      </details>
    </div>`;
  chat.appendChild(el);
  scrollToBottom();
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message) return;

  showConversation();
  addUserMessage(message);
  history.push({ role: "user", content: message });
  input.value = "";
  autoResize();
  sendBtn.disabled = true;

  const typing = document.createElement("div");
  typing.className = "message assistant";
  typing.innerHTML = `${MARK}<div class="assistant-body typing-text">Thinking<span class="dots"><i></i><i></i><i></i></span></div>`;
  chat.appendChild(typing);
  scrollToBottom();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history, sessionId: "web" }),
    });
    const data = await response.json();
    typing.remove();
    if (!response.ok) throw new Error(data.error || "Request failed");
    addAssistantMessage(data);
    history.push({ role: "assistant", content: data.answer });
    history = history.slice(-12);
  } catch (error) {
    typing.remove();
    addAssistantMessage({
      answer: `Sorry, the request failed: ${error.message}`,
      intent: "error",
      citations: [],
      tools: [],
      trace: [],
      meta: { latencyMs: 0, costUsd: 0, guardrails: [] },
    });
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", autoResize);

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-q]");
  if (button) sendMessage(button.dataset.q);
});

clearButtons.forEach((button) => button.addEventListener("click", resetConversation));

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    const label = data.mode === "live" ? "live · openai" : "local mode";
    modeLabels.forEach((el) => { el.textContent = label; });
  })
  .catch(() => {
    modeLabels.forEach((el) => { el.textContent = "offline"; });
  });

autoResize();
input.focus();
