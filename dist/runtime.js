// extensions/workflow.ts
import { closeSync, existsSync as existsSync5, openSync, readSync } from "node:fs";
import { resolve as resolve3 } from "node:path";
import { StringDecoder } from "node:string_decoder";

// src/extension-reload.ts
import { resolve } from "node:path";

// package.json
var package_default = {
  name: "@quintinshaw/pi-dynamic-workflows",
  version: "3.6.2",
  description: "Claude-Code-style dynamic workflows for Pi \u2014 fan a task out across 100s of subagents with real model routing, token/cost accounting, resume, git-worktree isolation, and an interactive /workflows TUI.",
  type: "module",
  main: "./dist/index.js",
  types: "./dist/index.d.ts",
  publishConfig: {
    access: "public"
  },
  exports: {
    ".": {
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    }
  },
  files: [
    "dist/",
    "extensions/",
    "skills/",
    "src/",
    "assets/readme/",
    "README.md"
  ],
  scripts: {
    test: "npm run check && npm run release:check",
    "test:unit": "tsx --test tests/**/*.test.ts",
    "release:check": "npm run build && npm run docs:check && npm run context:check && npm run test:unit && npm run release:verify",
    "release:verify": "tsx scripts/check-workflow-release.ts",
    check: "biome check . && npm run check:scripts",
    "check:scripts": "tsc -p tsconfig.scripts.json",
    format: "biome format --write .",
    lint: "biome lint .",
    build: "tsc",
    "docs:generate": "tsx scripts/generate-workflow-capabilities.ts",
    "docs:check": "tsx scripts/generate-workflow-capabilities.ts --check",
    "context:generate": "tsx scripts/generate-workflow-context-measurement.ts",
    "context:check": "tsx scripts/generate-workflow-context-measurement.ts --check",
    "guidance:generate": "tsx scripts/generate-workflow-guidance-baseline.ts",
    "guidance:check": "tsx scripts/generate-workflow-guidance-baseline.ts --check",
    "guidance:accept": "tsx scripts/accept-workflow-guidance.ts",
    comprehension: "tsx scripts/run-workflow-comprehension.ts",
    "delivery-choice": "tsx scripts/run-workflow-delivery-choice.ts",
    dev: "tsx src/index.ts",
    prepublishOnly: "npm run release:check"
  },
  keywords: [
    "pi-package",
    "pi",
    "pi-coding-agent",
    "workflow",
    "workflows",
    "dynamic-workflows",
    "orchestration",
    "subagents",
    "multi-agent",
    "agents",
    "ai-agents",
    "parallel",
    "fan-out",
    "claude-code",
    "code-review",
    "llm"
  ],
  pi: {
    extensions: [
      "extensions/bootstrap.ts"
    ],
    skills: [
      "skills/workflow-authoring",
      "skills/workflow-patterns"
    ],
    image: "https://raw.githubusercontent.com/QuintinShaw/pi-dynamic-workflows/main/assets/readme/package-cover.png"
  },
  repository: {
    type: "git",
    url: "git+https://github.com/QuintinShaw/pi-dynamic-workflows.git"
  },
  author: "QuintinShaw",
  contributors: [
    "michaelliv (original author)"
  ],
  license: "MIT",
  dependencies: {
    acorn: "^8.16.0"
  },
  peerDependencies: {
    "@earendil-works/pi-coding-agent": ">=0.80.8",
    "@earendil-works/pi-tui": ">=0.80.6",
    typebox: "*"
  },
  devDependencies: {
    "@biomejs/biome": "2.4.16",
    "@earendil-works/pi-ai": "latest",
    "@earendil-works/pi-coding-agent": "latest",
    "@earendil-works/pi-tui": "latest",
    "fast-check": "^4.8.0",
    tsx: "latest",
    typebox: "latest",
    typescript: "latest"
  }
};

// src/extension-reload.ts
var WORKFLOW_EXTENSION_VERSION = package_default.version;
var RELOAD_HANDOFF_KEY = /* @__PURE__ */ Symbol.for("@quintinshaw/pi-dynamic-workflows:reload-handoff-slot");
var RELOAD_HANDOFF_TTL_MS = 3e4;
function getSlot() {
  return globalThis[RELOAD_HANDOFF_KEY] ?? null;
}
function setSlot(slot) {
  globalThis[RELOAD_HANDOFF_KEY] = slot;
}
function clearSlot(expected) {
  const current = getSlot();
  if (expected && current !== expected) return;
  if (current) clearTimeout(current.timer);
  setSlot(null);
}
function handoffWorkflowRuntime(runtime, ttlMs = RELOAD_HANDOFF_TTL_MS) {
  const previous = getSlot();
  if (previous && previous.runtime !== runtime) {
    pauseStrandedWorkflowRuntime(previous.runtime);
  }
  clearSlot();
  const slot = {
    runtime,
    timer: setTimeout(() => {
      if (getSlot() !== slot) return;
      pauseStrandedWorkflowRuntime(runtime);
      setSlot(null);
    }, ttlMs)
  };
  slot.timer.unref?.();
  setSlot(slot);
}
function takeWorkflowRuntime(cwd) {
  const slot = getSlot();
  if (!slot) return void 0;
  if (cwd !== void 0) {
    const want = resolve(cwd);
    const stagedCwd = resolve(slot.runtime.cwd);
    let managerCwd = stagedCwd;
    try {
      managerCwd = resolve(slot.runtime.manager.getCwd());
    } catch {
    }
    const launch = resolve(process.cwd());
    if (want !== stagedCwd && want !== managerCwd && want !== launch) {
      return void 0;
    }
  }
  clearSlot(slot);
  return slot.runtime;
}
function claimWorkflowRuntime(_cwd) {
  const runtime = takeWorkflowRuntime();
  if (!runtime) return {};
  return runtime.extensionVersion === WORKFLOW_EXTENSION_VERSION ? { compatible: runtime } : { versionMismatch: runtime };
}
function pauseStrandedWorkflowRuntime(runtime) {
  let paused = 0;
  let live = [];
  try {
    if (typeof runtime.manager.listLiveRuns === "function") {
      live = runtime.manager.listLiveRuns();
    } else if (typeof runtime.manager.listRuns === "function") {
      live = runtime.manager.listRuns().flatMap((r) => {
        const liveRun = runtime.manager.getRun(r.runId);
        return liveRun ? [liveRun] : [];
      });
    }
  } catch {
    return 0;
  }
  for (const run of live) {
    if (run.status === "running" && runtime.manager.pause(run.runId)) paused++;
  }
  return paused;
}
var SESSION_REPLACEMENT_REASONS = /* @__PURE__ */ new Set(["reload", "new", "resume", "fork"]);
function discardWorkflowRuntime(_cwd, runtime) {
  const slot = getSlot();
  if (!slot) return;
  if (runtime && slot.runtime !== runtime) return;
  clearSlot(slot);
}

// src/adversarial-review.ts
function generateAdversarialReviewWorkflow() {
  return `export const meta = {
  name: 'adversarial_review',
  description: 'Adversarial review: findings cross-checked by independent skeptics',
  phases: [
    { title: 'Investigate' },
    { title: 'Refute' },
    { title: 'Consensus' },
  ],
}

const task = (args && args.task) || ''
const reviewers = (args && args.reviewers) || 2
const threshold = (args && args.threshold) || 0.5

phase('Investigate')
const investigation = await agent(
  'Investigate the following and list concrete, individually-checkable findings:\\n' + task,
  { label: 'investigate', schema: { type: 'object', properties: { findings: { type: 'array', items: { type: 'string' } } }, required: ['findings'] } }
)
const findings = investigation.findings || []

phase('Refute')
const judged = await parallel(findings.map((f, i) => () =>
  parallel(Array.from({ length: reviewers }, (_, r) => () =>
    agent(
      'You are a skeptical reviewer. Try to REFUTE this finding for the task below. ' +
      'Default to real=false when uncertain. Investigate with the available tools if needed.\\n\\n' +
      'TASK: ' + task + '\\nFINDING: ' + f,
      { label: 'refute ' + (i + 1) + '.' + (r + 1), schema: { type: 'object', properties: { real: { type: 'boolean' }, reason: { type: 'string' } }, required: ['real'] } }
    )
  )).then((votes) => {
    const valid = votes.filter(Boolean)
    const realCount = valid.filter((v) => v && v.real).length
    const ratio = valid.length ? realCount / valid.length : 0
    return { finding: f, realVotes: realCount, totalVotes: valid.length, survives: ratio >= threshold }
  })
))

const survivors = judged.filter((j) => j && j.survives)

phase('Consensus')
const report = await agent(
  'Write a final review report. Include ONLY the findings that survived adversarial review (listed below), ' +
  'each with a short justification. Note how many were discarded.\\n\\n' +
  'SURVIVING FINDINGS JSON:\\n' + JSON.stringify(survivors),
  { label: 'consensus' }
)

return { total: findings.length, survivors, report }`;
}
function generateMultiPerspectiveWorkflow(topic, perspectives) {
  const perspectiveAgents = perspectives.map((p, i) => {
    const label = p.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || `perspective-${i + 1}`;
    return `  () => agent(${JSON.stringify(`Analyze from ${p} perspective: `)} + topic, { label: ${JSON.stringify(label)} }),`;
  }).join("\n");
  return `export const meta = {
  name: 'multi_perspective_analysis',
  description: ${JSON.stringify(`Analyze from ${perspectives.length} different perspectives`)},
  phases: [
    { title: 'Perspective Analysis' },
    { title: 'Synthesis' },
  ],
};

phase('Perspective Analysis');
const topic = ${JSON.stringify(topic)};
const analyses = await parallel([
${perspectiveAgents}
]);

phase('Synthesis');
const synthesis = await agent(
  'Synthesize these different perspectives into a balanced analysis:\\n' +
  'Analyses: ' + JSON.stringify(analyses) + '\\n' +
  'Topic: ' + topic,
  { label: 'synthesizer' }
);

return { analyses, synthesis };`;
}

// src/agent.ts
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3 } from "node:path";
import {
  createAgentSession,
  createCodingTools,
  DefaultResourceLoader,
  getAgentDir as getAgentDir2,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { Check, Convert } from "typebox/value";

// src/agent-history.ts
var DEFAULT_MAX_ENTRIES = 40;
var DEFAULT_MAX_TEXT_CHARS = 2e3;
var DEFAULT_MAX_TOTAL_CHARS = 2e4;
function compactAgentHistory(messages, options = {}) {
  const maxEntries = positiveInt(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const maxTextChars = positiveInt(options.maxTextChars, DEFAULT_MAX_TEXT_CHARS);
  const maxTotalChars = positiveInt(options.maxTotalChars, DEFAULT_MAX_TOTAL_CHARS);
  const entries = [];
  for (const raw of messages) {
    const message = asRecord(raw);
    if (!message) continue;
    const role = message.role;
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : void 0;
    if (role === "user") {
      const text = textFromContent(message.content);
      if (text.trim()) entries.push({ role: "user", kind: "text", text, timestamp });
      continue;
    }
    if (role === "assistant") {
      for (const part of Array.isArray(message.content) ? message.content : []) {
        const block = asRecord(part);
        if (!block || typeof block.type !== "string") continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          entries.push({ role: "assistant", kind: "text", text: block.text, timestamp });
        } else if (block.type === "toolCall" && typeof block.name === "string") {
          const args = asRecord(block.arguments);
          const filePath = (block.name === "write" || block.name === "edit") && typeof args?.path === "string" ? args.path : void 0;
          const writeContent = block.name === "write" && filePath && typeof args?.content === "string" ? args.content : void 0;
          entries.push({
            role: "assistant",
            kind: "toolCall",
            toolName: block.name,
            // A write's JSON envelope is both noisy and likely to be truncated
            // into invalid JSON. Preserve its source directly so the pager can
            // render it as code. Edit calls retain their path so the pager can
            // pair the compact call header with the result's native Pi diff.
            text: writeContent ?? stringifyCompact(block.arguments ?? {}),
            path: filePath,
            timestamp
          });
        }
      }
      if (typeof message.errorMessage === "string" && message.errorMessage.trim()) {
        entries.push({ role: "assistant", kind: "error", text: message.errorMessage, isError: true, timestamp });
      }
      continue;
    }
    if (role === "toolResult") {
      const toolName = typeof message.toolName === "string" ? message.toolName : void 0;
      const text = textFromContent(message.content) || "(no text output)";
      const details = asRecord(message.details);
      const diff = toolName === "edit" && typeof details?.diff === "string" ? details.diff : void 0;
      entries.push({
        role: "tool",
        kind: message.isError ? "error" : "toolResult",
        toolName,
        text,
        diff,
        isError: Boolean(message.isError),
        timestamp
      });
    }
  }
  return fitEntries(entries, maxEntries, maxTextChars, maxTotalChars);
}
function fitEntries(entries, maxEntries, maxTextChars, maxTotalChars) {
  const fitted = [];
  let total = 0;
  for (const entry of entries.slice(-maxEntries).reverse()) {
    const remaining = maxTotalChars - total;
    if (remaining <= 0) break;
    let entryBudget = Math.min(maxTextChars, remaining);
    const diff = entry.diff ? truncateText(entry.diff, entryBudget) : void 0;
    entryBudget -= diff?.length ?? 0;
    const text = truncateText(entry.text, entryBudget);
    fitted.unshift({ ...entry, text, diff });
    total += text.length + (diff?.length ?? 0);
  }
  return fitted;
}
function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const block = asRecord(part);
    return block?.type === "text" && typeof block.text === "string" ? block.text : "";
  }).filter(Boolean).join("");
}
function stringifyCompact(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  if (maxChars <= 20) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 20)}... [truncated]`;
}
function positiveInt(value, fallback) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}
function asRecord(value) {
  return value && typeof value === "object" ? value : void 0;
}

// src/agent-registry.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

// src/config.ts
var MAX_AGENTS_PER_RUN = 1e3;
var DEFAULT_AGENT_TIMEOUT_MS = null;
var MAX_CONCURRENCY = 16;
var MAX_AGENT_RETRIES = 3;
var WORKFLOW_RUNS_DIR = ".pi/workflows/runs";
var WORKFLOW_SAVED_DIR = ".pi/workflows/saved";
var MODEL_TIERS_FILE = ".pi/workflows/model-tiers.json";
var DEFAULT_KEYWORD_TRIGGER_WORD = "workflow";
function normalizeKeywordTriggerWord(value) {
  if (typeof value !== "string") return void 0;
  const word = value.trim();
  if (!word || word.startsWith("/") || /\s/.test(word)) return void 0;
  return word;
}
var AGENTS_DIR = ".pi/agents";

// src/agent-registry.ts
function toStringArray(value) {
  if (value == null) return void 0;
  if (Array.isArray(value)) {
    const arr = value.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
    return arr.length ? arr : void 0;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const arr = value.split(",").map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : void 0;
  }
  return void 0;
}
function parseAgentDefinition(content, source, fileName) {
  let parsed;
  try {
    parsed = parseFrontmatter(content);
  } catch {
    parsed = { frontmatter: {}, body: content };
  }
  const fm = parsed.frontmatter;
  const fmName = typeof fm.name === "string" ? fm.name.trim() : "";
  const name = fmName || basename(fileName).replace(/\.md$/i, "").trim();
  const prompt = parsed.body.trim();
  if (!name && !prompt) return null;
  return {
    name,
    description: typeof fm.description === "string" ? fm.description.trim() || void 0 : void 0,
    tools: toStringArray(fm.tools),
    disallowedTools: toStringArray(fm.disallowedTools),
    model: typeof fm.model === "string" ? fm.model.trim() || void 0 : void 0,
    isolation: typeof fm.isolation === "string" && fm.isolation.toLowerCase().trim() === "worktree" ? "worktree" : void 0,
    prompt,
    source
  };
}
function readDefsFromDir(dir, source) {
  if (!existsSync(dir)) return [];
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".md"));
  } catch {
    return [];
  }
  const defs = [];
  for (const file of files.sort()) {
    try {
      const def = parseAgentDefinition(readFileSync(join(dir, file), "utf-8"), source, file);
      if (def) defs.push(def);
    } catch {
    }
  }
  return defs;
}
function loadAgentRegistry(cwd, opts) {
  const projectDir = opts?.projectDir ?? join(cwd, AGENTS_DIR);
  const userDir = opts?.userDir ?? join(getAgentDir(), "agents");
  const legacyUserDir = opts?.legacyUserDir ?? join(homedir(), AGENTS_DIR);
  const registry = /* @__PURE__ */ new Map();
  for (const def of readDefsFromDir(projectDir, "project")) {
    if (def.name && !registry.has(def.name)) registry.set(def.name, def);
  }
  if (userDir !== projectDir) {
    for (const def of readDefsFromDir(userDir, "user")) {
      if (def.name && !registry.has(def.name)) registry.set(def.name, def);
    }
  }
  if (legacyUserDir !== projectDir && legacyUserDir !== userDir) {
    let warnedLegacy = false;
    for (const def of readDefsFromDir(legacyUserDir, "user")) {
      if (def.name && !registry.has(def.name)) {
        registry.set(def.name, def);
        if (!warnedLegacy) {
          console.warn(
            `[agent-registry] Loaded agent definition(s) from the deprecated location "${legacyUserDir}". Move them to "${userDir}" \u2014 the old location may stop being read in a future release.`
          );
          warnedLegacy = true;
        }
      }
    }
  }
  return registry;
}
function resolveAgentType(name, registry) {
  if (!name) return void 0;
  return registry.get(name);
}
function applyToolPolicy(tools, allow, deny) {
  let out = tools;
  if (allow?.length) {
    const allowSet = new Set(allow);
    out = out.filter((t) => allowSet.has(t.name));
  }
  if (deny?.length) {
    const denySet = new Set(deny);
    out = out.filter((t) => !denySet.has(t.name));
  }
  return out;
}
function agentDefinitionKey(def) {
  if (!def) return null;
  return JSON.stringify({
    tools: def.tools ?? null,
    disallowedTools: def.disallowedTools ?? null,
    model: def.model ?? null,
    isolation: def.isolation ?? null,
    prompt: def.prompt
  });
}

// src/errors.ts
var WorkflowError = class extends Error {
  code;
  recoverable;
  agentLabel;
  details;
  /** For PROVIDER_USAGE_LIMIT: the provider's human reset hint, e.g. "Resets in ~3h" (verbatim). */
  resetHint;
  constructor(message, code, options = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.agentLabel = options.agentLabel;
    this.details = options.details;
    this.resetHint = options.resetHint;
  }
};
var WorkflowCapabilityContractError = class extends Error {
  diagnostics;
  constructor(message, diagnostics) {
    super(message);
    this.name = "WorkflowCapabilityContractError";
    this.diagnostics = diagnostics;
  }
};
function isWorkflowError(error) {
  return error instanceof WorkflowError;
}
function isProviderUsageLimit(error) {
  return isWorkflowError(error) && error.code === "PROVIDER_USAGE_LIMIT" /* PROVIDER_USAGE_LIMIT */;
}
function classifyProviderLimit(text) {
  if (!text) return { matched: false };
  const matched = /usage limit|limit reached|insufficient[_\s]?quota|quota exceeded|exceeded your current quota|out of budget|available balance|\bquota\b|rate.?limit|too many requests|\b429\b|GoUsageLimitError|FreeUsageLimitError|\bbilling\b/i.test(
    text
  );
  if (!matched) return { matched: false };
  const reset = text.match(/resets?\s+(?:in|at)\s+[^.\n]+/i);
  return { matched: true, resetHint: reset?.[0]?.trim() };
}
function isAbortError(error) {
  if (!(error instanceof Error)) return false;
  return /\babort(?:ed)?\b/i.test(error.message);
}
function isTimeoutError(error) {
  if (!(error instanceof Error)) return false;
  return /\btimeout\b/i.test(error.message) || error.name === "TimeoutError";
}
function wrapError(error, context) {
  if (isWorkflowError(error)) return error;
  if (isAbortError(error)) {
    return new WorkflowError(
      error instanceof Error ? error.message : "Workflow was aborted",
      "WORKFLOW_ABORTED" /* WORKFLOW_ABORTED */,
      { recoverable: true }
    );
  }
  if (isTimeoutError(error)) {
    return new WorkflowError(
      error instanceof Error ? error.message : "Agent timed out",
      "AGENT_TIMEOUT" /* AGENT_TIMEOUT */,
      { recoverable: true, agentLabel: context?.agentLabel }
    );
  }
  if (error instanceof Error) {
    const limit = classifyProviderLimit(error.message);
    if (limit.matched) {
      return new WorkflowError(error.message, "PROVIDER_USAGE_LIMIT" /* PROVIDER_USAGE_LIMIT */, {
        recoverable: false,
        agentLabel: context?.agentLabel,
        resetHint: limit.resetHint
      });
    }
  }
  return new WorkflowError(
    error instanceof Error ? error.message : String(error),
    "AGENT_EXECUTION_ERROR" /* AGENT_EXECUTION_ERROR */,
    { recoverable: true, agentLabel: context?.agentLabel, details: error }
  );
}

// src/model-spec.ts
import { modelsAreEqual } from "@earendil-works/pi-ai";
var THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
var DEFAULT_MODEL_PER_PROVIDER = {
  "amazon-bedrock": "us.anthropic.claude-opus-4-6-v1",
  anthropic: "claude-opus-4-8",
  openai: "gpt-5.4",
  "azure-openai-responses": "gpt-5.4",
  "openai-codex": "gpt-5.5",
  deepseek: "deepseek-v4-pro",
  google: "gemini-3.1-pro-preview",
  "google-vertex": "gemini-3.1-pro-preview",
  "github-copilot": "gpt-5.4",
  openrouter: "moonshotai/kimi-k2.6",
  "vercel-ai-gateway": "zai/glm-5.1",
  zai: "glm-5.1",
  mistral: "devstral-medium-latest",
  minimax: "MiniMax-M3",
  "minimax-cn": "MiniMax-M3",
  moonshotai: "kimi-k2.6",
  "moonshotai-cn": "kimi-k2.6",
  huggingface: "moonshotai/Kimi-K2.6",
  fireworks: "accounts/fireworks/models/kimi-k2p6",
  together: "moonshotai/Kimi-K2.6",
  opencode: "kimi-k2.6",
  "opencode-go": "kimi-k2.6",
  "kimi-coding": "kimi-for-coding",
  "cloudflare-workers-ai": "@cf/moonshotai/kimi-k2.6",
  "cloudflare-ai-gateway": "workers-ai/@cf/moonshotai/kimi-k2.6",
  xiaomi: "mimo-v2.5-pro",
  "xiaomi-token-plan-cn": "mimo-v2.5-pro",
  "xiaomi-token-plan-ams": "mimo-v2.5-pro",
  "xiaomi-token-plan-sgp": "mimo-v2.5-pro"
};
function isThinkingLevel(value) {
  return THINKING_LEVELS.includes(value);
}
function formatModelSpecWithThinking(modelSpec, thinkingLevel) {
  return thinkingLevel ? `${modelSpec}:${thinkingLevel}` : modelSpec;
}
function canonicalModelSpec(model) {
  return `${model.provider}/${model.id}`;
}
function splitModelSpecThinking(spec, knownModelSpecs) {
  const trimmed = spec?.trim() ?? "";
  if (!trimmed) return { modelSpec: "", thinkingLevel: void 0 };
  const known = knownModelSpecs ? new Set(knownModelSpecs) : void 0;
  if (known?.has(trimmed)) return { modelSpec: trimmed, thinkingLevel: void 0 };
  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon === -1) return { modelSpec: trimmed, thinkingLevel: void 0 };
  const prefix = trimmed.slice(0, lastColon);
  const suffix = trimmed.slice(lastColon + 1);
  if (!prefix || !isThinkingLevel(suffix)) return { modelSpec: trimmed, thinkingLevel: void 0 };
  if (known && !known.has(prefix)) return { modelSpec: trimmed, thinkingLevel: void 0 };
  return { modelSpec: prefix, thinkingLevel: suffix };
}
function isAlias(id) {
  if (id.endsWith("-latest")) return true;
  return !/-\d{8}$/.test(id);
}
function findExactModelReferenceMatch(modelReference, availableModels) {
  const trimmedReference = modelReference.trim();
  if (!trimmedReference) return void 0;
  const normalizedReference = trimmedReference.toLowerCase();
  const canonicalMatches = availableModels.filter(
    (model) => canonicalModelSpec(model).toLowerCase() === normalizedReference
  );
  if (canonicalMatches.length === 1) return canonicalMatches[0];
  if (canonicalMatches.length > 1) return void 0;
  const slashIndex = trimmedReference.indexOf("/");
  if (slashIndex !== -1) {
    const provider = trimmedReference.slice(0, slashIndex).trim();
    const modelId = trimmedReference.slice(slashIndex + 1).trim();
    if (provider && modelId) {
      const providerMatches = availableModels.filter(
        (model) => model.provider.toLowerCase() === provider.toLowerCase() && model.id.toLowerCase() === modelId.toLowerCase()
      );
      if (providerMatches.length === 1) return providerMatches[0];
      if (providerMatches.length > 1) return void 0;
    }
  }
  const idMatches = availableModels.filter((model) => model.id.toLowerCase() === normalizedReference);
  return idMatches.length === 1 ? idMatches[0] : void 0;
}
function tryMatchModel(modelPattern, availableModels, preferredProvider) {
  const exactMatch = findExactModelReferenceMatch(modelPattern, availableModels);
  if (exactMatch) return exactMatch;
  const normalizedPattern = modelPattern.toLowerCase();
  const matches = availableModels.filter(
    (model) => model.id.toLowerCase().includes(normalizedPattern) || model.name?.toLowerCase().includes(normalizedPattern)
  );
  const preferredMatches = preferredProvider ? matches.filter((model) => model.provider.toLowerCase() === preferredProvider.toLowerCase()) : [];
  const rankedMatches = preferredMatches.length > 0 ? preferredMatches : matches;
  if (rankedMatches.length === 0) return void 0;
  const aliases = rankedMatches.filter((model) => isAlias(model.id));
  if (aliases.length > 0) {
    aliases.sort((a, b) => b.id.localeCompare(a.id));
    return aliases[0];
  }
  const datedVersions = rankedMatches.filter((model) => !isAlias(model.id));
  datedVersions.sort((a, b) => b.id.localeCompare(a.id));
  return datedVersions[0];
}
function parseModelPattern(pattern, availableModels, options) {
  const exactMatch = tryMatchModel(pattern, availableModels, options?.preferredProvider);
  if (exactMatch) return { model: exactMatch };
  const lastColonIndex = pattern.lastIndexOf(":");
  if (lastColonIndex === -1) return {};
  const prefix = pattern.slice(0, lastColonIndex);
  const suffix = pattern.slice(lastColonIndex + 1);
  if (isThinkingLevel(suffix)) {
    const result3 = parseModelPattern(prefix, availableModels, options);
    if (!result3.model) return result3;
    return {
      model: result3.model,
      thinkingLevel: result3.warning ? void 0 : suffix,
      warning: result3.warning
    };
  }
  if (options?.allowInvalidThinkingLevelFallback === false) return {};
  const result2 = parseModelPattern(prefix, availableModels, options);
  if (!result2.model) return result2;
  return {
    model: result2.model,
    warning: `Invalid thinking level "${suffix}" in pattern "${pattern}". Using default instead.`
  };
}
function buildFallbackModel(provider, modelId, availableModels) {
  const providerModels = availableModels.filter((model) => model.provider === provider);
  if (providerModels.length === 0) return void 0;
  const defaultId = DEFAULT_MODEL_PER_PROVIDER[provider];
  const baseModel = defaultId ? providerModels.find((model) => model.id === defaultId) ?? providerModels[0] : providerModels[0];
  return { ...baseModel, id: modelId, name: modelId };
}
function resolveModelSpecWithThinking(spec, modelRegistry, options) {
  const requestedSpec = spec.trim();
  if (!requestedSpec) return { requestedSpec, error: "No model spec provided." };
  const availableModels = modelRegistry.getAll();
  if (availableModels.length === 0) {
    return {
      requestedSpec,
      error: "No models available. Check your installation or add models to models.json."
    };
  }
  const providerMap = /* @__PURE__ */ new Map();
  for (const model2 of availableModels) {
    providerMap.set(model2.provider.toLowerCase(), model2.provider);
  }
  let provider;
  let pattern = requestedSpec;
  let inferredProvider = false;
  const slashIndex = requestedSpec.indexOf("/");
  if (slashIndex !== -1) {
    const maybeProvider = requestedSpec.slice(0, slashIndex);
    const canonicalProvider = providerMap.get(maybeProvider.toLowerCase());
    if (canonicalProvider) {
      provider = canonicalProvider;
      pattern = requestedSpec.slice(slashIndex + 1);
      inferredProvider = true;
    }
  }
  if (!provider) {
    const exact = findExactModelReferenceMatch(requestedSpec, availableModels);
    if (exact) {
      return { requestedSpec, model: exact, resolvedSpec: canonicalModelSpec(exact) };
    }
  }
  const candidates = provider ? availableModels.filter((model2) => model2.provider === provider) : availableModels;
  const { model, thinkingLevel, warning } = parseModelPattern(pattern, candidates, {
    allowInvalidThinkingLevelFallback: false,
    ...provider === void 0 ? { preferredProvider: options?.preferredProvider } : {}
  });
  if (model) {
    if (inferredProvider && modelRegistry.hasConfiguredAuth && !modelRegistry.hasConfiguredAuth(model)) {
      const rawExactMatches = availableModels.filter(
        (candidate) => candidate.id.toLowerCase() === requestedSpec.toLowerCase() && !modelsAreEqual(candidate, model)
      );
      const authenticatedRawMatches = rawExactMatches.filter(
        (candidate) => modelRegistry.hasConfiguredAuth?.(candidate)
      );
      if (authenticatedRawMatches.length === 1) {
        const preferred = authenticatedRawMatches[0];
        return { requestedSpec, model: preferred, resolvedSpec: canonicalModelSpec(preferred) };
      }
    }
    return {
      requestedSpec,
      model,
      thinkingLevel,
      warning,
      resolvedSpec: formatModelSpecWithThinking(canonicalModelSpec(model), thinkingLevel)
    };
  }
  if (inferredProvider) {
    const exact = findExactModelReferenceMatch(requestedSpec, availableModels);
    if (exact) {
      return { requestedSpec, model: exact, resolvedSpec: canonicalModelSpec(exact) };
    }
    const fallback = parseModelPattern(requestedSpec, availableModels, {
      allowInvalidThinkingLevelFallback: false,
      preferredProvider: options?.preferredProvider
    });
    if (fallback.model) {
      return {
        requestedSpec,
        model: fallback.model,
        thinkingLevel: fallback.thinkingLevel,
        warning: fallback.warning,
        resolvedSpec: formatModelSpecWithThinking(canonicalModelSpec(fallback.model), fallback.thinkingLevel)
      };
    }
  }
  if (provider) {
    let fallbackPattern = pattern;
    let fallbackThinking;
    const lastColon = pattern.lastIndexOf(":");
    if (lastColon !== -1) {
      const suffix = pattern.slice(lastColon + 1);
      if (isThinkingLevel(suffix)) {
        fallbackPattern = pattern.slice(0, lastColon);
        fallbackThinking = suffix;
      }
    }
    const fallbackModel = buildFallbackModel(provider, fallbackPattern, availableModels);
    if (fallbackModel) {
      const modelWithReasoning = fallbackThinking && fallbackThinking !== "off" ? { ...fallbackModel, reasoning: true } : fallbackModel;
      const fallbackWarning = warning ? `${warning} Model "${fallbackPattern}" not found for provider "${provider}". Using custom model id.` : `Model "${fallbackPattern}" not found for provider "${provider}". Using custom model id.`;
      return {
        requestedSpec,
        model: modelWithReasoning,
        thinkingLevel: fallbackThinking,
        warning: fallbackWarning,
        resolvedSpec: formatModelSpecWithThinking(canonicalModelSpec(modelWithReasoning), fallbackThinking)
      };
    }
  }
  const display = provider ? `${provider}/${pattern}` : requestedSpec;
  return {
    requestedSpec,
    warning,
    error: `Model "${display}" not found. Use /workflows-models to choose an available model.`
  };
}

// src/model-tier-config.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, writeFileSync } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { dirname, join as join2 } from "node:path";
function getModelTierConfigPath() {
  return join2(homedir2(), MODEL_TIERS_FILE);
}
var SMALL_MODEL_HINTS = ["mini", "flash", "haiku", "nano", "small"];
var BIG_MODEL_HINTS = ["opus", "pro", "ultra", "large", "plus"];
function hintScore(spec) {
  const lower = spec.toLowerCase();
  if (SMALL_MODEL_HINTS.some((hint) => lower.includes(hint))) return -1;
  if (BIG_MODEL_HINTS.some((hint) => lower.includes(hint))) return 1;
  return 0;
}
function rankByCapability(models) {
  const knownCosts = models.map((m) => m.costOutput).filter((c) => typeof c === "number" && c > 0).sort((a, b) => a - b);
  const hasPriceSignal = knownCosts.length > 0;
  const min = knownCosts[0];
  const max = knownCosts[knownCosts.length - 1];
  const median = knownCosts[Math.floor(knownCosts.length / 2)];
  const costKey = (m) => {
    if (typeof m.costOutput === "number" && m.costOutput > 0) return m.costOutput;
    if (!hasPriceSignal) return void 0;
    const hint = hintScore(m.spec);
    return hint > 0 ? max : hint < 0 ? min : median;
  };
  return models.map((m, index) => ({ m, index, cost: costKey(m), hint: hintScore(m.spec), ctx: m.contextWindow ?? 0 })).sort((a, b) => {
    if (a.cost !== void 0 && b.cost !== void 0 && a.cost !== b.cost) return a.cost - b.cost;
    if (a.hint !== b.hint) return a.hint - b.hint;
    if (a.ctx !== b.ctx) return a.ctx - b.ctx;
    return a.index - b.index;
  }).map((entry) => entry.m);
}
function buildDefaultTierConfig(currentModelSpec, availableModels) {
  const models = availableModels ?? listAvailableModels();
  const ranked = rankByCapability(models).map((m) => m.spec);
  if (ranked.length >= 3) {
    const small = ranked[0];
    const big = ranked[ranked.length - 1];
    const medium = ranked[Math.floor(ranked.length / 2)];
    return { tiers: { small, medium, big } };
  }
  if (ranked.length === 2) {
    const [weaker, stronger] = ranked;
    return { tiers: { small: weaker, medium: stronger, big: stronger } };
  }
  const fallback = ranked[0] ?? currentModelSpec ?? "";
  return {
    tiers: {
      small: fallback,
      medium: fallback,
      big: fallback
    }
  };
}
function formatTierFallbackNotice(mainModel, availableModels) {
  const fallback = mainModel ?? "the session default model";
  const suggested = buildDefaultTierConfig(mainModel, availableModels);
  const mapping = sortedTierNames(suggested).map((tier) => `${tier}=${suggested.tiers[tier] || "?"}`).join("  ");
  return `[workflow] An agent requested opts.tier but no model-tiers.json is configured, so tiers currently fall back to ${fallback}. Run /workflows-models to configure them` + (mapping ? `. Suggested mapping from your available models: ${mapping}` : ".");
}
function isValidTiersMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([key, val]) => key.trim().length > 0 && typeof val === "string" && val.trim().length > 0);
}
function loadModelTierConfig(configPath) {
  const path = configPath ?? getModelTierConfigPath();
  if (!existsSync2(path)) return null;
  try {
    const raw = readFileSync2(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!isValidTiersMap(parsed.tiers)) return null;
    return parsed;
  } catch {
    return null;
  }
}
function saveModelTierConfig(config, configPath) {
  if (!isValidTiersMap(config?.tiers)) {
    throw new Error(
      "Refusing to save a degenerate model tier config: tiers must be a non-empty map of tier name to a non-empty model spec string."
    );
  }
  const path = configPath ?? getModelTierConfigPath();
  const dir = dirname(path);
  if (!existsSync2(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}
function resolveTierModel(tier, config) {
  return config.tiers[tier];
}
function sortedTierNames(config) {
  const names = Object.keys(config.tiers);
  const rank = { small: 0, medium: 1, big: 2 };
  return names.sort((a, b) => (rank[a] ?? 99) - (rank[b] ?? 99) || a.localeCompare(b));
}

// src/structured-output.ts
import { defineTool } from "@earendil-works/pi-coding-agent";
function createStructuredOutputTool({
  schema,
  capture,
  name = "structured_output"
}) {
  return defineTool({
    name,
    label: "Structured Output",
    description: "Return the final machine-readable result for this subagent task.",
    promptSnippet: "Return final machine-readable output",
    promptGuidelines: [
      `${name} is the final answer channel for this task; call ${name} exactly once when done.`,
      `Do not write a prose final answer after calling ${name}.`
    ],
    parameters: schema,
    async execute(_toolCallId, params) {
      capture.value = params;
      capture.called = true;
      return {
        content: [{ type: "text", text: "Structured output received." }],
        details: params,
        terminate: true
      };
    }
  });
}

// src/agent.ts
function findJsonBlock(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const start = text.search(/[{[]/);
  if (start === -1) return void 0;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close && --depth === 0) return text.slice(start, i + 1);
  }
  return void 0;
}
function extractValidated(text, schema) {
  const json = findJsonBlock(text);
  if (json === void 0) return void 0;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    return void 0;
  }
  try {
    const converted = Convert(schema, parsed);
    if (Check(schema, converted)) return converted;
  } catch {
  }
  return void 0;
}
function lastAssistantError(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    return { stopReason: message.stopReason, errorMessage: message.errorMessage };
  }
  return void 0;
}
function throwIfProviderLimit(messages, label) {
  const err = lastAssistantError(messages);
  if (err?.stopReason !== "error") return;
  const { matched, resetHint } = classifyProviderLimit(err.errorMessage);
  if (!matched) return;
  throw new WorkflowError(
    err.errorMessage ?? "Provider usage/quota limit reached",
    "PROVIDER_USAGE_LIMIT" /* PROVIDER_USAGE_LIMIT */,
    { recoverable: false, agentLabel: label, resetHint }
  );
}
async function resolveStructuredOutput(session, capture, schema, options, lastText) {
  if (capture.called) return capture.value;
  const maxRetries = Math.max(0, options.maxSchemaRetries ?? 2);
  try {
    session.setActiveToolsByName?.(["structured_output"]);
  } catch {
  }
  for (let attempt = 0; attempt < maxRetries && !capture.called; attempt++) {
    if (options.signal?.aborted) throw new Error("Subagent was aborted");
    await session.prompt(
      "You did not call the structured_output tool. Call structured_output now as your only action, with the required fields filled in. Do not write a prose answer."
    );
  }
  if (capture.called) return capture.value;
  const extracted = extractValidated(lastText(session.messages), schema);
  if (extracted !== void 0) {
    console.warn(
      "[workflow] structured_output recovered from prose extraction (the model never called the tool); prefer a tool-reliable model"
    );
    return extracted;
  }
  throwIfProviderLimit(session.messages, options.label);
  throw new WorkflowError(
    "Subagent did not produce valid structured_output after repair attempts",
    "SCHEMA_NONCOMPLIANCE" /* SCHEMA_NONCOMPLIANCE */,
    { recoverable: false, agentLabel: options.label }
  );
}
function resolveAgentModelSpec(options, mainModel, loadConfig = loadModelTierConfig, onTierWithoutConfig) {
  if (options.model) return options.model;
  const config = loadConfig();
  if (options.tier) {
    if (!config) onTierWithoutConfig?.(options.tier);
    return (config ? resolveTierModel(options.tier, config) : void 0) ?? mainModel;
  }
  if (config) {
    const medium = resolveTierModel("medium", config);
    if (medium) return medium;
  }
  return void 0;
}
var fallbackRuntimePromise;
var fallbackRegistry;
function ensureFallbackRegistry() {
  if (!fallbackRuntimePromise) {
    const dir = getAgentDir2();
    fallbackRuntimePromise = (async () => {
      const runtime = await ModelRuntime.create({
        authPath: join3(dir, "auth.json"),
        modelsPath: join3(dir, "models.json")
      });
      await runtime.getAvailable().catch(() => {
      });
      return runtime;
    })();
    fallbackRuntimePromise.catch(() => {
      fallbackRuntimePromise = void 0;
    });
  }
  return fallbackRuntimePromise.then((runtime) => {
    fallbackRegistry ??= new ModelRegistry(runtime);
    return fallbackRegistry;
  });
}
var warnedNoRuntime = false;
function runtimeOf(registry) {
  const runtime = registry.runtime;
  if (!runtime && !warnedNoRuntime) {
    warnedNoRuntime = true;
    console.warn(
      "[workflow] ModelRegistry no longer carries a private `runtime` field (pi internals changed); subagents fall back to a default-built runtime and may miss extension-registered providers"
    );
  }
  return runtime;
}
function listAvailableModels(registry) {
  try {
    const modelRegistry = registry ?? fallbackRegistry;
    if (!modelRegistry) {
      void ensureFallbackRegistry().catch(() => {
      });
      return [];
    }
    return modelRegistry.getAvailable().map((model) => ({
      spec: canonicalModelSpec(model),
      costOutput: model.cost?.output,
      contextWindow: model.contextWindow
    }));
  } catch {
    return [];
  }
}
function listAvailableModelSpecs(registry) {
  return listAvailableModels(registry).map((model) => model.spec);
}
var warnedTierUnconfigured = false;
function warnTierUnconfiguredOnce(mainModel, registry) {
  if (warnedTierUnconfigured) return;
  warnedTierUnconfigured = true;
  try {
    console.warn(formatTierFallbackNotice(mainModel, listAvailableModels(registry)));
  } catch {
  }
}
var warnedPersistSecrets = false;
function warnPersistSecretsOnce(sessionDir) {
  if (warnedPersistSecrets) return;
  warnedPersistSecrets = true;
  console.warn(
    `[workflow] persistAgentSessions is ON: full subagent transcripts (which may include secrets or other sensitive context) are being written to disk under ${sessionDir}. Disable persistAgentSessions if that isn't intended.`
  );
}
function usageFromStats(stats) {
  const { tokens, cost } = stats;
  if (tokens.total <= 0 && cost <= 0) return void 0;
  return {
    input: tokens.input,
    output: tokens.output,
    cacheRead: tokens.cacheRead,
    cacheWrite: tokens.cacheWrite,
    total: tokens.total,
    cost
  };
}
var DEFAULT_EXCLUDED_SUBAGENT_TOOLS = ["workflow", "workflow_control"];
function subagentExcludedTools(extra, sessionExclude) {
  return [...DEFAULT_EXCLUDED_SUBAGENT_TOOLS, ...sessionExclude ?? [], ...extra ?? []];
}
var WorkflowAgent = class {
  cwd;
  baseTools;
  /** Extra subagent tool-name denylist, merged with the always-on defaults. */
  excludeTools;
  sessionOptions;
  persistAgentSessions;
  instructions;
  mainModel;
  /** Shared registry from the host session, when provided. */
  sharedRegistry;
  /** Lazily built once; shares the SDK's agentDir/auth so resolved models are authed. */
  registry;
  /**
   * Memoized model-tiers.json snapshot, boxed so a legitimately-null config
   * (file absent/invalid) is distinguishable from "not loaded yet". See
   * loadTierConfig() below for why this is scoped per-instance.
   */
  tierConfigBox;
  /**
   * Shared resource loader for every subagent of this run, built once. See
   * getSharedResourceLoader — this is the #109 memory mitigation.
   */
  sharedResourceLoaderPromise;
  /**
   * Emitted at most once per instance (~= once per run, see the class-level
   * lifetime note above): the untagged/default "medium" tier resolved to a
   * model spec that isn't available. Deliberately per-instance rather than a
   * MODEL_NOT_FOUND throw — an untagged agent never asked for that specific
   * model, so a broken default tier shouldn't fail every untagged agent in the
   * run. See onModelFallback below for the (still-loud) degrade path.
   */
  warnedDefaultTierUnavailable = false;
  constructor(options = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.baseTools = options.tools ?? createCodingTools(this.cwd);
    this.excludeTools = options.excludeTools ?? [];
    this.sessionOptions = options.session ?? {};
    this.persistAgentSessions = options.persistAgentSessions ?? false;
    this.instructions = options.instructions;
    this.mainModel = options.mainModel;
    this.sharedRegistry = options.modelRegistry;
  }
  /**
   * A resource loader shared by every subagent of this run, built once (#109).
   *
   * Without a resourceLoader, createAgentSession() builds a fresh
   * DefaultResourceLoader per subagent and reloads it — re-running EVERY installed
   * extension factory each time (verified: N subagents → N factory runs). Each
   * such factory that arms a load-time timer/listener then roots its subagent
   * session forever, because AgentSession.dispose() emits no session_shutdown to
   * run the cleanup — the dominant #109 leak, and one our own extension
   * (UsageLimitScheduler) can trigger.
   *
   * `noExtensions: true` skips loading host extensions; skills, prompts, and
   * AGENTS.md context still load. The subagent keeps the tools this workflow
   * hands it via `customTools` (coding tools + any optional toolset) —
   * those are unaffected. What it loses is HOST EXTENSION-REGISTERED tools (MCP
   * bridges, browser tools, anything a host extension added via ctx.registerTool):
   * pre-change a subagent session inherited those from the full host extension
   * set, now it does not, so an agentType `tools` allowlist naming one matches
   * nothing. This is a deliberate trade-off — it also structurally kills recursive
   * orchestration in subagents (no extension runtime at all), beyond the name-level
   * #107 denylist — and must be release-noted. `createAgentSession` with a shared
   * resourceLoader is a supported embedding pattern. runWorkflow builds one
   * WorkflowAgent per run, so this loader's lifetime is exactly one run: built
   * once, reused by all its subagents, then dropped with the agent.
   */
  getSharedResourceLoader(agentDir) {
    if (!this.sharedResourceLoaderPromise) {
      this.sharedResourceLoaderPromise = (async () => {
        const loader = new DefaultResourceLoader({
          cwd: this.cwd,
          agentDir,
          settingsManager: SettingsManager.create(this.cwd, agentDir),
          noExtensions: true
        });
        await loader.reload();
        return loader;
      })().catch((err) => {
        this.sharedResourceLoaderPromise = void 0;
        throw err;
      });
    }
    return this.sharedResourceLoaderPromise;
  }
  /**
   * Resolve the registry for a run: an explicit per-run registry wins, then the
   * constructor's shared registry, then a lazily-built disk registry (shared
   * across calls once built). Async because pi >= 0.80.8 builds registries from
   * an async-created ModelRuntime.
   */
  async getRegistry(perRunRegistry) {
    if (perRunRegistry) {
      return perRunRegistry;
    }
    if (this.sharedRegistry) {
      return this.sharedRegistry;
    }
    if (!this.registry) {
      this.registry = await ensureFallbackRegistry();
    }
    return this.registry;
  }
  /**
   * Read+parse ~/.pi/workflows/model-tiers.json at most once for this
   * instance's lifetime, instead of on every run() call. `resolveAgentModelSpec`
   * previously received `loadModelTierConfig` directly (sync existsSync +
   * readFileSync + JSON.parse from disk), which it calls unconditionally for
   * any agent without an explicit options.model — so a large fan-out did N
   * redundant synchronous disk reads that blocked the event loop and stalled
   * concurrent agents' I/O.
   *
   * `runWorkflow()` constructs a fresh `WorkflowAgent` per run (see
   * `new WorkflowAgent(options)` in workflow.ts, unless a caller injects its
   * own `options.agent` runner — a test-only escape hatch per
   * WorkflowManagerOptions.agent's doc comment), so a WorkflowAgent instance's
   * lifetime is one run in production. Memoizing on `this` therefore has the
   * same scope and lifetime as the agentRegistry snapshot workflow.ts already
   * takes once per run "for determinism" — the config file isn't expected to
   * change mid-run, and two different runs (= two different WorkflowAgent
   * instances) each get their own fresh read of whatever is on disk at the
   * time, so this does not leak stale config across runs or break tests that
   * construct fresh agents with different configs.
   *
   * `loader` is injectable for tests (defaults to the real disk read); it is
   * only ever consulted once, on the first call, regardless of what is passed
   * on later calls.
   */
  loadTierConfig(loader = loadModelTierConfig) {
    if (!this.tierConfigBox) {
      this.tierConfigBox = { value: loader() };
    }
    return this.tierConfigBox.value;
  }
  /**
   * Session manager for one subagent run. File-backed (persisted under the
   * standard sessions dir, keyed by the runner's project cwd — never a
   * per-call worktree cwd) when persistAgentSessions is on; in-memory otherwise.
   *
   * SessionManager.create() only creates the session directory — the SDK writes
   * the session file lazily (synchronous fs calls, uncaught) on the first
   * assistant message, deep inside session.prompt(). A failure there would
   * otherwise throw mid-run and abort this subagent. Probe writability up front
   * so any create/write failure (permissions, disk full) degrades this single
   * agent to an in-memory session instead — the run continues, just without a
   * persisted transcript.
   */
  createSessionManager() {
    if (!this.persistAgentSessions) return SessionManager.inMemory();
    try {
      const manager = SessionManager.create(this.cwd);
      this.assertSessionDirWritable(manager.getSessionDir());
      warnPersistSecretsOnce(manager.getSessionDir());
      return manager;
    } catch (error) {
      console.warn(
        `[workflow] persistAgentSessions: could not persist this agent's session (${error instanceof Error ? error.message : String(error)}); continuing with an in-memory session`
      );
      return SessionManager.inMemory();
    }
  }
  /** Best-effort write probe: throws if the session directory isn't actually writable. */
  assertSessionDirWritable(dir) {
    const probePath = join3(dir, `.write-probe-${randomUUID()}`);
    writeFileSync2(probePath, "");
    unlinkSync(probePath);
  }
  async run(prompt, options = {}) {
    const capture = { called: false, value: void 0 };
    const runCwd = options.cwd ?? this.cwd;
    const baseTools = runCwd === this.cwd ? this.baseTools : createCodingTools(runCwd);
    const customTools = applyToolPolicy(
      [...baseTools, ...options.tools ?? []],
      options.toolNames,
      options.disallowedToolNames
    );
    if (options.systemTools?.length) {
      customTools.push(...options.systemTools);
    }
    if (options.schema) {
      const schemaType = options.schema.type;
      if (schemaType !== "object") {
        throw new WorkflowError(
          `agent() opts.schema must be a top-level JSON object schema (type: "object") \u2014 got type: ${schemaType ?? "undefined"}; wrap array/primitive results in an object, e.g. { type: "object", properties: { items: <your schema> } }`,
          "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */,
          { recoverable: false }
        );
      }
      customTools.push(createStructuredOutputTool({ schema: options.schema, capture }));
    }
    const modelRegistry = await this.getRegistry(options.modelRegistry);
    const modelSpec = resolveAgentModelSpec(
      options,
      this.mainModel,
      () => this.loadTierConfig(),
      () => warnTierUnconfiguredOnce(this.mainModel, modelRegistry)
    );
    const isExplicitRequest = Boolean(options.model || options.tier);
    let resolvedModel;
    let resolvedThinkingLevel;
    if (modelSpec) {
      const resolved = resolveModelSpecWithThinking(modelSpec, modelRegistry, {
        preferredProvider: this.mainModel?.split("/", 1)[0]
      });
      if (resolved.warning) console.warn(`[workflow] ${resolved.warning}`);
      if (!resolved.model) {
        if (isExplicitRequest) {
          const message = options.model ? resolved.error ?? `Model "${modelSpec}" not found. Use /workflows-models to choose an available model.` : `tier "${options.tier}" from model-tiers.json resolves to "${modelSpec}", which is not available. Use /workflows-models to choose an available model.`;
          throw new WorkflowError(message, "MODEL_NOT_FOUND" /* MODEL_NOT_FOUND */, {
            recoverable: false,
            agentLabel: options.label
          });
        }
        if (!this.warnedDefaultTierUnavailable) {
          this.warnedDefaultTierUnavailable = true;
          options.onModelFallback?.({ tier: "medium", requestedSpec: modelSpec });
        }
      } else {
        resolvedModel = resolved.model;
        resolvedThinkingLevel = resolved.thinkingLevel;
        options.onModelResolved?.(resolved.resolvedSpec ?? canonicalModelSpec(resolved.model));
      }
    }
    const agentDir = getAgentDir2();
    const modelRuntime = runtimeOf(modelRegistry);
    const sessionManager = this.createSessionManager();
    const { session } = await createAgentSession({
      cwd: runCwd,
      agentDir,
      sessionManager,
      // Use real SettingsManager to inherit user's default provider/model settings.
      // SettingsManager.inMemory() doesn't load ~/.pi/settings.json, so subagents
      // would fall back to the first available model (e.g. openai-codex) which may
      // not have valid auth, causing silent empty responses.
      settingsManager: SettingsManager.create(this.cwd, agentDir),
      customTools,
      // Shared per-run loader with no host extensions (#109) — see
      // getSharedResourceLoader. An injected resourceLoader (tests / embedders)
      // wins and skips the shared build entirely; the ...this.sessionOptions
      // spread below re-applies the same injected value harmlessly.
      resourceLoader: this.sessionOptions.resourceLoader ?? await this.getSharedResourceLoader(agentDir),
      // Share the resolved registry's ModelRuntime (catalog + auth, including
      // extension-registered providers) with the subagent session. pi >= 0.80.8
      // takes modelRuntime here; the old modelRegistry option is gone.
      ...modelRuntime ? { modelRuntime } : {},
      ...this.sessionOptions,
      // Per-call model/thinking wins over any sessionOptions defaults.
      ...resolvedModel ? { model: resolvedModel } : {},
      ...resolvedThinkingLevel ? { thinkingLevel: resolvedThinkingLevel } : {},
      // Deny recursive-orchestration tools in the subagent (#107). Placed after
      // the sessionOptions spread so it always applies; folds in any denylist
      // the caller set on sessionOptions rather than dropping it.
      excludeTools: subagentExcludedTools(this.excludeTools, this.sessionOptions.excludeTools)
    });
    if (this.persistAgentSessions && !this.sessionOptions.sessionManager && options.sessionName) {
      try {
        sessionManager.appendSessionInfo(options.sessionName);
      } catch {
      }
    }
    let removeAbortListener;
    let removeHistoryListener;
    let lastHistoryEmit = 0;
    const emitHistory = () => options.onHistory?.(compactAgentHistory(session.messages));
    const maybeEmitHistory = () => {
      if (!options.onHistory) return;
      const now = Date.now();
      if (now - lastHistoryEmit < 250) return;
      lastHistoryEmit = now;
      emitHistory();
    };
    try {
      if (options.signal?.aborted) throw new Error("Subagent was aborted");
      if (options.signal) {
        const onAbort = () => void session.abort();
        options.signal.addEventListener("abort", onAbort, { once: true });
        removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
      }
      if (options.onHistory) {
        removeHistoryListener = session.subscribe(() => maybeEmitHistory());
      }
      await session.prompt(this.buildPrompt(prompt, options, Boolean(options.schema)));
      if (options.signal?.aborted) throw new Error("Subagent was aborted");
      throwIfProviderLimit(session.messages, options.label);
      if (options.schema) {
        return await resolveStructuredOutput(
          session,
          capture,
          options.schema,
          options,
          (m) => this.lastAssistantText(m)
        );
      }
      const text = this.finalAssistantText(session.messages);
      if (!text.trim()) {
        throw new WorkflowError("Subagent produced no assistant output", "AGENT_EMPTY_OUTPUT" /* AGENT_EMPTY_OUTPUT */, {
          recoverable: true,
          agentLabel: options.label
        });
      }
      return text;
    } finally {
      removeAbortListener?.();
      removeHistoryListener?.();
      try {
        emitHistory();
      } catch {
      }
      if (options.onUsage) {
        try {
          const usage = usageFromStats(session.getSessionStats());
          if (usage) options.onUsage(usage);
        } catch {
        }
      }
      session.dispose();
    }
  }
  buildPrompt(prompt, options, structured) {
    const parts = [
      this.instructions,
      options.instructions,
      options.label ? `Task label: ${options.label}` : void 0,
      prompt
    ].filter(Boolean);
    if (structured) {
      parts.push(
        [
          "Final output contract:",
          "- Your final action MUST be a structured_output tool call.",
          "- The structured_output arguments are the return value of this subagent.",
          "- Do not emit a prose final answer instead of structured_output.",
          "- If you need to inspect files or run commands first, do so, then call structured_output exactly once."
        ].join("\n")
      );
    }
    return parts.join("\n\n");
  }
  lastAssistantText(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
      if (text.trim()) return text;
    }
    return "";
  }
  /**
   * The unstructured agent's FINAL answer: assistant text that appears after the
   * last tool result. Text before the final tool result is stale progress (the
   * agent's last real action was a tool call, not answering), so returning it
   * would mask an incomplete run and suppress AGENT_EMPTY_OUTPUT retries (#111).
   *
   * Distinct from lastAssistantText(), which stays deliberately lenient — the
   * schema path's prose-JSON recovery (resolveStructuredOutput) may need to read
   * the structured payload out of any assistant message, not only the terminal one.
   */
  finalAssistantText(messages) {
    let lastToolResult = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "toolResult") {
        lastToolResult = i;
        break;
      }
    }
    for (let i = messages.length - 1; i > lastToolResult; i--) {
      const message = messages[i];
      if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
      const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
      if (text.trim()) return text;
    }
    return "";
  }
};

// src/builtin-commands.ts
import { spawn } from "node:child_process";

// src/code-review.ts
var MAX_DIFF_CHARS = 2e5;
function generateCodeReviewWorkflow() {
  return `export const meta = {
  name: 'code_review',
  description: 'Multi-angle parallel code review: 7 finder angles + verify pass \u2192 ranked findings',
  phases: [
    { title: 'Find' },
    { title: 'Verify' },
    { title: 'Report' },
  ],
}

const MAX_DIFF_CHARS = ${MAX_DIFF_CHARS}
const rawDiff = (args && args.diff) || ''
const diffSource = (args && args.diffSource) || 'git diff HEAD'
const diffTruncated = rawDiff.length > MAX_DIFF_CHARS
const diff = diffTruncated ? rawDiff.slice(0, MAX_DIFF_CHARS) : rawDiff
if (diffTruncated) {
  log(
    'Diff truncated for review: showing the first ' + MAX_DIFF_CHARS + ' of ' + rawDiff.length +
    ' characters (' + (rawDiff.length - MAX_DIFF_CHARS) + ' omitted). Findings past the cut are not covered.'
  )
}
const candidateSchema = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
        },
        required: ['file', 'line', 'summary', 'failure_scenario'],
      },
    },
  },
  required: ['candidates'],
}

const diffBlock = '\\n\\n<diff source=\\"' + diffSource + '\\"' + (diffTruncated ? ' truncated=\\"true\\"' : '') + '>\\n' +
  diff + (diffTruncated ? '\\n\\n[... diff truncated: ' + (rawDiff.length - MAX_DIFF_CHARS) + ' more characters omitted ...]' : '') +
  '\\n</diff>\\n'
const base = 'Use the read/grep tools to pull in any additional file context you need.' + diffBlock

phase('Find')
const finders = await parallel([
  () => agent(
    'You are a line-by-line correctness scanner. Hunt ONLY for: inverted conditions, off-by-one errors, ' +
    'null/nil dereferences, wrong variable used, swallowed errors. For each candidate name the exact file, ' +
    'line number, a one-line summary, and the concrete failure scenario. Return ONLY issues you can justify ' +
    'with a line in the diff.' + base,
    { label: 'A-line-scan', tier: 'medium', schema: candidateSchema }
  ),
  () => agent(
    'You are a removed-behavior auditor. For every deleted line or block in the diff: name the invariant ' +
    'or contract it enforced, then find where (or prove) that contract is re-established elsewhere. ' +
    'Report only gaps where the invariant is NOT re-established.' + base,
    { label: 'B-removed-behavior', tier: 'medium', schema: candidateSchema }
  ),
  () => agent(
    'You are a cross-file call-site tracer. For each function/method whose signature or behavior changed ' +
    'in the diff: grep the codebase for callers, then check whether each call site is still correct after ' +
    'the change. Report only call sites that are now broken or need updating.' + base,
    { label: 'C-cross-file-tracer', tier: 'medium', schema: candidateSchema }
  ),
  () => agent(
    'You are a reuse finder. Identify new code in the diff that duplicates existing helpers, utilities, ' +
    'or patterns already present in the codebase. Propose the existing symbol that should be used instead.' + base,
    { label: 'D-reuse', tier: 'small', schema: candidateSchema }
  ),
  () => agent(
    'You are a simplification finder. Look for: redundant state that could be derived, copy-paste ' +
    'variation that could be a shared function, and dead code introduced by the diff.' + base,
    { label: 'E-simplification', tier: 'small', schema: candidateSchema }
  ),
  () => agent(
    'You are an efficiency finder. Identify: redundant I/O or network calls, sequential work that could ' +
    'be parallel, and blocking operations on the startup or hot path introduced by the diff.' + base,
    { label: 'F-efficiency', tier: 'small', schema: candidateSchema }
  ),
  () => agent(
    'You are an altitude reviewer. Assess whether the change is made at the RIGHT abstraction level. ' +
    'Look for: bandaids on shared infrastructure that should be fixed at the root, fixes in the wrong ' +
    'layer (e.g. compensating in the UI for a data model problem), or the change solving a symptom ' +
    'rather than the cause.' + base,
    { label: 'G-altitude', tier: 'big', schema: candidateSchema }
  ),
])

// Collect and deduplicate candidates across all finders
const allRaw = finders.flatMap((r, fi) => {
  const label = ['A','B','C','D','E','F','G'][fi]
  return ((r && r.candidates) || []).map((c) => ({ ...c, angle: label }))
})

// Deduplicate: same file + line + first 40 chars of summary \u2192 keep first
const seen = new Set()
const allCandidates = allRaw.filter((c) => {
  const key = (c.file || '') + ':' + (c.line || 0) + ':' + (c.summary || '').slice(0, 40)
  if (seen.has(key)) return false
  seen.add(key)
  return true
})

phase('Verify')
// NOTE: deliberately NOT using the verify() stdlib helper here. verify() only
// returns a boolean real/not-real vote; this phase needs the 3-way
// CONFIRMED/PLAUSIBLE/REFUTED verdict so the synthesis report can hedge
// ("worth a second look" vs "will break"). Since only REFUTED is filtered out
// below, verify()'s boolean would collapse CONFIRMED and PLAUSIBLE into one
// bucket and lose that signal for no behavioral gain \u2014 verify({reviewers: 1})
// is already a single agent() call under the hood, same as this.
const verdicts = allCandidates.length > 0
  ? await parallel(allCandidates.map((c, i) => () =>
      agent(
        'You are a verifier. Determine whether this code review finding is CONFIRMED, PLAUSIBLE, or REFUTED. ' +
        'CONFIRMED = you can trace the exact failure in the diff. PLAUSIBLE = concern is valid but not certain. ' +
        'REFUTED = finding is wrong or already handled.\\n\\n' +
        'FINDING:\\nFile: ' + c.file + '\\nLine: ' + c.line + '\\nSummary: ' + c.summary + '\\n' +
        'Failure scenario: ' + c.failure_scenario + diffBlock,
        {
          label: 'verify-' + (i + 1),
          schema: {
            type: 'object',
            properties: { verdict: { type: 'string', enum: ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] }, reason: { type: 'string' } },
            required: ['verdict'],
          },
        }
      )
    ))
  : []

const surviving = allCandidates
  .map((c, i) => ({ ...c, verdict: (verdicts[i] && verdicts[i].verdict) || 'PLAUSIBLE', verifyReason: (verdicts[i] && verdicts[i].reason) || '' }))
  .filter((c) => c.verdict !== 'REFUTED')

// Rank: correctness (A/B/C) before cleanup (D/E/F) before altitude (G), cap at 10
const rankAngle = (a) => ['A','B','C'].includes(a) ? 0 : ['D','E','F'].includes(a) ? 1 : 2
surviving.sort((a, b) => rankAngle(a.angle) - rankAngle(b.angle))
const top = surviving.slice(0, 10)

phase('Report')
const synthesis = await agent(
  'You are a senior code reviewer writing the final report. Below are the verified findings from a ' +
  'multi-angle code review (already ranked by severity). Write a concise markdown report: ' +
  '1 sentence per finding with file, line, and the failure scenario. Note the total found vs shown. ' +
  'Correctness issues (A/B/C) come first, then cleanup (D/E/F), then altitude (G).\\n\\n' +
  'FINDINGS JSON:\\n' + JSON.stringify(top, null, 2),
  { label: 'synthesis', tier: 'big' }
)

return { total: allCandidates.length, surviving: surviving.length, findings: top, report: synthesis, diffTruncated }`;
}

// src/deep-research.ts
function generateCodebaseAuditWorkflow(scope, checks) {
  const displayScope = scope.length > 60 ? `${scope.slice(0, 60)}\u2026` : scope;
  const checkAgents = checks.map((check, i) => {
    const label = check.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20) || `check-${i + 1}`;
    return `  () => agent(${JSON.stringify(`Audit ${check} across: `)} + scope, { label: ${JSON.stringify(label)} }),`;
  }).join("\n");
  return `export const meta = {
  name: 'codebase_audit',
  description: ${JSON.stringify(`Codebase audit: ${displayScope}`)},
  phases: [
    { title: 'Individual Checks' },
    { title: 'Cross-Validation' },
    { title: 'Report' },
  ],
};

phase('Individual Checks');
const scope = ${JSON.stringify(scope)};
const findings = await parallel([
${checkAgents}
]);

phase('Cross-Validation');
const validated = await agent(
  'Cross-validate these audit findings. Remove false positives and confirm real issues:\\n' +
  JSON.stringify(findings),
  { label: 'validator' }
);

phase('Report');
const report = await agent(
  'Generate a prioritized audit report with actionable recommendations:\\n' + validated,
  { label: 'report-writer' }
);

return { findings, validated, report };`;
}

// src/builtin-workflows.ts
var DEFAULT_MULTI_PERSPECTIVES = [
  "technical",
  "product",
  "security",
  "user experience",
  "maintainability"
];
function asRecord2(args) {
  return args && typeof args === "object" ? args : {};
}
function requireNonEmptyString(value, argName, patternName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Built-in workflow "${patternName}" requires args.${argName} to be a non-empty string.`);
  }
  return value;
}
function requireStringArray(value, argName, patternName) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((v) => typeof v === "string" && v.trim())) {
    throw new Error(
      `Built-in workflow "${patternName}" requires args.${argName} to be a non-empty array of non-empty strings.`
    );
  }
  return value;
}
var BUILTIN_WORKFLOWS = [
  {
    name: "adversarial-review",
    description: "Investigate a task, then cross-check each finding with skeptical reviewers. args: { task: string, reviewers?: number, threshold?: number }.",
    resolve(_cwd, args) {
      requireNonEmptyString(asRecord2(args).task, "task", "adversarial-review");
      return { script: generateAdversarialReviewWorkflow() };
    }
  },
  {
    name: "code-review",
    description: "Multi-angle parallel code review: 7 specialized finders (correctness, reuse, simplification, efficiency, altitude) + verify pass \u2192 ranked findings. args: { diff: string, diffSource?: string }.",
    resolve(_cwd, args) {
      requireNonEmptyString(asRecord2(args).diff, "diff", "code-review");
      return { script: generateCodeReviewWorkflow() };
    }
  },
  {
    name: "multi-perspective",
    description: "Analyze a topic from several independent perspectives in parallel, then synthesize. args: { topic: string, perspectives?: string[] }.",
    resolve(_cwd, args) {
      const record = asRecord2(args);
      const topic = requireNonEmptyString(record.topic, "topic", "multi-perspective");
      const perspectives = Array.isArray(record.perspectives) && record.perspectives.length >= 2 ? requireStringArray(record.perspectives, "perspectives", "multi-perspective") : [...DEFAULT_MULTI_PERSPECTIVES];
      return { script: generateMultiPerspectiveWorkflow(topic, perspectives) };
    }
  },
  {
    name: "codebase-audit",
    description: "Run parallel checks against a codebase scope, then cross-validate and report. args: { scope: string, checks: string[] }.",
    resolve(_cwd, args) {
      const record = asRecord2(args);
      const scope = requireNonEmptyString(record.scope, "scope", "codebase-audit");
      const checks = requireStringArray(record.checks, "checks", "codebase-audit");
      return { script: generateCodebaseAuditWorkflow(scope, checks) };
    }
  }
];
var BUILTIN_WORKFLOW_NAMES = BUILTIN_WORKFLOWS.map((w) => w.name);
function findBuiltinWorkflow(name) {
  return BUILTIN_WORKFLOWS.find((w) => w.name === name);
}
function resolveWorkflowInvocation(name, args, ctx) {
  const saved = ctx.storage.load(name);
  if (saved) return { script: saved.script };
  const builtin = findBuiltinWorkflow(name);
  if (builtin) return builtin.resolve(ctx.cwd, args);
  return void 0;
}

// src/saved-commands.ts
import { createCodingTools as createCodingTools2 } from "@earendil-works/pi-coding-agent";

// src/workflow.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash as createHash2 } from "node:crypto";
import vm from "node:vm";
import { parse } from "acorn";

// src/logger.ts
import { appendFileSync, mkdirSync as mkdirSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";

// src/workflow-paths.ts
import { createHash } from "node:crypto";
import { homedir as homedir3 } from "node:os";
import { basename as basename2, join as join4, resolve as resolve2 } from "node:path";
var WORKFLOW_HOME_RELATIVE_DIR = ".pi/workflows";
var WORKFLOW_PROJECTS_SUBDIR = "projects";
function workflowHomeDir() {
  return join4(homedir3(), WORKFLOW_HOME_RELATIVE_DIR);
}
function workflowUserSavedDir() {
  return join4(workflowHomeDir(), "saved");
}
function workflowProjectKey(cwd) {
  const projectPath = resolve2(cwd);
  const slug2 = sanitizePathSegment(basename2(projectPath) || "project");
  const hash = createHash("sha256").update(projectPath).digest("hex").slice(0, 12);
  return `${slug2}-${hash}`;
}
function workflowProjectPaths(cwd) {
  const key = workflowProjectKey(cwd);
  const rootDir = join4(workflowHomeDir(), WORKFLOW_PROJECTS_SUBDIR, key);
  return {
    key,
    rootDir,
    runsDir: join4(rootDir, "runs"),
    savedDir: join4(rootDir, "saved"),
    settingsPath: join4(rootDir, "settings.json"),
    legacyRunsDir: resolve2(cwd, WORKFLOW_RUNS_DIR),
    legacySavedDir: resolve2(cwd, WORKFLOW_SAVED_DIR)
  };
}
function sanitizePathSegment(value) {
  const sanitized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return sanitized || "project";
}

// src/logger.ts
function createWorkflowLogger(options = {}) {
  const logs = [];
  const persistLogs = options.persist ?? true;
  const cwd = options.cwd ?? process.cwd();
  const runId = options.runId ?? `run-${Date.now()}`;
  const runsDir = workflowProjectPaths(cwd).runsDir;
  let logFile = null;
  const write = (level, message) => {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const entry = `[${timestamp}] [${level}] ${message}`;
    logs.push(entry);
    options.onLog?.(message);
    if (persistLogs && logFile) {
      try {
        appendFileSync(logFile, `${entry}
`);
      } catch {
      }
    }
  };
  const logger = {
    log(message) {
      write("INFO", message);
    },
    error(message) {
      write("ERROR", message);
    },
    warn(message) {
      write("WARN", message);
    },
    getLogs() {
      return [...logs];
    },
    persist() {
      if (!persistLogs) return null;
      try {
        mkdirSync2(runsDir, { recursive: true });
        logFile = join5(runsDir, `${runId}.log`);
        writeFileSync3(logFile, `${logs.join("\n")}
`);
        return logFile;
      } catch {
        return null;
      }
    }
  };
  if (persistLogs) {
    try {
      mkdirSync2(runsDir, { recursive: true });
      logFile = join5(runsDir, `${runId}.log`);
    } catch {
    }
  }
  return logger;
}

// src/model-routing.ts
function resolveModelForPhase(phase, config) {
  if (!phase || !config.routes.length) {
    return config.defaultModel;
  }
  for (const route of config.routes) {
    if (route.useRegex) {
      try {
        const regex = new RegExp(route.phasePattern, "i");
        if (regex.test(phase)) {
          return route.model;
        }
      } catch {
      }
    } else if (phase === route.phasePattern) {
      return route.model;
    }
  }
  return config.defaultModel;
}
function parseModelRoutingFromMeta(phases, defaultModel) {
  const routes = [];
  if (phases) {
    for (const phase of phases) {
      if (phase.model) {
        routes.push({
          phasePattern: phase.title,
          model: phase.model
        });
      }
    }
  }
  return { defaultModel, routes };
}

// src/shared-store.ts
import { defineTool as defineTool2 } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
var SharedStore = class {
  map = /* @__PURE__ */ new Map();
  // Per-agent write deltas for delta-journaling; keyed by a run-unique
  // `${runId}:${callIndex}` string (see class doc) so nested workflow() runs
  // sharing this store can't collide on a bare callIndex.
  agentDeltas = /* @__PURE__ */ new Map();
  // Pre-write shadow values for the CURRENT delta-key's in-progress writes,
  // so a failed retry attempt's mutations can be rolled back (see
  // `discardDelta`) instead of leaking into the live store or a later
  // successful attempt's recorded delta. Populated lazily by `trackPut` (only
  // the first write to a given key within the current delta window is
  // shadowed — later writes to the same key within the same attempt are
  // already covered by that first shadow) and cleared whenever the delta is
  // finalized, either way, via `commitDelta`/`discardDelta`.
  priorValues = /* @__PURE__ */ new Map();
  /** Store a value under `key`. Overwrites any existing value. */
  put(key, value) {
    this.map.set(key, value);
  }
  /**
   * Store a value and record the write in the per-agent delta for `deltaKey`
   * (a run-unique `${runId}:${callIndex}` string — see class doc). Used by
   * per-agent tools created via `createAgentStoreTools` so that each agent's
   * writes can be journaled and replayed independently.
   */
  trackPut(key, value, deltaKey) {
    let priors = this.priorValues.get(deltaKey);
    if (!priors) {
      priors = /* @__PURE__ */ new Map();
      this.priorValues.set(deltaKey, priors);
    }
    if (!priors.has(key)) {
      priors.set(
        key,
        this.map.has(key) ? { existed: true, value: this.map.get(key) } : { existed: false, value: void 0 }
      );
    }
    this.map.set(key, value);
    let delta = this.agentDeltas.get(deltaKey);
    if (!delta) {
      delta = {};
      this.agentDeltas.set(deltaKey, delta);
    }
    delta[key] = value;
  }
  /** Retrieve the value for `key`, or `undefined` when absent. */
  get(key) {
    return this.map.get(key);
  }
  /** Whether `key` is present in the store. */
  has(key) {
    return this.map.has(key);
  }
  /** Return a deep-copied plain-object snapshot of all entries. */
  snapshot() {
    return structuredClone(Object.fromEntries(this.map));
  }
  /**
   * Extract and clear the write delta accumulated for `deltaKey`.
   * Called after an agent completes to get the set of keys it wrote.
   */
  commitDelta(deltaKey) {
    const delta = this.agentDeltas.get(deltaKey) ?? {};
    this.agentDeltas.delete(deltaKey);
    this.priorValues.delete(deltaKey);
    return delta;
  }
  /**
   * Undo the writes recorded for `deltaKey` and discard its bookkeeping,
   * without touching any other key. Used when a retry attempt fails: that
   * attempt's writes must not remain visible in the live store (e.g. to a
   * concurrently-running sibling agent's store_get, or to script code reading
   * `store.get` directly) and must not merge into the delta eventually
   * recorded when a later attempt of the SAME call succeeds — otherwise a
   * failed attempt's mutations would silently survive into the run's live
   * state while being absent from the journaled delta that resume replay
   * reconstructs from, leaving live execution and replay permanently
   * inconsistent. Each key touched during this delta window is restored to
   * whatever it held immediately before the window started (or deleted, if
   * it did not exist yet) — never to some other attempt's or caller's value.
   *
   * Per-key guard: a key is only rolled back if the store STILL holds this
   * attempt's own last write to it (checked with `Object.is` against the
   * value recorded in `delta`). If a concurrently-running sibling (a
   * different `deltaKey`, e.g. another agent in the same parallel() batch)
   * legitimately overwrote the same key AFTER this attempt wrote it but
   * BEFORE it failed, that sibling's write is left untouched — rolling back
   * unconditionally would silently erase a live, unrelated write that this
   * attempt never made and has no business undoing.
   *
   * A no-op if `deltaKey` never wrote anything (nothing to roll back).
   */
  discardDelta(deltaKey) {
    const delta = this.agentDeltas.get(deltaKey);
    if (!delta) return;
    const priors = this.priorValues.get(deltaKey);
    for (const key of Object.keys(delta)) {
      if (!Object.is(this.map.get(key), delta[key])) continue;
      const prior = priors?.get(key);
      if (prior?.existed) this.map.set(key, prior.value);
      else this.map.delete(key);
    }
    this.agentDeltas.delete(deltaKey);
    this.priorValues.delete(deltaKey);
  }
  /**
   * Apply a write delta additively — sets each key without clearing others.
   * Used during resume replay so parallel-agent deltas applied in callSeq
   * order accumulate correctly regardless of original completion order.
   */
  applyDelta(delta) {
    for (const [k, v] of Object.entries(delta)) {
      this.map.set(k, v);
    }
  }
  /**
   * Replace all entries with a snapshot (for full resets).
   * Prefer `applyDelta` for resume replay — see journal integration above.
   */
  restore(snap) {
    this.map.clear();
    for (const [k, v] of Object.entries(snap)) {
      this.map.set(k, v);
    }
  }
  /** Clear all entries (called when the run ends). */
  dispose() {
    this.map.clear();
    this.agentDeltas.clear();
    this.priorValues.clear();
  }
};
function createAgentStoreTools(store, deltaKey) {
  const storePut = defineTool2({
    name: "store_put",
    label: "Store Put",
    description: "Write a value to the shared run store. Any other agent in this workflow run can read it with store_get. Overwrites any existing value for the key. Note: when two parallel agents write the same key, the last write wins \u2014 no merge is performed.",
    promptSnippet: "Write a value to the shared store",
    parameters: Type.Object({
      key: Type.String({ description: "The key to store the value under." }),
      value: Type.Any({ description: "The value to store (any JSON-serializable value)." })
    }),
    async execute(_id, params) {
      store.trackPut(params.key, params.value, deltaKey);
      return {
        content: [{ type: "text", text: `Stored value under key "${params.key}".` }],
        details: { key: params.key }
      };
    }
  });
  const storeGet = defineTool2({
    name: "store_get",
    label: "Store Get",
    description: "Read a value from the shared run store previously written by store_put. Returns the stored value, or null when the key does not exist.",
    promptSnippet: "Read a value from the shared store",
    parameters: Type.Object({
      key: Type.String({ description: "The key to read." })
    }),
    async execute(_id, params) {
      const found = store.has(params.key);
      const value = store.get(params.key);
      const text = found ? `Value for key "${params.key}": ${JSON.stringify(value)}` : `Key "${params.key}" not found in store.`;
      return {
        content: [{ type: "text", text }],
        details: { key: params.key, value: found ? value : null, found }
      };
    }
  });
  return [storePut, storeGet];
}

// src/workflow-capability-contract.ts
var REFERENCE_PATH = "skills/workflow-authoring/references/capability-details.md";
var PRESENT_AT = { kind: "present-at", version: package_default.version };
var noOptions = [];
var option = (name, type, optional, defaultValue = null, constraints = noOptions, dynamicReference = null) => ({ name, type, optional, default: defaultValue, constraints, dynamicReference });
var AGENT_OPTIONS = {
  id: "agent-options",
  options: [
    option("label", "string", true, "derived from phase and call count"),
    option("phase", "string", true, "current phase"),
    option("schema", "plain JSON Schema", true),
    option("model", "string", true, null, ["highest-priority exact model selector"]),
    option("tier", "string", true, null, ["configured route name"], "model-routes"),
    option("isolation", '"worktree"', true),
    option("agentType", "string", true, null, ["must come from provided context"], "agent-types"),
    option("timeoutMs", "number | null", true, "run timeout; null disables"),
    option("retries", "number", true, "run retry count", ["finite values are floored and clamped to 0..3"])
  ]
};
var CHECKPOINT_OPTIONS = {
  id: "checkpoint-options",
  options: [
    option("default", "unknown", true, "true when no UI and omitted"),
    option("headless", '"default" | "abort"', true, '"default"'),
    option("kind", '"confirm" | "input" | "select"', true, '"confirm"'),
    option("choices", "string[]", true),
    option("timeoutMs", "number", true)
  ]
};
var PHASE_OPTIONS = {
  id: "phase-options",
  options: [option("budget", "number", true, null, ["positive soft pre-call token gate"])]
};
var VERIFY_OPTIONS = {
  id: "verify-options",
  options: [
    option("reviewers", "number", true, "2", ["authors should provide a finite integer; runtime clamps below 1"]),
    option("threshold", "number", true, "0.5"),
    option("lens", "string | string[]", true)
  ]
};
var JUDGE_PANEL_OPTIONS = {
  id: "judge-panel-options",
  options: [
    option("judges", "number", true, "3", ["authors should provide a finite integer; runtime clamps below 1"]),
    option("rubric", "string", true, '"overall quality and correctness"')
  ]
};
var LOOP_UNTIL_DRY_OPTIONS = {
  id: "loop-until-dry-options",
  options: [
    option("round", "(roundIndex: number) => unknown[] | Promise<unknown[]>", false),
    option("key", "(item: unknown) => string", true, "JSON.stringify"),
    option("consecutiveEmpty", "number", true, "2", [
      "authors should provide a finite integer; runtime clamps below 1"
    ]),
    option("maxRounds", "number", true, "50", ["authors should provide a finite positive integer"])
  ]
};
var RETRY_OPTIONS = {
  id: "retry-options",
  options: [
    option("attempts", "number", true, "3", [
      "authors must provide a finite integer; runtime clamps values below 1 to 1"
    ]),
    option("until", "(result: unknown) => boolean", true, "accept first result when omitted", [
      "must be synchronous; use gate for asynchronous validation"
    ])
  ]
};
var GATE_OPTIONS = {
  id: "gate-options",
  options: [
    option("attempts", "number", true, "3", [
      "authors must provide a finite integer; runtime clamps values below 1 to 1"
    ])
  ]
};
var runtimeGlobal = (name, options = {}) => ({
  id: `workflow.runtime.${name}`,
  label: name,
  classification: "runtime-global" /* RUNTIME_GLOBAL */,
  support: options.support ?? "supported" /* SUPPORTED */,
  discovery: options.discovery ?? "compact-guidance" /* COMPACT_GUIDANCE */,
  origin: "project" /* PROJECT */,
  lifecycle: PRESENT_AT,
  signature: options.signature ?? name,
  optionShape: options.optionShape ?? null,
  constraints: options.constraints ?? noOptions,
  enforcementOwner: "runWorkflow context assembly",
  runtimeBinding: {
    global: name,
    implementation: name,
    ...options.allowsUndefined ? { allowsUndefined: true } : {}
  },
  behaviorEvidence: options.evidence ?? ["tests/workflow-runtime.test.ts"],
  staticReference: { path: REFERENCE_PATH, anchor: name.toLowerCase() },
  dynamicReference: null
});
var toolInput = (name, signature, constraints = noOptions) => ({
  id: `workflow.tool-input.${name}`,
  label: name,
  classification: "workflow-tool-input" /* WORKFLOW_TOOL_INPUT */,
  support: "supported" /* SUPPORTED */,
  discovery: "compact-guidance" /* COMPACT_GUIDANCE */,
  origin: "tool-adapter" /* TOOL_ADAPTER */,
  lifecycle: PRESENT_AT,
  signature,
  optionShape: null,
  constraints,
  enforcementOwner: "workflowToolSchema and createWorkflowTool",
  runtimeBinding: null,
  behaviorEvidence: ["tests/workflow-tool.test.ts"],
  staticReference: { path: REFERENCE_PATH, anchor: `tool-input-${name.toLowerCase()}` },
  dynamicReference: null
});
var capabilities = [
  runtimeGlobal("agent", {
    signature: "agent(prompt, options?) => Promise<string | structured value | null>",
    optionShape: "agent-options",
    constraints: [
      "recoverable failures return null after retries; nonrecoverable failures throw",
      "schema noncompliance after bounded structured-output repair is nonrecoverable and bypasses agent retries",
      "per-agent retries override invocation retries; retries are floored and clamped to 0..3",
      "resume replays only the longest unchanged prefix; the first miss and every later call execute live",
      "selector priority is explicit model > agentType model > tier > phase model > metadata model > implicit medium > session default",
      "an explicit model, agentType model, tier, or phase model that resolves to an unavailable model throws MODEL_NOT_FOUND naming the source (e.g. the tier and what it resolved to) instead of falling back",
      "only the implicit default medium tier (no explicit model, tier, agentType, or phase model requested) degrades to the session default when unavailable, logging a one-time run-visible warning instead of throwing",
      "worktree isolation is best-effort; failure logs that isolation was ignored and continues without an isolated working directory"
    ],
    evidence: ["tests/workflow-runtime.test.ts", "tests/agent-registry.test.ts", "tests/structured-output.test.ts"]
  }),
  runtimeGlobal("parallel", {
    signature: "parallel(thunks) => Promise<Array<unknown | null>>",
    constraints: [
      "requires functions rather than promises",
      "result order matches input order",
      "recoverable thunk failures become null; nonrecoverable failures throw"
    ]
  }),
  runtimeGlobal("pipeline", {
    signature: "pipeline(items, ...stages) => Promise<Array<unknown | null>>",
    constraints: [
      "items run concurrently while stages per item run sequentially",
      "each stage receives previousValue, originalItem, and zero-based index",
      "a null stage result is passed to the next stage; authors must guard missing coverage explicitly",
      "recoverable stage failures become null; nonrecoverable failures throw"
    ]
  }),
  runtimeGlobal("workflow", {
    signature: "workflow(savedName, childArgs?) => Promise<unknown>",
    constraints: [
      "one nested level",
      "shares limiter, counters, token accounting, and store",
      "nested workflows do not reuse the parent resume journal"
    ],
    evidence: ["tests/workflow-saved.test.ts", "tests/shared-store.test.ts"]
  }),
  runtimeGlobal("verify", {
    signature: "verify(item: unknown, options?: { reviewers?: number; threshold?: number; lens?: string | string[] }) => Promise<{ real: boolean; realCount: number; total: number; votes: Array<{ real: boolean; reason?: string }> }>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    optionShape: "verify-options",
    constraints: [
      "reviewer failures are omitted; successful votes form the denominator in realCount / total",
      "threshold comparison is inclusive and real is false when no reviewer succeeds",
      "multiple lenses cycle across reviewers"
    ],
    evidence: ["tests/quality-stdlib.test.ts"]
  }),
  runtimeGlobal("judgePanel", {
    signature: "judgePanel(attempts: unknown[], options?: { judges?: number; rubric?: string }) => Promise<{ index: number; attempt: unknown; score: number; judgments: Array<{ score: number; reason?: string }> } | undefined>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    optionShape: "judge-panel-options",
    constraints: [
      "failed judgments are omitted and each candidate score averages successful judgments only",
      "a candidate with no successful judgments scores 0",
      "highest mean score wins with stable input index as the tie-break; empty input returns undefined"
    ],
    evidence: ["tests/quality-stdlib.test.ts"]
  }),
  runtimeGlobal("loopUntilDry", {
    signature: "loopUntilDry(options: { round: (roundIndex: number) => unknown[] | Promise<unknown[]>; key?: (item: unknown) => string; consecutiveEmpty?: number; maxRounds?: number }) => Promise<unknown[]>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    optionShape: "loop-until-dry-options",
    constraints: [
      "roundIndex is zero-based; null, non-array, or duplicate-only round results count as empty",
      "token-budget or agent-limit capacity exhaustion returns the accumulated partial array instead of throwing",
      "the returned array does not report whether termination came from dryness, maxRounds, or capacity exhaustion",
      "authors must retain failed-round identity and truthful termination state outside the helper"
    ],
    evidence: ["tests/quality-stdlib.test.ts"]
  }),
  runtimeGlobal("completenessCheck", {
    signature: "completenessCheck(taskArgs: unknown, results: unknown) => Promise<{ complete: boolean; missing?: string[] } | null>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    constraints: [
      "only the first 4,000 characters of serialized result evidence are sent to the critic",
      "missing is optional and recoverable critic failure returns null",
      "large evidence sets must be chunked or summarized before relying on the advisory verdict"
    ],
    evidence: ["tests/quality-stdlib.test.ts"]
  }),
  runtimeGlobal("retry", {
    signature: "retry(thunk: (attempt: number) => unknown | Promise<unknown>, options?: { attempts?: number; until?: (result: unknown) => boolean }) => Promise<unknown>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    optionShape: "retry-options",
    constraints: [
      "attempt is zero-based and attempts counts total thunk calls",
      "until is synchronous; returning a Promise is truthy and accepts the first result",
      "omitting until accepts the first result regardless of attempts",
      "stops when until(result) is true; exhaustion returns only the last result without attempt metadata",
      "authors must supply a finite attempts bound when overriding the default"
    ],
    evidence: ["tests/quality-stdlib.test.ts"]
  }),
  runtimeGlobal("gate", {
    signature: "gate(thunk: (feedback: string | undefined, attempt: number) => unknown | Promise<unknown>, validator: (value: unknown) => { ok: boolean; feedback?: string } | Promise<{ ok: boolean; feedback?: string }>, options?: { attempts?: number }) => Promise<{ ok: boolean; value: unknown; attempts: number }>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    optionShape: "gate-options",
    constraints: [
      "feedback is undefined on the first thunk call and then receives the previous validator feedback string",
      "attempt is zero-based for the thunk while the returned attempts count is one-based",
      "a value is accepted when the validator returns an object with a truthy ok property; a bare boolean is not accepted",
      "exhaustion returns ok false with the last value and the bounded attempts count",
      "authors must supply a finite attempts bound when overriding the default"
    ],
    evidence: ["tests/quality-stdlib.test.ts"]
  }),
  runtimeGlobal("checkpoint", {
    signature: "checkpoint(prompt, options?) => Promise<unknown>",
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    optionShape: "checkpoint-options",
    constraints: [
      "foreground confirm and headless behavior are implemented; input/select/timeout are declared-only",
      "consumes one agent slot and no tokens",
      "journaled answers replay only within an unchanged resume prefix"
    ],
    evidence: ["tests/checkpoint.test.ts"]
  }),
  runtimeGlobal("log", { signature: "log(message) => void" }),
  runtimeGlobal("phase", {
    signature: "phase(title, options?) => void",
    optionShape: "phase-options",
    constraints: ["phase budgets are soft pre-call gates"]
  }),
  runtimeGlobal("args", { signature: "args: unknown", allowsUndefined: true }),
  runtimeGlobal("cwd", { signature: "cwd: string" }),
  runtimeGlobal("process", { signature: "process: { cwd(): string }" }),
  runtimeGlobal("budget", {
    signature: "budget: { total, spent(), remaining() }",
    constraints: [
      "frozen view over shared soft token accounting",
      "spend accrues after agents finish, so in-flight work can overshoot",
      "nested workflows share the same accounting"
    ]
  }),
  runtimeGlobal("console", {
    signature: "console: { log, info, warn, error }",
    support: "compatibility" /* COMPATIBILITY */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    constraints: ["new workflows should use log()"]
  }),
  toolInput("script", "script?: string", ["required raw JavaScript workflow source unless `name` is given"]),
  toolInput("name", "name?: string", [
    "resolves a project/user saved workflow first, then one of the 5 built-in patterns",
    "mutually exclusive with resumeFromRunId"
  ]),
  toolInput("args", "args?: unknown"),
  toolInput("background", "background?: boolean = true", [
    "background workflows are headless; use background false when checkpoint must show foreground confirmation"
  ]),
  toolInput("maxAgents", "maxAgents?: number = 1000", ["default, not a hard product maximum"]),
  toolInput("concurrency", "concurrency?: number", ["runtime clamps to 1..16"]),
  toolInput("agentRetries", "agentRetries?: number = configured value or 0", ["floored and clamped to 0..3"]),
  toolInput("agentTimeoutMs", "agentTimeoutMs?: number = configured default or unbounded"),
  toolInput("tokenBudget", "tokenBudget?: number = configured default or unlimited", [
    "soft pre-call gate; in-flight work can overshoot"
  ]),
  toolInput("resumeFromRunId", "resumeFromRunId?: string", [
    "resumes a prior incomplete run with an edited script",
    "unchanged positional agent calls replay from cache until the first changed or inserted call",
    "always runs in the background"
  ]),
  {
    id: "workflow.script.metadata",
    label: "export const meta",
    classification: "script-contract" /* SCRIPT_CONTRACT */,
    support: "supported" /* SUPPORTED */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    origin: "project" /* PROJECT */,
    lifecycle: PRESENT_AT,
    signature: "export const meta = { name: string, description: string, phases?: Array<{ title: string; detail?: string; model?: string }>, model?: string }",
    optionShape: null,
    constraints: [
      "must be the first statement",
      "name and description must be nonblank strings",
      "metadata must use literal values; expressions such as string concatenation and template interpolation are rejected",
      "the meta declaration is the only legal export because the remaining body executes inside an async function"
    ],
    enforcementOwner: "parseWorkflowScript",
    runtimeBinding: null,
    behaviorEvidence: ["tests/workflow-parser.test.ts"],
    staticReference: { path: REFERENCE_PATH, anchor: "metadata" },
    dynamicReference: null
  },
  {
    id: "workflow.script.return-value",
    label: "workflow return value",
    classification: "script-contract" /* SCRIPT_CONTRACT */,
    support: "supported" /* SUPPORTED */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    origin: "project" /* PROJECT */,
    lifecycle: PRESENT_AT,
    signature: "return JSON-serializable data",
    optionShape: null,
    constraints: ["do not return functions, promises, cyclic objects, BigInt, or runtime handles"],
    enforcementOwner: "workflow tool result boundary",
    runtimeBinding: null,
    behaviorEvidence: ["tests/workflow-authoring-skill.test.ts", "tests/workflow-tool.test.ts"],
    staticReference: { path: REFERENCE_PATH, anchor: "return-value" },
    dynamicReference: null
  },
  {
    id: "workflow.script.determinism",
    label: "deterministic script execution",
    classification: "script-contract" /* SCRIPT_CONTRACT */,
    support: "supported" /* SUPPORTED */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    origin: "project" /* PROJECT */,
    lifecycle: PRESENT_AT,
    signature: null,
    optionShape: null,
    constraints: [
      "Date.now(), Math.random(), and no-argument new Date() are unavailable",
      "pass timestamps and randomness through args"
    ],
    enforcementOwner: "parseWorkflowScript and VM determinism prelude",
    runtimeBinding: null,
    behaviorEvidence: ["tests/workflow-parser.test.ts", "tests/workflow-runtime.test.ts"],
    staticReference: { path: REFERENCE_PATH, anchor: "determinism" },
    dynamicReference: null
  },
  {
    id: "workflow.compat.markdown-fences",
    label: "whole-script Markdown fence stripping",
    classification: "compatibility-behavior" /* COMPATIBILITY_BEHAVIOR */,
    support: "compatibility" /* COMPATIBILITY */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    origin: "tool-adapter" /* TOOL_ADAPTER */,
    lifecycle: PRESENT_AT,
    signature: null,
    optionShape: null,
    constraints: ["accepted for compatibility but not recommended"],
    enforcementOwner: "normalizeWorkflowScript",
    runtimeBinding: null,
    behaviorEvidence: ["tests/workflow-tool.test.ts"],
    staticReference: { path: REFERENCE_PATH, anchor: "compatibility" },
    dynamicReference: null
  },
  {
    id: "workflow.vm.realm-substrate",
    label: "VM realm JavaScript substrate",
    classification: "internal-substrate" /* INTERNAL_SUBSTRATE */,
    support: "internal" /* INTERNAL */,
    discovery: "none" /* NONE */,
    origin: "vm-realm" /* VM_REALM */,
    lifecycle: PRESENT_AT,
    signature: null,
    optionShape: null,
    constraints: ["Node-version-dependent globals are not project-owned workflow API", "VM is not a security sandbox"],
    enforcementOwner: "node:vm",
    runtimeBinding: null,
    behaviorEvidence: ["tests/workflow-runtime.test.ts"],
    staticReference: null,
    dynamicReference: null
  },
  {
    id: "workflow.dynamic.model-routes",
    label: "model routes",
    classification: "dynamic-reference" /* DYNAMIC_REFERENCE */,
    support: "supported" /* SUPPORTED */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    origin: "live-configuration" /* LIVE_CONFIGURATION */,
    lifecycle: PRESENT_AT,
    signature: null,
    optionShape: null,
    constraints: ["live values must not be copied into static contract data"],
    enforcementOwner: "model-tier-config",
    runtimeBinding: null,
    behaviorEvidence: ["tests/workflows-models-command.test.ts"],
    staticReference: { path: REFERENCE_PATH, anchor: "model-routes" },
    dynamicReference: "model-routes"
  },
  {
    id: "workflow.dynamic.agent-types",
    label: "agent types",
    classification: "dynamic-reference" /* DYNAMIC_REFERENCE */,
    support: "supported" /* SUPPORTED */,
    discovery: "workflow-authoring-skill" /* WORKFLOW_AUTHORING_SKILL */,
    origin: "live-configuration" /* LIVE_CONFIGURATION */,
    lifecycle: PRESENT_AT,
    signature: null,
    optionShape: null,
    constraints: ["live values must not be copied into static contract data"],
    enforcementOwner: "agent-registry",
    runtimeBinding: null,
    behaviorEvidence: ["tests/agent-registry.test.ts"],
    staticReference: { path: REFERENCE_PATH, anchor: "agent-types" },
    dynamicReference: "agent-types"
  }
];
var WORKFLOW_CAPABILITY_DEFINITION = {
  versions: {
    extension: package_default.version,
    format: { kind: "present-at", version: "1.0.0" },
    content: PRESENT_AT
  },
  optionShapes: [
    AGENT_OPTIONS,
    CHECKPOINT_OPTIONS,
    PHASE_OPTIONS,
    VERIFY_OPTIONS,
    JUDGE_PANEL_OPTIONS,
    LOOP_UNTIL_DRY_OPTIONS,
    RETRY_OPTIONS,
    GATE_OPTIONS
  ],
  capabilities,
  dynamicReferences: [
    {
      id: "model-routes",
      owner: "model-tier-config",
      itemShape: "{ name: string; description?: string }",
      connection: "loadModelTierConfig"
    },
    {
      id: "agent-types",
      owner: "agent-registry",
      itemShape: "{ name: string; description?: string }",
      connection: "loadAgentRegistry"
    }
  ]
};
function defineWorkflowCapabilityContract(definition) {
  deepFreeze(definition);
  const definitionDiagnostics = validateDefinition(definition);
  if (definitionDiagnostics.length > 0) {
    throw new WorkflowCapabilityContractError("invalid workflow capability definition", definitionDiagnostics);
  }
  const optionShapes = new Map(definition.optionShapes.map((shape) => [shape.id, shape]));
  const dynamicReferences = new Map(definition.dynamicReferences.map((reference) => [reference.id, reference]));
  const bindings = definition.capabilities.flatMap(
    (capability) => capability.runtimeBinding ? [{ ...capability.runtimeBinding }] : []
  );
  const implementations = new Set(bindings.map((binding) => binding.implementation));
  const globals = new Set(bindings.map((binding) => binding.global));
  const diagnoseAlignment = (evidence) => {
    const diagnostics = [];
    if (evidence.suppliedImplementations) {
      for (const binding of bindings) {
        if (!Object.hasOwn(evidence.suppliedImplementations, binding.implementation) || evidence.suppliedImplementations[binding.implementation] === void 0 && !binding.allowsUndefined) {
          diagnostics.push({
            code: "MISSING_RUNTIME_IMPLEMENTATION",
            severity: "error" /* ERROR */,
            subject: binding.implementation,
            message: `Declared workflow global "${binding.global}" has no supplied implementation "${binding.implementation}".`
          });
        }
      }
      for (const name of Object.keys(evidence.suppliedImplementations)) {
        if (!implementations.has(name)) {
          diagnostics.push({
            code: "UNDECLARED_RUNTIME_IMPLEMENTATION",
            severity: "warning" /* WARNING */,
            subject: name,
            message: `Supplied runtime implementation "${name}" is undeclared and was ignored.`
          });
        }
      }
    }
    if (evidence.observedProjectGlobals) {
      const observed = new Set(evidence.observedProjectGlobals);
      for (const name of globals) {
        if (!observed.has(name)) {
          diagnostics.push({
            code: "DECLARED_GLOBAL_UNOBSERVED",
            severity: "error" /* ERROR */,
            subject: name,
            message: `Declared workflow global "${name}" was not observed in the assembled context.`
          });
        }
      }
      for (const name of observed) {
        if (!globals.has(name)) {
          diagnostics.push({
            code: "OBSERVED_GLOBAL_UNDECLARED",
            severity: "error" /* ERROR */,
            subject: name,
            message: `Observed project-owned workflow global "${name}" is undeclared.`
          });
        }
      }
    }
    return diagnostics;
  };
  return {
    definition,
    assembleRuntimeBindings(supplied) {
      const diagnostics = diagnoseAlignment({ suppliedImplementations: supplied });
      const missing = diagnostics.filter((diagnostic) => diagnostic.code === "MISSING_RUNTIME_IMPLEMENTATION");
      if (missing.length > 0) {
        throw new WorkflowCapabilityContractError(
          `missing declared runtime implementation: ${missing.map((diagnostic) => diagnostic.subject).join(", ")}`,
          diagnostics
        );
      }
      const assembled = {};
      for (const binding of bindings) assembled[binding.global] = supplied[binding.implementation];
      return { globals: assembled, diagnostics };
    },
    projectStaticReferenceFacts() {
      return definition.capabilities.filter((capability) => capability.staticReference !== null).map((capability) => ({
        id: capability.id,
        label: capability.label,
        classification: capability.classification,
        support: capability.support,
        signature: capability.signature,
        options: capability.optionShape ? optionShapes.get(capability.optionShape) ?? null : null,
        constraints: capability.constraints,
        reference: capability.staticReference ? `${capability.staticReference.path}#${capability.staticReference.anchor}` : null,
        dynamicReference: capability.dynamicReference ? dynamicReferences.get(capability.dynamicReference) ?? null : null
      }));
    },
    diagnoseAlignment
  };
}
function validateDefinition(definition) {
  const diagnostics = [];
  const ids = /* @__PURE__ */ new Set();
  const globals = /* @__PURE__ */ new Set();
  const runtimeImplementations = /* @__PURE__ */ new Set();
  const optionShapes = /* @__PURE__ */ new Set();
  const dynamicReferences = /* @__PURE__ */ new Set();
  const invalid = (subject, message) => diagnostics.push({ code: "INVALID_CAPABILITY_DEFINITION", severity: "error" /* ERROR */, subject, message });
  for (const shape of definition.optionShapes) {
    if (optionShapes.has(shape.id)) invalid(shape.id, `Duplicate option shape "${shape.id}".`);
    optionShapes.add(shape.id);
  }
  for (const reference of definition.dynamicReferences) {
    if (dynamicReferences.has(reference.id)) invalid(reference.id, `Duplicate dynamic reference "${reference.id}".`);
    dynamicReferences.add(reference.id);
  }
  for (const capability of definition.capabilities) {
    if (ids.has(capability.id)) invalid(capability.id, `Duplicate capability id "${capability.id}".`);
    ids.add(capability.id);
    if (capability.classification === "runtime-global" /* RUNTIME_GLOBAL */ && !capability.runtimeBinding) {
      invalid(capability.id, "Runtime-global capabilities require a runtime binding.");
    }
    if (capability.runtimeBinding) {
      if (globals.has(capability.runtimeBinding.global)) {
        invalid(capability.runtimeBinding.global, `Duplicate runtime global "${capability.runtimeBinding.global}".`);
      }
      globals.add(capability.runtimeBinding.global);
      if (runtimeImplementations.has(capability.runtimeBinding.implementation)) {
        invalid(
          capability.runtimeBinding.implementation,
          `Duplicate runtime implementation identity "${capability.runtimeBinding.implementation}".`
        );
      }
      runtimeImplementations.add(capability.runtimeBinding.implementation);
      if (capability.classification !== "runtime-global" /* RUNTIME_GLOBAL */ || capability.origin !== "project" /* PROJECT */) {
        invalid(capability.id, "Runtime bindings require runtime-global classification and project origin.");
      }
    }
    if (capability.optionShape && !optionShapes.has(capability.optionShape)) {
      invalid(capability.id, `Unknown option shape "${capability.optionShape}".`);
    }
    if (capability.dynamicReference && !dynamicReferences.has(capability.dynamicReference)) {
      invalid(capability.id, `Unknown dynamic reference "${capability.dynamicReference}".`);
    }
  }
  return diagnostics;
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
var WORKFLOW_CAPABILITY_CONTRACT = defineWorkflowCapabilityContract(WORKFLOW_CAPABILITY_DEFINITION);

// src/worktree.ts
import { execFile } from "node:child_process";
import { join as join6 } from "node:path";
import { promisify } from "node:util";
var exec = promisify(execFile);
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "agent";
}
async function createWorktree(baseCwd, name) {
  const id = slug(name);
  let repoRoot;
  try {
    const { stdout } = await exec("git", ["-C", baseCwd, "rev-parse", "--show-toplevel"]);
    repoRoot = stdout.trim();
  } catch {
    return { isolated: false, cwd: baseCwd, reason: "not a git repository" };
  }
  const path = join6(repoRoot, ".pi", "worktrees", id);
  const branch = `pi/wf/${id}`;
  try {
    await exec("git", ["-C", repoRoot, "worktree", "add", "-b", branch, path, "HEAD"]);
    return { isolated: true, cwd: path, branch, repoRoot };
  } catch (error) {
    return { isolated: false, cwd: baseCwd, reason: error instanceof Error ? error.message : String(error) };
  }
}
async function removeWorktree(wt) {
  if (!wt.isolated || !wt.repoRoot) return;
  try {
    await exec("git", ["-C", wt.repoRoot, "worktree", "remove", "--force", wt.cwd]);
  } catch {
  }
  if (wt.branch) {
    try {
      await exec("git", ["-C", wt.repoRoot, "branch", "-D", wt.branch]);
    } catch {
    }
  }
}

// src/workflow.ts
var fanoutScope = new AsyncLocalStorage();
var DETERMINISM_BLOCKLIST = /\bDate\s*\.\s*now\b|\bMath\s*\.\s*random\b|\bnew\s+Date\s*\(\s*\)/;
var DETERMINISM_PRELUDE = [
  '"use strict";',
  'Math.random = () => { throw new Error("Math.random() is unavailable in a workflow (it breaks resume); pass randomness via args or vary by index"); };',
  "{",
  "  const RealDate = Date;",
  '  const fail = (w) => { throw new Error(w + " is unavailable in a workflow (it breaks resume); pass a timestamp via args"); };',
  "  const SafeDate = function (...a) {",
  '    if (!new.target) fail("Date()");',
  '    if (a.length === 0) fail("new Date()");',
  "    return Reflect.construct(RealDate, a, SafeDate);",
  "  };",
  "  SafeDate.UTC = RealDate.UTC;",
  "  SafeDate.parse = RealDate.parse;",
  '  SafeDate.now = () => fail("Date.now()");',
  "  SafeDate.prototype = RealDate.prototype;",
  "  globalThis.Date = SafeDate;",
  "}"
].join("\n");
async function runWorkflow(script, options = {}) {
  const started = Date.now();
  const { meta, body } = parseWorkflowScript(script);
  const routingConfig = parseModelRoutingFromMeta(meta.phases, meta.model);
  const maxAgents = options.maxAgents ?? MAX_AGENTS_PER_RUN;
  const agentTimeoutMs = options.agentTimeoutMs !== void 0 ? options.agentTimeoutMs : DEFAULT_AGENT_TIMEOUT_MS;
  const runId = options.runId ?? `run-${started.toString(36)}`;
  const baseCwd = options.cwd ?? process.cwd();
  const agentRegistry = options.agentRegistry ?? loadAgentRegistry(baseCwd);
  const logger = createWorkflowLogger({
    runId,
    cwd: options.cwd ?? process.cwd(),
    persist: options.persistLogs ?? true,
    onLog: options.onLog
  });
  const state = {
    logs: [],
    // When the script declares meta.phases, default the current phase to the
    // first one so agents created before any explicit phase() call still group
    // under a declared phase instead of an orphan "(no phase)" bucket. An
    // explicit phase() (or agent({ phase })) overrides this.
    phases: meta.phases?.[0]?.title ? [meta.phases[0].title] : [],
    currentPhase: meta.phases?.[0]?.title,
    phaseBudgets: /* @__PURE__ */ new Map(),
    callSeq: 0,
    firstMiss: Number.POSITIVE_INFINITY
  };
  const agentRunner = options.agent ?? new WorkflowAgent(options);
  const concurrency = normalizeConcurrency(
    options.concurrency ?? Math.max(1, (globalThis.navigator?.hardwareConcurrency ?? 8) - 2)
  );
  const shared = options.sharedRuntime ?? {
    limiter: createLimiter(concurrency),
    agentCount: 0,
    spent: options.initialTokenUsage?.total ?? 0,
    tokenUsage: options.initialTokenUsage ? { ...options.initialTokenUsage } : { input: 0, output: 0, total: 0, cost: 0, cacheRead: 0, cacheWrite: 0 },
    depth: 0,
    nestedCallSeq: 0,
    runFatalController: new AbortController(),
    inFlight: /* @__PURE__ */ new Set()
  };
  const limiter = shared.limiter;
  const isTopLevelRun = !options.sharedRuntime;
  const store = options.sharedStore ?? new SharedStore();
  const log = (message) => {
    const text = String(message);
    state.logs.push(text);
    logger.log(text);
  };
  const phase = (title, phaseOptions) => {
    state.currentPhase = title;
    if (!state.phases.includes(title)) state.phases.push(title);
    if (typeof phaseOptions?.budget === "number" && phaseOptions.budget > 0) {
      state.phaseBudgets.set(title, { budget: phaseOptions.budget, startSpent: shared.spent, warned: false });
    }
    options.onPhase?.(title);
    options.onRuntimeEvent?.({
      type: "phase",
      title,
      budget: typeof phaseOptions?.budget === "number" && phaseOptions.budget > 0 ? phaseOptions.budget : null
    });
  };
  const budget = Object.freeze({
    total: options.tokenBudget ?? null,
    spent: () => shared.spent,
    remaining: () => options.tokenBudget == null ? Infinity : Math.max(0, options.tokenBudget - shared.spent)
  });
  const agentLimitError = () => new WorkflowError(
    `Agent limit exceeded (${shared.agentCount}/${maxAgents}). Re-call workflow with resumeFromRunId="${runId}", the same script, and maxAgents: N (N>${maxAgents}) \u2014 journaled prefix replays free. /workflows resume alone cannot raise the cap.`,
    "AGENT_LIMIT_EXCEEDED" /* AGENT_LIMIT_EXCEEDED */,
    { recoverable: false }
  );
  const isAborted = () => Boolean(options.signal?.aborted || shared.runFatalController.signal.aborted);
  const throwIfAborted = () => {
    if (isAborted()) {
      throw new WorkflowError("workflow aborted", "WORKFLOW_ABORTED" /* WORKFLOW_ABORTED */, { recoverable: true });
    }
  };
  const agent = (prompt, agentOptions = {}) => {
    const call = agentImpl(prompt, agentOptions);
    shared.inFlight.add(call);
    call.catch(() => {
    }).finally(() => shared.inFlight.delete(call));
    return call;
  };
  const agentImpl = async (prompt, agentOptions = {}) => {
    throwIfAborted();
    const batch = fanoutScope.getStore();
    if (shared.agentCount >= maxAgents) {
      throw agentLimitError();
    }
    if (budget.total !== null && budget.remaining() <= 0) {
      throw new WorkflowError("workflow token budget exhausted", "TOKEN_BUDGET_EXHAUSTED" /* TOKEN_BUDGET_EXHAUSTED */, {
        recoverable: false
      });
    }
    const assignedPhase = agentOptions.phase ?? state.currentPhase;
    if (assignedPhase) {
      const pb = state.phaseBudgets.get(assignedPhase);
      if (pb) {
        const phaseSpent = shared.spent - pb.startSpent;
        if (phaseSpent >= pb.budget) {
          throw new WorkflowError(
            `phase "${assignedPhase}" token sub-budget exhausted (${pb.budget})`,
            "TOKEN_BUDGET_EXHAUSTED" /* TOKEN_BUDGET_EXHAUSTED */,
            { recoverable: false }
          );
        }
        if (!pb.warned && phaseSpent >= pb.budget * 0.8) {
          pb.warned = true;
          log(`phase "${assignedPhase}" at ${Math.round(phaseSpent / pb.budget * 100)}% of its token sub-budget`);
        }
      }
    }
    const requestedLabel = agentOptions.label?.trim();
    const agentDef = resolveAgentType(agentOptions.agentType, agentRegistry);
    if (agentOptions.agentType && !agentDef) {
      log(`unknown agentType "${agentOptions.agentType}"; using default tools/model`);
    }
    const explicitModel = agentOptions.model ?? agentDef?.model;
    const modelSpec = explicitModel ?? (agentOptions.tier ? void 0 : resolveModelForPhase(assignedPhase, routingConfig));
    let displayModel = modelSpec ?? options.mainModel;
    const callIndex = state.callSeq++;
    const callHash = hashAgentCall(prompt, modelSpec, assignedPhase, agentOptions, agentDefinitionKey(agentDef));
    const deltaKey = `${runId}:${callIndex}`;
    shared.agentCount++;
    const label = requestedLabel || defaultAgentLabel(assignedPhase, shared.agentCount);
    const cached = options.resumeJournal?.get(deltaKey);
    const hashMatches = cached != null && cached.hash === callHash;
    const cachedEmptyOutput = hashMatches && isEmptyTextAgentResult(cached.result, agentOptions.schema);
    if (hashMatches && !cachedEmptyOutput && callIndex < state.firstMiss) {
      options.onAgentStart?.({ id: deltaKey, label, phase: assignedPhase, prompt, model: displayModel });
      options.onAgentEnd?.({
        id: deltaKey,
        label,
        phase: assignedPhase,
        result: cached.result,
        tokens: 0,
        model: displayModel
      });
      if (cached.storeDelta) store.applyDelta(cached.storeDelta);
      return cached.result;
    }
    if (!hashMatches || cachedEmptyOutput) state.firstMiss = Math.min(state.firstMiss, callIndex);
    return limiter(async () => {
      const timeout = agentOptions.timeoutMs !== void 0 ? agentOptions.timeoutMs : agentTimeoutMs;
      const retryAttempts = normalizeAgentRetries(agentOptions.retries ?? options.agentRetries ?? 0);
      const maxAttempts = retryAttempts + 1;
      options.onAgentStart?.({ id: deltaKey, label, phase: assignedPhase, prompt, model: displayModel });
      let worktree;
      const resolvedIsolation = agentOptions.isolation ?? agentDef?.isolation;
      if (resolvedIsolation === "worktree") {
        worktree = await createWorktree(baseCwd, `${runId}-${callIndex}-${label}`);
        if (!worktree.isolated) log(`isolation ignored for "${label}" (${worktree.reason})`);
      }
      const runCwd = worktree?.isolated ? worktree.cwd : void 0;
      let usage;
      const recordTokens = (result2) => {
        const tokens = usage && usage.total > 0 ? usage.total : estimateTokens(result2) + estimateTokens(prompt);
        if (usage) {
          shared.tokenUsage.input += usage.input;
          shared.tokenUsage.output += usage.output;
          shared.tokenUsage.cost += usage.cost;
          shared.tokenUsage.cacheRead += usage.cacheRead;
          shared.tokenUsage.cacheWrite += usage.cacheWrite;
        }
        shared.tokenUsage.total += tokens;
        shared.spent += tokens;
        return tokens;
      };
      try {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          usage = void 0;
          const externalSignal = options.signal;
          let onExternalAbort;
          let onRunFatal;
          try {
            throwIfAborted();
            if (batch?.cancelled) throw agentLimitError();
            const agentController = new AbortController();
            if (isAborted()) {
              agentController.abort();
            } else {
              if (externalSignal) {
                onExternalAbort = () => agentController.abort();
                externalSignal.addEventListener("abort", onExternalAbort, { once: true });
              }
              onRunFatal = () => agentController.abort();
              shared.runFatalController.signal.addEventListener("abort", onRunFatal, { once: true });
            }
            const runPromise = agentRunner.run(prompt, {
              label,
              // Identifiable name for persisted sessions (persistAgentSessions).
              sessionName: `workflow:${runId} ${label}`,
              schema: agentOptions.schema,
              signal: agentController.signal,
              instructions: buildAgentInstructions(assignedPhase, agentOptions, agentDef, resolvedIsolation),
              model: modelSpec,
              tier: agentOptions.tier,
              modelRegistry: options.modelRegistry,
              toolNames: agentDef?.tools,
              disallowedToolNames: agentDef?.disallowedTools,
              // Per-agent store tools track this agent's writes by the
              // run-unique deltaKey so the delta can be journaled and replayed
              // correctly on resume, even when a nested workflow() run shares
              // this store concurrently with the parent run.
              systemTools: createAgentStoreTools(store, deltaKey),
              cwd: runCwd,
              onModelResolved: (id) => {
                displayModel = id;
              },
              onModelFallback: ({ tier, requestedSpec }) => {
                log(`default "${tier}" tier model "${requestedSpec}" unavailable \u2014 using the session default`);
              },
              onUsage: (u) => {
                usage = u;
              },
              onHistory: (history) => {
                options.onAgentHistory?.({ id: deltaKey, label, phase: assignedPhase, history });
              }
            });
            runPromise.catch(() => {
            });
            const result2 = await withTimeout(runPromise, timeout, label, () => agentController.abort());
            throwIfAborted();
            if (isEmptyTextAgentResult(result2, agentOptions.schema)) {
              throw new WorkflowError("Subagent produced no assistant output", "AGENT_EMPTY_OUTPUT" /* AGENT_EMPTY_OUTPUT */, {
                recoverable: true,
                agentLabel: label
              });
            }
            const tokens = recordTokens(result2);
            options.onAgentJournal?.({
              index: callIndex,
              runId,
              hash: callHash,
              result: result2,
              storeDelta: store.commitDelta(deltaKey)
            });
            options.onAgentEnd?.({
              id: deltaKey,
              label,
              phase: assignedPhase,
              result: result2,
              tokens,
              tokenUsage: usage,
              worktree: runCwd,
              model: displayModel
            });
            return result2;
          } catch (error) {
            if (isAborted()) throw error;
            const workflowError = wrapError(error, { agentLabel: label });
            logger.error(`agent ${label} attempt ${attempt}/${maxAttempts} failed: ${workflowError.message}`);
            const tokens = recordTokens(null);
            store.discardDelta(deltaKey);
            if (workflowError.recoverable && attempt < maxAttempts) {
              log(
                `agent "${label}" attempt ${attempt}/${maxAttempts} failed: ${workflowError.code} ${workflowError.message}; retrying`
              );
              options.onRetrySpend?.(tokens);
              continue;
            }
            options.onAgentEnd?.({
              id: deltaKey,
              label,
              phase: assignedPhase,
              result: null,
              tokens,
              tokenUsage: usage,
              worktree: runCwd,
              model: displayModel,
              error: workflowError.message,
              errorCode: workflowError.code,
              recoverable: workflowError.recoverable
            });
            if (workflowError.recoverable) {
              log(
                `agent "${label}" exhausted ${maxAttempts} attempt${maxAttempts === 1 ? "" : "s"}: ${workflowError.code} ${workflowError.message}`
              );
              return null;
            }
            throw workflowError;
          } finally {
            if (onExternalAbort) externalSignal?.removeEventListener("abort", onExternalAbort);
            if (onRunFatal) shared.runFatalController.signal.removeEventListener("abort", onRunFatal);
          }
        }
        return null;
      } finally {
        if (worktree?.isolated) await removeWorktree(worktree);
      }
    });
  };
  const parallel = async (thunks) => {
    throwIfAborted();
    if (!Array.isArray(thunks)) throw new TypeError("parallel() expects an array of functions");
    if (thunks.some((thunk) => typeof thunk !== "function")) {
      throw new TypeError("parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)");
    }
    const batch = { cancelled: false };
    return fanoutScope.run(
      batch,
      () => Promise.all(
        thunks.map(async (thunk, index) => {
          try {
            return await thunk();
          } catch (error) {
            if (isAborted()) throw error;
            const workflowError = wrapError(error);
            if (!workflowError.recoverable) {
              if (workflowError.code === "AGENT_LIMIT_EXCEEDED" /* AGENT_LIMIT_EXCEEDED */) batch.cancelled = true;
              throw workflowError;
            }
            log(`parallel[${index}] failed: ${workflowError.message}`);
            return null;
          }
        })
      )
    );
  };
  const pipeline = async (items, ...stages) => {
    throwIfAborted();
    if (!Array.isArray(items)) throw new TypeError("pipeline() expects an array as the first argument");
    if (stages.some((stage) => typeof stage !== "function")) {
      throw new TypeError("pipeline() stages must be functions: pipeline(items, item => ..., result => ...)");
    }
    const batch = { cancelled: false };
    return fanoutScope.run(
      batch,
      () => Promise.all(
        items.map(async (item, index) => {
          let value = item;
          for (const stage of stages) {
            try {
              throwIfAborted();
              value = await stage(value, item, index);
              throwIfAborted();
            } catch (error) {
              if (isAborted()) throw error;
              const workflowError = wrapError(error);
              if (!workflowError.recoverable) {
                if (workflowError.code === "AGENT_LIMIT_EXCEEDED" /* AGENT_LIMIT_EXCEEDED */) batch.cancelled = true;
                throw workflowError;
              }
              log(`pipeline[${index}] failed: ${workflowError.message}`);
              return null;
            }
          }
          return value;
        })
      )
    );
  };
  const workflowFn = async (nameOrScript, childArgs) => {
    throwIfAborted();
    if (shared.depth >= 1) {
      throw new WorkflowError("workflow() can nest only one level deep", "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */, {
        recoverable: false
      });
    }
    const resolved = options.loadSavedWorkflow?.(String(nameOrScript));
    const childScript = resolved ?? String(nameOrScript);
    const workflowName = String(nameOrScript);
    options.onRuntimeEvent?.({ type: "workflow", stage: "start", name: workflowName, args: childArgs });
    shared.depth++;
    try {
      const prefixIntact = state.firstMiss === Number.POSITIVE_INFINITY;
      const child = await runWorkflow(childScript, {
        ...options,
        args: childArgs,
        sharedRuntime: shared,
        // Propagate the parent's store so nested agents share the same key-value space.
        sharedStore: store,
        resumeJournal: prefixIntact ? options.resumeJournal : void 0,
        resumeFromRunId: void 0,
        // shared.nestedCallSeq, not shared.depth — see its doc comment: depth
        // returns to 0 between sequential sibling calls, which would otherwise
        // mint the same child runId (and hence colliding deltaKeys/event ids)
        // for two different children.
        runId: `${runId}-nested${++shared.nestedCallSeq}`,
        persistLogs: false
      });
      return child.result;
    } finally {
      shared.depth--;
      options.onRuntimeEvent?.({ type: "workflow", stage: "end", name: workflowName, args: childArgs });
    }
  };
  const VERIFY_SCHEMA = {
    type: "object",
    properties: { real: { type: "boolean" }, reason: { type: "string" } },
    required: ["real"]
  };
  const verify = async (item, opts = {}) => {
    options.onRuntimeEvent?.({ type: "quality", stage: "start", helper: "verify" });
    const reviewers = Math.max(1, opts.reviewers ?? 2);
    const threshold = opts.threshold ?? 0.5;
    const lenses = opts.lens ? Array.isArray(opts.lens) ? opts.lens : [opts.lens] : [];
    const claim = typeof item === "string" ? item : JSON.stringify(item);
    const votes = (await parallel(
      Array.from(
        { length: reviewers },
        (_v, i) => () => agent(
          `Adversarially review whether the following is REAL/correct. Try to refute it; default to real=false if unsure.${lenses.length ? ` Focus lens: ${lenses[i % lenses.length]}.` : ""}

${claim}`,
          { label: `verify ${i + 1}`, schema: VERIFY_SCHEMA }
        )
      )
    )).filter(Boolean);
    const realCount = votes.filter((v) => v?.real).length;
    const verdict = {
      real: votes.length > 0 && realCount / votes.length >= threshold,
      realCount,
      total: votes.length,
      votes
    };
    options.onRuntimeEvent?.({ type: "quality", stage: "end", helper: "verify" });
    return verdict;
  };
  const JUDGE_SCHEMA = {
    type: "object",
    properties: { score: { type: "number" }, reason: { type: "string" } },
    required: ["score"]
  };
  const judgePanel = async (attempts, opts = {}) => {
    options.onRuntimeEvent?.({ type: "quality", stage: "start", helper: "judgePanel" });
    const judges = Math.max(1, opts.judges ?? 3);
    const rubric = opts.rubric ?? "overall quality and correctness";
    const scored = (await parallel(
      (Array.isArray(attempts) ? attempts : []).map((att, idx) => async () => {
        const text = typeof att === "string" ? att : JSON.stringify(att);
        const js = (await parallel(
          Array.from(
            { length: judges },
            (_v, j) => () => agent(
              `Score this candidate from 0 to 1 on: ${rubric}. Reply with the score.

Candidate:
${text}`,
              {
                label: `judge ${idx + 1}.${j + 1}`,
                schema: JUDGE_SCHEMA
              }
            )
          )
        )).filter(Boolean);
        const score = js.length ? js.reduce((s, v) => s + (Number(v?.score) || 0), 0) / js.length : 0;
        return { index: idx, attempt: att, score, judgments: js };
      })
    )).filter(Boolean);
    let best = scored[0];
    for (const s of scored) if (s.score > best.score || s.score === best.score && s.index < best.index) best = s;
    options.onRuntimeEvent?.({ type: "quality", stage: "end", helper: "judgePanel" });
    return best;
  };
  const loopUntilDry = async (opts) => {
    if (!opts || typeof opts.round !== "function")
      throw new TypeError("loopUntilDry requires { round: (i) => items[] }");
    const key = opts.key ?? ((x) => JSON.stringify(x));
    const consecutiveEmpty = Math.max(1, opts.consecutiveEmpty ?? 2);
    const maxRounds = opts.maxRounds ?? 50;
    const seen = /* @__PURE__ */ new Set();
    const all = [];
    let dry = 0;
    for (let r = 0; r < maxRounds && dry < consecutiveEmpty; r++) {
      let items;
      try {
        items = await opts.round(r) ?? [];
      } catch (error) {
        const code = error?.code;
        if (code === "TOKEN_BUDGET_EXHAUSTED" /* TOKEN_BUDGET_EXHAUSTED */ || code === "AGENT_LIMIT_EXCEEDED" /* AGENT_LIMIT_EXCEEDED */) break;
        throw error;
      }
      const fresh = (Array.isArray(items) ? items : []).filter((x) => x != null && !seen.has(key(x)));
      if (!fresh.length) {
        dry++;
        continue;
      }
      dry = 0;
      for (const x of fresh) {
        seen.add(key(x));
        all.push(x);
      }
    }
    return all;
  };
  const COMPLETENESS_SCHEMA = {
    type: "object",
    properties: { complete: { type: "boolean" }, missing: { type: "array", items: { type: "string" } } },
    required: ["complete"]
  };
  const completenessCheck = async (taskArgs, results) => {
    options.onRuntimeEvent?.({ type: "quality", stage: "start", helper: "completenessCheck" });
    const verdict = await agent(
      `Given the task and the results gathered so far, list what is still MISSING (modalities not covered, claims unverified, gaps). Be specific and concise.

Task:
${JSON.stringify(taskArgs)}

Results so far:
${JSON.stringify(results).slice(0, 4e3)}`,
      { label: "completeness critic", schema: COMPLETENESS_SCHEMA }
    );
    options.onRuntimeEvent?.({ type: "quality", stage: "end", helper: "completenessCheck" });
    return verdict;
  };
  const retry = async (thunk, opts = {}) => {
    const attempts = Math.max(1, opts.attempts ?? 3);
    let last;
    for (let i = 0; i < attempts; i++) {
      last = await thunk(i);
      const accepted = !opts.until || opts.until(last);
      options.onRuntimeEvent?.({ type: "control-attempt", helper: "retry", attempt: i + 1, accepted });
      if (accepted) return last;
    }
    return last;
  };
  const gate = async (thunk, validator, opts = {}) => {
    const attempts = Math.max(1, opts.attempts ?? 3);
    let feedback;
    let last;
    for (let i = 0; i < attempts; i++) {
      last = await thunk(feedback, i);
      const verdict = await validator(last);
      const accepted = Boolean(verdict?.ok);
      options.onRuntimeEvent?.({ type: "control-attempt", helper: "gate", attempt: i + 1, accepted });
      if (accepted) return { ok: true, value: last, attempts: i + 1 };
      feedback = verdict?.feedback;
    }
    return { ok: false, value: last, attempts };
  };
  const checkpoint = async (promptText, checkpointOptions = {}) => {
    throwIfAborted();
    if (typeof promptText !== "string") throw new TypeError("checkpoint(promptText, options?) needs a prompt string");
    if (shared.agentCount >= maxAgents) {
      throw agentLimitError();
    }
    const callIndex = state.callSeq++;
    const callHash = hashCheckpoint(promptText, checkpointOptions);
    const journalKey = `${runId}:${callIndex}`;
    const cached = options.resumeJournal?.get(journalKey);
    if (cached != null && cached.hash === callHash && callIndex < state.firstMiss) {
      shared.agentCount++;
      return cached.result;
    }
    if (cached == null || cached.hash !== callHash) state.firstMiss = Math.min(state.firstMiss, callIndex);
    shared.agentCount++;
    let reply;
    if (options.confirm) {
      reply = await options.confirm(promptText, checkpointOptions);
    } else if (checkpointOptions.headless === "abort") {
      throw new WorkflowError(
        `checkpoint "${promptText}" needs human input but none is available (headless run)`,
        "WORKFLOW_ABORTED" /* WORKFLOW_ABORTED */,
        { recoverable: false }
      );
    } else {
      reply = checkpointOptions.default ?? true;
    }
    throwIfAborted();
    options.onAgentJournal?.({ index: callIndex, runId, hash: callHash, result: reply });
    return reply;
  };
  const runtimeImplementations = {
    agent,
    parallel,
    pipeline,
    workflow: workflowFn,
    verify,
    judgePanel,
    loopUntilDry,
    completenessCheck,
    retry,
    gate,
    checkpoint,
    log,
    phase,
    args: options.args,
    cwd: options.cwd ?? process.cwd(),
    process: Object.freeze({ cwd: () => options.cwd ?? process.cwd() }),
    budget,
    console: {
      log,
      info: log,
      warn: (m) => log(`[warn] ${String(m)}`),
      error: (m) => log(`[error] ${String(m)}`)
    }
  };
  const { globals: projectGlobals, diagnostics: bindingDiagnostics } = WORKFLOW_CAPABILITY_CONTRACT.assembleRuntimeBindings(runtimeImplementations);
  for (const diagnostic of bindingDiagnostics) logger.warn(diagnostic.message);
  const context = vm.createContext({
    ...projectGlobals
    // Object/Array/JSON/Math/Date/Promise/Set/Map/etc. come from the vm realm
    // itself — we deliberately do NOT inject host built-ins, whose .constructor
    // would be the host Function (a determinism-guard bypass). Math/Date are
    // neutered in-realm by DETERMINISM_PRELUDE below.
  });
  const wrapped = `${DETERMINISM_PRELUDE}
(async () => {
${body}
})()`;
  try {
    const result2 = await new vm.Script(wrapped, { filename: `${meta.name || "workflow"}.js` }).runInContext(context);
    const logFile = logger.persist();
    if (logFile) {
      log(`Logs persisted to ${logFile}`);
    }
    options.onTokenUsage?.(shared.tokenUsage);
    return {
      meta,
      result: result2,
      logs: state.logs,
      phases: state.phases,
      agentCount: shared.agentCount,
      durationMs: Date.now() - started,
      runId,
      tokenUsage: shared.tokenUsage
    };
  } catch (error) {
    if (isTopLevelRun) shared.runFatalController.abort();
    throw error;
  } finally {
    if (isTopLevelRun) {
      if (shared.inFlight.size > 0) {
        log(`waiting for ${shared.inFlight.size} outstanding agent() call(s) to settle before this run completes`);
      }
      while (shared.inFlight.size > 0) {
        await Promise.allSettled(Array.from(shared.inFlight));
      }
      store.dispose();
    }
  }
}
function parseWorkflowScript(script) {
  if (DETERMINISM_BLOCKLIST.test(script)) {
    throw new WorkflowError(
      "Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable",
      "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */,
      { recoverable: false }
    );
  }
  const ast = parse(script, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    ranges: false
  });
  const first = ast.body?.[0];
  if (first?.type !== "ExportNamedDeclaration") {
    throw new WorkflowError(
      "`export const meta = { name, description, phases }` must be the first statement in the script",
      "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */,
      { recoverable: false }
    );
  }
  const declaration = first.declaration;
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") {
    throw new WorkflowError(
      "meta export must be `export const meta = ...`",
      "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */,
      {
        recoverable: false
      }
    );
  }
  if (declaration.declarations.length !== 1) {
    throw new WorkflowError("meta export must declare only `meta`", "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */, {
      recoverable: false
    });
  }
  const declarator = declaration.declarations[0];
  if (declarator.id?.type !== "Identifier" || declarator.id.name !== "meta") {
    throw new WorkflowError("meta export must declare `meta`", "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */, {
      recoverable: false
    });
  }
  if (!declarator.init)
    throw new WorkflowError("meta must have a literal value", "SCRIPT_VALIDATION_ERROR" /* SCRIPT_VALIDATION_ERROR */, {
      recoverable: false
    });
  const meta = evaluateLiteral(declarator.init, "meta");
  validateMeta(meta);
  return {
    meta,
    body: script.slice(0, first.start) + script.slice(first.end)
  };
}
function evaluateLiteral(node, path) {
  switch (node.type) {
    case "ObjectExpression": {
      const out = {};
      for (const prop of node.properties) {
        if (prop.type === "SpreadElement") throw new Error(`spread not allowed in ${path}`);
        if (prop.type !== "Property") throw new Error(`only plain properties allowed in ${path}`);
        if (prop.computed) throw new Error(`computed keys not allowed in ${path}`);
        if (prop.kind !== "init" || prop.method) throw new Error(`methods/accessors not allowed in ${path}`);
        const key = propertyKey(prop.key, path);
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          throw new Error(`reserved key name not allowed in ${path}: ${key}`);
        }
        out[key] = evaluateLiteral(prop.value, `${path}.${key}`);
      }
      return out;
    }
    case "ArrayExpression":
      return node.elements.map((element, index) => {
        if (!element) throw new Error(`sparse arrays not allowed in ${path}`);
        if (element.type === "SpreadElement") throw new Error(`spread not allowed in ${path}`);
        return evaluateLiteral(element, `${path}[${index}]`);
      });
    case "Literal":
      return node.value;
    case "TemplateLiteral":
      if (node.expressions.length > 0) throw new Error(`template interpolation not allowed in ${path}`);
      return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
    case "UnaryExpression":
      if (node.operator === "-" && node.argument?.type === "Literal" && typeof node.argument.value === "number") {
        return -node.argument.value;
      }
      throw new Error(`only negative-number unary allowed in ${path}`);
    default:
      throw new Error(`non-literal node type in ${path}: ${node.type}`);
  }
}
function propertyKey(node, path) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "Literal" && (typeof node.value === "string" || typeof node.value === "number"))
    return String(node.value);
  throw new Error(`unsupported key type in ${path}: ${node.type}`);
}
function validateMeta(meta) {
  if (!meta || typeof meta !== "object") throw new Error("meta must be an object");
  const value = meta;
  if (typeof value.name !== "string" || !value.name.trim()) throw new Error("meta.name must be a non-empty string");
  if (typeof value.description !== "string" || !value.description.trim())
    throw new Error("meta.description must be a non-empty string");
  if (value.model !== void 0 && typeof value.model !== "string") throw new Error("meta.model must be a string");
  if (value.phases !== void 0) {
    if (!Array.isArray(value.phases)) throw new Error("meta.phases must be an array");
    for (const phase of value.phases) {
      if (!phase || typeof phase !== "object" || typeof phase.title !== "string") {
        throw new Error("each meta phase must have a title string");
      }
    }
  }
}
function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return async (fn) => {
    if (active >= limit) await new Promise((resolve4) => queue.push(resolve4));
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}
function defaultAgentLabel(phase, index) {
  return phase ? `${phase} agent ${index}` : `agent ${index}`;
}
function hashCheckpoint(promptText, options) {
  const identity = JSON.stringify({
    promptText,
    kind: options.kind ?? "confirm",
    choices: options.choices ?? null,
    default: options.default ?? null,
    headless: options.headless ?? "default",
    timeoutMs: options.timeoutMs ?? null
  });
  return createHash2("sha256").update(identity).digest("hex");
}
function hashAgentCall(prompt, model, phase, options, agentDefKey) {
  const identity = JSON.stringify({
    prompt,
    model: model ?? null,
    tier: options.tier ?? null,
    phase: phase ?? null,
    agentType: options.agentType ?? null,
    // Resolved definition (tools/model/prompt) so editing an agent .md invalidates
    // this call's cached result on a later resume.
    agentDef: agentDefKey,
    schema: options.schema ?? null
  });
  return createHash2("sha256").update(identity).digest("hex");
}
function buildAgentInstructions(phase, options, def, resolvedIsolation) {
  const lines = [];
  if (def?.prompt) lines.push(def.prompt);
  else if (options.agentType) lines.push(`Act as workflow subagent type: ${options.agentType}`);
  if (phase) lines.push(`Workflow phase: ${phase}`);
  if (resolvedIsolation) lines.push(`Requested isolation: ${resolvedIsolation}`);
  return lines.length ? lines.join("\n\n") : void 0;
}
function isEmptyTextAgentResult(result2, schema) {
  return schema === void 0 && typeof result2 === "string" && result2.trim().length === 0;
}
function estimateTokens(value) {
  return Math.ceil(JSON.stringify(value ?? "").length / 4);
}
function normalizeConcurrency(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 1;
  return Math.min(MAX_CONCURRENCY, Math.floor(value));
}
function normalizeAgentRetries(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_AGENT_RETRIES, Math.floor(value));
}
async function withTimeout(promise, ms, label, onTimeout) {
  if (ms === null) return promise;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      try {
        onTimeout?.();
      } catch {
      }
      reject(
        new WorkflowError(
          `Agent "${label}" timed out after ${ms}ms; raise or omit timeoutMs/agentTimeoutMs to allow longer runs`,
          "AGENT_TIMEOUT" /* AGENT_TIMEOUT */,
          { recoverable: true }
        )
      );
    }, ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// src/saved-commands.ts
function isRegistered(pi, name) {
  try {
    return (pi.getCommands?.() ?? []).some((c) => c.name === name);
  } catch {
    return false;
  }
}
function reportText(result2) {
  const r = result2.result;
  if (r && typeof r.report === "string" && r.report.trim()) return r.report;
  return JSON.stringify(result2.result, null, 2);
}
function parseCommandArgs(raw, parameters) {
  const out = {};
  const positional = [];
  for (const tok of raw.trim().split(/\s+/).filter(Boolean)) {
    const eq = tok.indexOf("=");
    if (eq > 0) out[tok.slice(0, eq)] = tok.slice(eq + 1);
    else positional.push(tok);
  }
  out._ = positional.join(" ");
  out._raw = raw.trim();
  for (const [key, spec] of Object.entries(parameters ?? {})) {
    if (out[key] === void 0 && spec.default !== void 0) out[key] = spec.default;
  }
  return out;
}
function registerSavedWorkflow(pi, cwd, wf, manager, exists, loadWorkflow) {
  if (isRegistered(pi, wf.name)) return;
  const getCwd = typeof cwd === "function" ? cwd : () => cwd;
  const getManager = typeof manager === "function" ? manager : () => manager;
  pi.registerCommand(wf.name, {
    description: wf.description || `Saved workflow: ${wf.name}`,
    async handler(args, ctx) {
      const liveWf = loadWorkflow ? loadWorkflow() : exists && !exists() ? null : wf;
      if (!liveWf) {
        ctx.ui.notify(
          `/${wf.name} is not available in this project \u2014 reload the session to drop the stale command.`,
          "warning"
        );
        return;
      }
      try {
        const liveManager = getManager();
        if (liveManager) {
          const { runId } = liveManager.startInBackground(liveWf.script, parseCommandArgs(args, liveWf.parameters));
          ctx.ui.notify(
            `/${liveWf.name} running in the background (${runId}) \u2014 watch the task panel or /workflows; the result is posted here when it finishes.`,
            "info"
          );
          return;
        }
        const liveCwd = getCwd();
        ctx.ui.notify(`Starting /${liveWf.name}\u2026`, "info");
        const result2 = await runWorkflow(liveWf.script, {
          cwd: liveCwd,
          args: parseCommandArgs(args, liveWf.parameters),
          tools: createCodingTools2(liveCwd),
          onPhase: (title) => ctx.ui.setStatus(`wf:${liveWf.name}`, `${liveWf.name}: ${title}`)
        });
        ctx.ui.setStatus(`wf:${liveWf.name}`, void 0);
        await pi.sendMessage({
          customType: `workflow:${liveWf.name}`,
          content: reportText(result2),
          display: true
        });
      } catch (error) {
        ctx.ui.setStatus(`wf:${liveWf.name}`, void 0);
        ctx.ui.notify(`/${liveWf.name} failed: ${error instanceof Error ? error.message : error}`, "error");
      }
    }
  });
}
function registerAllSavedWorkflows(pi, cwd, storage, manager) {
  const getStorage = typeof storage === "function" ? storage : () => storage;
  const getCwd = typeof cwd === "function" ? cwd : () => cwd;
  for (const wf of getStorage().list()) {
    const name = wf.name;
    registerSavedWorkflow(
      pi,
      getCwd,
      wf,
      manager,
      () => getStorage().load(name) != null,
      () => getStorage().load(name)
    );
  }
}

// src/workflow-saved.ts
import { join as join7 } from "node:path";

// src/fs-persistence.ts
import {
  existsSync as existsSync3,
  mkdirSync as mkdirSync3,
  readdirSync as readdirSync2,
  readFileSync as readFileSync3,
  renameSync,
  statSync,
  unlinkSync as unlinkSync2,
  writeFileSync as writeFileSync4
} from "node:fs";
function defaultPersistenceFs() {
  return { existsSync: existsSync3, mkdirSync: mkdirSync3, readdirSync: readdirSync2, readFileSync: readFileSync3, renameSync, statSync, unlinkSync: unlinkSync2, writeFileSync: writeFileSync4 };
}
function resolvePersistenceFs(overrides) {
  const base = defaultPersistenceFs();
  return overrides ? { ...base, ...overrides } : base;
}
function ensureDir(fs, dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
function writeJsonAtomicWithBackup(fs, path, data) {
  const json = JSON.stringify(data, null, 2);
  fs.writeFileSync(`${path}.tmp`, json);
  fs.renameSync(`${path}.tmp`, path);
  try {
    fs.writeFileSync(`${path}.bak`, json);
  } catch {
  }
}
function readJsonWithBackupRecovery(fs, path) {
  for (const candidate of [path, `${path}.bak`]) {
    try {
      if (!fs.existsSync(candidate)) continue;
      return JSON.parse(fs.readFileSync(candidate, "utf-8"));
    } catch {
    }
  }
  return null;
}
function listJsonFilesSafe(fs, dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
}
function unlinkIfExistsSafe(fs, path) {
  try {
    if (fs.existsSync(path)) {
      fs.unlinkSync(path);
      return true;
    }
  } catch {
  }
  return false;
}

// src/workflow-saved.ts
function isSafeSavedWorkflowName(name) {
  return name.length > 0 && name.length <= 128 && name.trim() === name && name !== "." && name !== ".." && !/[/\\\0]/.test(name);
}
function assertSafeSavedWorkflowName(name) {
  if (!isSafeSavedWorkflowName(name)) {
    throw new Error("Saved workflow name must be a non-empty path-safe name without slashes.");
  }
}
function createWorkflowStorage(cwd, fsOverride) {
  const fs = resolvePersistenceFs(fsOverride);
  const paths = workflowProjectPaths(cwd);
  const projectDir = paths.savedDir;
  const legacyProjectDir = paths.legacySavedDir;
  const userDir = workflowUserSavedDir();
  const ensureDir2 = (dir) => ensureDir(fs, dir);
  const workflowPath = (name, location) => {
    assertSafeSavedWorkflowName(name);
    const dir = location === "project" ? projectDir : userDir;
    return join7(dir, `${name}.json`);
  };
  const legacyProjectWorkflowPath = (name) => {
    assertSafeSavedWorkflowName(name);
    return join7(legacyProjectDir, `${name}.json`);
  };
  const loadFromFile = (path, location) => {
    const data = readJsonWithBackupRecovery(fs, path);
    if (!data || typeof data !== "object" || !isSafeSavedWorkflowName(data.name ?? "")) {
      return null;
    }
    return {
      ...data,
      location,
      path
    };
  };
  return {
    save(workflow, location = "project") {
      assertSafeSavedWorkflowName(workflow.name);
      const dir = location === "project" ? projectDir : userDir;
      ensureDir2(dir);
      const path = workflowPath(workflow.name, location);
      const saved = {
        ...workflow,
        location,
        path,
        savedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeJsonAtomicWithBackup(fs, path, saved);
      return saved;
    },
    load(name) {
      if (!isSafeSavedWorkflowName(name)) return null;
      const projectPath = workflowPath(name, "project");
      const project = loadFromFile(projectPath, "project");
      if (project) return project;
      const legacyProject = loadFromFile(legacyProjectWorkflowPath(name), "project");
      if (legacyProject) return legacyProject;
      const userPath = workflowPath(name, "user");
      return loadFromFile(userPath, "user");
    },
    list() {
      const workflows = [];
      const seen = /* @__PURE__ */ new Set();
      const addDir = (dir, location) => {
        for (const file of listJsonFilesSafe(fs, dir)) {
          const wf = loadFromFile(join7(dir, file), location);
          if (wf && !seen.has(wf.name)) {
            seen.add(wf.name);
            workflows.push(wf);
          }
        }
      };
      addDir(projectDir, "project");
      addDir(legacyProjectDir, "project");
      addDir(userDir, "user");
      return workflows.sort((a, b) => a.name.localeCompare(b.name));
    },
    delete(name, location) {
      if (!isSafeSavedWorkflowName(name)) return false;
      const locations = location ? [location] : ["project", "user"];
      let deleted = false;
      for (const loc of locations) {
        const path = workflowPath(name, loc);
        unlinkIfExistsSafe(fs, `${path}.bak`);
        if (unlinkIfExistsSafe(fs, path)) {
          deleted = true;
        }
        if (loc === "project") {
          const legacyPath = legacyProjectWorkflowPath(name);
          unlinkIfExistsSafe(fs, `${legacyPath}.bak`);
          if (unlinkIfExistsSafe(fs, legacyPath)) {
            deleted = true;
          }
        }
      }
      return deleted;
    }
  };
}

// src/builtin-commands.ts
var COMMAND_ERROR_MAX_CHARS = 32e3;
var AUTO_SCOPE_METADATA_MAX_CHARS = 2e6;
var AUTO_SCOPE_MAX_PATHS = 4096;
var AUTO_SCOPE_MAX_ARG_BYTES = 256 * 1024;
var AUTO_SCOPE_ROOT_RULES = [
  [".playwright-mcp", "browser capture"],
  ["graphify-out", "graph index output"],
  ["supabase/.temp", "tool state"],
  [".code-review-graph", "code index output"],
  [".gitnexus", "code index output"],
  [".codegraph", "code index output"]
];
var AUTO_SCOPE_DIRECTORY_RULES = /* @__PURE__ */ new Map([
  ["node_modules", "dependency output"],
  ["coverage", "coverage output"],
  [".nyc_output", "coverage output"],
  ["__pycache__", "cache output"],
  [".pytest_cache", "cache output"],
  [".mypy_cache", "cache output"],
  [".ruff_cache", "cache output"],
  [".turbo", "cache output"],
  [".cache", "cache output"],
  ["playwright-report", "browser report"],
  ["test-results", "test output"]
]);
function captureCommandPrefix(command, args, options) {
  if (!Number.isSafeInteger(options.maxChars) || options.maxChars < 1) {
    return Promise.reject(new Error("captureCommandPrefix: maxChars must be a positive safe integer"));
  }
  return new Promise((resolve4, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    let stdout = "";
    let totalChars = 0;
    let stderr = "";
    let stderrTruncated = false;
    child.stdout.on("data", (chunk) => {
      totalChars += chunk.length;
      const remaining = options.maxChars - stdout.length;
      if (remaining > 0) stdout += chunk.slice(0, remaining);
    });
    child.stderr.on("data", (chunk) => {
      const remaining = COMMAND_ERROR_MAX_CHARS - stderr.length;
      if (remaining > 0) stderr += chunk.slice(0, remaining);
      if (chunk.length > remaining) stderrTruncated = true;
    });
    child.once("error", reject);
    child.stdout.once("error", reject);
    child.stderr.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve4({ stdout, totalChars });
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      const detail = stderr.trim();
      const truncationNote = stderrTruncated ? " [stderr truncated]" : "";
      reject(new Error(`${command} failed with ${reason}${detail ? `: ${detail}${truncationNote}` : ""}`));
    });
  });
}
function parseDiffNumstat(output) {
  if (output.length === 0) return [];
  if (!output.endsWith("\0")) throw new Error("git numstat output is not NUL-terminated");
  return output.slice(0, -1).split("\0").map((record, index) => {
    const firstTab = record.indexOf("	");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("	", firstTab + 1);
    if (firstTab < 1 || secondTab < firstTab + 2) {
      throw new Error(`git numstat record ${index + 1} is malformed`);
    }
    const addedText = record.slice(0, firstTab);
    const deletedText = record.slice(firstTab + 1, secondTab);
    const path = record.slice(secondTab + 1);
    if (!path || path.includes("\uFFFD")) {
      throw new Error(`git numstat record ${index + 1} has an unsupported path`);
    }
    const binary = addedText === "-" && deletedText === "-";
    if (!binary && (!/^\d+$/.test(addedText) || !/^\d+$/.test(deletedText))) {
      throw new Error(`git numstat record ${index + 1} has invalid line counts`);
    }
    if (!binary && (addedText === "-" || deletedText === "-")) {
      throw new Error(`git numstat record ${index + 1} has inconsistent binary markers`);
    }
    const addedLines = binary ? null : Number.parseInt(addedText, 10);
    const deletedLines = binary ? null : Number.parseInt(deletedText, 10);
    if (addedLines !== null && !Number.isSafeInteger(addedLines) || deletedLines !== null && !Number.isSafeInteger(deletedLines)) {
      throw new Error(`git numstat record ${index + 1} exceeds safe integer limits`);
    }
    return { path, addedLines, deletedLines, binary };
  });
}
function classifyCodeReviewArtifact(path) {
  for (const [prefix, reason] of AUTO_SCOPE_ROOT_RULES) {
    if (path.startsWith(`${prefix}/`)) return reason;
  }
  const segments = path.split("/");
  for (const segment of segments.slice(0, -1)) {
    const reason = AUTO_SCOPE_DIRECTORY_RULES.get(segment);
    if (reason) return reason;
  }
  for (let index = 0; index < segments.length - 2; index += 1) {
    if (segments[index] === "cypress" && ["screenshots", "videos"].includes(segments[index + 1])) {
      return "browser capture";
    }
  }
  const basename3 = segments.at(-1)?.toLowerCase() ?? "";
  if (/\.(?:[cm]?js|css)\.map$/.test(basename3)) return "source map";
  if (/\.(?:min|bundle)\.(?:[cm]?js|css)$/.test(basename3)) return "compiled bundle";
  if (basename3.endsWith(".tsbuildinfo")) return "compiler state";
  if (basename3.includes(".generated.") || basename3.includes(".gen.")) return "generated file";
  return void 0;
}
var BARE_DIFF_HEAD_ARGS = ["diff", "HEAD", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames"];
async function discoverCodeReviewAutoScope(cwd) {
  const metadata = await captureCommandPrefix(
    "git",
    ["diff", "HEAD", "--numstat", "-z", "--no-renames", "--no-ext-diff", "--no-textconv", "--no-color"],
    { cwd, maxChars: AUTO_SCOPE_METADATA_MAX_CHARS }
  );
  if (metadata.totalChars > metadata.stdout.length) {
    throw new Error(`tracked-change metadata exceeds ${AUTO_SCOPE_METADATA_MAX_CHARS.toLocaleString()} characters`);
  }
  const included = [];
  const excluded = [];
  for (const entry of parseDiffNumstat(metadata.stdout)) {
    const reason = classifyCodeReviewArtifact(entry.path);
    if (reason) excluded.push({ ...entry, reason });
    else included.push(entry);
  }
  return { included, excluded };
}
function buildAutoScopedDiffArgs(scope) {
  if (scope.included.length > AUTO_SCOPE_MAX_PATHS) {
    throw new Error(
      `auto-scope selected ${scope.included.length.toLocaleString()} paths (limit ${AUTO_SCOPE_MAX_PATHS})`
    );
  }
  const argBytes = scope.included.reduce((total, entry) => total + Buffer.byteLength(entry.path, "utf8") + 1, 0);
  if (argBytes > AUTO_SCOPE_MAX_ARG_BYTES) {
    throw new Error(
      `auto-scope path arguments use ${argBytes.toLocaleString()} bytes (limit ${AUTO_SCOPE_MAX_ARG_BYTES.toLocaleString()})`
    );
  }
  return ["--literal-pathspecs", ...BARE_DIFF_HEAD_ARGS, "--", ...scope.included.map((entry) => entry.path)];
}
function sumChangedLines(entries) {
  return entries.reduce((total, entry) => total + (entry.addedLines ?? 0) + (entry.deletedLines ?? 0), 0);
}
function formatAutoScopeNotice(scope) {
  const reasons = /* @__PURE__ */ new Map();
  for (const entry of scope.excluded) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1);
  const reasonSummary = [...reasons.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([reason, count]) => `${reason}: ${count}`).join(", ");
  const selectedLines = sumChangedLines(scope.included);
  const skippedLines = sumChangedLines(scope.excluded);
  const skippedBinaries = scope.excluded.filter((entry) => entry.binary).length;
  const binarySummary = skippedBinaries > 0 ? `; ${skippedBinaries.toLocaleString()} binary` : "";
  return `Auto-scope: reviewing ${scope.included.length.toLocaleString()} tracked files (~${selectedLines.toLocaleString()} changed lines); skipped ${scope.excluded.length.toLocaleString()} high-confidence artifacts (~${skippedLines.toLocaleString()} changed lines${binarySummary}). Rules: ${reasonSummary}. Use /code-review <path> to include an artifact explicitly.`;
}
function shortError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}\u2026` : message;
}
function alreadyRegistered(pi, name) {
  try {
    return (pi.getCommands?.() ?? []).some((c) => c.name === name);
  } catch {
    return false;
  }
}
function tokenizeArgs(input) {
  const tokens = [];
  for (const m of input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}
function startBackground(manager, ctx, name, script, args, exec2) {
  try {
    const { runId } = manager.startInBackground(script, args, exec2 ?? {});
    ctx.ui.notify(
      `/${name} running in the background (${runId}) \u2014 watch the task panel or /workflows; the report is posted here when it finishes.`,
      "info"
    );
  } catch (error) {
    ctx.ui.notify(`${name} failed to start: ${error instanceof Error ? error.message : error}`, "error");
  }
}
function requireBuiltin(name) {
  const found = findBuiltinWorkflow(name);
  if (!found) throw new Error(`internal error: no built-in workflow registered for "${name}"`);
  return found;
}
function resolveBuiltinOrNotify(name, cwd, args, ctx) {
  try {
    return requireBuiltin(name).resolve(cwd, args);
  } catch (error) {
    ctx.ui.notify(`/${name}: ${error instanceof Error ? error.message : String(error)}`, "warning");
    return void 0;
  }
}
function registerBuiltinWorkflows(pi, opts) {
  const getManager = () => {
    const m = opts.getManager?.() ?? opts.manager;
    if (!m) throw new Error("registerBuiltinWorkflows: no WorkflowManager");
    return m;
  };
  const getCwd = () => opts.getCwd?.() ?? opts.cwd ?? process.cwd();
  const getStorage = () => opts.getStorage?.() ?? opts.storage ?? createWorkflowStorage(getCwd());
  function runSavedShadowIfPresent(name, rawArgs, ctx) {
    const saved = getStorage().load(name);
    if (!saved) return false;
    startBackground(getManager(), ctx, name, saved.script, parseCommandArgs(rawArgs, saved.parameters));
    return true;
  }
  if (!alreadyRegistered(pi, "adversarial-review")) {
    pi.registerCommand("adversarial-review", {
      description: "Investigate a task, then cross-check each finding with skeptical reviewers",
      async handler(args, ctx) {
        if (runSavedShadowIfPresent("adversarial-review", args, ctx)) return;
        const task = args.trim();
        if (!task) return ctx.ui.notify("Usage: /adversarial-review <task or question>", "warning");
        const resolved = resolveBuiltinOrNotify("adversarial-review", getCwd(), { task }, ctx);
        if (!resolved) return;
        startBackground(getManager(), ctx, "adversarial-review", resolved.script, { task });
      }
    });
  }
  if (!alreadyRegistered(pi, "code-review")) {
    pi.registerCommand("code-review", {
      description: "Multi-angle parallel code review: 7 specialized finders (correctness, reuse, simplification, efficiency, altitude) + verify pass \u2192 ranked findings",
      async handler(args, ctx) {
        if (runSavedShadowIfPresent("code-review", args, ctx)) return;
        const input = args.trim();
        const cwd = getCwd();
        let diffSource = "git diff HEAD";
        let cmd;
        let cmdArgs;
        let autoScope;
        if (!input) {
          try {
            const discovered = await discoverCodeReviewAutoScope(cwd);
            if (discovered.excluded.length > 0 && discovered.included.length === 0) {
              return ctx.ui.notify(
                `Auto-scope skipped all ${discovered.excluded.length.toLocaleString()} tracked changes as high-confidence generated/cache artifacts. Use /code-review <path> to review one explicitly.`,
                "warning"
              );
            }
            if (discovered.excluded.length > 0) {
              cmd = "git";
              cmdArgs = buildAutoScopedDiffArgs(discovered);
              autoScope = discovered;
              diffSource = `git diff HEAD (auto-scope: ${discovered.included.length.toLocaleString()} included, ${discovered.excluded.length.toLocaleString()} artifacts skipped)`;
            } else {
              cmd = "git";
              cmdArgs = [...BARE_DIFF_HEAD_ARGS];
            }
          } catch (error) {
            ctx.ui.notify(
              `Auto-scope unavailable (${shortError(error)}); reviewing the full git diff HEAD without skipping files.`,
              "warning"
            );
            cmd = "git";
            cmdArgs = [...BARE_DIFF_HEAD_ARGS];
          }
        } else if (/^\d+$/.test(input)) {
          diffSource = `gh pr diff ${input}`;
          cmd = "gh";
          cmdArgs = ["pr", "diff", input];
        } else if (input.includes("..")) {
          diffSource = `git diff ${input}`;
          cmd = "git";
          cmdArgs = ["diff", input];
        } else {
          diffSource = `git diff HEAD -- ${input}`;
          cmd = "git";
          cmdArgs = ["diff", "HEAD", "--", input];
        }
        let captured;
        try {
          captured = await captureCommandPrefix(cmd, cmdArgs, {
            cwd,
            maxChars: MAX_DIFF_CHARS
          });
        } catch (error) {
          if (!autoScope) {
            return ctx.ui.notify(`Failed to get diff (${diffSource}): ${shortError(error)}`, "error");
          }
          ctx.ui.notify(
            `Auto-scoped diff failed (${shortError(error)}); retrying the full git diff HEAD without skipping files.`,
            "warning"
          );
          autoScope = void 0;
          diffSource = "git diff HEAD";
          try {
            captured = await captureCommandPrefix("git", [...BARE_DIFF_HEAD_ARGS], {
              cwd,
              maxChars: MAX_DIFF_CHARS
            });
          } catch (fallbackError) {
            return ctx.ui.notify(`Failed to get diff (${diffSource}): ${shortError(fallbackError)}`, "error");
          }
        }
        if (autoScope && !captured.stdout.trim()) {
          ctx.ui.notify(
            "Auto-scoped diff became empty while it was being collected; retrying the full git diff HEAD.",
            "warning"
          );
          autoScope = void 0;
          diffSource = "git diff HEAD";
          try {
            captured = await captureCommandPrefix("git", [...BARE_DIFF_HEAD_ARGS], {
              cwd,
              maxChars: MAX_DIFF_CHARS
            });
          } catch (fallbackError) {
            return ctx.ui.notify(`Failed to get diff (${diffSource}): ${shortError(fallbackError)}`, "error");
          }
        }
        const diff = captured.stdout;
        const originalLength = captured.totalChars;
        if (!diff.trim()) return ctx.ui.notify(`No diff output from: ${diffSource}`, "warning");
        if (autoScope) ctx.ui.notify(formatAutoScopeNotice(autoScope), "info");
        if (originalLength > MAX_DIFF_CHARS) {
          ctx.ui.notify(
            `Diff is ${originalLength.toLocaleString()} characters \u2014 truncated to the first ${MAX_DIFF_CHARS.toLocaleString()} for the review. Findings past the cut are not covered.`,
            "warning"
          );
        }
        const resolved = resolveBuiltinOrNotify("code-review", getCwd(), { diff, diffSource }, ctx);
        if (!resolved) return;
        startBackground(getManager(), ctx, "code-review", resolved.script, { diff, diffSource });
      }
    });
  }
  if (!alreadyRegistered(pi, "multi-perspective")) {
    pi.registerCommand("multi-perspective", {
      description: "Analyze a topic from several independent perspectives in parallel, then synthesize",
      async handler(args, ctx) {
        if (runSavedShadowIfPresent("multi-perspective", args, ctx)) return;
        const [topic, ...rest] = tokenizeArgs(args);
        if (!topic) {
          return ctx.ui.notify('Usage: /multi-perspective "<topic>" [perspective1] [perspective2] \u2026', "warning");
        }
        const resolved = resolveBuiltinOrNotify("multi-perspective", getCwd(), { topic, perspectives: rest }, ctx);
        if (!resolved) return;
        startBackground(getManager(), ctx, "multi-perspective", resolved.script);
      }
    });
  }
  if (!alreadyRegistered(pi, "codebase-audit")) {
    pi.registerCommand("codebase-audit", {
      description: "Run parallel checks against a codebase scope, then cross-validate and report",
      async handler(args, ctx) {
        if (runSavedShadowIfPresent("codebase-audit", args, ctx)) return;
        const [scope, ...checks] = tokenizeArgs(args);
        if (!scope || checks.length === 0) {
          return ctx.ui.notify('Usage: /codebase-audit <scope> "<check1>" ["<check2>" \u2026]', "warning");
        }
        const resolved = resolveBuiltinOrNotify("codebase-audit", getCwd(), { scope, checks }, ctx);
        if (!resolved) return;
        startBackground(getManager(), ctx, "codebase-audit", resolved.script);
      }
    });
  }
}

// src/display.ts
function tokenFigures(usage, scalarTokens) {
  const cacheRead = usage?.cacheRead ?? 0;
  const reported = (usage?.input ?? 0) + (usage?.output ?? 0) + (usage?.cacheWrite ?? 0);
  const estimate = Math.max(scalarTokens ?? 0, usage?.total ?? 0);
  return { fresh: Math.max(reported, estimate - cacheRead), cacheRead };
}
function aggregateAgentUsage(agents) {
  let fresh = 0;
  let cacheRead = 0;
  for (const a of agents) {
    const f = tokenFigures(a.tokenUsage, a.tokens);
    fresh += f.fresh;
    cacheRead += f.cacheRead;
  }
  return { fresh, cacheRead };
}
function fmtTokenCount(fresh, cacheRead, fmt) {
  const f = fmt(fresh) || "0";
  return cacheRead > 0 ? `${f} tok \xB7 ${fmt(cacheRead)} cached` : `${f} tok`;
}
function fmtTokenSegment(figures, fmt) {
  return figures.fresh + figures.cacheRead > 0 ? fmtTokenCount(figures.fresh, figures.cacheRead, fmt) : "";
}
function fmtCost(cost) {
  if (cost > 0 && cost < 1e-4) return "<$0.0001";
  return `$${cost.toFixed(cost >= 0.01 ? 2 : 4)}`;
}
var fmtFull = (n) => n.toLocaleString();
function createWorkflowSnapshot(meta) {
  return {
    name: meta.name,
    description: meta.description,
    phases: meta.phases?.map((phase) => phase.title) ?? [],
    logs: [],
    agents: [],
    agentCount: 0,
    runningCount: 0,
    doneCount: 0,
    errorCount: 0
  };
}
function recomputeWorkflowSnapshot(snapshot) {
  const runningCount = snapshot.agents.filter((agent) => agent.status === "running").length;
  const doneCount = snapshot.agents.filter((agent) => agent.status === "done").length;
  const errorCount = snapshot.agents.filter((agent) => agent.status === "error").length;
  return { ...snapshot, agentCount: snapshot.agents.length, runningCount, doneCount, errorCount };
}
function createWidgetWorkflowDisplay(ctx, options = {}) {
  const key = options.key ?? "workflow";
  const placement = options.placement ?? "belowEditor";
  const showStatus = options.showStatus ?? false;
  let snapshot;
  let completed = false;
  const widgetFactory = (_tui, theme) => ({
    render: () => snapshot ? renderWorkflowLines(snapshot, options, theme) : [],
    invalidate: () => {
    }
  });
  if (ctx.hasUI) {
    ctx.ui.setWidget(key, widgetFactory, { placement });
  }
  return {
    update(s) {
      snapshot = s;
      if (!ctx.hasUI) return;
      if (showStatus) ctx.ui.setStatus(key, statusLine(s, completed));
      ctx.ui.setWidget(key, widgetFactory, { placement });
    },
    complete(s) {
      snapshot = s;
      completed = true;
      if (!ctx.hasUI) return;
      if (showStatus) ctx.ui.setStatus(key, statusLine(s, true));
      ctx.ui.setWidget(key, widgetFactory, { placement });
    },
    clear() {
      if (!ctx.hasUI) return;
      if (showStatus) ctx.ui.setStatus(key, void 0);
      ctx.ui.setWidget(key, void 0);
    }
  };
}
function createToolUpdateWorkflowDisplay(onUpdate, ctx, options = {}) {
  const widget = ctx ? createWidgetWorkflowDisplay(ctx, options) : void 0;
  const streamToolUpdates = options.streamToolUpdates ?? !ctx?.hasUI;
  const emit = (snapshot, completed = false) => {
    if (streamToolUpdates) {
      onUpdate?.({
        content: [{ type: "text", text: renderWorkflowText(snapshot, completed) }],
        details: snapshot
      });
    }
    if (completed) widget?.complete(snapshot);
    else widget?.update(snapshot);
  };
  return {
    update(snapshot) {
      emit(snapshot, false);
    },
    complete(snapshot) {
      emit(snapshot, true);
    },
    clear() {
      widget?.clear();
    }
  };
}
var NO_THEME = { fg: (_c, t) => t, bold: (t) => t };
function agentTokenCell(agent, theme) {
  const segment = fmtTokenSegment(tokenFigures(agent.tokenUsage, agent.tokens), fmtFull);
  return segment ? theme.fg("dim", ` [${segment}]`) : "";
}
function renderWorkflowLines(snapshot, options = {}, theme = NO_THEME) {
  const maxAgents = options.maxAgents ?? 8;
  const showResultPreviews = options.showResultPreviews ?? false;
  const state = snapshot.errorCount > 0 ? `, ${snapshot.errorCount} errors` : snapshot.runningCount > 0 ? `, ${snapshot.runningCount} running` : "";
  const usage = snapshot.tokenUsage;
  const costInfo = usage?.cost ? ` \xB7 ${fmtCost(usage.cost)}` : "";
  const segment = fmtTokenSegment(tokenFigures(usage), fmtFull);
  const tokenInfo = `${segment ? ` \xB7 ${segment}` : ""}${costInfo}`;
  const lines = [
    `${theme.bold(`\u25C6 Workflow: ${snapshot.name}`)} (${snapshot.doneCount}/${snapshot.agentCount} done${state}${tokenInfo})`
  ];
  const phaseNames = snapshot.phases.length ? snapshot.phases : unique(snapshot.agents.map((agent) => agent.phase).filter(Boolean));
  const rendered = /* @__PURE__ */ new Set();
  for (const phase of phaseNames) {
    const agents = snapshot.agents.filter((agent) => agent.phase === phase);
    for (const agent of agents) rendered.add(agent);
    const done = agents.filter((agent) => agent.status === "done").length;
    const running = agents.filter((agent) => agent.status === "running").length;
    const errors = agents.filter((agent) => agent.status === "error").length;
    const skipped = agents.filter((agent) => agent.status === "skipped").length;
    const complete = agents.length > 0 && done + errors + skipped === agents.length;
    const marker = running > 0 || !complete && snapshot.currentPhase === phase ? "\u25B6" : complete ? "\u2713" : " ";
    lines.push(
      theme.fg("accent", `  ${marker} ${phase}`) + theme.fg(
        "dim",
        ` ${done}/${agents.length}${running ? ` \xB7 ${running} running` : ""}${errors ? ` \xB7 ${errors} errors` : ""}${skipped ? ` \xB7 ${skipped} skipped` : ""}`
      )
    );
    const visibleAgents = agents.slice(-maxAgents);
    for (const agent of visibleAgents) {
      const order = `[${agent.id}]`;
      const result2 = showResultPreviews && agent.resultPreview ? ` \u2014 ${agent.resultPreview}` : "";
      lines.push(
        `    ${order} ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${agentTokenCell(agent, theme)}${result2}`
      );
    }
    if (agents.length > visibleAgents.length)
      lines.push(theme.fg("dim", `    \u2026 ${agents.length - visibleAgents.length} earlier agents`));
  }
  const unphased = snapshot.agents.filter((agent) => !rendered.has(agent));
  if (unphased.length) {
    lines.push(theme.fg("accent", "  Unphased"));
    for (const agent of unphased.slice(-maxAgents)) {
      const result2 = showResultPreviews && agent.resultPreview ? ` \u2014 ${agent.resultPreview}` : "";
      lines.push(
        `    [${agent.id}] ${statusIcon(agent.status)} ${shorten(agent.label, 48)}${agentTokenCell(agent, theme)}${result2}`
      );
    }
  }
  return lines;
}
function renderWorkflowText(snapshot, completed = false) {
  const header = completed ? "Workflow completed" : "Workflow running";
  return [header, ...renderWorkflowLines(snapshot)].join("\n");
}
function statusLine(snapshot, completed) {
  if (completed) return `workflow \u2713 ${snapshot.name}: ${snapshot.doneCount}/${snapshot.agentCount}`;
  if (snapshot.runningCount > 0)
    return `workflow ${snapshot.name}: ${snapshot.runningCount} running, ${snapshot.doneCount}/${snapshot.agentCount} done`;
  return `workflow ${snapshot.name}: ${snapshot.doneCount}/${snapshot.agentCount} done`;
}
function statusIcon(status) {
  switch (status) {
    case "queued":
      return "\u25CB";
    case "running":
      return "\u25CF";
    case "done":
      return "\u2713";
    case "error":
      return "\u2717";
    case "skipped":
      return "-";
  }
}
function unique(values) {
  return [...new Set(values)];
}
function shorten(value, max) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}
function preview(value, max = 80) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;
}

// src/effort-command.ts
function createEffortState() {
  return { level: "off" };
}
var HIGH_DIRECTIVE = "Effort: HIGH. Be thorough \u2014 use a few parallel reviewers/perspectives and an adversarial verify pass (see verify()/judgePanel()); set maxAgents to match the planned fan-out.";
var ULTRA_DIRECTIVE = "Effort: ULTRA. Be exhaustive \u2014 fan out widely (more reviewers/judges, deeper loopUntilDry rounds, a completenessCheck at the end), prefer the big tier for synthesis, and set a high maxAgents that matches the planned fan-out. This can spend a lot of tokens quickly; maximal effort does not imply an inferred spend ceiling.";
function effortDirective(level) {
  if (level === "high") return HIGH_DIRECTIVE;
  if (level === "ultra") return ULTRA_DIRECTIVE;
  return void 0;
}
function isSubstantive(text) {
  const t = text.trim();
  return t.length >= 16 && !t.startsWith("/");
}
function registerEffortCommand(pi, state) {
  pi.registerCommand("effort", {
    description: "Standing workflow effort: off | high | ultra \u2014 auto-arms a workflow for substantive messages",
    async handler(args, _ctx) {
      const arg = args.trim().toLowerCase();
      const say = (content) => pi.sendMessage({ customType: "effort", content, display: true });
      if (arg === "off" || arg === "high" || arg === "ultra") {
        state.level = arg;
        await say(
          arg === "off" ? "Effort off \u2014 messages are no longer auto-armed as workflows." : `Effort ${arg} \u2014 substantive messages now auto-arm a workflow (${arg === "ultra" ? "exhaustive" : "thorough"} fan-out). Use /effort off to stop.`
        );
        return;
      }
      await say(`Effort is currently "${state.level}". Usage: /effort off | high | ultra`);
    }
  });
  pi.registerCommand("ultracode", {
    description: "Ultracode: standing maximal-effort mode (this session only, never persisted) \u2014 auto-arms an exhaustive workflow for substantive messages. /ultracode off to stop.",
    async handler(args, _ctx) {
      const arg = args.trim().toLowerCase();
      const say = (content) => pi.sendMessage({ customType: "effort", content, display: true });
      if (arg === "off") {
        state.level = "off";
        await say("Ultracode off \u2014 messages are no longer auto-armed as workflows.");
        return;
      }
      state.level = "ultra";
      await say(
        "Ultracode ON \u2014 substantive messages now auto-arm an exhaustive workflow (wide fan-out, big-tier synthesis). Use /ultracode off to stop."
      );
    }
  });
}

// src/run-persistence.ts
import { join as join8 } from "node:path";
var DEFAULT_MAX_TERMINAL_RUNS_ON_DISK = 300;
var TERMINAL_RUN_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "aborted"]);
var LIST_CACHE_TTL_MS = 300;
function createRunPersistence(cwd, fsOverride, options) {
  const fs = resolvePersistenceFs(fsOverride);
  const _existsSync = fs.existsSync;
  const _readFileSync = fs.readFileSync;
  const _statSync = fs.statSync;
  const _unlinkSync = fs.unlinkSync;
  const _writeFileSync = fs.writeFileSync;
  const maxTerminalRunsOnDisk = options?.maxTerminalRunsOnDisk ?? DEFAULT_MAX_TERMINAL_RUNS_ON_DISK;
  const paths = workflowProjectPaths(cwd);
  const runsDir = paths.runsDir;
  const legacyRunsDir = paths.legacyRunsDir;
  const ensureDir2 = () => ensureDir(fs, runsDir);
  const runPath = (dir, runId) => join8(dir, `${runId}.json`);
  const primaryRunPath = (runId) => runPath(runsDir, runId);
  const legacyRunPath = (runId) => runPath(legacyRunsDir, runId);
  const lockPath = (dir, runId) => join8(dir, `${runId}.lock`);
  const primaryLockPath = (runId) => lockPath(runsDir, runId);
  const legacyLockPath = (runId) => lockPath(legacyRunsDir, runId);
  const candidateRunPaths = (runId) => [primaryRunPath(runId), legacyRunPath(runId)];
  const pidIsAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err.code === "EPERM") return true;
      return false;
    }
  };
  const readLockAt = (path) => {
    try {
      return JSON.parse(_readFileSync(path, "utf-8"));
    } catch {
      return null;
    }
  };
  const readLock = (runId) => readLockAt(primaryLockPath(runId));
  let listCache;
  let listCacheAt = 0;
  const invalidateListCache = () => {
    listCache = void 0;
  };
  const fileStateCache = /* @__PURE__ */ new Map();
  const removeStaleLegacyLock = (runId) => {
    const lock = legacyLockPath(runId);
    const existing = readLockAt(lock);
    if (existing?.runId === runId && pidIsAlive(existing.pid)) return false;
    try {
      if (_existsSync(lock)) _unlinkSync(lock);
    } catch {
      return false;
    }
    return true;
  };
  const computeList = () => {
    const byRunId = /* @__PURE__ */ new Map();
    const seenPaths = /* @__PURE__ */ new Set();
    for (const dir of [runsDir, legacyRunsDir]) {
      for (const file of listJsonFilesSafe(fs, dir)) {
        const path = join8(dir, file);
        seenPaths.add(path);
        try {
          const stat = _statSync(path);
          const cached = fileStateCache.get(path);
          if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && cached.ino === stat.ino) {
            if (!byRunId.has(cached.state.runId)) byRunId.set(cached.state.runId, cached.state);
            continue;
          }
          const state = JSON.parse(_readFileSync(path, "utf-8"));
          fileStateCache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, state });
          if (!byRunId.has(state.runId)) byRunId.set(state.runId, state);
        } catch {
          fileStateCache.delete(path);
        }
      }
    }
    for (const path of fileStateCache.keys()) {
      if (!seenPaths.has(path)) fileStateCache.delete(path);
    }
    return [...byRunId.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  };
  const enforceRetention = () => {
    const terminal = computeList().filter((r) => TERMINAL_RUN_STATUSES.has(r.status)).sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    const excess = terminal.length - maxTerminalRunsOnDisk;
    if (excess <= 0) return;
    for (const run of terminal.slice(0, excess)) {
      deleteRunFiles(run.runId);
    }
    invalidateListCache();
  };
  const deleteRunFiles = (runId) => {
    let deleted = false;
    for (const path of candidateRunPaths(runId)) {
      const dir = path === primaryRunPath(runId) ? runsDir : legacyRunsDir;
      for (const sidecar of [`${path}.bak`, `${path}.tmp`, lockPath(dir, runId)]) {
        unlinkIfExistsSafe(fs, sidecar);
        fileStateCache.delete(sidecar);
      }
      if (unlinkIfExistsSafe(fs, path)) deleted = true;
      fileStateCache.delete(path);
    }
    return deleted;
  };
  return {
    save(state) {
      ensureDir2();
      state.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      const path = primaryRunPath(state.runId);
      writeJsonAtomicWithBackup(fs, path, state);
      invalidateListCache();
      if (TERMINAL_RUN_STATUSES.has(state.status)) enforceRetention();
    },
    load(runId) {
      for (const path of candidateRunPaths(runId)) {
        const state = readJsonWithBackupRecovery(fs, path);
        if (state) return state;
      }
      return null;
    },
    list() {
      const now = Date.now();
      if (listCache && now - listCacheAt < LIST_CACHE_TTL_MS) {
        return [...listCache];
      }
      const result2 = computeList();
      listCache = result2;
      listCacheAt = now;
      return [...result2];
    },
    delete(runId) {
      try {
        return deleteRunFiles(runId);
      } finally {
        invalidateListCache();
      }
    },
    acquireRunLease(runId) {
      ensureDir2();
      const path = primaryRunPath(runId);
      const lock = primaryLockPath(runId);
      if (!removeStaleLegacyLock(runId)) return null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = `${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
        const payload = {
          runId,
          runPath: path,
          pid: process.pid,
          startedAt: (/* @__PURE__ */ new Date()).toISOString(),
          token
        };
        try {
          _writeFileSync(lock, JSON.stringify(payload, null, 2), { flag: "wx" });
          return { runId, token };
        } catch (err) {
          const code = err.code;
          if (code !== "EEXIST") throw err;
          const existing = readLock(runId);
          if (existing && existing.runPath === path && pidIsAlive(existing.pid)) {
            return null;
          }
          try {
            _unlinkSync(lock);
          } catch {
            return null;
          }
        }
      }
      return null;
    },
    releaseRunLease(lease) {
      try {
        const existing = readLock(lease.runId);
        if (existing?.token === lease.token) _unlinkSync(primaryLockPath(lease.runId));
      } catch {
      }
    },
    getRunsDir() {
      return runsDir;
    }
  };
}
function generateRunId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

// src/task-panel.ts
import { join as join9 } from "node:path";

// src/delivery-steal.ts
import { AgentSession, ExtensionRunner } from "@earendil-works/pi-coding-agent";
var boundSessionSends = /* @__PURE__ */ new Map();
var lastHostSession;
var agentSessionPatched = false;
var bindCoreObserved = false;
function hostSessionIdToSteal(session) {
  const sm = session.sessionManager;
  if (!sm) return void 0;
  if (sm.persist === false) return void 0;
  if (session._resourceLoader?.noExtensions === true) return void 0;
  try {
    const name = sm.getSessionName?.();
    if (typeof name === "string" && name.startsWith("workflow:")) return void 0;
  } catch {
  }
  if (typeof session.sendCustomMessage !== "function") return void 0;
  try {
    const sid = sm.getSessionId?.();
    if (typeof sid === "string" && sid) return sid;
  } catch {
    return void 0;
  }
  return void 0;
}
function captureHostSessionSend(session) {
  const sid = hostSessionIdToSteal(session);
  if (!sid) return;
  lastHostSession = session;
  boundSessionSends.set(sid, (message, options) => session.sendCustomMessage(message, options));
}
function recaptureHostSessionSend(sessionId) {
  const existing = boundSessionSends.get(sessionId);
  if (existing) return existing;
  if (lastHostSession) captureHostSessionSend(lastHostSession);
  return boundSessionSends.get(sessionId);
}
function deleteBoundSessionSend(sessionId) {
  boundSessionSends.delete(sessionId);
}
function patchAgentSessionCapture() {
  if (agentSessionPatched) return;
  agentSessionPatched = true;
  try {
    const proto = AgentSession.prototype;
    const original = proto._bindExtensionCore;
    if (typeof original !== "function") return;
    proto._bindExtensionCore = function patchedBindExtensionCore(runner) {
      try {
        captureHostSessionSend(this);
      } catch {
      }
      return original.apply(this, [runner]);
    };
  } catch {
  }
}
function patchBindCoreObserve() {
  if (bindCoreObserved) return;
  bindCoreObserved = true;
  try {
    const proto = ExtensionRunner.prototype;
    const original = proto.bindCore;
    if (typeof original !== "function") return;
    proto.bindCore = function patchedBindCore(...args) {
      return original.apply(this, args);
    };
  } catch {
  }
}
function installDeliverySteal() {
  patchAgentSessionCapture();
  patchBindCoreObserve();
}
installDeliverySteal();

// src/task-panel.ts
import { truncateToWidth as truncateToWidth2, visibleWidth as visibleWidth2 } from "@earendil-works/pi-tui";

// src/workflow-ui.ts
import {
  getLanguageFromPath,
  getMarkdownTheme,
  renderDiff
} from "@earendil-works/pi-coding-agent";
import { Markdown, parseKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
var STATUS_ICON = {
  pending: "\xB7",
  queued: "\xB7",
  running: "\u25C6",
  paused: "\u23F8",
  completed: "\u2713",
  done: "\u2713",
  failed: "\u2717",
  error: "\u2717",
  aborted: "\u2298",
  skipped: "\u2298"
};
var NavigatorTextRenderCache = class {
  entries = /* @__PURE__ */ new Map();
  resultJson = /* @__PURE__ */ new WeakMap();
  weight = 0;
  get(key) {
    const hit = this.entries.get(key);
    if (!hit) return void 0;
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.lines;
  }
  stringify(result2) {
    const cached = this.resultJson.get(result2);
    if (cached !== void 0) return cached;
    let json;
    try {
      json = JSON.stringify(result2, null, 2) ?? String(result2);
    } catch {
      json = String(result2);
    }
    this.resultJson.set(result2, json);
    return json;
  }
  set(key, lines, weight) {
    const MAX_ENTRIES = 96;
    const MAX_WEIGHT = 4e6;
    if (weight > MAX_WEIGHT) return lines;
    const previous = this.entries.get(key);
    if (previous) this.weight -= previous.weight;
    this.entries.delete(key);
    this.entries.set(key, { lines, weight });
    this.weight += weight;
    while (this.entries.size > MAX_ENTRIES || this.weight > MAX_WEIGHT) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.weight -= oldest[1].weight;
    }
    return lines;
  }
};
var BOX_BORDER_LEFT = "\u2502 ";
var BOX_BORDER_RIGHT = " \u2502";
var BOX_BORDER_OVERHEAD = BOX_BORDER_LEFT.length + BOX_BORDER_RIGHT.length;
function asText(v) {
  return typeof v === "string" ? v : String(v ?? "");
}
function agentPhaseKey(a) {
  return a.phase != null ? asText(a.phase) : "(no phase)";
}
function toAgentRow(a) {
  return {
    id: a.id,
    label: asText(a.label),
    status: a.status,
    phase: a.phase != null ? asText(a.phase) : a.phase,
    tokens: a.tokens,
    tokenUsage: a.tokenUsage,
    model: a.model
  };
}
function shortModel(model) {
  if (!model) return void 0;
  const m = asText(model);
  const slash = m.indexOf("/");
  return slash > 0 ? m.slice(slash + 1) : m;
}
var NavigatorModel = class {
  constructor(manager, storage) {
    this.manager = manager;
    this.storage = storage;
  }
  manager;
  storage;
  frameDepth = 0;
  frameRuns;
  frameSnapshots = /* @__PURE__ */ new Map();
  /** Share persisted data across all model lookups performed by one render. */
  withRenderFrame(render) {
    const outermost = this.frameDepth === 0;
    this.frameDepth++;
    try {
      return render();
    } finally {
      this.frameDepth--;
      if (outermost) {
        this.frameRuns = void 0;
        this.frameSnapshots.clear();
      }
    }
  }
  persistedRuns() {
    if (this.frameDepth === 0) return this.manager.listRuns();
    if (!this.frameRuns) this.frameRuns = this.manager.listRuns();
    return this.frameRuns;
  }
  snapshot(runId) {
    if (this.frameDepth > 0 && this.frameSnapshots.has(runId)) return this.frameSnapshots.get(runId);
    const live = this.manager.getRun(runId);
    const value = live ? { snapshot: live.snapshot, status: live.status } : (() => {
      const p = this.persistedRuns().find((r) => r.runId === runId);
      return p ? { snapshot: persistedToSnapshot(p), status: p.status } : void 0;
    })();
    if (this.frameDepth > 0) this.frameSnapshots.set(runId, value);
    return value;
  }
  runs() {
    return this.persistedRuns().map((p) => {
      const live = this.manager.getRun(p.runId);
      const rawAgents = live?.snapshot.agents ?? p.agents;
      const agents = Array.isArray(rawAgents) ? rawAgents : [];
      const usage = live?.snapshot.tokenUsage ?? p.tokenUsage;
      const fromUsage = tokenFigures(usage);
      const fromAgents = aggregateAgentUsage(agents);
      const figures = fromAgents.fresh + fromAgents.cacheRead > fromUsage.fresh + fromUsage.cacheRead ? fromAgents : fromUsage;
      return {
        runId: p.runId,
        name: asText(live?.snapshot.name ?? p.workflowName),
        status: live?.status ?? p.status,
        done: agents.filter((a) => a.status === "done").length,
        total: agents.length,
        fresh: figures.fresh,
        cacheRead: figures.cacheRead,
        cost: usage?.cost ?? 0
      };
    });
  }
  /** Return saved workflows sorted by name, or [] when no storage configured. */
  saved() {
    if (!this.storage) return [];
    return this.storage.list().sort((a, b) => a.name.localeCompare(b.name));
  }
  /** Delete a saved workflow by name. */
  deleteSaved(name) {
    if (!this.storage) return false;
    return this.storage.delete(name);
  }
  runName(runId) {
    return asText(this.snapshot(runId)?.snapshot.name ?? runId);
  }
  runStatus(runId) {
    return asText(this.snapshot(runId)?.status ?? "unknown");
  }
  phases(runId) {
    const snap = this.snapshot(runId)?.snapshot;
    if (!snap) return [];
    const order = Array.isArray(snap.phases) ? snap.phases.map(asText) : [];
    const byPhase = /* @__PURE__ */ new Map();
    const agents = Array.isArray(snap.agents) ? snap.agents : [];
    for (const a of agents) {
      const key = agentPhaseKey(a);
      if (!byPhase.has(key)) byPhase.set(key, []);
      byPhase.get(key)?.push(a);
      if (!order.includes(key)) order.push(key);
    }
    return order.map((title) => {
      const agents2 = byPhase.get(title) ?? [];
      const usage = aggregateAgentUsage(agents2);
      return {
        title,
        // already coerced to a string above
        done: agents2.filter((a) => a.status === "done").length,
        total: agents2.length,
        fresh: usage.fresh,
        cacheRead: usage.cacheRead
      };
    });
  }
  agents(runId, phase) {
    const snap = this.snapshot(runId)?.snapshot;
    if (!snap || !Array.isArray(snap.agents)) return [];
    return snap.agents.filter((a) => agentPhaseKey(a) === phase).map((a) => toAgentRow(a));
  }
  /**
   * All agents grouped by their (coerced) phase in a SINGLE pass — O(agents).
   * The navigator's phase pane needs each phase's agents (status colour + the
   * selected phase's rows); calling agents() once per phase row was O(phases ×
   * agents) per frame. Callers that render every phase use this instead.
   */
  agentsByPhase(runId) {
    const out = /* @__PURE__ */ new Map();
    const snap = this.snapshot(runId)?.snapshot;
    if (!snap || !Array.isArray(snap.agents)) return out;
    for (const a of snap.agents) {
      const key = agentPhaseKey(a);
      let arr = out.get(key);
      if (!arr) {
        arr = [];
        out.set(key, arr);
      }
      arr.push(toAgentRow(a));
    }
    return out;
  }
  agentDetail(runId, agentId) {
    return this.snapshot(runId)?.snapshot.agents.find((a) => a.id === agentId);
  }
};
function persistedToSnapshot(p) {
  const agents = (Array.isArray(p.agents) ? p.agents : []).filter((agent) => agent && typeof agent === "object");
  const journalByIndex = /* @__PURE__ */ new Map();
  const journalByCallId = /* @__PURE__ */ new Map();
  for (const entry of Array.isArray(p.journal) ? p.journal : []) {
    if (entry && typeof entry === "object" && typeof entry.index === "number") {
      journalByIndex.set(entry.index, entry.result);
      journalByCallId.set(`${entry.runId ?? p.runId}:${entry.index}`, entry.result);
    }
  }
  const snapshotAgents = agents.map((a, callIndex) => {
    const journalResult = a.callId ? journalByCallId.get(a.callId) : journalByIndex.get(callIndex);
    const result2 = a.result === void 0 && a.status === "done" ? journalResult : a.result;
    return {
      id: a.id,
      callId: a.callId,
      label: a.label,
      phase: a.phase,
      prompt: a.prompt,
      status: a.status,
      result: result2,
      resultPreview: result2 === void 0 ? a.resultPreview : String(typeof result2 === "string" ? result2 : JSON.stringify(result2)),
      error: a.error,
      errorCode: a.errorCode,
      recoverable: a.recoverable,
      history: a.history,
      tokens: a.tokens,
      tokenUsage: a.tokenUsage,
      model: a.model
    };
  });
  return {
    name: asText(p.workflowName),
    phases: Array.isArray(p.phases) ? p.phases : [],
    currentPhase: p.currentPhase,
    logs: Array.isArray(p.logs) ? p.logs : [],
    agents: snapshotAgents,
    agentCount: snapshotAgents.length,
    runningCount: snapshotAgents.filter((a) => a.status === "running").length,
    doneCount: snapshotAgents.filter((a) => a.status === "done").length,
    errorCount: snapshotAgents.filter((a) => a.status === "error").length,
    tokenUsage: p.tokenUsage ? { ...p.tokenUsage } : void 0,
    runId: p.runId
  };
}
var NavigatorState = class {
  stack = [{ kind: "runs", cursor: 0 }];
  scroll = 0;
  tailing = false;
  pagerOpen = false;
  pageSize = 1;
  top() {
    return this.stack[this.stack.length - 1];
  }
  get kind() {
    return this.top().kind;
  }
  get cursor() {
    return this.top().cursor;
  }
  set cursor(val) {
    this.top().cursor = val;
  }
  get runId() {
    return this.top().runId;
  }
  get phase() {
    return this.top().phase;
  }
  get agentId() {
    return this.top().agentId;
  }
  /** The saved workflow name at the cursor in savedDetail view */
  get savedName() {
    return this.top().savedName;
  }
  get depth() {
    return this.stack.length;
  }
  /**
   * Determine what kind of item is at the given cursor position in the
   * runs view. Positions before runs.length are "run"; after are "saved".
   */
  itemKindAt(model, cursor) {
    const runCount = model.runs().length;
    return cursor < runCount ? "run" : "saved";
  }
  /** Clamp the cursor to [0, count). */
  clamp(count) {
    const t = this.top();
    t.cursor = count <= 0 ? 0 : Math.max(0, Math.min(t.cursor, count - 1));
  }
  move(delta, count) {
    if (this.kind === "detail" || this.kind === "savedDetail") {
      if (this.kind === "detail") this.pagerOpen = true;
      if (delta < 0) this.tailing = false;
      this.scroll = Math.max(0, this.scroll + delta);
      return;
    }
    if (count <= 0) return;
    const t = this.top();
    t.cursor = (t.cursor + delta + count) % count;
  }
  /** Update the amount moved by page keys to match the rendered viewport. */
  setPageSize(rows) {
    this.pageSize = Math.max(1, rows);
  }
  /** Move by almost one viewport, retaining one line of reading context. */
  movePage(direction, count) {
    const delta = direction * Math.max(1, this.pageSize - 1);
    if (this.kind === "detail" || this.kind === "savedDetail") {
      if (this.kind === "detail") this.pagerOpen = true;
      if (direction < 0) this.tailing = false;
      this.scroll = Math.max(0, this.scroll + delta);
      return;
    }
    if (count > 0) this.cursor = Math.max(0, Math.min(count - 1, this.cursor + delta));
  }
  /** Jump to the beginning or end of the current list/detail. End also enables
   * follow mode for a live agent detail; start disables it. */
  jump(edge, count) {
    if (this.kind === "detail" || this.kind === "savedDetail") {
      if (this.kind === "detail") this.pagerOpen = true;
      this.tailing = this.kind === "detail" && edge === "end";
      this.scroll = edge === "start" ? 0 : Number.MAX_SAFE_INTEGER;
      return;
    }
    this.cursor = edge === "start" || count <= 0 ? 0 : count - 1;
  }
  /** Open the full pager without closing an already-open pager. */
  openPager() {
    if (this.kind !== "detail") return false;
    if (!this.pagerOpen) {
      this.pagerOpen = true;
      this.scroll = 0;
    }
    return true;
  }
  /** Toggle the full pager while retaining the compact agent summary view. */
  togglePager() {
    if (this.kind !== "detail") return false;
    if (!this.pagerOpen) return this.openPager();
    this.pagerOpen = false;
    this.scroll = 0;
    this.tailing = false;
    return false;
  }
  /** Toggle live follow mode in an agent detail pager. */
  toggleTail() {
    if (this.kind !== "detail") return false;
    this.pagerOpen = true;
    this.tailing = !this.tailing;
    if (this.tailing) this.scroll = Number.MAX_SAFE_INTEGER;
    return this.tailing;
  }
  /** Drill into the selected item. Returns true if the view changed. */
  drill(model) {
    const t = this.top();
    if (t.kind === "runs") {
      const runs = model.runs();
      const saved = model.saved();
      if (t.cursor < runs.length) {
        const run = runs[t.cursor];
        if (!run) return false;
        this.stack.push({ kind: "phases", cursor: 0, runId: run.runId });
        return true;
      }
      const item = saved[t.cursor - runs.length];
      if (!item) return false;
      this.scroll = 0;
      this.tailing = false;
      this.pagerOpen = false;
      this.stack.push({ kind: "savedDetail", cursor: 0, savedName: item.name });
      return true;
    }
    if (t.kind === "phases" && t.runId) {
      const phases = model.phases(t.runId);
      const ph = phases[t.cursor];
      if (!ph) return false;
      this.stack.push({ kind: "agents", cursor: 0, runId: t.runId, phase: ph.title });
      return true;
    }
    if (t.kind === "agents" && t.runId && t.phase) {
      const agents = model.agents(t.runId, t.phase);
      const ag = agents[t.cursor];
      if (!ag) return false;
      this.scroll = 0;
      this.tailing = false;
      this.pagerOpen = false;
      this.stack.push({ kind: "detail", cursor: 0, runId: t.runId, phase: t.phase, agentId: ag.id });
      return true;
    }
    return false;
  }
  /** Pop one level. Returns false when already at the top (caller should close). */
  back() {
    if (this.kind === "detail" && this.pagerOpen) {
      this.pagerOpen = false;
      this.scroll = 0;
      this.tailing = false;
      return true;
    }
    if (this.stack.length <= 1) return false;
    this.stack.pop();
    this.scroll = 0;
    this.tailing = false;
    this.pagerOpen = false;
    return true;
  }
  /** The runId at cursor, or undefined when on a saved item. */
  activeRunId(model) {
    if (this.runId) return this.runId;
    if (this.kind === "runs") {
      const runs = model.runs();
      if (this.cursor < runs.length) return runs[this.cursor]?.runId;
    }
    return void 0;
  }
};
function pad(n) {
  return n.toLocaleString();
}
var BX = { h: "\u2500", v: "\u2502", tl: "\u250C", tr: "\u2510", bl: "\u2514", br: "\u2518", tj: "\u252C", bj: "\u2534" };
var CARET = "\u203A";
var DOT = "\u25CF";
var ELLIPSIS = "\u2026";
var LW_MIN = 14;
var RW_MIN = 24;
var GAP_NM = 2;
function compactTokens(t) {
  if (!t || t <= 0) return "0";
  if (t < 1e3) return String(Math.round(t));
  if (t < 1e6) {
    const k = t / 1e3;
    const s = k >= 100 ? Math.round(k).toString() : trimZero(k.toFixed(1));
    return `${s}k`;
  }
  const m = t / 1e6;
  return `${trimZero(m.toFixed(1))}M`;
}
function trimZero(s) {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}
function pluralize(word, n) {
  return n === 1 ? word : `${word}s`;
}
function phaseStatusColor(p, agents) {
  if (agents.some((a) => a.status === "error" || a.status === "failed")) return "error";
  if (agents.some((a) => a.status === "running")) return "warning";
  if (p.total > 0 && p.done === p.total) return "success";
  return "dim";
}
var AGENT_DOT_COLOR = {
  running: "warning",
  queued: "dim",
  pending: "dim",
  paused: "dim",
  done: "success",
  completed: "success",
  error: "error",
  failed: "error",
  skipped: "dim",
  aborted: "dim"
};
function computeLeftWidth(phases, width) {
  const titleNeed = visibleWidth("Phases") + 2 + 1 + 1 + 3;
  let contentMax = 0;
  phases.forEach((p, i) => {
    const idx = String(i + 1);
    const hasAgents = p.total > 0;
    const need = 2 + visibleWidth(idx) + 1 + visibleWidth(p.title) + (hasAgents ? 1 + visibleWidth(`${p.done}/${p.total}`) : 0);
    if (need > contentMax) contentMax = need;
  });
  const innerNeed = Math.max(contentMax, titleNeed - 2);
  const lwNatural = innerNeed + 2;
  const lwMax = Math.min(40, Math.floor(width * 0.45));
  return Math.max(LW_MIN, Math.min(lwNatural, Math.max(LW_MIN, lwMax)));
}
function leftPhaseRow(p, i, selected, agents, innerW, theme) {
  const idx = String(i + 1);
  const hasAgents = p.total > 0;
  const progress = hasAgents ? `${p.done}/${p.total}` : "";
  const marker = selected ? `${CARET} ` : "  ";
  const fixed = 2 + visibleWidth(idx) + 1 + (progress ? 1 + visibleWidth(progress) : 0);
  const nameRoom = Math.max(0, innerW - fixed);
  const name = truncateToWidth(p.title, nameRoom, ELLIPSIS, false);
  const styleMain = (s) => selected ? theme.fg("accent", theme.bold(s)) : hasAgents ? s : theme.fg("dim", s);
  const progStyle = (s) => selected ? theme.fg("accent", theme.bold(s)) : theme.fg(phaseStatusColor(p, agents), s);
  const caret = selected ? theme.fg("accent", theme.bold(marker)) : marker;
  let row = caret + styleMain(`${idx} ${name}`);
  if (progress) row += ` ${progStyle(progress)}`;
  return truncateToWidth(row, innerW, "", true);
}
function rightAgentRow(a, selected, modelColStart, innerW, theme) {
  const dotColor = AGENT_DOT_COLOR[a.status] ?? "dim";
  const stats = fmtTokenSegment(tokenFigures(a.tokenUsage, a.tokens), compactTokens);
  const model = shortModel(a.model) ?? "";
  const markerW = 2;
  const statsW = visibleWidth(stats);
  const nameStart = markerW + 2;
  let modelStart = Math.max(nameStart + visibleWidth(a.label) + GAP_NM, markerW + modelColStart);
  const statsStart = innerW - statsW;
  let modelRoom = statsStart - 1 - modelStart;
  let nameOut = a.label;
  let modelOut = model;
  if (modelRoom < 0) {
    modelOut = "";
    modelStart = nameStart;
    modelRoom = 0;
    const nameRoom = Math.max(0, statsStart - 1 - nameStart);
    nameOut = truncateToWidth(a.label, nameRoom, ELLIPSIS, false);
  } else {
    modelOut = truncateToWidth(model, modelRoom, ELLIPSIS, false);
    const nameRoom = Math.max(0, modelStart - GAP_NM - nameStart);
    nameOut = truncateToWidth(a.label, nameRoom, ELLIPSIS, false);
  }
  const marker = selected ? theme.fg("accent", theme.bold(`${CARET} `)) : "  ";
  const dot = theme.fg(dotColor, DOT);
  const nameStyled = selected ? theme.fg("accent", theme.bold(nameOut)) : theme.fg("accent", nameOut);
  const modelStyled = modelOut ? theme.fg("dim", modelOut) : "";
  const statsStyled = theme.fg("dim", stats);
  let out = marker + dot + " " + nameStyled;
  const afterName = nameStart + visibleWidth(nameOut);
  if (modelOut) {
    out += " ".repeat(Math.max(0, modelStart - afterName)) + modelStyled;
    const afterModel = modelStart + visibleWidth(modelOut);
    out += " ".repeat(Math.max(0, statsStart - afterModel)) + statsStyled;
  } else {
    out += " ".repeat(Math.max(0, statsStart - afterName)) + statsStyled;
  }
  return truncateToWidth(out, innerW, "", true);
}
function topTitleSegment(title, innerW, leading, theme) {
  const label = ` ${title} `;
  const lead = leading ? BX.h : "";
  let labelOut = label;
  const fixed = visibleWidth(lead) + 1;
  if (visibleWidth(label) > innerW - fixed) {
    labelOut = truncateToWidth(label, Math.max(0, innerW - fixed), ELLIPSIS, false);
  }
  const used = visibleWidth(lead) + visibleWidth(labelOut);
  const dashes = BX.h.repeat(Math.max(0, innerW - used));
  return theme.fg("muted", lead) + theme.fg("dim", labelOut) + theme.fg("muted", dashes);
}
function renderTwoPaneFrame(a) {
  const { width, bodyRows, left, right, leftTitle, rightTitle, leftW, theme } = a;
  const rightW = width - leftW + 1;
  const leftInner = leftW - 2;
  const rightInner = rightW - 2;
  const bc = (s) => theme.fg("muted", s);
  const out = [];
  out.push(
    bc(BX.tl) + topTitleSegment(leftTitle, leftInner, false, theme) + bc(BX.tj) + topTitleSegment(rightTitle, rightInner, true, theme) + bc(BX.tr)
  );
  const blankL = " ".repeat(leftInner);
  const blankR = " ".repeat(rightInner);
  for (let r = 0; r < bodyRows; r++) {
    const l = left[r] ?? blankL;
    const rr = right[r] ?? blankR;
    out.push(bc(BX.v) + l + bc(BX.v) + rr + bc(BX.v));
  }
  out.push(bc(BX.bl) + bc(BX.h.repeat(leftInner)) + bc(BX.bj) + bc(BX.h.repeat(rightInner)) + bc(BX.br));
  return out;
}
function renderPhasesAgents(state, model, runId, width, theme, bodyCap) {
  const phases = model.phases(runId);
  const agentsByPhase = model.agentsByPhase(runId);
  const agentsOf = (title) => agentsByPhase.get(title) ?? [];
  const inAgents = state.kind === "agents";
  let selPhaseIdx = inAgents ? phases.findIndex((p) => p.title === state.phase) : state.cursor;
  if (selPhaseIdx < 0) selPhaseIdx = 0;
  const selPhase = phases[selPhaseIdx];
  const agents = selPhase ? agentsOf(selPhase.title) : [];
  if (width < LW_MIN + RW_MIN - 1) {
    return renderSinglePane(state, phases, selPhaseIdx, agents, width, theme, bodyCap, inAgents);
  }
  const leftW = computeLeftWidth(phases, width);
  const rightW = width - leftW + 1;
  const leftInner = leftW - 2;
  const rightInner = rightW - 2;
  const leftRows = scrollWindow(phases.length, inAgents ? selPhaseIdx : state.cursor, bodyCap);
  const rightRows = scrollWindow(agents.length, inAgents ? state.cursor : 0, bodyCap);
  const bodyRows = Math.max(1, Math.min(bodyCap, Math.max(leftRows.count, rightRows.count)));
  const left = [];
  for (let k = 0; k < bodyRows; k++) {
    const idx = leftRows.start + k;
    if (idx >= phases.length) {
      left.push(" ".repeat(leftInner));
      continue;
    }
    const p = phases[idx];
    const selected = !inAgents && idx === state.cursor;
    const ag = agentsOf(p.title);
    let row = leftPhaseRow(p, idx, selected, ag, leftInner, theme);
    if (k === bodyRows - 1 && leftRows.more) {
      row = truncateToWidth(theme.fg("dim", `  ${ELLIPSIS}`), leftInner, "", true);
    }
    left.push(row);
  }
  const modelColStart = computeModelColStart(agents, rightInner);
  const right = [];
  if (agents.length === 0) {
    const msg = truncateToWidth(theme.fg("dim", "no agents"), rightInner, "", true);
    for (let k = 0; k < bodyRows; k++) right.push(k === 0 ? msg : " ".repeat(rightInner));
  } else {
    for (let k = 0; k < bodyRows; k++) {
      const idx = rightRows.start + k;
      if (idx >= agents.length) {
        right.push(" ".repeat(rightInner));
        continue;
      }
      const selected = inAgents && idx === state.cursor;
      let row = rightAgentRow(agents[idx], selected, modelColStart, rightInner, theme);
      if (k === bodyRows - 1 && rightRows.more) {
        row = truncateToWidth(theme.fg("dim", `  ${ELLIPSIS}`), rightInner, "", true);
      }
      right.push(row);
    }
  }
  const n = agents.length;
  const rightTitle = `${selPhase ? selPhase.title : "(none)"} \xB7 ${n} ${pluralize("agent", n)}`;
  return renderTwoPaneFrame({
    width,
    bodyRows,
    left,
    right,
    leftTitle: "Phases",
    rightTitle,
    leftW,
    theme
  });
}
function computeModelColStart(agents, innerW) {
  let maxName = 0;
  for (const a of agents) maxName = Math.max(maxName, visibleWidth(a.label));
  const start = 2 + maxName + GAP_NM;
  return Math.min(start, Math.max(2, Math.floor(innerW * 0.55)));
}
function scrollWindow(total, active, cap) {
  if (total <= cap) return { start: 0, count: total, more: false };
  let start = Math.max(0, Math.min(active - Math.floor(cap / 2), total - cap));
  if (active < start) start = active;
  if (active >= start + cap) start = active - cap + 1;
  return { start, count: cap, more: start + cap < total };
}
function renderSinglePane(state, phases, selPhaseIdx, agents, width, theme, bodyCap, inAgents) {
  const innerW = Math.max(1, width - 2);
  const bc = (s) => theme.fg("muted", s);
  const out = [];
  if (inAgents) {
    const selPhase = phases[selPhaseIdx];
    const n = agents.length;
    const title = `${selPhase ? selPhase.title : "(none)"} \xB7 ${n} ${pluralize("agent", n)}`;
    out.push(bc(BX.tl) + topTitleSegment(title, innerW, false, theme) + bc(BX.tr));
    const win = scrollWindow(agents.length, state.cursor, bodyCap);
    const modelColStart = computeModelColStart(agents, innerW);
    const rows = Math.max(1, win.count);
    for (let k = 0; k < rows; k++) {
      const idx = win.start + k;
      if (idx >= agents.length) {
        out.push(bc(BX.v) + " ".repeat(innerW) + bc(BX.v));
        continue;
      }
      let row = rightAgentRow(agents[idx], idx === state.cursor, modelColStart, innerW, theme);
      if (k === rows - 1 && win.more) row = truncateToWidth(theme.fg("dim", `  ${ELLIPSIS}`), innerW, "", true);
      out.push(bc(BX.v) + row + bc(BX.v));
    }
  } else {
    out.push(bc(BX.tl) + topTitleSegment("Phases", innerW, false, theme) + bc(BX.tr));
    const win = scrollWindow(phases.length, state.cursor, bodyCap);
    const rows = Math.max(1, win.count);
    for (let k = 0; k < rows; k++) {
      const idx = win.start + k;
      if (idx >= phases.length) {
        out.push(bc(BX.v) + " ".repeat(innerW) + bc(BX.v));
        continue;
      }
      const p = phases[idx];
      let row = leftPhaseRow(p, idx, idx === state.cursor, [], innerW, theme);
      if (k === rows - 1 && win.more) row = truncateToWidth(theme.fg("dim", `  ${ELLIPSIS}`), innerW, "", true);
      out.push(bc(BX.v) + row + bc(BX.v));
    }
  }
  out.push(bc(BX.bl) + bc(BX.h.repeat(innerW)) + bc(BX.br));
  return out;
}
function renderNavigatorFrame(state, model, width, theme, viewportRows, markdownTheme, renderCache) {
  const lines = [];
  state.setPageSize(Math.max(1, viewportRows - 5));
  const sel = (i, text) => i === state.cursor ? theme.fg("accent", theme.bold(`\u276F ${text}`)) : `  ${text}`;
  const dim = (t) => theme.fg("dim", t);
  const pushScrollable = (body) => {
    const viewport = Math.max(1, viewportRows - 4);
    state.setPageSize(viewport);
    const maxScroll = Math.max(0, body.length - viewport);
    if (state.kind === "detail" && state.tailing) state.scroll = maxScroll;
    state.scroll = Math.min(Math.max(0, state.scroll), maxScroll);
    lines.push(...body.slice(state.scroll, state.scroll + viewport));
    if (body.length > viewport) {
      const end = Math.min(state.scroll + viewport, body.length);
      const up = state.scroll > 0 ? "\u2191" : " ";
      const down = end < body.length ? "\u2193" : " ";
      const mode = state.kind === "detail" && state.tailing ? " TAIL" : "";
      lines.push(dim(`  [${state.scroll + 1}-${end} / ${body.length}] ${up}${down}${mode}`));
    }
  };
  const pushCompact = (body) => {
    const viewport = Math.max(1, viewportRows - 3);
    if (body.length <= viewport) {
      lines.push(...body);
      return;
    }
    lines.push(...body.slice(0, Math.max(1, viewport - 1)));
    lines.push(dim("  \u2026 enter to open full pager"));
  };
  if (state.kind === "runs") {
    const runs = model.runs();
    const saved = model.saved();
    const total = runs.length + saved.length;
    state.clamp(total);
    const bodyCap = Math.max(1, viewportRows - 3);
    let win = scrollWindow(total, state.cursor, bodyCap);
    const windowEnd = () => win.start + win.count;
    const crossesSavedBoundary = () => runs.length > 0 && saved.length > 0 && win.start < runs.length && windowEnd() > runs.length;
    if (crossesSavedBoundary() && bodyCap > 1) win = scrollWindow(total, state.cursor, bodyCap - 1);
    const up = win.start > 0 ? "\u2191" : " ";
    const down = windowEnd() < total ? "\u2193" : " ";
    const range = win.start > 0 || windowEnd() < total ? dim(`  [${up} ${win.start + 1}-${windowEnd()} / ${total} ${down}]`) : "";
    lines.push(theme.bold(`Workflows${range}`));
    if (total === 0) {
      lines.push(dim("  No runs yet. Start one with a background workflow."));
    }
    for (let i = win.start; i < windowEnd(); i++) {
      if (i === runs.length && runs.length > 0 && saved.length > 0) lines.push(dim("  \u2500\u2500 saved \u2500\u2500"));
      if (i < runs.length) {
        const r = runs[i];
        if (!r) continue;
        const icon = STATUS_ICON[r.status] ?? "?";
        const tok = fmtTokenSegment(r, pad);
        const meta = [`${r.done}/${r.total}`, tok, r.cost > 0 ? fmtCost(r.cost) : ""].filter(Boolean).join(" \xB7 ");
        lines.push(sel(i, `${icon} ${r.name}  ${dim(`${r.runId} \xB7 ${r.status} \xB7 ${meta}`)}`));
      } else {
        const w = saved[i - runs.length];
        if (!w) continue;
        const loc = w.location === "user" ? "~" : ".";
        const desc = w.description ? dim(`  ${w.description}`) : "";
        lines.push(sel(i, `${w.name}${desc}  ${dim(loc)}`));
      }
    }
  } else if (state.kind === "phases" && state.runId) {
    const phases = model.phases(state.runId);
    state.clamp(phases.length);
    lines.push(...twoPaneHeader(model, state.runId, phases, width, theme));
    const bodyCap = Math.max(
      1,
      viewportRows - 2 - 2 - 2
      /*blank+footer*/
    );
    lines.push(...renderPhasesAgents(state, model, state.runId, width, theme, bodyCap));
  } else if (state.kind === "agents" && state.runId && state.phase) {
    const agents = model.agents(state.runId, state.phase);
    state.clamp(agents.length);
    const phases = model.phases(state.runId);
    lines.push(...twoPaneHeader(model, state.runId, phases, width, theme));
    const bodyCap = Math.max(1, viewportRows - 2 - 2 - 2);
    lines.push(...renderPhasesAgents(state, model, state.runId, width, theme, bodyCap));
  } else if (state.kind === "detail" && state.runId && state.agentId != null) {
    const a = model.agentDetail(state.runId, state.agentId);
    lines.push(theme.bold(a ? asText(a.label) : "agent"));
    if (a) {
      const body = [];
      if (state.pagerOpen) {
        body.push(dim("Status: ") + asText(a.status ?? ""));
        if (a.model) body.push(dim("Model: ") + (shortModel(a.model) ?? ""));
        if (a.error) body.push(dim("Error: ") + asText(a.error));
        if (a.errorCode) {
          body.push(`${dim("Error code: ")}${asText(a.errorCode)}${a.recoverable ? " (recoverable)" : ""}`);
        }
        body.push("", theme.fg("accent", theme.bold("Prompt:")));
        body.push(...renderMarkdownLines(asText(a.prompt ?? ""), width, markdownTheme, renderCache));
        body.push("", theme.fg("accent", theme.bold("Result:")));
        body.push(...renderResultLines(a.result, a.resultPreview, width, markdownTheme, renderCache));
        if (Array.isArray(a.history) && a.history.length) {
          body.push("", theme.fg("accent", theme.bold("History:")));
          for (let i = 0; i < a.history.length; i++) {
            body.push(...renderHistoryEntryLines(a.history, i, width, markdownTheme, dim, renderCache));
          }
        }
        pushScrollable(body);
      } else if (a.status === "done") {
        body.push(theme.fg("accent", theme.bold("Result:")));
        body.push(...renderResultLines(a.result, a.resultPreview, width, markdownTheme, renderCache));
        pushCompact(body);
      } else {
        body.push(dim("Status: ") + asText(a.status ?? ""));
        if (a.model) body.push(dim("Model: ") + (shortModel(a.model) ?? ""));
        if (a.error) body.push(dim("Error: ") + asText(a.error));
        if (a.errorCode) {
          body.push(`${dim("Error code: ")}${asText(a.errorCode)}${a.recoverable ? " (recoverable)" : ""}`);
        }
        body.push("", theme.fg("accent", theme.bold("Prompt:")));
        const promptLines = renderMarkdownLines(asText(a.prompt ?? ""), width, markdownTheme, renderCache);
        body.push(...promptLines.slice(0, 5));
        if (promptLines.length > 5) body.push(dim("  \u2026 prompt continues in pager"));
        body.push("", theme.fg("accent", theme.bold("Recent activity:")));
        if (a.history?.length) {
          const start = Math.max(0, a.history.length - 2);
          for (let i = start; i < a.history.length; i++) {
            const eventLines = renderHistoryEntryLines(a.history, i, width, markdownTheme, dim, renderCache);
            body.push(...eventLines.slice(0, 4));
            if (eventLines.length > 4) body.push(dim("  \u2026 event continues in pager"));
          }
        } else {
          body.push(dim("  Waiting for the first agent event\u2026"));
        }
        pushCompact(body);
      }
    }
  } else if (state.kind === "savedDetail" && state.savedName) {
    const saved = model.saved();
    const w = saved.find((s) => s.name === state.savedName);
    lines.push(theme.bold(w ? w.name : "saved workflow"));
    if (w) {
      const body = [];
      if (w.description) body.push(dim("Description: ") + asText(w.description));
      body.push(dim("Location: ") + (w.location === "user" ? "user (~/.pi)" : "project (.pi)"));
      body.push(dim("Saved at: ") + asText(w.savedAt));
      if (w.parameters) body.push(dim("Parameters: ") + JSON.stringify(w.parameters));
      body.push("", theme.fg("accent", theme.bold("Script:")));
      body.push(...renderCodeLines(asText(w.script), "javascript", width, markdownTheme, renderCache));
      pushScrollable(body);
    }
  }
  lines.push("");
  lines.push(footerHint(state, model, theme));
  return lines;
}
function twoPaneHeader(model, runId, phases, width, theme) {
  const name = model.runName(runId);
  const status = model.runStatus(runId);
  let done = 0;
  let total = 0;
  let fresh = 0;
  let cacheRead = 0;
  for (const p of phases) {
    done += p.done;
    total += p.total;
    fresh += p.fresh;
    cacheRead += p.cacheRead;
  }
  const nameText = truncateToWidth(name, width, ELLIPSIS, false);
  const line0 = theme.fg("accent", theme.bold(nameText));
  const headerSegment = fmtTokenSegment({ fresh, cacheRead }, compactTokens);
  const rightRaw = `${done}/${total} ${pluralize("agent", total)}${headerSegment ? ` \xB7 ${headerSegment}` : ""}`;
  const rightW = visibleWidth(rightRaw);
  const gap = 2;
  let line1;
  if (rightW >= width) {
    line1 = theme.fg("dim", truncateToWidth(rightRaw, width, ELLIPSIS, false));
  } else {
    const availL = width - rightW - gap;
    const leftText = availL > 0 ? truncateToWidth(status, availL, ELLIPSIS, false) : "";
    const leftW = visibleWidth(leftText);
    const fill = " ".repeat(Math.max(gap, width - leftW - rightW));
    line1 = theme.fg("dim", leftText) + fill + theme.fg("dim", rightRaw);
  }
  return [line0, line1];
}
function historyLabel(entry) {
  if (entry.kind === "toolCall") return entry.toolName ? `assistant tool ${asText(entry.toolName)}` : "assistant tool";
  if (entry.role === "tool") return entry.toolName ? `tool ${asText(entry.toolName)}` : "tool";
  if (entry.kind === "error") return `${asText(entry.role)} error`;
  return asText(entry.role);
}
function editCallPath(entry) {
  if (entry.kind !== "toolCall" || entry.toolName !== "edit") return void 0;
  if (typeof entry.path === "string") return entry.path;
  try {
    const args = JSON.parse(asText(entry.text));
    return typeof args.path === "string" ? args.path : void 0;
  } catch {
    return void 0;
  }
}
function writeCallSource(entry) {
  if (entry.kind !== "toolCall" || entry.toolName !== "write") return void 0;
  if (typeof entry.path === "string") return { path: entry.path, content: asText(entry.text) };
  try {
    const args = JSON.parse(asText(entry.text));
    return typeof args.path === "string" && typeof args.content === "string" ? { path: args.path, content: args.content } : void 0;
  } catch {
    return void 0;
  }
}
function historyEntryLanguage(history, index) {
  const entry = history[index];
  if (!entry) return void 0;
  if (entry.kind === "toolCall") {
    const write = writeCallSource(entry);
    return write ? getLanguageFromPath(write.path) ?? "text" : "json";
  }
  if (entry.kind !== "toolResult" || entry.toolName !== "read") return void 0;
  for (let i = index - 1; i >= 0; i--) {
    const call = history[i];
    if (call?.kind !== "toolCall" || call.toolName !== "read") continue;
    try {
      const args = JSON.parse(asText(call.text));
      return typeof args.path === "string" ? getLanguageFromPath(args.path) : void 0;
    } catch {
      return void 0;
    }
  }
  return void 0;
}
function renderHistoryEntryLines(history, index, width, markdownTheme, dim, renderCache) {
  const entry = history[index];
  if (!entry || typeof entry !== "object") return [];
  const write = writeCallSource(entry);
  const editPath = editCallPath(entry);
  const path = write?.path ?? editPath;
  const header = dim(`${historyLabel(entry)}:${path ? ` ${path}` : ""}`);
  if (entry.kind === "toolResult" && entry.toolName === "edit" && typeof entry.diff === "string") {
    return [header, ...renderDiffLines(entry.diff, width, renderCache)];
  }
  if (editPath) return [header];
  const language = historyEntryLanguage(history, index);
  const text = write?.content ?? asText(entry.text);
  return [
    header,
    ...language ? renderCodeLines(text, language, width, markdownTheme, renderCache) : renderMarkdownLines(text, width, markdownTheme, renderCache)
  ];
}
function footerHint(state, model, theme) {
  const parts = [];
  switch (state.kind) {
    case "detail":
      if (state.pagerOpen) {
        parts.push(
          "\u2191/\u2193 line",
          "PgUp/PgDn page",
          "g/G ends",
          `t tail:${state.tailing ? "on" : "off"}`,
          "enter summary",
          "esc back"
        );
      } else {
        parts.push("enter open pager", "t tail", "esc back");
      }
      break;
    case "savedDetail":
      parts.push("\u2191/\u2193 line", "PgUp/PgDn page", "g/G ends", "esc back", "x delete");
      break;
    case "runs": {
      const itemKind = model.saved().length > 0 ? state.itemKindAt(model, state.cursor) : "run";
      parts.push("\u2191/\u2193 select", "enter open", "esc back");
      if (itemKind === "run") {
        parts.push("p pause", "x stop", "r restart", "s save");
      } else {
        parts.push("x delete");
      }
      parts.push("q quit");
      break;
    }
    default:
      parts.push("\u2191/\u2193 select", "enter open", "esc back", "q quit");
  }
  return theme.fg("dim", parts.join(" \xB7 "));
}
function wrap(text, width) {
  return wrapTextWithAnsi(asText(text), Math.max(1, width));
}
function renderMarkdownLines(text, width, markdownTheme, renderCache) {
  const safeText = asText(text);
  if (!markdownTheme) return wrap(safeText, width);
  const renderWidth = Math.max(1, width);
  const key = `md:${renderWidth}:${safeText}`;
  const cached = renderCache?.get(key);
  if (cached) return cached;
  const lines = new Markdown(safeText, 0, 0, markdownTheme).render(renderWidth);
  return renderCache?.set(key, lines, key.length + lines.reduce((sum, line) => sum + line.length, 0)) ?? lines;
}
function renderDiffLines(diff, width, renderCache) {
  const renderWidth = Math.max(1, width);
  const key = `diff:${renderWidth}:${diff}`;
  const cached = renderCache?.get(key);
  if (cached) return cached;
  const lines = renderDiff(diff).split("\n").flatMap((line) => wrapTextWithAnsi(`  ${line}`, renderWidth));
  return renderCache?.set(key, lines, key.length + lines.reduce((sum, line) => sum + line.length, 0)) ?? lines;
}
function renderCodeLines(text, language, width, markdownTheme, renderCache) {
  const safeText = asText(text);
  const renderWidth = Math.max(1, width);
  const key = `code:${language}:${renderWidth}:${safeText}`;
  const cached = renderCache?.get(key);
  if (cached) return cached;
  const sourceLines = markdownTheme?.highlightCode?.(safeText, language) ?? safeText.split("\n");
  const lines = sourceLines.flatMap((line) => wrapTextWithAnsi(`  ${line}`, renderWidth));
  return renderCache?.set(key, lines, key.length + lines.reduce((sum, line) => sum + line.length, 0)) ?? lines;
}
function renderResultLines(result2, preview2, width, markdownTheme, renderCache) {
  if (result2 !== void 0 && typeof result2 !== "string") {
    let json;
    if (renderCache && typeof result2 === "object" && result2 !== null) {
      json = renderCache.stringify(result2);
    } else {
      try {
        json = JSON.stringify(result2, null, 2) ?? String(result2);
      } catch {
        json = String(result2);
      }
    }
    return renderCodeLines(json, "json", width, markdownTheme, renderCache);
  }
  return renderMarkdownLines(
    typeof result2 === "string" ? result2 : preview2 ?? "(none)",
    width,
    markdownTheme,
    renderCache
  );
}
function keyToAction(keyId, kind, itemKind) {
  switch (keyId) {
    case "up":
      return { type: "move", delta: -1 };
    case "down":
      return { type: "move", delta: 1 };
    case "k":
      return { type: "move", delta: -1 };
    case "j":
      return { type: "move", delta: 1 };
    case "pageUp":
    case "ctrl+u":
    case "ctrl+b":
      return { type: "page", direction: -1 };
    case "pageDown":
    case "ctrl+d":
    case "ctrl+f":
      return { type: "page", direction: 1 };
    case "space":
      return kind === "detail" || kind === "savedDetail" ? { type: "page", direction: 1 } : { type: "none" };
    case "home":
    case "g":
      return { type: "jump", edge: "start" };
    case "end":
    case "G":
    case "shift+g":
      return { type: "jump", edge: "end" };
    case "t":
      return kind === "detail" ? { type: "toggleTail" } : { type: "none" };
    case "enter":
    case "return":
      if (kind === "detail") return { type: "togglePager" };
      if (kind === "savedDetail") return { type: "none" };
      return { type: "drill" };
    case "right":
      if (kind === "detail") return { type: "openPager" };
      if (kind === "savedDetail") return { type: "none" };
      return { type: "drill" };
    case "escape":
    case "esc":
    case "left":
      return { type: "back" };
    case "q":
      return { type: "close" };
    case "p":
      return { type: "pause" };
    case "x":
      if (kind === "savedDetail" || itemKind === "saved") return { type: "deleteSaved" };
      return { type: "stop" };
    case "r":
      return { type: "restart" };
    case "s":
      if (itemKind === "saved") return { type: "none" };
      return { type: "save" };
    default:
      return { type: "none" };
  }
}
function currentCount(state, model) {
  if (state.kind === "runs") return model.runs().length + model.saved().length;
  if (state.kind === "phases" && state.runId) return model.phases(state.runId).length;
  if (state.kind === "agents" && state.runId && state.phase) return model.agents(state.runId, state.phase).length;
  return 0;
}
function openWorkflowNavigator(pi, manager, ui, opts = {}) {
  const model = new NavigatorModel(manager, opts.storage);
  const state = new NavigatorState();
  return ui.custom(
    (tui, theme, _keybindings, done) => {
      const rerender = () => tui.requestRender();
      const markdownTheme = getMarkdownTheme();
      const renderCache = new NavigatorTextRenderCache();
      const events = ["agentStart", "agentEnd", "phase", "log", "complete", "error", "stopped", "paused", "resumed"];
      const onEvent = () => rerender();
      for (const ev of events) manager.on(ev, onEvent);
      let historyRenderTimer;
      let historyRenderTarget;
      const onAgentHistory = (event) => {
        if (state.kind !== "detail" || event.runId !== state.runId || event.agentId === void 0 || event.agentId !== state.agentId) {
          return;
        }
        historyRenderTarget = { runId: event.runId, agentId: event.agentId };
        if (historyRenderTimer) return;
        historyRenderTimer = setTimeout(() => {
          historyRenderTimer = void 0;
          const target = historyRenderTarget;
          historyRenderTarget = void 0;
          if (target && state.kind === "detail" && target.runId === state.runId && target.agentId === state.agentId) {
            rerender();
          }
        }, 125);
        historyRenderTimer.unref?.();
      };
      manager.on("agentHistory", onAgentHistory);
      const cleanup = () => {
        for (const ev of events) manager.off(ev, onEvent);
        manager.off("agentHistory", onAgentHistory);
        if (historyRenderTimer) clearTimeout(historyRenderTimer);
        historyRenderTimer = void 0;
        historyRenderTarget = void 0;
      };
      const act = (data) => {
        const itemKind = state.kind === "runs" ? state.itemKindAt(model, state.cursor) : void 0;
        const action = keyToAction(parseKey(data), state.kind, itemKind);
        try {
          switch (action.type) {
            case "move":
              state.move(action.delta, currentCount(state, model));
              break;
            case "page":
              state.movePage(action.direction, currentCount(state, model));
              break;
            case "jump":
              state.jump(action.edge, currentCount(state, model));
              break;
            case "toggleTail":
              state.toggleTail();
              break;
            case "togglePager":
              state.togglePager();
              break;
            case "openPager":
              state.openPager();
              break;
            case "drill":
              state.drill(model);
              break;
            case "back":
              if (!state.back()) {
                cleanup();
                done(void 0);
              }
              break;
            case "close":
              cleanup();
              done(void 0);
              return;
            case "deleteSaved": {
              if (state.kind === "runs") {
                const saved = model.saved();
                const runCount = model.runs().length;
                const item = saved[state.cursor - runCount];
                if (item) {
                  model.deleteSaved(item.name);
                  ui.notify(`Deleted /${item.name}`, "info");
                }
              } else if (state.kind === "savedDetail" && state.savedName) {
                model.deleteSaved(state.savedName);
                ui.notify(`Deleted /${state.savedName}`, "info");
                state.back();
              }
              break;
            }
            case "pause": {
              const id = state.activeRunId(model);
              if (id) ui.notify(manager.pause(id) ? `Paused ${id}` : `Cannot pause ${id}`, "info");
              break;
            }
            case "stop": {
              const id = state.activeRunId(model);
              if (id) ui.notify(manager.stop(id) ? `Stopped ${id}` : `Cannot stop ${id}`, "info");
              break;
            }
            case "restart": {
              const id = state.activeRunId(model);
              const run = id ? manager.listRuns().find((r) => r.runId === id) : void 0;
              if (!run?.script) {
                ui.notify(id ? `Cannot restart ${id} (no script saved)` : "No run selected to restart", "warning");
                break;
              }
              try {
                const { runId: newId } = manager.startInBackground(run.script, run.args);
                ui.notify(`Restarted ${run.workflowName || "workflow"} as ${newId}`, "info");
              } catch (error) {
                ui.notify(
                  `Failed to restart ${run.workflowName || "workflow"}: ${error instanceof Error ? error.message : error}`,
                  "error"
                );
              }
              break;
            }
            case "save": {
              const id = state.activeRunId(model);
              const run = id ? manager.listRuns().find((r) => r.runId === id) : void 0;
              const storage = opts.getStorage?.() ?? opts.storage;
              if (!run?.script) {
                ui.notify("No saved run script to save", "warning");
              } else if (!storage) {
                ui.notify("Saving is not available (no storage)", "error");
              } else {
                const name = run.workflowName || "workflow";
                let saved;
                try {
                  saved = storage.save({
                    name,
                    description: run.workflowName,
                    script: run.script,
                    location: "project"
                  });
                } catch (error) {
                  ui.notify(error instanceof Error ? error.message : String(error), "error");
                  break;
                }
                const getCwd = opts.getCwd ?? (() => opts.cwd ?? process.cwd());
                const getManager = opts.getManager ?? (() => manager);
                const getLiveStorage = () => opts.getStorage?.() ?? opts.storage ?? storage;
                registerSavedWorkflow(
                  pi,
                  getCwd,
                  saved,
                  getManager,
                  () => getLiveStorage()?.load(saved.name) != null,
                  () => getLiveStorage()?.load(saved.name)
                );
                ui.notify(`Saved /${name}`, "info");
              }
              break;
            }
            default:
              return;
          }
        } catch (error) {
          ui.notify(
            `Workflow action "${action.type}" failed: ${error instanceof Error ? error.message : error}`,
            "error"
          );
        }
        rerender();
      };
      let _focused = false;
      const component = {
        get focused() {
          return _focused;
        },
        set focused(v) {
          _focused = v;
        },
        render: (width) => {
          const borderColor = (s) => _focused ? theme.fg("accent", s) : theme.fg("borderMuted", s);
          const titleColor = (s) => _focused ? theme.fg("dim", theme.bold(s)) : theme.fg("muted", s);
          const bgColor = (s) => theme.bg("customMessageBg", s);
          const innerWidth = Math.max(10, width - BOX_BORDER_OVERHEAD);
          const terminalRows = tui.terminal?.rows ?? 24;
          const overlayRows = Math.max(8, Math.floor(terminalRows * 0.92));
          const contentRows = Math.max(6, overlayRows - 2);
          const raw = model.withRenderFrame(
            () => renderNavigatorFrame(state, model, innerWidth, theme, contentRows, markdownTheme, renderCache)
          );
          const title = titleColor(" workflows ");
          const topBorder = borderColor("\u256D\u2500") + title + borderColor("\u2500".repeat(Math.max(0, innerWidth - 10))) + borderColor("\u256E");
          const botBorder = borderColor(`\u2570${"\u2500".repeat(Math.max(0, innerWidth + 2))}\u256F`);
          const wrapAndBg = (line) => {
            const padded = truncateToWidth(line, innerWidth, "", true);
            const fullLine = borderColor(BOX_BORDER_LEFT) + padded + borderColor(BOX_BORDER_RIGHT);
            const trailingPad = width - visibleWidth(fullLine);
            return bgColor(fullLine + (trailingPad > 0 ? " ".repeat(trailingPad) : ""));
          };
          return [bgColor(topBorder), ...raw.map(wrapAndBg), bgColor(botBorder)];
        },
        handleInput: (data) => act(data),
        invalidate: () => {
        },
        dispose: () => cleanup()
      };
      return component;
    },
    // A roomy overlay with visual margin so borders stand out from the terminal edge.
    // Supports sidebar mode via opts.anchor="right-center".
    {
      overlay: true,
      overlayOptions: {
        width: opts.anchor === "right-center" ? "60%" : "94%",
        maxHeight: "92%",
        anchor: opts.anchor ?? "center",
        margin: 1
      }
    }
  );
}

// src/task-panel.ts
var RUN_EVENTS = [
  "agentStart",
  "agentEnd",
  "phase",
  "log",
  "tokenUsage",
  "complete",
  "error",
  "stopped",
  "paused",
  "resumed"
];
var RUN_END_EVENTS = ["complete", "error", "stopped"];
var DEFAULT_DELIVERED_MAX_CHARS = 400;
function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function summarizeResult(result2, maxChars = DEFAULT_DELIVERED_MAX_CHARS) {
  if (typeof result2 === "string") return result2;
  if (result2 == null) return "null";
  if (typeof result2 === "object") {
    const obj = result2;
    for (const key of ["verdict", "report", "summary", "synthesis"]) {
      const val = obj[key];
      if (typeof val === "string" && val.trim()) return val;
    }
  }
  const json = JSON.stringify(result2, null, 2);
  if (json.length <= maxChars) return json;
  const kept = json.slice(0, maxChars);
  const droppedBytes = Buffer.byteLength(json, "utf8") - Buffer.byteLength(kept, "utf8");
  return `${kept}
\u2026(truncated ${formatBytes(droppedBytes)})`;
}
function fitLine(line, width) {
  if (typeof width !== "number" || !Number.isFinite(width)) return line;
  const maxWidth = Math.max(0, Math.floor(width));
  if (visibleWidth2(line) <= maxWidth) return line;
  return truncateToWidth2(line, maxWidth);
}
function deliverText(run, opts = {}) {
  const summary = summarizeResult(run.result?.result, opts.maxChars);
  const tu = run.result?.tokenUsage;
  const cost = tu?.cost ? ` \xB7 ${fmtCost(tu.cost)}` : "";
  const segment = fmtTokenSegment(tokenFigures(tu), fmtTokensShort);
  const tokens = `${segment ? ` \xB7 ${segment}` : ""}${cost}`;
  const agents = run.result?.agentCount ?? run.snapshot.agentCount;
  const duration = run.result?.durationMs ? ` \xB7 ${(run.result.durationMs / 1e3).toFixed(1)}s` : "";
  const lines = [
    `\u2713 Background workflow "${run.snapshot.name}" finished (${agents} agents${tokens}${duration}).`,
    "",
    summary
  ];
  if (opts.resultPath) lines.push("", `\u21B3 Full result: ${opts.resultPath}`);
  return lines.join("\n");
}
function persistedResultPath(manager, runId) {
  try {
    return join9(manager.getPersistence().getRunsDir(), `${runId}.json`);
  } catch {
    return void 0;
  }
}
function deliveredMaxChars(opts) {
  try {
    return opts.loadSettings?.().deliveredResultMaxChars ?? DEFAULT_DELIVERED_MAX_CHARS;
  } catch {
    return DEFAULT_DELIVERED_MAX_CHARS;
  }
}
var sessionEndpoints = /* @__PURE__ */ new Map();
var inFlightDeliveries = /* @__PURE__ */ new Set();
installDeliverySteal();
function deliveryManager(manager) {
  return manager;
}
function resolveDeliverySessionId(run, manager) {
  return run.sessionId ?? manager.getSessionId?.();
}
function markRunPending(run, marker) {
  run.pendingDelivery = marker;
}
function clearRunPending(manager, runId, run) {
  if (run?.pendingDelivery) {
    run.pendingDelivery = void 0;
  }
  try {
    const persistence = manager.getPersistence?.();
    if (!persistence) return;
    const state = persistence.load(runId);
    if (!state?.pendingDelivery) return;
    const { pendingDelivery: _drop, ...rest } = state;
    persistence.save(rest);
    const live = run ?? manager.getRun(runId);
    if (live) live.pendingDelivery = void 0;
  } catch {
  }
}
function persistRunPendingBestEffort(manager, run) {
  try {
    const persistence = manager.getPersistence?.();
    if (!persistence) return;
    const existing = persistence.load(run.runId);
    if (existing) {
      persistence.save({ ...existing, pendingDelivery: run.pendingDelivery, sessionId: run.sessionId });
      return;
    }
    if (run.pendingDelivery) {
      persistence.save({
        runId: run.runId,
        workflowName: run.snapshot.name,
        script: run.script ?? "",
        sessionId: run.sessionId,
        status: run.status,
        phases: run.snapshot.phases ?? [],
        agents: [],
        logs: run.snapshot.logs ?? [],
        result: run.result?.result,
        tokenUsage: run.result?.tokenUsage ?? run.snapshot.tokenUsage,
        durationMs: run.result?.durationMs,
        startedAt: run.startedAt?.toISOString?.() ?? (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        pendingDelivery: run.pendingDelivery
      });
    }
  } catch {
  }
}
function contentForPending(manager, runId, marker, loadSettings, run, persisted) {
  if (marker.kind === "text") return marker.text;
  if (run) {
    return deliverText(run, {
      resultPath: persistedResultPath(manager, runId),
      maxChars: deliveredMaxChars({ loadSettings })
    });
  }
  if (persisted) {
    return deliverText(
      {
        snapshot: { name: persisted.workflowName, agentCount: persisted.agents?.length ?? 0 },
        result: {
          result: persisted.result,
          tokenUsage: persisted.tokenUsage,
          agentCount: persisted.agents?.length ?? 0,
          durationMs: persisted.durationMs
        }
      },
      {
        resultPath: persistedResultPath(manager, runId),
        maxChars: deliveredMaxChars({ loadSettings })
      }
    );
  }
  return void 0;
}
function tryDeliverEndpoint(endpoint, content) {
  if (endpoint.suspended) return Promise.resolve(false);
  if (endpoint.sessionId && sessionEndpoints.get(endpoint.sessionId) !== endpoint) {
    return Promise.resolve(false);
  }
  if (typeof endpoint.send === "function") {
    try {
      const ret = endpoint.send(
        { customType: "workflow-result", content, display: true },
        { triggerTurn: true, deliverAs: "followUp" }
      );
      if (ret != null && typeof ret.then === "function") {
        const startedGeneration = endpoint.generation;
        const sessionId = endpoint.sessionId;
        return Promise.resolve(ret).then(
          () => {
            const current = sessionEndpoints.get(sessionId);
            return !!current && !current.suspended;
          },
          (err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[workflow-delivery] async send failed; left pending on disk: ${msg}`);
            const current = sessionEndpoints.get(sessionId);
            if (current && current.generation !== startedGeneration && !current.suspended) {
            }
            return false;
          }
        );
      }
      console.warn(
        `[workflow-delivery] send for session ${endpoint.sessionId} did not return a thenable; not treating as delivered (fail closed).`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[workflow-delivery] send failed; left pending on disk: ${msg}`);
      return Promise.resolve(false);
    }
  }
  return Promise.resolve(false);
}
function deliverAndAck(manager, runId, sessionId, content, run) {
  if (inFlightDeliveries.has(runId)) return;
  const endpoint = sessionEndpoints.get(sessionId);
  if (!endpoint || endpoint.suspended || endpoint.sessionId !== sessionId) return;
  inFlightDeliveries.add(runId);
  const startedGeneration = endpoint.generation;
  void tryDeliverEndpoint(endpoint, content).then((ok) => {
    if (ok) {
      clearRunPending(manager, runId, run ?? manager.getRun?.(runId));
      return;
    }
    inFlightDeliveries.delete(runId);
    const current = sessionEndpoints.get(sessionId);
    if (current && !current.suspended && current.generation !== startedGeneration && current.manager) {
      flushSessionDiskPending(current.manager, sessionId, current);
    }
  }).finally(() => {
    inFlightDeliveries.delete(runId);
  });
}
function routeBackgroundDelivery(manager, run, marker, content) {
  markRunPending(run, marker);
  persistRunPendingBestEffort(manager, run);
  const sessionId = resolveDeliverySessionId(run, manager);
  if (!sessionId) {
    console.warn(`[workflow-delivery] run ${run.runId} has no sessionId; leaving pending on disk (fail closed).`);
    return;
  }
  deliverAndAck(manager, run.runId, sessionId, content, run);
}
function bindSessionDelivery(sessionId, _pi, opts = {}) {
  if (!sessionId) return;
  patchAgentSessionCapture();
  patchBindCoreObserve();
  const stolen = opts.stableSend ?? recaptureHostSessionSend(sessionId);
  if (!stolen) {
    console.warn(
      `[workflow-delivery] no session-stable thenable send for session ${sessionId}; endpoint registered fail-closed (completions stay on disk until a host send is captured).`
    );
  }
  try {
    const liveId = opts.sessionManager?.getSessionId?.();
    if (liveId && liveId !== sessionId) {
      console.warn(`[workflow-delivery] refusing bind: sessionManager id ${liveId} !== endpoint ${sessionId}`);
      return;
    }
  } catch {
  }
  const prev = sessionEndpoints.get(sessionId);
  const endpoint = {
    sessionId,
    send: stolen,
    loadSettings: opts.loadSettings ?? prev?.loadSettings,
    suspended: false,
    generation: (prev?.generation ?? 0) + 1,
    manager: opts.manager ?? prev?.manager
  };
  sessionEndpoints.set(sessionId, endpoint);
  if (endpoint.manager) flushSessionDiskPending(endpoint.manager, sessionId, endpoint);
}
function suspendSessionDelivery(sessionId) {
  if (!sessionId) return;
  const endpoint = sessionEndpoints.get(sessionId);
  if (endpoint) endpoint.suspended = true;
}
function dropSessionDelivery(sessionId) {
  if (!sessionId) return;
  sessionEndpoints.delete(sessionId);
  deleteBoundSessionSend(sessionId);
}
function flushSessionDiskPending(manager, sessionId, endpoint) {
  if (endpoint.suspended) return;
  const tryOne = (runId, marker, run, persisted) => {
    if (inFlightDeliveries.has(runId)) return;
    const content = contentForPending(manager, runId, marker, endpoint.loadSettings, run, persisted);
    if (content === void 0) return;
    deliverAndAck(manager, runId, sessionId, content, run);
  };
  try {
    for (const run of manager.listLiveRuns?.() ?? []) {
      if (!run.pendingDelivery) continue;
      if (run.sessionId != null && run.sessionId !== sessionId) continue;
      if (run.sessionId == null) run.sessionId = sessionId;
      tryOne(run.runId, run.pendingDelivery, run);
    }
  } catch {
  }
  try {
    const persistence = manager.getPersistence?.();
    if (!persistence) return;
    for (const state of persistence.list()) {
      if (!state.pendingDelivery) continue;
      if (state.sessionId !== sessionId) continue;
      const live = manager.getRun?.(state.runId);
      if (live?.pendingDelivery) continue;
      tryOne(state.runId, state.pendingDelivery, live, state);
    }
  } catch {
  }
}
function suspendResultDelivery(manager) {
  suspendSessionDelivery(manager.getSessionId?.());
}
function installResultDelivery(_pi, manager, opts = {}) {
  const m = deliveryManager(manager);
  m.__deliveryLoadSettings = opts.loadSettings;
  patchAgentSessionCapture();
  patchBindCoreObserve();
  if (m.__deliveryInstalled) {
    const sid = manager.getSessionId?.();
    if (sid) {
      const endpoint = sessionEndpoints.get(sid);
      if (endpoint) {
        endpoint.loadSettings = opts.loadSettings ?? endpoint.loadSettings;
        endpoint.manager = manager;
      }
    }
    return;
  }
  m.__deliveryInstalled = true;
  manager.on("complete", ({ runId }) => {
    const run = manager.getRun(runId);
    if (!run?.background) return;
    const sessionId = resolveDeliverySessionId(run, manager);
    const endpoint = sessionId ? sessionEndpoints.get(sessionId) : void 0;
    const content = deliverText(run, {
      resultPath: persistedResultPath(manager, runId),
      maxChars: deliveredMaxChars({
        loadSettings: endpoint?.loadSettings ?? m.__deliveryLoadSettings
      })
    });
    routeBackgroundDelivery(manager, run, { kind: "complete" }, content);
  });
  manager.on("error", ({ runId, error }) => {
    const run = manager.getRun(runId);
    if (!run?.background) return;
    const text = `\u2717 Background workflow ${runId} failed: ${error?.message ?? "unknown error"}`;
    routeBackgroundDelivery(manager, run, { kind: "text", text }, text);
  });
  manager.on(
    "paused",
    ({
      runId,
      reason,
      error,
      resetHint
    }) => {
      if (reason !== "usage_limit") return;
      const run = manager.getRun(runId);
      if (!run?.background) return;
      const when = resetHint ? ` (${resetHint})` : "";
      const cause = error?.message ?? "provider usage limit reached";
      const text = `\u23F8 Background workflow ${runId} paused: ${cause}${when}. Completed steps are saved \u2014 run /workflows resume ${runId} once your usage limit resets.`;
      routeBackgroundDelivery(manager, run, { kind: "text", text }, text);
    }
  );
}
function renderPanel(manager, theme, width) {
  const all = manager.listRuns();
  const active = all.filter((r) => r.status === "running" || r.status === "paused");
  if (!active.length) return [];
  const rows = active.map((r) => {
    const live = manager.getRun(r.runId);
    const agents = live?.snapshot.agents ?? r.agents;
    const done = agents.filter((a) => a.status === "done").length;
    const icon = r.status === "paused" ? "\u23F8" : "\u25C6";
    const phase = live?.snapshot.currentPhase ? ` \xB7 ${live.snapshot.currentPhase}` : "";
    return `  ${icon} ${r.workflowName}  ${done}/${agents.length} agents${phase}`;
  });
  const finished = all.filter((r) => r.status !== "running" && r.status !== "paused").length;
  const hint = theme.fg(
    "dim",
    finished > 0 ? `  /workflows \u2014 open navigator (${finished} finished kept in history)` : "  /workflows \u2014 open navigator"
  );
  return [theme.bold(`Workflows running (${active.length}):`), ...rows, hint].map((line) => fitLine(line, width));
}
var RATE_WINDOW_MS = 1e4;
var tokenSamples = /* @__PURE__ */ new Map();
function sampleTokens(runId, total, now) {
  const samples = tokenSamples.get(runId) ?? [];
  const last = samples[samples.length - 1];
  if (last && last.ts === now && last.total === total) return;
  samples.push({ ts: now, total });
  while (samples.length > 2 && now - samples[0].ts > RATE_WINDOW_MS) samples.shift();
  tokenSamples.set(runId, samples);
}
function tokensPerSecond(runId) {
  const samples = tokenSamples.get(runId);
  if (!samples || samples.length < 2) return 0;
  const oldest = samples[0];
  const newest = samples[samples.length - 1];
  const elapsedMs = newest.ts - oldest.ts;
  if (elapsedMs <= 0) return 0;
  const delta = newest.total - oldest.total;
  if (delta <= 0) return 0;
  return delta / elapsedMs * 1e3;
}
function clearTokenSamples(runId) {
  tokenSamples.delete(runId);
}
function fmtTokensShort(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1e3) return `${Math.round(n)}`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}K`;
  return `${(n / 1e6).toFixed(1)}M`;
}
function clampMaxAgents(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return 8;
  return Math.min(1e3, Math.floor(value));
}
function renderRunBody(snap, agents, maxAgents, theme) {
  const dim = (t) => theme.fg("dim", t);
  const lines = [];
  const order = snap.phases.length ? [...snap.phases] : [];
  const byPhase = /* @__PURE__ */ new Map();
  for (const a of agents) {
    const key = a.phase ?? "(no phase)";
    if (!byPhase.has(key)) byPhase.set(key, []);
    byPhase.get(key)?.push(a);
    if (!order.includes(key)) order.push(key);
  }
  for (const title of order) {
    const phaseAgents = byPhase.get(title) ?? [];
    if (!phaseAgents.length) continue;
    const done = phaseAgents.filter((a) => a.status === "done").length;
    const running = phaseAgents.filter((a) => a.status === "running").length;
    const errors = phaseAgents.filter((a) => a.status === "error").length;
    const skipped = phaseAgents.filter((a) => a.status === "skipped").length;
    const complete = done + errors + skipped === phaseAgents.length;
    const marker = running > 0 || !complete && snap.currentPhase === title ? "\u25B6" : complete ? "\u2713" : " ";
    const phaseMeta = [
      `${done}/${phaseAgents.length} agents`,
      running ? `${running} running` : "",
      errors ? `${errors} errors` : "",
      fmtTokenSegment(aggregateAgentUsage(phaseAgents), fmtTokensShort)
    ].filter(Boolean).join(" \xB7 ");
    lines.push(theme.fg("accent", `  ${marker} ${title}`) + dim(`  ${phaseMeta}`));
    const visible = phaseAgents.slice(-maxAgents);
    for (const a of visible) {
      const segment = fmtTokenSegment(tokenFigures(a.tokenUsage, a.tokens), fmtTokensShort);
      const tok = segment ? dim(` ${segment}`) : "";
      const mdl = shortModel(a.model);
      const model = mdl ? dim(` \xB7 ${mdl}`) : "";
      lines.push(`    [${a.id}] ${statusIcon(a.status)} ${shorten(a.label, 40)}${tok}${model}`);
    }
    if (phaseAgents.length > visible.length) {
      lines.push(dim(`    \u2026 ${phaseAgents.length - visible.length} earlier agents`));
    }
  }
  return lines;
}
function renderPanelDetailed(manager, theme, width, maxAgents, now) {
  const all = manager.listRuns();
  const active = all.filter((r) => r.status === "running" || r.status === "paused");
  if (!active.length) return [];
  const dim = (t) => theme.fg("dim", t);
  const out = [theme.bold(`Workflows running (${active.length}):`)];
  for (const r of active) {
    const live = manager.getRun(r.runId);
    const snap = live?.snapshot;
    const agents = snap?.agents ?? r.agents;
    const done = agents.filter((a) => a.status === "done").length;
    const icon = r.status === "paused" ? "\u23F8" : "\u25C6";
    const usage = snap?.tokenUsage ?? r.tokenUsage;
    const runUsage = aggregateAgentUsage(agents);
    sampleTokens(r.runId, runUsage.fresh + runUsage.cacheRead, now);
    const rate = r.status === "running" ? tokensPerSecond(r.runId) : 0;
    const meta = [
      `${done}/${agents.length} agents`,
      snap?.currentPhase || "",
      fmtTokenSegment(runUsage, fmtTokensShort),
      // (cost is only known once the run finalizes its usage.)
      usage?.cost ? fmtCost(usage.cost) : "",
      rate > 0 ? `${Math.round(rate)} tok/s` : ""
    ].filter(Boolean).join(" \xB7 ");
    out.push(`  ${icon} ${theme.bold(r.workflowName)}  ${dim(meta)}`);
    if (snap) out.push(...renderRunBody(snap, agents, maxAgents, theme));
  }
  const finished = all.filter((r) => r.status !== "running" && r.status !== "paused").length;
  out.push(
    dim(
      finished > 0 ? `  /workflows \u2014 open navigator (${finished} finished kept in history)` : "  /workflows \u2014 open navigator"
    )
  );
  return out.map((line) => fitLine(line, width));
}
function installTaskPanel(_pi, manager, ui, opts = {}) {
  let cached = {};
  let cachedAt = Number.NEGATIVE_INFINITY;
  const settings = () => {
    if (!opts.loadSettings) return cached;
    const now = Date.now();
    if (now - cachedAt > 1e3) {
      try {
        cached = opts.loadSettings() ?? {};
      } catch {
        cached = {};
      }
      cachedAt = now;
    }
    return cached;
  };
  const hasActiveRun = () => manager.listRuns().some((r) => r.status === "running" || r.status === "paused");
  ui.setWidget(
    "workflow-tasks",
    (tui, theme) => {
      const onEvent = () => tui.requestRender();
      for (const ev of RUN_EVENTS) manager.on(ev, onEvent);
      const onRunEnd = ({ runId }) => clearTokenSamples(runId);
      for (const ev of RUN_END_EVENTS) manager.on(ev, onRunEnd);
      const timer = setInterval(() => {
        if (settings().progressPanelMode === "detailed" && hasActiveRun()) tui.requestRender();
      }, 2e3);
      timer.unref?.();
      const comp = {
        render: (width) => {
          const s = settings();
          if (s.progressPanelMode === "detailed") {
            return renderPanelDetailed(manager, theme, width, clampMaxAgents(s.progressPanelMaxAgents), Date.now());
          }
          return renderPanel(manager, theme, width);
        },
        invalidate: () => {
        },
        dispose: () => {
          clearInterval(timer);
          for (const ev of RUN_EVENTS) manager.off(ev, onEvent);
          for (const ev of RUN_END_EVENTS) manager.off(ev, onRunEnd);
        }
      };
      return comp;
    },
    { placement: "belowEditor" }
  );
}

// src/usage-limit-scheduler.ts
var DEFAULT_MAX_ATTEMPTS = 5;
var DEFAULT_MIN_DELAY_MS = 6e4;
var DEFAULT_FALLBACK_DELAY_MS = 3e5;
var DEFAULT_MAX_DELAY_MS = 6 * 60 * 60 * 1e3;
function parseResetHintMs(hint) {
  if (!hint) return void 0;
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)(?![a-z])/gi;
  let match;
  let totalMs = 0;
  let found = false;
  while ((match = re.exec(hint)) !== null) {
    const value = Number.parseFloat(match[1]);
    if (!Number.isFinite(value)) continue;
    const unit = match[2].toLowerCase();
    found = true;
    if (unit.startsWith("h")) totalMs += value * 36e5;
    else if (unit.startsWith("m")) totalMs += value * 6e4;
    else if (unit.startsWith("s")) totalMs += value * 1e3;
  }
  return found ? totalMs : void 0;
}
function computeAutoResumeDelayMs(params) {
  const base = parseResetHintMs(params.resetHint) ?? params.fallbackDelayMs;
  const remaining = base - params.elapsedMs;
  const exponent = Math.min(Math.max(params.attempts - 1, 0), 30);
  const backoff = remaining * 2 ** exponent;
  return Math.min(params.maxDelayMs, Math.max(params.minDelayMs, backoff));
}
var UsageLimitScheduler = class {
  manager;
  now;
  setTimer;
  clearTimer;
  maxAttempts;
  minDelayMs;
  fallbackDelayMs;
  maxDelayMs;
  diagnostic;
  state = /* @__PURE__ */ new Map();
  disposed = false;
  /**
   * Runs this scheduler is currently auto-resuming (its own timer fired). Used to
   * tell an auto-resume's "resumed" event apart from a manual one: an auto-resume
   * must keep the backoff counter (it IS the backoff), a manual resume resets it.
   */
  autoResumingRunIds = /* @__PURE__ */ new Set();
  onPaused = (event) => {
    this.safe(() => this.handlePaused(event));
  };
  onTerminal = (event) => {
    this.safe(() => this.cleanup(event?.runId));
  };
  onResumed = (event) => {
    this.safe(() => this.handleResumed(event));
  };
  constructor(manager, options = {}) {
    this.manager = manager;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.minDelayMs = options.minDelayMs ?? DEFAULT_MIN_DELAY_MS;
    this.fallbackDelayMs = options.fallbackDelayMs ?? DEFAULT_FALLBACK_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    this.diagnostic = options.onDiagnostic ?? ((message, detail) => {
      console.warn(message, detail ?? "");
    });
    this.manager.on("paused", this.onPaused);
    this.manager.on("resumed", this.onResumed);
    this.manager.on("complete", this.onTerminal);
    this.manager.on("error", this.onTerminal);
    this.manager.on("stopped", this.onTerminal);
    this.safe(() => this.coldStartRearm());
  }
  /** Clear every armed timer and unsubscribe from the manager. Idempotent. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.manager.off("paused", this.onPaused);
    this.manager.off("resumed", this.onResumed);
    this.manager.off("complete", this.onTerminal);
    this.manager.off("error", this.onTerminal);
    this.manager.off("stopped", this.onTerminal);
    for (const entry of this.state.values()) {
      if (entry.timer !== void 0) this.clearTimer(entry.timer);
    }
    this.state.clear();
  }
  /** Test/diagnostic helper: in-memory attempt count tracked for a run, if any. */
  getAttemptCount(runId) {
    return this.state.get(runId)?.attempts;
  }
  /** Test/diagnostic helper: whether a resume timer is currently armed for a run. */
  hasArmedTimer(runId) {
    return this.state.get(runId)?.timer !== void 0;
  }
  // ---- event handlers -----------------------------------------------------
  handlePaused(event) {
    if (this.disposed || !event?.runId || event.reason !== "usage_limit") return;
    const runId = event.runId;
    const persisted = this.safeLoad(runId);
    if (persisted?.autoResume === false) {
      this.diagnostic(`[usage-limit-scheduler] ${runId}: autoResume is disabled for this run, not arming`);
      return;
    }
    const priorAttempts = this.state.get(runId)?.attempts ?? persisted?.autoResumeAttempts ?? 0;
    this.arm(runId, {
      attempts: priorAttempts + 1,
      resetHint: event.resetHint ?? persisted?.resetHint,
      elapsedMs: 0
    });
  }
  cleanup(runId) {
    if (!runId) return;
    const entry = this.state.get(runId);
    if (entry?.timer !== void 0) this.clearTimer(entry.timer);
    this.state.delete(runId);
  }
  /**
   * A run was resumed. If WE resumed it (auto-resume timer fired), leave the
   * backoff counter alone — that's the sequence doing its job, and it must still
   * be able to reach the cap. If a human resumed it (via /workflows), treat that
   * as a deliberate fresh start: drop the in-memory given-up state and reset the
   * persisted counter so a later pause re-enters the normal backoff from attempt 1
   * instead of staying silently given-up forever.
   */
  handleResumed(event) {
    if (this.disposed || !event?.runId) return;
    if (this.autoResumingRunIds.has(event.runId)) return;
    this.cleanup(event.runId);
    this.persistAttempts(event.runId, 0);
  }
  coldStartRearm() {
    const runs = this.manager.listAllRuns();
    for (const run of runs) {
      if (run.status !== "paused" || run.pauseReason !== "usage_limit") continue;
      if (run.autoResume === false) continue;
      if (this.state.has(run.runId)) continue;
      const priorAttempts = run.autoResumeAttempts ?? 0;
      const updatedAtMs = Date.parse(run.updatedAt);
      const elapsedMs = Number.isFinite(updatedAtMs) ? Math.max(0, this.now() - updatedAtMs) : 0;
      this.arm(run.runId, {
        attempts: priorAttempts + 1,
        resetHint: run.resetHint,
        elapsedMs
      });
    }
  }
  // ---- arming / firing ------------------------------------------------------
  arm(runId, params) {
    const existing = this.state.get(runId);
    if (existing?.timer !== void 0) this.clearTimer(existing.timer);
    if (params.attempts > this.maxAttempts) {
      const alreadyLogged = existing?.gaveUp === true;
      const frozen = this.maxAttempts + 1;
      this.state.set(runId, { attempts: frozen, gaveUp: true });
      this.persistAttempts(runId, frozen);
      if (!alreadyLogged && params.attempts <= frozen) {
        this.diagnostic(
          `[usage-limit-scheduler] ${runId}: giving up after ${this.maxAttempts} auto-resume attempt(s) (max ${this.maxAttempts}); leaving paused for manual resume`
        );
      }
      return;
    }
    const delay = computeAutoResumeDelayMs({
      resetHint: params.resetHint,
      attempts: params.attempts,
      elapsedMs: params.elapsedMs,
      minDelayMs: this.minDelayMs,
      fallbackDelayMs: this.fallbackDelayMs,
      maxDelayMs: this.maxDelayMs
    });
    const timer = this.setTimer(() => this.safe(() => this.onTimerFire(runId)), delay);
    this.state.set(runId, { attempts: params.attempts, timer });
    this.persistAttempts(runId, params.attempts);
  }
  async onTimerFire(runId) {
    if (this.disposed) return;
    const entry = this.state.get(runId);
    if (!entry || entry.gaveUp) return;
    this.state.set(runId, { ...entry, timer: void 0 });
    let resumed = false;
    this.autoResumingRunIds.add(runId);
    try {
      resumed = await this.manager.resume(runId);
    } catch (err) {
      this.diagnostic(`[usage-limit-scheduler] ${runId}: resume() threw`, err);
      resumed = false;
    } finally {
      this.autoResumingRunIds.delete(runId);
    }
    if (this.disposed) return;
    if (resumed) {
      return;
    }
    const status = this.safeStatus(runId);
    if (status === void 0 || status === "completed" || status === "aborted") {
      this.cleanup(runId);
      return;
    }
    const current = this.state.get(runId) ?? entry;
    const timer = this.setTimer(() => this.safe(() => this.onTimerFire(runId)), this.minDelayMs);
    this.state.set(runId, { attempts: current.attempts, timer });
  }
  // ---- helpers --------------------------------------------------------------
  safeLoad(runId) {
    try {
      return this.manager.getPersistence().load(runId) ?? void 0;
    } catch (err) {
      this.diagnostic(`[usage-limit-scheduler] ${runId}: persistence load failed`, err);
      return void 0;
    }
  }
  safeStatus(runId) {
    try {
      return this.manager.listAllRuns().find((r) => r.runId === runId)?.status;
    } catch (err) {
      this.diagnostic(`[usage-limit-scheduler] ${runId}: listAllRuns() failed`, err);
      return void 0;
    }
  }
  /**
   * Best-effort persist of the in-memory attempt counter, so a cold start after
   * a crash can approximately resume the backoff sequence instead of restarting
   * it. Deferred to a microtask so it lands AFTER the manager's own persistRun()
   * write for this same pause (which happens synchronously, right after the
   * "paused" event we're reacting to returns control to executeRun()) — writing
   * synchronously here would just get clobbered, since persistRun() writes a
   * fresh PersistedRunState object literal that doesn't know about this field.
   * This is still inherently racy across process crashes (see class docs); it
   * is a best-effort durability aid, not a correctness requirement for the live
   * (in-memory) path.
   */
  persistAttempts(runId, attempts) {
    queueMicrotask(() => {
      if (this.disposed) return;
      try {
        const persistence = this.manager.getPersistence();
        const current = persistence.load(runId);
        if (!current) return;
        persistence.save({ ...current, autoResumeAttempts: attempts });
      } catch (err) {
        this.diagnostic(`[usage-limit-scheduler] ${runId}: failed to persist autoResumeAttempts`, err);
      }
    });
  }
  safe(fn) {
    try {
      const result2 = fn();
      if (result2 && typeof result2.catch === "function") {
        result2.catch((err) => {
          this.diagnostic("[usage-limit-scheduler] async handler error", err);
        });
      }
    } catch (err) {
      this.diagnostic("[usage-limit-scheduler] handler error", err);
    }
  }
};

// src/workflow-settings.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync4, readFileSync as readFileSync4, writeFileSync as writeFileSync5 } from "node:fs";
import { dirname as dirname2, join as join10 } from "node:path";
function getWorkflowSettingsPath() {
  return join10(workflowHomeDir(), "settings.json");
}
function getWorkflowProjectSettingsPath(cwd) {
  return workflowProjectPaths(cwd).settingsPath;
}
function loadWorkflowSettings(settingsPathOrOptions) {
  const options = normalizeOptions(settingsPathOrOptions);
  const globalSettings = readSettings(options.settingsPath ?? getWorkflowSettingsPath());
  const projectPath = options.projectSettingsPath ?? (options.cwd ? getWorkflowProjectSettingsPath(options.cwd) : void 0);
  if (!projectPath) return globalSettings;
  return { ...globalSettings, ...readSettings(projectPath) };
}
function saveWorkflowSettings(settings, settingsPathOrOptions) {
  const options = normalizeOptions(settingsPathOrOptions);
  const projectPath = options.projectSettingsPath ?? (options.cwd ? getWorkflowProjectSettingsPath(options.cwd) : void 0);
  const path = options.scope === "project" && projectPath ? projectPath : options.settingsPath ?? getWorkflowSettingsPath();
  const dir = dirname2(path);
  if (!existsSync4(dir)) mkdirSync4(dir, { recursive: true });
  const existing = readObject(path);
  writeFileSync5(path, `${JSON.stringify({ ...existing, ...normalizeSettings(settings) }, null, 2)}
`, "utf-8");
}
function saveWorkflowSettingsForCwd(settings, cwd) {
  saveWorkflowSettings(settings);
  const projectPath = getWorkflowProjectSettingsPath(cwd);
  if (existsSync4(projectPath)) {
    saveWorkflowSettings(settings, { projectSettingsPath: projectPath, scope: "project" });
  }
}
function normalizeOptions(settingsPathOrOptions) {
  return typeof settingsPathOrOptions === "string" ? { settingsPath: settingsPathOrOptions } : settingsPathOrOptions ?? {};
}
function readSettings(path) {
  if (!existsSync4(path)) return {};
  try {
    return normalizeSettings(JSON.parse(readFileSync4(path, "utf-8")));
  } catch {
    return {};
  }
}
function normalizeSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value;
  const settings = {};
  if (typeof raw.keywordTriggerEnabled === "boolean") {
    settings.keywordTriggerEnabled = raw.keywordTriggerEnabled;
  }
  const keywordTriggerWord = normalizeKeywordTriggerWord(raw.keywordTriggerWord);
  if (keywordTriggerWord !== void 0) settings.keywordTriggerWord = keywordTriggerWord;
  if (raw.defaultAgentTimeoutMs === null) {
    settings.defaultAgentTimeoutMs = null;
  } else if (typeof raw.defaultAgentTimeoutMs === "number" && Number.isFinite(raw.defaultAgentTimeoutMs) && raw.defaultAgentTimeoutMs > 0) {
    settings.defaultAgentTimeoutMs = raw.defaultAgentTimeoutMs;
  }
  if (raw.defaultTokenBudget === null) {
    settings.defaultTokenBudget = null;
  } else {
    const defaultTokenBudget = normalizeInteger(raw.defaultTokenBudget, 1, Number.MAX_SAFE_INTEGER);
    if (defaultTokenBudget !== void 0) settings.defaultTokenBudget = defaultTokenBudget;
  }
  const defaultConcurrency = normalizeInteger(raw.defaultConcurrency, 1, MAX_CONCURRENCY);
  if (defaultConcurrency !== void 0) settings.defaultConcurrency = defaultConcurrency;
  const defaultAgentRetries = normalizeInteger(raw.defaultAgentRetries, 0, MAX_AGENT_RETRIES);
  if (defaultAgentRetries !== void 0) settings.defaultAgentRetries = defaultAgentRetries;
  if (raw.progressPanelMode === "compact" || raw.progressPanelMode === "detailed") {
    settings.progressPanelMode = raw.progressPanelMode;
  }
  if (typeof raw.progressPanelMaxAgents === "number" && Number.isFinite(raw.progressPanelMaxAgents) && raw.progressPanelMaxAgents >= 1) {
    settings.progressPanelMaxAgents = Math.min(1e3, Math.floor(raw.progressPanelMaxAgents));
  }
  if (typeof raw.persistAgentSessions === "boolean") {
    settings.persistAgentSessions = raw.persistAgentSessions;
  }
  const deliveredResultMaxChars = normalizeInteger(raw.deliveredResultMaxChars, 1, 1e6);
  if (deliveredResultMaxChars !== void 0) settings.deliveredResultMaxChars = deliveredResultMaxChars;
  if (Array.isArray(raw.excludeSubagentTools)) {
    const names = raw.excludeSubagentTools.filter((t) => typeof t === "string" && t.trim().length > 0);
    if (names.length) settings.excludeSubagentTools = names;
  }
  return settings;
}
function normalizeInteger(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) return void 0;
  return Math.min(max, Math.floor(value));
}
function readObject(path) {
  if (!existsSync4(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync4(path, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// src/workflow-editor.ts
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function triggerSource(triggerWord) {
  const escaped = escapeRegExp(triggerWord);
  const plural = triggerWord.toLowerCase() === DEFAULT_KEYWORD_TRIGGER_WORD ? "s?" : "";
  return `(?<![/\\p{ID_Continue}$-])(?<!\\\\)${escaped}${plural}(?![/\\p{ID_Continue}$-])(?!\\\\)`;
}
function triggerRegex(triggerWord = DEFAULT_KEYWORD_TRIGGER_WORD, flags = "iu", atEnd = false) {
  const word = normalizeKeywordTriggerWord(triggerWord) ?? DEFAULT_KEYWORD_TRIGGER_WORD;
  return new RegExp(`${triggerSource(word)}${atEnd ? "$" : ""}`, flags);
}
function hasTrigger(text, triggerWord = DEFAULT_KEYWORD_TRIGGER_WORD) {
  return triggerRegex(triggerWord).test(text);
}
var EFFORT_CONVERSATIONAL_ESCAPE = "This turn was armed by standing effort mode, not by an explicit workflow request: if it is conversational or trivial, skip the workflow and just respond directly.";
function armReasonClause(reason) {
  return reason === "keyword" ? "you typed the workflow trigger word, which counts as an explicit opt-in to multi-agent orchestration" : "standing effort mode armed this turn (you did not explicitly ask for a workflow)";
}
var BACKGROUND_DELIVERY_REASSURANCE = "If you do call `workflow`, it runs in the background by default: this turn will end and the result is delivered back into the conversation automatically when it finishes \u2014 that's expected, not a stall, so you do not need to stay and block. Only pass background:false if the user is waiting for the result inline in this same turn.";
function buildArmedWorkflowPrompt(text, opts = {}) {
  const reason = opts.reason ?? "keyword";
  const lines = [
    text,
    "",
    "---",
    "[workflows mode armed. Decide first: if this message is a question, a trivial task, or",
    "just talk (about workflows, this repo, or the tool itself), answer it directly and stay",
    "conversational \u2014 arming authorizes the tool, it does not force it. If it is a real,",
    "decomposable request to do work, handle it by calling the `workflow` tool: write a script",
    "that fans the task out across subagents via agent()/parallel()/pipeline().",
    `Why this turn is armed: ${armReasonClause(reason)}.`,
    BACKGROUND_DELIVERY_REASSURANCE + "]"
  ];
  if (opts.extraDirective) lines.push("", opts.extraDirective);
  return lines.join("\n");
}
function buildForcedWorkflowPrompt(text, extraDirective) {
  const lines = [
    text,
    "",
    "---",
    "[/workflows run \u2014 you ran an explicit command to execute a workflow for this request.",
    "Call the `workflow` tool now: write a script that fans this task out across subagents",
    "via agent()/parallel()/pipeline(). (This is a direct command, not a heuristic guess, so",
    "do not answer in prose instead of running the workflow.)",
    BACKGROUND_DELIVERY_REASSURANCE + "]"
  ];
  if (extraDirective) lines.push("", extraDirective);
  return lines.join("\n");
}
var WORKFLOW_TOOL_NAME = "workflow";
function registerWorkflowTriggerCommand(pi, state, settingsStore = DEFAULT_SETTINGS_STORE) {
  pi.registerCommand?.("workflows-trigger", {
    description: "Keyword workflow trigger: on | off | set <word> | reset | status",
    async handler(args, _ctx) {
      const raw = args.trim();
      const [command = "status", ...rest] = raw.split(/\s+/);
      const arg = command.toLowerCase();
      const say = (content) => pi.sendMessage({ customType: "workflows-trigger", content, display: true });
      if (arg === "on") {
        state.keywordTriggerEnabled = true;
        state.suppressedKeywordText = void 0;
        const saved = persistWorkflowTriggerSettings(settingsStore, { keywordTriggerEnabled: true });
        await say(
          saved ? `Workflows keyword trigger on \u2014 mentioning ${triggerDisplayName(state.keywordTriggerWord)} in an interactive message will auto-arm workflows mode. Saved for new sessions.` : "Workflows keyword trigger on for this session, but the preference could not be saved."
        );
        return;
      }
      if (arg === "off") {
        state.keywordTriggerEnabled = false;
        state.active = false;
        state.suppressedKeywordText = void 0;
        const saved = persistWorkflowTriggerSettings(settingsStore, { keywordTriggerEnabled: false });
        await say(
          saved ? `Workflows keyword trigger off \u2014 messages can mention ${triggerDisplayName(state.keywordTriggerWord)} without forcing the workflow tool. Saved for new sessions. Use /workflows-trigger on to restore.` : "Workflows keyword trigger off for this session, but the preference could not be saved. Use /workflows-trigger on to restore."
        );
        return;
      }
      if (arg === "set") {
        const requested = rest.join(" ");
        const keywordTriggerWord2 = normalizeKeywordTriggerWord(requested);
        if (!keywordTriggerWord2) {
          await say(
            'Invalid trigger word. Use a non-empty term with no spaces and no leading "/", e.g. /workflows-trigger set pi-workflow'
          );
          return;
        }
        state.keywordTriggerWord = keywordTriggerWord2;
        state.suppressedKeywordText = void 0;
        const saved = persistWorkflowTriggerSettings(settingsStore, { keywordTriggerWord: keywordTriggerWord2 });
        await say(
          saved ? `Workflows keyword trigger word set to "${keywordTriggerWord2}". Saved for new sessions.` : `Workflows keyword trigger word set to "${keywordTriggerWord2}" for this session, but the preference could not be saved.`
        );
        return;
      }
      if (arg === "reset") {
        state.keywordTriggerWord = DEFAULT_KEYWORD_TRIGGER_WORD;
        state.suppressedKeywordText = void 0;
        const saved = persistWorkflowTriggerSettings(settingsStore, {
          keywordTriggerWord: DEFAULT_KEYWORD_TRIGGER_WORD
        });
        await say(
          saved ? 'Workflows keyword trigger word reset to "workflow" (also matches "workflows"). Saved for new sessions.' : 'Workflows keyword trigger word reset to "workflow" for this session, but the preference could not be saved.'
        );
        return;
      }
      const keywordTriggerWord = resolvedTriggerWord(state.keywordTriggerWord);
      await say(
        `Workflows keyword trigger is ${state.keywordTriggerEnabled ? "on" : "off"}; trigger word is "${keywordTriggerWord}". Changes are saved for new sessions. Usage: /workflows-trigger on | off | set <word> | reset | status`
      );
    }
  });
}
function registerWorkflowProgressCommands(pi, settingsStore = DEFAULT_SETTINGS_STORE) {
  pi.registerCommand?.("workflows-progress", {
    description: "Bottom progress panel: compact | detailed | status | max <N>",
    async handler(args, _ctx) {
      const trimmed = args.trim();
      const say = (content) => pi.sendMessage({ customType: "workflows-progress", content, display: true });
      const spaceIdx = trimmed.indexOf(" ");
      const verb = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
      const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
      if (verb === "compact" || verb === "detailed") {
        const saved = persistProgressSettings(settingsStore, { progressPanelMode: verb });
        await say(
          saved ? `Workflow progress panel set to ${verb} \u2014 takes effect on the next render of a live run (no restart needed).` : `Workflow progress panel set to ${verb} for this session, but the preference could not be saved.`
        );
        return;
      }
      if (verb === "max") {
        if (!rest) {
          await say(
            `Detailed progress shows up to ${loadProgressMaxAgents(settingsStore)} agents per phase. Usage: /workflows-progress max <1-1000>`
          );
          return;
        }
        const n = Number.parseInt(rest, 10);
        if (!Number.isFinite(n) || n < 1) {
          await say(`Invalid value "${rest}". Usage: /workflows-progress max <1-1000> (a whole number \u2265 1).`);
          return;
        }
        const clamped = Math.min(1e3, n);
        const saved = persistProgressSettings(settingsStore, { progressPanelMaxAgents: clamped });
        await say(
          saved ? `Detailed progress now shows up to ${clamped} agents per phase.` : `Set to ${clamped} for this session, but the preference could not be saved.`
        );
        return;
      }
      await say(
        `Workflow progress panel is ${loadProgressMode(settingsStore)}, showing up to ${loadProgressMaxAgents(settingsStore)} agents per phase. Usage: /workflows-progress compact | detailed | status | max <N>`
      );
    }
  });
}
function installWorkflowKeywordArming(pi, effort, options = {}) {
  const settingsStore = options.settingsStore ?? DEFAULT_SETTINGS_STORE;
  const initialSettings = loadInitialWorkflowSettings(settingsStore);
  const state = {
    active: false,
    keywordTriggerEnabled: initialSettings.keywordTriggerEnabled ?? true,
    keywordTriggerWord: initialSettings.keywordTriggerWord ?? DEFAULT_KEYWORD_TRIGGER_WORD
  };
  registerWorkflowTriggerCommand(pi, state, settingsStore);
  registerWorkflowProgressCommands(pi, settingsStore);
  let savedTools;
  pi.on("input", (event) => {
    if (event.source !== "interactive" || !event.text) return { action: "continue" };
    const normalizedText = event.text.trim();
    const suppressed = state.suppressedKeywordText === normalizedText;
    if (suppressed) state.suppressedKeywordText = void 0;
    const triggered = state.keywordTriggerEnabled && !suppressed && hasTrigger(event.text, state.keywordTriggerWord);
    const byEffort = !triggered && !!effort && effort.level !== "off" && isSubstantive(event.text);
    if (!triggered && !byEffort) return { action: "continue" };
    try {
      if (savedTools === void 0) {
        savedTools = pi.getActiveTools?.() ?? [];
        const current = [...savedTools];
        if (!current.includes(WORKFLOW_TOOL_NAME)) {
          current.push(WORKFLOW_TOOL_NAME);
        }
        pi.setActiveTools?.(current);
      }
    } catch {
    }
    const extra = byEffort && effort ? [effortDirective(effort.level), EFFORT_CONVERSATIONAL_ESCAPE].filter(Boolean).join(" ") : void 0;
    const reason = byEffort ? "effort" : "keyword";
    return {
      action: "transform",
      text: buildArmedWorkflowPrompt(event.text, { reason, extraDirective: extra })
    };
  });
  pi.on("turn_end", () => {
    if (savedTools === void 0) return;
    const restore = savedTools;
    savedTools = void 0;
    try {
      pi.setActiveTools?.(restore);
    } catch {
    }
  });
  return state;
}
var DEFAULT_SETTINGS_STORE = {
  load: loadWorkflowSettings,
  save: saveWorkflowSettings
};
function loadInitialWorkflowSettings(settingsStore) {
  try {
    const settings = settingsStore.load();
    return {
      keywordTriggerEnabled: settings.keywordTriggerEnabled,
      keywordTriggerWord: normalizeKeywordTriggerWord(settings.keywordTriggerWord) ?? DEFAULT_KEYWORD_TRIGGER_WORD
    };
  } catch {
    return { keywordTriggerEnabled: true, keywordTriggerWord: DEFAULT_KEYWORD_TRIGGER_WORD };
  }
}
function persistWorkflowTriggerSettings(settingsStore, settings) {
  try {
    settingsStore.save(settings);
    return true;
  } catch {
    return false;
  }
}
function resolvedTriggerWord(keywordTriggerWord) {
  return normalizeKeywordTriggerWord(keywordTriggerWord) ?? DEFAULT_KEYWORD_TRIGGER_WORD;
}
function triggerDisplayName(keywordTriggerWord) {
  const word = resolvedTriggerWord(keywordTriggerWord);
  return word.toLowerCase() === DEFAULT_KEYWORD_TRIGGER_WORD ? "workflow/workflows" : `"${word}"`;
}
function persistProgressSettings(settingsStore, settings) {
  try {
    settingsStore.save(settings);
    return true;
  } catch {
    return false;
  }
}
function loadProgressMode(settingsStore) {
  try {
    return settingsStore.load().progressPanelMode ?? "compact";
  } catch {
    return "compact";
  }
}
function loadProgressMaxAgents(settingsStore) {
  try {
    return settingsStore.load().progressPanelMaxAgents ?? 8;
  } catch {
    return 8;
  }
}

// src/workflow-commands.ts
var STATUS_ICON2 = {
  pending: "\xB7",
  running: "\u25C6",
  paused: "\u23F8",
  completed: "\u2713",
  failed: "\u2717",
  aborted: "\u2298"
};
var USAGE = "Usage: /workflows [list] | run <prompt> | status <id> | watch <id> | stop <id> | pause <id> | resume <id> | rm <id> | save <name> [runId]";
var RUN_USAGE = "Usage: /workflows run <prompt> \u2014 force a dynamic workflow from the prompt";
function summarizeRun(run) {
  const icon = STATUS_ICON2[run.status] ?? "?";
  const done = run.agents.filter((a) => a.status === "done").length;
  const total = run.agents.length;
  const segment = fmtTokenSegment(tokenFigures(run.tokenUsage), fmtFull);
  const tokens = segment ? ` \xB7 ${segment}` : "";
  return `${icon} ${run.runId}  ${run.workflowName} [${run.status}] ${done}/${total} agents${tokens}`;
}
function oneLineProgress(snapshot) {
  const total = snapshot.agents.length;
  const done = snapshot.agents.filter((a) => a.status === "done").length;
  const running = snapshot.agents.filter((a) => a.status === "running").length;
  const errs = snapshot.agents.filter((a) => a.status === "error").length;
  const phase = snapshot.currentPhase ? ` \xB7 ${snapshot.currentPhase}` : "";
  return `\u25C6 ${snapshot.name}: ${done}/${total} done${running ? `, ${running} running` : ""}${errs ? `, ${errs} err` : ""}${phase}`;
}
function watchRun(manager, pi, ctx, id) {
  const active = manager.getRun(id);
  if (active?.status !== "running") return false;
  const key = `wf:${id}`;
  const update = () => {
    const run = manager.getRun(id);
    if (run) ctx.ui.setStatus(key, oneLineProgress(run.snapshot));
  };
  const onEvent = (e) => {
    if (!e || e.runId === id) update();
  };
  let settled = false;
  const progressEvents = ["agentStart", "agentEnd", "phase", "log"];
  const finalEvents = ["complete", "error", "stopped", "paused"];
  const finish = (e) => {
    if (e && e.runId !== id) return;
    if (settled) return;
    settled = true;
    for (const ev of progressEvents) manager.off(ev, onEvent);
    for (const ev of finalEvents) manager.off(ev, finish);
    ctx.ui.setStatus(key, void 0);
    const run = manager.getRun(id);
    if (run) {
      void pi.sendMessage({
        customType: "workflows",
        content: renderWorkflowText(recomputeWorkflowSnapshot(run.snapshot), true),
        display: true
      });
    }
  };
  for (const ev of progressEvents) manager.on(ev, onEvent);
  for (const ev of finalEvents) manager.on(ev, finish);
  update();
  return true;
}
function renderPersistedStatus(run) {
  const lines = [`${STATUS_ICON2[run.status] ?? "?"} ${run.workflowName} (${run.runId}) \u2014 ${run.status}`];
  if (run.currentPhase) lines.push(`  phase: ${run.currentPhase}`);
  for (const agent of run.agents) {
    const icon = agent.status === "done" ? "\u2713" : agent.status === "error" ? "\u2717" : agent.status === "running" ? "\u25C6" : "\xB7";
    lines.push(`  ${icon} ${agent.label}`);
  }
  const tokenSegment = fmtTokenSegment(tokenFigures(run.tokenUsage), fmtFull);
  if (tokenSegment) lines.push(`  tokens: ${tokenSegment}`);
  if (run.durationMs) lines.push(`  duration: ${(run.durationMs / 1e3).toFixed(1)}s`);
  return lines.join("\n");
}
function registerWorkflowCommands(pi, manager, opts = {}) {
  const getManager = opts.getManager ?? (typeof manager === "function" ? manager : () => manager);
  const getCwd = () => opts.getCwd?.() ?? opts.cwd ?? process.cwd();
  const getStorage = () => opts.getStorage?.() ?? opts.storage;
  try {
    const taken = (pi.getCommands?.() ?? []).some((c) => c.name === "workflows");
    if (taken) return;
  } catch {
  }
  pi.registerCommand("workflows", {
    description: "Manage workflow runs \u2014 no args (opens navigator) | run <prompt> | status/stop/pause/resume <id> | rm <id> | save <name> [runId]",
    async handler(args, ctx) {
      const manager2 = getManager();
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] ?? "list").toLowerCase();
      const id = parts[1];
      const print = (text) => pi.sendMessage({ customType: "workflows", content: text, display: true });
      switch (sub) {
        case "run": {
          const prompt = args.trim().slice(parts[0]?.length ?? 0).trim();
          if (!prompt) {
            ctx.ui.notify(RUN_USAGE, "warning");
            return;
          }
          try {
            const active = pi.getActiveTools?.() ?? [];
            if (!active.includes(WORKFLOW_TOOL_NAME)) pi.setActiveTools?.([...active, WORKFLOW_TOOL_NAME]);
          } catch {
          }
          const effort = opts.effort;
          const extra = effort && effort.level !== "off" ? effortDirective(effort.level) : void 0;
          const armed = buildForcedWorkflowPrompt(prompt, extra);
          ctx.ui.notify(`Running workflow: ${prompt.slice(0, 60)}${prompt.length > 60 ? "\u2026" : ""}`, "info");
          try {
            await pi.sendMessage(
              { customType: "workflow-run", content: armed, display: true },
              { triggerTurn: true, deliverAs: "followUp" }
            );
          } catch {
            ctx.ui.notify("Could not start the workflow turn.", "error");
          }
          return;
        }
        case "ui":
        case "list": {
          if (sub !== "list" && ctx.hasUI) {
            await openWorkflowNavigator(pi, manager2, ctx.ui, {
              storage: getStorage(),
              cwd: getCwd(),
              getStorage,
              getCwd,
              getManager
            });
            return;
          }
          if (parts.length === 0 && ctx.hasUI) {
            await openWorkflowNavigator(pi, manager2, ctx.ui, {
              storage: getStorage(),
              cwd: getCwd(),
              getStorage,
              getCwd,
              getManager
            });
            return;
          }
          const runs = manager2.listRuns();
          if (!runs.length) {
            await print("No workflow runs yet. Start one with a background workflow (background: true).");
            return;
          }
          await print(["Workflow runs:", ...runs.map(summarizeRun), "", USAGE].join("\n"));
          return;
        }
        case "watch":
        case "status": {
          if (!id) {
            ctx.ui.notify(USAGE, "warning");
            return;
          }
          if (watchRun(manager2, pi, ctx, id)) {
            ctx.ui.notify(`Watching ${id} \u2014 live progress in the status bar; result prints when it finishes.`, "info");
            return;
          }
          const live = manager2.getSnapshot(id);
          if (live) {
            await print(renderWorkflowText(recomputeWorkflowSnapshot(live), false));
            return;
          }
          const run = manager2.listRuns().find((r) => r.runId === id);
          if (!run) {
            ctx.ui.notify(`No workflow run "${id}"`, "error");
            return;
          }
          await print(renderPersistedStatus(run));
          return;
        }
        case "stop": {
          if (!id) return ctx.ui.notify(USAGE, "warning");
          ctx.ui.notify(
            manager2.stop(id) ? `Stopped ${id}` : `Cannot stop ${id} (not running)`,
            manager2.getRun(id) ? "info" : "warning"
          );
          return;
        }
        case "pause": {
          if (!id) return ctx.ui.notify(USAGE, "warning");
          ctx.ui.notify(manager2.pause(id) ? `Paused ${id}` : `Cannot pause ${id} (not running)`, "info");
          return;
        }
        case "resume": {
          if (!id) return ctx.ui.notify(USAGE, "warning");
          const ok = await manager2.resume(id);
          ctx.ui.notify(ok ? `Resumed ${id}` : `Resume not available for ${id} yet`, ok ? "info" : "warning");
          return;
        }
        case "rm": {
          if (!id) return ctx.ui.notify(USAGE, "warning");
          ctx.ui.notify(manager2.deleteRun(id) ? `Removed ${id}` : `No run ${id}`, "info");
          return;
        }
        case "save": {
          const name = id;
          if (!name) return ctx.ui.notify("Usage: /workflows save <name> [runId]", "warning");
          const storage = getStorage();
          if (!storage) return ctx.ui.notify("Saving is not available (no storage configured)", "error");
          const runs = manager2.listRuns();
          const runIdArg = parts[2];
          const run = runIdArg ? runs.find((r) => r.runId === runIdArg) : runs.find((r) => r.script);
          if (!run?.script) {
            ctx.ui.notify(runIdArg ? `No run ${runIdArg} with a script` : "No saved run to save", "error");
            return;
          }
          let saved;
          try {
            saved = storage.save({
              name,
              description: run.workflowName,
              script: run.script,
              location: "project"
            });
          } catch (error) {
            ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
            return;
          }
          registerSavedWorkflow(
            pi,
            getCwd,
            saved,
            getManager,
            // Always re-resolve storage at invocation — do not close over the
            // instance from this save call, or a later project switch leaves
            // the loader pointed at the source project's store.
            () => getStorage()?.load(name) != null,
            () => getStorage()?.load(name) ?? null
          );
          ctx.ui.notify(`Saved /${name} (from ${run.runId})`, "info");
          return;
        }
        default:
          ctx.ui.notify(`Unknown subcommand "${sub}". ${USAGE}`, "warning");
      }
    }
  });
}

// src/workflow-control-tool.ts
import { defineTool as defineTool3 } from "@earendil-works/pi-coding-agent";
import { Type as Type2 } from "typebox";
var workflowControlSchema = Type2.Object(
  {
    action: Type2.Union(
      [
        Type2.Literal("list"),
        Type2.Literal("status"),
        Type2.Literal("pause"),
        Type2.Literal("resume"),
        Type2.Literal("stop")
      ],
      { description: "list = all runs (no runId); status/pause/resume/stop act on one run and require runId." }
    ),
    runId: Type2.Optional(
      Type2.String({
        minLength: 1,
        description: "Canonical workflow run ID. Required for status, pause, resume, and stop; omit for list."
      })
    )
  },
  { additionalProperties: false }
);
function createWorkflowControlTool(options) {
  const getManager = () => {
    const m = options.getManager?.() ?? options.manager;
    if (!m) throw new Error("workflow_control: no WorkflowManager configured");
    return m;
  };
  return defineTool3({
    name: "workflow_control",
    label: "Workflow Control",
    description: "List and inspect workflow runs, or pause, resume, and stop them without asking the user to run slash commands.",
    promptSnippet: "Inspect and manage workflow runs directly by canonical run ID.",
    promptGuidelines: [
      "Use workflow_control for workflow lifecycle management; do not ask the user to type /workflows when this tool can perform the action.",
      "Use stop to terminate or quit a run. Closing the navigator does not stop a run."
    ],
    parameters: workflowControlSchema,
    prepareArguments: normalizeInput,
    async execute(_toolCallId, params) {
      const manager = getManager();
      if (params.action === "list") {
        const runs = manager.listRuns();
        const summaries = runs.map((run2) => summarizeRun2(run2, manager.getSnapshot(run2.runId)));
        return result(
          summaries.length ? `action=list result=ok runs=${summaries.length}
${summaries.map(formatRun).join("\n")}` : "action=list result=ok runs=0",
          { action: "list", result: "ok", runs: summaries }
        );
      }
      if (!params.runId) return controlError(params.action, "", "runId is required for this action", ["list"]);
      const run = findRun(manager, params.runId);
      if (!run) return controlError(params.action, params.runId, "run not found", ["list"]);
      try {
        switch (params.action) {
          case "status": {
            const summary = summarizeRun2(run, manager.getSnapshot(run.runId));
            return result(`action=status result=ok ${formatRun(summary)}`, {
              action: "status",
              result: "ok",
              run: summary
            });
          }
          case "pause":
            if (!manager.pause(run.runId)) return invalidTransition("pause", run);
            return actionSuccess("pause", "paused", currentSummary(manager, run));
          case "resume":
            if (!await manager.resume(run.runId)) return invalidTransition("resume", run);
            return actionSuccess("resume", "resumed", currentSummary(manager, run));
          case "stop":
            if (!manager.stop(run.runId)) return invalidTransition("stop", run);
            return actionSuccess("stop", "stopped", currentSummary(manager, run));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return controlError(params.action, run.runId, message, allowedActions(run.status));
      }
    }
  });
}
function normalizeInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("workflow_control requires an object argument");
  }
  const input = value;
  const actions = /* @__PURE__ */ new Set(["list", "status", "pause", "resume", "stop"]);
  if (typeof input.action !== "string" || !actions.has(input.action)) {
    throw new Error("workflow_control requires action: list|status|pause|resume|stop");
  }
  const allowedKeys = input.action === "list" ? /* @__PURE__ */ new Set(["action"]) : /* @__PURE__ */ new Set(["action", "runId"]);
  const extraKey = Object.keys(input).find((key) => !allowedKeys.has(key));
  if (extraKey) throw new Error(`workflow_control action "${input.action}" does not accept ${extraKey}`);
  if (input.action !== "list" && (typeof input.runId !== "string" || !input.runId.trim())) {
    throw new Error(`workflow_control action "${input.action}" requires runId`);
  }
  return input;
}
function result(text, details) {
  return { content: [{ type: "text", text }], details };
}
function findRun(manager, runId) {
  return manager.listRuns().find((candidate) => candidate.runId === runId);
}
function currentSummary(manager, fallback) {
  const current = findRun(manager, fallback.runId) ?? fallback;
  return summarizeRun2(current, manager.getSnapshot(current.runId));
}
function actionSuccess(action, actionResult, run) {
  return result(`action=${action} result=${actionResult} ${formatRun(run)}`, {
    action,
    result: actionResult,
    run
  });
}
function invalidTransition(action, run) {
  return controlError(action, run.runId, `cannot ${action} run with status ${run.status}`, allowedActions(run.status));
}
function controlError(action, runId, message, allowed) {
  return result(
    `action=${action} result=error runId=${runId} error=${message} allowed=${allowed.join(",") || "none"}`,
    { action, result: "error", runId, error: message, allowedActions: allowed }
  );
}
function allowedActions(status) {
  switch (status) {
    case "running":
      return ["status", "pause", "stop"];
    case "paused":
      return ["status", "resume", "stop"];
    case "failed":
    case "pending":
      return ["status", "resume"];
    case "completed":
    case "aborted":
      return ["status"];
  }
}
function summarizeRun2(run, live) {
  const agents = live?.agents ?? run.agents;
  const counts = countAgents(agents);
  const liveUsage = tokenFigures(live?.tokenUsage);
  const persistedUsage = tokenFigures(run.tokenUsage);
  const agentUsage = aggregateAgentUsage(agents);
  return {
    runId: run.runId,
    workflowName: live?.name ?? run.workflowName,
    status: run.status,
    phase: live?.currentPhase ?? run.currentPhase ?? null,
    counts,
    activeLabels: agents.filter((agent) => agent.status === "running").map((agent) => agent.label),
    tokenTotal: Math.max(
      liveUsage.fresh + liveUsage.cacheRead,
      persistedUsage.fresh + persistedUsage.cacheRead,
      agentUsage.fresh + agentUsage.cacheRead
    )
  };
}
function countAgents(agents) {
  return {
    total: agents.length,
    done: agents.filter((agent) => agent.status === "done").length,
    running: agents.filter((agent) => agent.status === "running").length,
    queued: agents.filter((agent) => agent.status === "queued").length,
    error: agents.filter((agent) => agent.status === "error").length,
    skipped: agents.filter((agent) => agent.status === "skipped").length
  };
}
function formatRun(run) {
  const active = run.activeLabels.join(",") || "-";
  return `runId=${run.runId} name=${quote(run.workflowName)} status=${run.status} phase=${quote(run.phase ?? "-")} total=${run.counts.total} done=${run.counts.done} running=${run.counts.running} queued=${run.counts.queued} error=${run.counts.error} skipped=${run.counts.skipped} active=${quote(active)} tokens=${run.tokenTotal}`;
}
function quote(value) {
  return JSON.stringify(value);
}

// src/workflow-manager.ts
import { EventEmitter } from "node:events";
var IN_MEMORY_TERMINAL_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "aborted"]);
var DEFAULT_MAX_TERMINAL_RUNS_IN_MEMORY = 20;
var WorkflowManager = class _WorkflowManager extends EventEmitter {
  /**
   * Lifecycle contract for `runs`:
   *
   *  - An entry is added when a run starts (startInBackground/runSync) or is
   *    resumed (resume()), always with a live AbortController and (usually)
   *    an active RunLease.
   *  - While status is "running" or "paused", the entry is NEVER evicted —
   *    its execution could still settle (a pending executeRun() promise) or
   *    it is mid-usage-limit-checkpoint/manually-paused and still considered
   *    "the current state of this run" by callers. Eviction only ever
   *    considers an entry AFTER executeRun() has fully settled it to
   *    "completed" | "failed" | "aborted" (see IN_MEMORY_TERMINAL_STATUSES)
   *    and persisted + released its lease — i.e. strictly after the same
   *    isCurrent()-gated persistRun()/releaseRunLease() calls in
   *    executeRun()'s success/catch tails.
   *  - Once terminal, an entry becomes eviction-ELIGIBLE (recordTerminalRun())
   *    but is not necessarily evicted immediately: up to
   *    maxTerminalRunsInMemory terminal entries are kept, oldest evicted
   *    first, so a `getRun()` call immediately after completion (e.g. the
   *    "complete" event's own synchronous listeners — task-panel's result
   *    delivery, `/workflows watch`) still sees the live object. Once
   *    evicted, the entry is simply removed from `runs`; nothing else reads
   *    or writes it again.
   *  - Every caller of getRun()/getSnapshot() must treat "undefined"/null as
   *    "no live in-memory copy right now" and fall back to listRuns() (backed
   *    by run-persistence.ts, which is what's authoritative for a run once
   *    the in-memory copy is gone) — this mirrors how those callers already
   *    treat any run this process never had in memory (e.g. one started by a
   *    different process and only ever seen via listRuns()). resume() never
   *    depends on `runs` for a run's state either: it always reloads from
   *    persistence, so an evicted runId resumes exactly like one from a
   *    prior process.
   *  - isCurrent(managed) composes with eviction the same way it composes
   *    with resume()/deleteRun() replacing or removing an entry: eviction
   *    removes the map entry outright, so a stale execution's later settle
   *    (isCurrent() check) sees `this.runs.get(runId) !== managed` (in fact
   *    undefined) and correctly no-ops, exactly as it would after
   *    resume()/deleteRun().
   */
  runs = /* @__PURE__ */ new Map();
  /**
   * FIFO of runIds that reached IN_MEMORY_TERMINAL_STATUSES, oldest first —
   * the eviction order for `runs` (see its doc comment). A runId can appear
   * more than once (e.g. resumed after eviction, then terminates again);
   * evicting is idempotent (recordTerminalRun() re-checks the CURRENT status
   * of the current map entry for that id before deleting), so duplicates
   * are harmless.
   */
  terminalRunQueue = [];
  maxTerminalRunsInMemory;
  persistence;
  cwd;
  concurrency;
  loadSavedWorkflow;
  agent;
  /** The session's main model (provider/id), for auto-tiering explore agents. */
  mainModel;
  /** The host Pi session's model registry, shared with subagents. */
  modelRegistry;
  /** The current pi session id; runs are stamped with it and listRuns() filters by it. */
  sessionId;
  defaultAgentTimeoutMs;
  defaultAgentRetries;
  defaultTokenBudget;
  toolsets;
  excludeSubagentTools;
  persistAgentSessions;
  constructor(options = {}) {
    super();
    this.cwd = options.cwd ?? process.cwd();
    this.concurrency = options.concurrency ?? 8;
    this.loadSavedWorkflow = options.loadSavedWorkflow;
    this.agent = options.agent;
    this.mainModel = options.mainModel;
    this.modelRegistry = options.modelRegistry;
    this.sessionId = options.sessionId;
    this.defaultAgentTimeoutMs = options.defaultAgentTimeoutMs ?? null;
    this.defaultAgentRetries = options.defaultAgentRetries ?? 0;
    this.defaultTokenBudget = options.defaultTokenBudget ?? null;
    this.toolsets = options.toolsets;
    this.excludeSubagentTools = options.excludeSubagentTools;
    this.persistAgentSessions = options.persistAgentSessions ?? false;
    this.maxTerminalRunsInMemory = options.maxTerminalRunsInMemory ?? DEFAULT_MAX_TERMINAL_RUNS_IN_MEMORY;
    this.persistence = createRunPersistence(this.cwd);
    this.recoverStaleRuns();
  }
  /** Bind the manager to the current pi session, so new runs are tagged with it and
   * the navigator/task-panel show only this session's runs (set on session_start). */
  setSessionId(id) {
    this.sessionId = id;
  }
  /** Currently bound pi session id (set on session_start), if any. */
  getSessionId() {
    return this.sessionId;
  }
  /** Project cwd this manager was constructed for (persistence + agent tools). */
  getCwd() {
    return this.cwd;
  }
  /**
   * Every live in-memory run, regardless of the navigator's session filter.
   * Stranded-pause / cross-session recovery must use this — listRuns() hides
   * runs whose frozen sessionId no longer matches the bound session.
   */
  listLiveRuns() {
    return [...this.runs.values()];
  }
  /**
   * After an in-process session replacement keeps this manager, re-home work
   * that still needs this conversation onto `sessionId`:
   *  - still-running / paused-in-memory runs (panel, workflow_control, stranded-pause)
   *  - any run (live or disk-only) with an undelivered `pendingDelivery` marker
   *
   * Terminal runs *without* pending keep their original sessionId so history
   * stays with the session that ran them. `previousSessionId` scopes disk-only
   * pending re-home so a parallel sibling in the same runsDir cannot steal
   * another session's undelivered work. No-op when `sessionId` is undefined.
   */
  adoptLiveRunsToSession(sessionId, previousSessionId) {
    if (!sessionId) return 0;
    const prev = previousSessionId !== void 0 ? previousSessionId : this.sessionId;
    let adopted = 0;
    for (const managed of this.runs.values()) {
      const active = managed.status === "running" || managed.status === "paused";
      const undelivered = managed.pendingDelivery != null;
      if (!active && !undelivered) continue;
      if (managed.sessionId === sessionId) continue;
      managed.sessionId = sessionId;
      this.persistRun(managed);
      adopted++;
    }
    try {
      for (const state of this.persistence.list()) {
        if (!state.pendingDelivery) continue;
        if (this.runs.has(state.runId)) continue;
        if (state.sessionId === sessionId) continue;
        if (prev == null || state.sessionId !== prev) continue;
        this.persistence.save({ ...state, sessionId });
        adopted++;
      }
    } catch {
    }
    return adopted;
  }
  /**
   * On startup, any persisted run still marked "running" belongs to a process
   * that died mid-run (this fresh manager has it nowhere in memory). Reconcile it
   * to "paused" — never "failed" — so its journal is preserved and resume() can
   * replay the completed prefix and finish the rest.
   */
  recoverStaleRuns() {
    try {
      for (const p of this.listAllRuns()) {
        if (p.status === "running" && !this.runs.has(p.runId)) {
          const lease = this.persistence.acquireRunLease(p.runId);
          if (!lease) continue;
          try {
            this.persistence.save({ ...p, status: "paused" });
          } finally {
            this.persistence.releaseRunLease(lease);
          }
        }
      }
    } catch {
    }
  }
  /**
   * Refresh host configuration after Pi reloads the extension while retaining
   * this manager's live runs, controllers, leases, and event listeners.
   * Existing executions keep the options they captured at start; subsequent
   * runs and resumes use these refreshed defaults.
   */
  reconfigureAfterReload(options) {
    this.concurrency = options.concurrency ?? 8;
    this.loadSavedWorkflow = options.loadSavedWorkflow;
    this.defaultAgentTimeoutMs = options.defaultAgentTimeoutMs ?? null;
    this.defaultAgentRetries = options.defaultAgentRetries ?? 0;
    this.defaultTokenBudget = options.defaultTokenBudget ?? null;
    this.toolsets = options.toolsets;
    this.excludeSubagentTools = options.excludeSubagentTools;
    this.persistAgentSessions = options.persistAgentSessions ?? false;
  }
  /** Set the session's main model (provider/id). Used to auto-tier explore agents. */
  setMainModel(spec) {
    this.mainModel = spec;
  }
  /** Set the host session's model registry so subagents resolve models consistently. */
  setModelRegistry(registry) {
    this.modelRegistry = registry;
  }
  /**
   * Expose the host session's model registry to integrations sharing this
   * manager. Workflow execution reads the same registry internally.
   */
  getModelRegistry() {
    return this.modelRegistry;
  }
  /**
   * Start a workflow in the background.
   * Returns immediately with a run ID; the workflow executes asynchronously.
   */
  startInBackground(script, args, exec2 = {}) {
    const parsed = parseWorkflowScript(script);
    const slug2 = parsed.meta.name ? parsed.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workflow" : "";
    const runId = slug2 ? `${slug2}-${generateRunId()}` : generateRunId();
    const controller = new AbortController();
    const lease = this.persistence.acquireRunLease(runId);
    if (!lease) throw new Error(`Could not acquire workflow run lease for ${runId}`);
    const managed = {
      runId,
      status: "running",
      snapshot: {
        name: parsed.meta.name,
        description: parsed.meta.description,
        phases: parsed.meta.phases?.map((p) => p.title) ?? [],
        logs: [],
        agents: [],
        agentCount: 0,
        runningCount: 0,
        doneCount: 0,
        errorCount: 0
      },
      controller,
      startedAt: /* @__PURE__ */ new Date(),
      script,
      args,
      journal: [],
      background: true,
      sessionId: this.sessionId,
      lease,
      autoResume: exec2.autoResume,
      // Resolve the budget once at start and freeze it on the run (see
      // ManagedRun.tokenBudget) so resume keeps start-time semantics.
      tokenBudget: exec2.tokenBudget !== void 0 ? exec2.tokenBudget : this.defaultTokenBudget,
      toolset: exec2.toolset,
      // Same freeze-at-start pattern as tokenBudget, for the same reason: a
      // resumed run must keep these values, not re-resolve against the
      // manager's current defaults (see ManagedRun doc comments).
      maxAgents: exec2.maxAgents,
      agentTimeoutMs: exec2.agentTimeoutMs !== void 0 ? exec2.agentTimeoutMs : this.defaultAgentTimeoutMs,
      concurrency: exec2.concurrency !== void 0 ? exec2.concurrency : this.concurrency,
      agentRetries: exec2.agentRetries !== void 0 ? exec2.agentRetries : this.defaultAgentRetries,
      agentTimestamps: /* @__PURE__ */ new Map(),
      agentsById: /* @__PURE__ */ new Map()
    };
    this.runs.set(runId, managed);
    try {
      this.persistence.save({
        runId,
        workflowName: parsed.meta.name,
        script,
        args,
        sessionId: managed.sessionId,
        status: "running",
        phases: managed.snapshot.phases,
        agents: [],
        logs: [],
        startedAt: managed.startedAt.toISOString(),
        updatedAt: managed.startedAt.toISOString(),
        autoResume: managed.autoResume,
        tokenBudget: managed.tokenBudget,
        toolset: managed.toolset,
        maxAgents: managed.maxAgents,
        agentTimeoutMs: managed.agentTimeoutMs,
        concurrency: managed.concurrency,
        agentRetries: managed.agentRetries
      });
    } catch (err) {
      this.releaseRunLease(managed);
      this.runs.delete(runId);
      throw err;
    }
    const promise = this.executeRun(managed, script, args, exec2);
    promise.catch(() => {
    });
    return { runId, promise };
  }
  /**
   * Execute a workflow synchronously (blocking) while still tracking it like a
   * background run, so the `/workflows` navigator and the live task panel see it.
   * `onProgress` fires on every progress event with the current snapshot, letting
   * a caller (e.g. the workflow tool) drive its own inline display.
   */
  async runSync(script, args, exec2 = {}) {
    const managed = this.createManaged(script, args);
    const lease = this.persistence.acquireRunLease(managed.runId);
    if (!lease) throw new Error(`Could not acquire workflow run lease for ${managed.runId}`);
    managed.lease = lease;
    managed.autoResume = exec2.autoResume;
    managed.tokenBudget = exec2.tokenBudget !== void 0 ? exec2.tokenBudget : this.defaultTokenBudget;
    managed.toolset = exec2.toolset;
    managed.maxAgents = exec2.maxAgents;
    managed.agentTimeoutMs = exec2.agentTimeoutMs !== void 0 ? exec2.agentTimeoutMs : this.defaultAgentTimeoutMs;
    managed.concurrency = exec2.concurrency !== void 0 ? exec2.concurrency : this.concurrency;
    managed.agentRetries = exec2.agentRetries !== void 0 ? exec2.agentRetries : this.defaultAgentRetries;
    this.runs.set(managed.runId, managed);
    this.persistRun(managed);
    return this.executeRun(managed, script, args, exec2);
  }
  /** Build a fresh managed run with an empty snapshot. */
  createManaged(script, args) {
    const parsed = parseWorkflowScript(script);
    const slug2 = parsed.meta.name ? parsed.meta.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workflow" : "";
    const runId = slug2 ? `${slug2}-${generateRunId()}` : generateRunId();
    return {
      runId,
      status: "running",
      snapshot: {
        name: parsed.meta.name,
        description: parsed.meta.description,
        phases: parsed.meta.phases?.map((p) => p.title) ?? [],
        logs: [],
        agents: [],
        agentCount: 0,
        runningCount: 0,
        doneCount: 0,
        errorCount: 0
      },
      controller: new AbortController(),
      startedAt: /* @__PURE__ */ new Date(),
      script,
      args,
      journal: [],
      background: false,
      sessionId: this.sessionId,
      agentTimestamps: /* @__PURE__ */ new Map(),
      agentsById: /* @__PURE__ */ new Map()
    };
  }
  async executeRun(managed, script, args, exec2 = {}) {
    const {
      resumeJournal,
      maxAgents,
      agentTimeoutMs,
      externalSignal,
      onProgress,
      tokenBudget,
      concurrency,
      agentRetries,
      confirm,
      tools,
      initialTokenUsage
    } = exec2;
    const resolvedMaxAgents = managed.maxAgents !== void 0 ? managed.maxAgents : maxAgents;
    const resolvedAgentTimeoutMs = managed.agentTimeoutMs !== void 0 ? managed.agentTimeoutMs : agentTimeoutMs !== void 0 ? agentTimeoutMs : this.defaultAgentTimeoutMs;
    const resolvedConcurrency = managed.concurrency !== void 0 ? managed.concurrency : concurrency ?? this.concurrency;
    const resolvedAgentRetries = managed.agentRetries !== void 0 ? managed.agentRetries : agentRetries ?? this.defaultAgentRetries;
    const resolvedTokenBudget = managed.tokenBudget !== void 0 ? managed.tokenBudget : tokenBudget ?? null;
    const resolvedTools = tools ?? (managed.toolset ? this.toolsets?.[managed.toolset]?.() : void 0);
    const progress = () => {
      if (this.isCurrent(managed)) onProgress?.(managed.snapshot);
    };
    if (externalSignal) {
      if (externalSignal.aborted) managed.controller.abort();
      else externalSignal.addEventListener("abort", () => managed.controller.abort(), { once: true });
    }
    try {
      const result2 = await runWorkflow(script, {
        cwd: this.cwd,
        args,
        // Use the managed run's persisted id as the workflow runId so the value
        // returned in result.runId matches the id that listRuns()/resume() use.
        // Otherwise runWorkflow mints an ephemeral `run-<ts>` id and the sync
        // path would surface a non-resumable id to the model.
        runId: managed.runId,
        agent: this.agent,
        mainModel: this.mainModel,
        modelRegistry: this.modelRegistry,
        persistAgentSessions: this.persistAgentSessions,
        signal: managed.controller.signal,
        concurrency: resolvedConcurrency,
        agentRetries: resolvedAgentRetries,
        maxAgents: resolvedMaxAgents,
        agentTimeoutMs: resolvedAgentTimeoutMs,
        tokenBudget: resolvedTokenBudget,
        tools: resolvedTools,
        excludeTools: this.excludeSubagentTools,
        confirm,
        loadSavedWorkflow: this.loadSavedWorkflow,
        resumeJournal,
        resumeFromRunId: resumeJournal ? managed.runId : void 0,
        // Seed the fresh SharedRuntime's spend counter from the persisted total
        // (resume()) so the hard tokenBudget cap holds cumulatively across a
        // pause/resume cycle instead of resetting to zero each time (see A2 —
        // runWorkflow only applies this on the fresh-SharedRuntime branch, never
        // overriding an inherited options.sharedRuntime from a nested workflow()).
        initialTokenUsage,
        // Retried-attempt spend (see WorkflowRunOptions.onRetrySpend and A2):
        // recordTokens() in workflow.ts already folded this into
        // shared.spent/tokenUsage, but onAgentEnd never sees a retried
        // (non-final) attempt — fold it into the same persisted aggregate here
        // so a run paused after a retry doesn't under-count against the budget.
        onRetrySpend: (tokens) => {
          this.accumulateTokenUsage(managed, tokens);
        },
        onAgentJournal: (entry) => {
          managed.journal = managed.journal.filter((e) => !(e.index === entry.index && e.runId === entry.runId));
          managed.journal.push(entry);
          this.schedulePersist(managed);
        },
        onLog: (message) => {
          managed.snapshot.logs.push(message);
          this.emitLive(managed, "log", { runId: managed.runId, message });
          progress();
        },
        onPhase: (title) => {
          managed.snapshot.currentPhase = title;
          if (!managed.snapshot.phases.includes(title)) {
            managed.snapshot.phases.push(title);
          }
          this.emitLive(managed, "phase", { runId: managed.runId, title });
          progress();
        },
        onAgentStart: (event) => {
          const id = managed.snapshot.agents.length + 1;
          const agentSnapshot = {
            id,
            callId: event.id,
            label: event.label,
            phase: event.phase,
            prompt: event.prompt,
            status: "running",
            model: event.model
          };
          managed.snapshot.agents.push(agentSnapshot);
          managed.agentsById.set(event.id, agentSnapshot);
          managed.agentTimestamps.set(id, { startedAt: (/* @__PURE__ */ new Date()).toISOString() });
          this.emitLive(managed, "agentStart", { runId: managed.runId, ...event });
          progress();
        },
        onAgentEnd: (event) => {
          const agent = managed.agentsById.get(event.id);
          if (agent) {
            agent.status = event.result === null ? "error" : "done";
            agent.result = event.result;
            agent.resultPreview = preview(event.result);
            agent.error = event.error;
            agent.errorCode = event.errorCode;
            agent.recoverable = event.recoverable;
            agent.tokens = event.tokens;
            if (event.tokenUsage) agent.tokenUsage = event.tokenUsage;
            if (event.model) agent.model = event.model;
            const ts = managed.agentTimestamps.get(agent.id);
            if (ts) ts.endedAt = (/* @__PURE__ */ new Date()).toISOString();
          }
          this.accumulateTokenUsage(managed, event.tokens ?? 0, event.tokenUsage);
          this.emitLive(managed, "agentEnd", { runId: managed.runId, ...event });
          progress();
        },
        onAgentHistory: (event) => {
          const agent = managed.agentsById.get(event.id);
          if (agent) {
            agent.history = event.history;
          }
          this.emitLive(managed, "agentHistory", { runId: managed.runId, agentId: agent?.id, ...event });
          progress();
        },
        onTokenUsage: (usage) => {
          managed.snapshot.tokenUsage = usage;
          this.emitLive(managed, "tokenUsage", { runId: managed.runId, usage });
          progress();
        }
      });
      managed.status = "completed";
      managed.result = result2;
      this.emitLive(managed, "complete", { runId: managed.runId, result: result2 });
      this.persistRun(managed);
      if (this.isCurrent(managed)) {
        this.releaseRunLease(managed);
        this.recordTerminalRun(managed.runId);
      }
      return result2;
    } catch (error) {
      const workflowError = error instanceof WorkflowError ? error : new WorkflowError(
        error instanceof Error ? error.message : String(error),
        "WORKFLOW_ABORTED" /* WORKFLOW_ABORTED */,
        { recoverable: true }
      );
      const usageLimitPaused = !managed.controller.signal.aborted && isProviderUsageLimit(workflowError);
      if (managed.controller.signal.aborted) {
        if (managed.status === "running") {
          managed.status = "aborted";
        }
      } else if (usageLimitPaused) {
        managed.status = "paused";
      } else {
        managed.status = "failed";
      }
      managed.error = workflowError;
      if (usageLimitPaused) {
        this.emitLive(managed, "paused", {
          runId: managed.runId,
          reason: "usage_limit",
          error: workflowError,
          resetHint: workflowError.resetHint
        });
      } else if (this.listenerCount("error") > 0) {
        this.emitLive(managed, "error", { runId: managed.runId, error: workflowError });
      }
      this.persistRun(managed);
      if (this.isCurrent(managed)) {
        this.releaseRunLease(managed);
        if (IN_MEMORY_TERMINAL_STATUSES.has(managed.status)) this.recordTerminalRun(managed.runId);
      }
      throw workflowError;
    }
  }
  /**
   * True when `managed` is still the live, current entry for its runId in
   * `this.runs` — false once resume() has replaced it with a new ManagedRun
   * object for the same runId, or deleteRun() has removed it entirely. A
   * superseded ManagedRun's async completion (executeRun's promise settling
   * well after something else already took over or tore down that runId)
   * must not write to disk or touch lease state on the newer execution's
   * behalf — see writeRunToDisk() and executeRun()'s post-await persist calls.
   */
  isCurrent(managed) {
    return this.runs.get(managed.runId) === managed;
  }
  /**
   * Emit an event on behalf of `managed`, but only while it's still the
   * current entry for its runId (see isCurrent()) — mirrors the disk/lease
   * guard for the observer-facing side of the same problem. A superseded
   * execution's progress/terminal events (log, phase, agentStart/End,
   * tokenUsage, complete, error, paused) are not just stale-but-harmless:
   * "complete" in particular can drive background result delivery into the
   * conversation, so letting a deleted/superseded run's stale settle still
   * fire it would deliver a result for a run that, from the caller's POV, no
   * longer exists (or has since been superseded by a newer execution whose
   * own events already tell the true story). No event in this set has a
   * legitimate reason to still reach listeners once superseded — unlike
   * disk writes there's no "expected race, harmless no-op" nuance here, it's
   * simply wrong to notify twice (or for a run that's gone). Events emitted
   * directly by pause()/stop()/resume()/deleteRun() themselves are NOT routed
   * through this helper — those methods own the transition and ARE current
   * at the moment they fire, same precedent as their persist/lease calls.
   */
  emitLive(managed, event, payload) {
    if (this.isCurrent(managed)) this.emit(event, payload);
  }
  /**
   * Mark `runId` as eviction-eligible now that its execution has genuinely
   * settled to a terminal status (completed/failed/aborted — see
   * IN_MEMORY_TERMINAL_STATUSES), and evict the oldest eligible entries
   * beyond maxTerminalRunsInMemory. Callers must only invoke this after the
   * same isCurrent()-gated persistRun()/releaseRunLease() sequence executeRun()
   * already uses (see the `runs` field doc comment for the full contract) —
   * this method itself re-validates the CURRENT entry's status before
   * deleting anything, so it never evicts a run that isn't (or is no longer)
   * genuinely terminal, including one resumed back to "running" after being
   * queued here but before its turn to be evicted came up.
   */
  recordTerminalRun(runId) {
    this.terminalRunQueue.push(runId);
    while (this.terminalRunQueue.length > this.maxTerminalRunsInMemory) {
      const oldest = this.terminalRunQueue.shift();
      if (oldest === void 0) break;
      const current = this.runs.get(oldest);
      if (current && IN_MEMORY_TERMINAL_STATUSES.has(current.status)) {
        this.runs.delete(oldest);
      }
    }
  }
  /**
   * Additively fold one agent-call's token cost into the run-wide persisted
   * aggregate (managed.snapshot.tokenUsage), seeded (on resume) from the
   * persisted total-at-pause — see A2. Shared by onAgentEnd (a completed or
   * finally-failed agent call) and onRetrySpend (a failed attempt that WILL
   * be retried, whose cost recordTokens() already folded into
   * shared.spent/tokenUsage in workflow.ts, but which onAgentEnd never sees —
   * see WorkflowRunOptions.onRetrySpend for why that needs its own channel).
   */
  accumulateTokenUsage(managed, tokens, tokenUsage) {
    const prior = managed.snapshot.tokenUsage;
    const usage = {
      input: prior?.input ?? 0,
      output: prior?.output ?? 0,
      total: prior?.total ?? 0,
      cost: prior?.cost ?? 0,
      cacheRead: prior?.cacheRead ?? 0,
      cacheWrite: prior?.cacheWrite ?? 0
    };
    usage.total += tokens;
    if (tokenUsage) {
      usage.input += tokenUsage.input;
      usage.output += tokenUsage.output;
      usage.cost += tokenUsage.cost;
      usage.cacheRead += tokenUsage.cacheRead;
      usage.cacheWrite += tokenUsage.cacheWrite;
    }
    managed.snapshot.tokenUsage = usage;
  }
  releaseRunLease(managed) {
    if (!managed.lease) return;
    this.persistence.releaseRunLease(managed.lease);
    managed.lease = void 0;
  }
  /** Trailing-edge throttle window for high-frequency progress persists (see schedulePersist). */
  static PERSIST_THROTTLE_MS = 400;
  /** Pending trailing-edge persist timers for high-frequency progress events, keyed by runId. */
  persistTimers = /* @__PURE__ */ new Map();
  /**
   * Coalesce rapid progress persists (currently: onAgentJournal, which fires
   * once per completed agent and can burst under concurrency) to at most one
   * disk write per PERSIST_THROTTLE_MS (trailing edge) instead of one write
   * per tick — persistRun() does a full JSON.stringify of the run plus up to
   * 3 sync writes, so firing it once per agent in a long run is O(N^2).
   *
   * Lifecycle-critical writes (status transitions, run end, pause/resume/stop)
   * must NOT use this — call persistRun() directly, which flushes (and cancels)
   * any pending timer first so a stale trailing write can never fire after, and
   * resurrect, a terminal state.
   */
  schedulePersist(managed) {
    if (this.persistTimers.has(managed.runId)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(managed.runId);
      this.writeRunToDisk(managed);
    }, _WorkflowManager.PERSIST_THROTTLE_MS);
    timer.unref?.();
    this.persistTimers.set(managed.runId, timer);
  }
  /**
   * Persist immediately and synchronously. Cancels any pending throttled write
   * for this run first, so the write that lands is always the caller's current
   * (final) state — never superseded by a stale deferred write. Use this for
   * every lifecycle-critical persist: run start, status transitions, run end,
   * pause()/resume()/stop().
   */
  persistRun(managed) {
    if (!this.isCurrent(managed)) return;
    const timer = this.persistTimers.get(managed.runId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(managed.runId);
    }
    this.writeRunToDisk(managed);
  }
  writeRunToDisk(managed) {
    if (!this.isCurrent(managed)) return;
    try {
      const keepsResumeJournal = managed.status !== "completed" && managed.status !== "aborted";
      this.persistence.save({
        runId: managed.runId,
        workflowName: managed.snapshot.name,
        // Persist the real script + journal so the run can be resumed. Runs live
        // in workflow run storage — protect via directory permissions, not blanking.
        script: managed.script,
        args: managed.args,
        // Always the run's own frozen owner — never this.sessionId. A mid-flight
        // setSessionId() (session replacement) must not re-home a still-running
        // run out from under stranded-pause / the originating panel.
        sessionId: managed.sessionId,
        // Fail-closed delivery marker — survives endpoint gaps / process restart.
        pendingDelivery: managed.pendingDelivery,
        journal: keepsResumeJournal ? managed.journal : void 0,
        status: managed.status,
        // Persisted every write (not just at pause) so a stale read during the
        // "paused" event race (see UsageLimitScheduler) is still correct — this
        // is fixed at run-start and doesn't change over the run's lifetime.
        autoResume: managed.autoResume,
        // Start-time execution context, re-read by resume() (see ManagedRun).
        tokenBudget: managed.tokenBudget,
        toolset: managed.toolset,
        maxAgents: managed.maxAgents,
        agentTimeoutMs: managed.agentTimeoutMs,
        concurrency: managed.concurrency,
        agentRetries: managed.agentRetries,
        // Why a usage-limit pause happened, so the navigator / a future cold start
        // can show it and (eventually) re-arm resume after the budget refills.
        pauseReason: managed.status === "paused" && isProviderUsageLimit(managed.error) ? "usage_limit" : void 0,
        resetHint: managed.status === "paused" && isProviderUsageLimit(managed.error) ? managed.error.resetHint : void 0,
        phases: managed.snapshot.phases,
        currentPhase: managed.snapshot.currentPhase,
        // Real per-agent timestamps only (see agentTimestamps) — never the run's
        // own startedAt or "now" stamped onto every agent on every write. A
        // still-running agent is persisted with no endedAt.
        agents: managed.snapshot.agents.map((a) => {
          const { result: result2, ...summary } = a;
          const ts = managed.agentTimestamps.get(a.id);
          return {
            ...summary,
            // Live runs keep the rich value in memory. Cold resumable runs use
            // the journal and retain resultPreview until replay reconstructs it.
            ...keepsResumeJournal || result2 === void 0 ? {} : { result: result2 },
            startedAt: ts?.startedAt,
            endedAt: ts?.endedAt
          };
        }),
        logs: managed.snapshot.logs,
        result: managed.result?.result,
        tokenUsage: managed.snapshot.tokenUsage ? {
          input: managed.snapshot.tokenUsage.input,
          output: managed.snapshot.tokenUsage.output,
          total: managed.snapshot.tokenUsage.total,
          cost: managed.snapshot.tokenUsage.cost,
          cacheRead: managed.snapshot.tokenUsage.cacheRead,
          cacheWrite: managed.snapshot.tokenUsage.cacheWrite
        } : void 0,
        startedAt: managed.startedAt.toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        completedAt: managed.status === "completed" ? (/* @__PURE__ */ new Date()).toISOString() : void 0,
        durationMs: managed.result?.durationMs
      });
    } catch (err) {
      console.warn("[workflow-manager] Persist run failed:", err);
    }
  }
  /**
   * Pause a running workflow.
   */
  pause(runId) {
    const managed = this.runs.get(runId);
    if (managed?.status !== "running") return false;
    managed.controller.abort();
    managed.status = "paused";
    this.emit("paused", { runId });
    this.persistRun(managed);
    this.releaseRunLease(managed);
    return true;
  }
  /**
   * Resume an interrupted run: replay journaled results for the unchanged prefix
   * and run the rest live. Returns false if there is nothing resumable.
   *
   * `opts.script` lets the orchestrating model resume with an EDITED script
   * (cached-prefix reuse / iteration): unchanged agent() calls whose content
   * hash still matches the journal entry at their positional callIndex replay
   * from cache, while the first changed or newly inserted call — and everything
   * after it — re-runs live. When `opts.script` is omitted, resume behaves
   * exactly as before and uses the persisted script (auto-resume, TUI resume);
   * this keeps the existing single-arg `resume(runId)` callers (e.g. the
   * UsageLimitScheduler) unchanged. `opts.args` overrides the persisted args
   * only when provided; otherwise the persisted args are kept.
   */
  async resume(runId, opts) {
    const active = this.runs.get(runId);
    if (active?.status === "running") return false;
    if (active?.status === "aborted") return false;
    const persisted = this.persistence.load(runId);
    if (!persisted?.script || persisted.status === "completed" || persisted.status === "aborted") return false;
    const lease = this.persistence.acquireRunLease(runId);
    if (!lease) return false;
    const script = opts?.script ?? persisted.script;
    const args = opts?.args !== void 0 ? opts.args : persisted.args;
    const priorTokenUsage = persisted.tokenUsage ? {
      input: persisted.tokenUsage.input,
      output: persisted.tokenUsage.output,
      total: persisted.tokenUsage.total,
      cost: persisted.tokenUsage.cost ?? 0,
      cacheRead: persisted.tokenUsage.cacheRead ?? 0,
      cacheWrite: persisted.tokenUsage.cacheWrite ?? 0
    } : void 0;
    const priorMaxAgents = persisted.maxAgents;
    const requestedMaxAgents = opts?.maxAgents;
    let resolvedMaxAgents = priorMaxAgents;
    if (typeof requestedMaxAgents === "number" && Number.isFinite(requestedMaxAgents)) {
      const raised = Math.floor(requestedMaxAgents);
      const effectivePrior = priorMaxAgents ?? MAX_AGENTS_PER_RUN;
      if (raised <= effectivePrior) {
        this.persistence.releaseRunLease(lease);
        return false;
      }
      resolvedMaxAgents = raised;
    }
    const controller = new AbortController();
    const managed = {
      runId,
      status: "running",
      snapshot: {
        name: persisted.workflowName,
        phases: persisted.phases ?? [],
        logs: persisted.logs ?? [],
        agents: [],
        agentCount: 0,
        runningCount: 0,
        doneCount: 0,
        errorCount: 0,
        // Seed the live snapshot's aggregate from the persisted total-at-pause
        // (see A2) so a pause that lands before this resume's first agent
        // completes doesn't lose the prior spend — onAgentEnd accumulates on
        // top of this rather than starting from scratch.
        tokenUsage: priorTokenUsage
      },
      controller,
      startedAt: /* @__PURE__ */ new Date(),
      // The (possibly edited) script + args become the run's own — persistRun()
      // writes them below, so a later resume of this run sees the edited script.
      script,
      args,
      journal: persisted.journal ?? [],
      background: true,
      // Prefer the frozen owner on disk; fall back to the manager's current
      // session only for legacy runs that predate per-run sessionId.
      sessionId: persisted.sessionId ?? this.sessionId,
      // Carry any undelivered conversation payload across resume so session_start
      // flush can still re-inject after a pause/restart gap.
      pendingDelivery: persisted.pendingDelivery,
      lease,
      // Carry the original opt-out forward across resumes; it's fixed at
      // run-start and persistRun() re-persists it on every subsequent write.
      autoResume: persisted.autoResume,
      // Restore start-time execution context: the budget the run started with
      // (legacy runs without one resume unbudgeted — never re-apply the current
      // default to a run that predates it) and the toolset tag executeRun
      // re-resolves so e.g. a resumed /deep-research keeps its web tools.
      tokenBudget: persisted.tokenBudget !== void 0 ? persisted.tokenBudget : null,
      toolset: persisted.toolset,
      // Restore the same start-time execution context for the other four
      // per-run knobs (see ManagedRun doc comments) — same rationale as
      // tokenBudget: never re-resolve against the manager's CURRENT defaults.
      // maxAgents: omit keeps the persisted cap (undefined means runWorkflow's
      // MAX_AGENTS_PER_RUN default). A finite opts.maxAgents is increase-only vs
      // that effective prior — never pin a lower ceiling onto a never-set run.
      // A non-raise request refuses the whole resume so callers don't think
      // recovery worked.
      maxAgents: resolvedMaxAgents,
      // agentTimeoutMs: unlike tokenBudget, a legacy run's real timeout at
      // start was never "no timeout" by omission — it was always
      // this.defaultAgentTimeoutMs, because pre-A1 resume() never threaded
      // agentTimeoutMs through at all and unconditionally fell back to the
      // manager default (see executeRun's resolvedAgentTimeoutMs fallback
      // chain). Falling back to null here would change what a legacy run's
      // resume actually does versus both its original start AND pre-fix
      // resume behavior. So — deliberately unlike tokenBudget's null
      // fallback — legacy runs resume with the manager's CURRENT default,
      // matching the only semantics such a run ever had.
      agentTimeoutMs: persisted.agentTimeoutMs !== void 0 ? persisted.agentTimeoutMs : this.defaultAgentTimeoutMs,
      // concurrency/agentRetries have no "explicit opt-out sentinel" the way
      // tokenBudget's null does — a legacy run without a persisted value falls
      // back to the manager's current values, matching how this execution
      // resolved unset concurrency/agentRetries before this fix ever existed.
      concurrency: persisted.concurrency !== void 0 ? persisted.concurrency : this.concurrency,
      agentRetries: persisted.agentRetries !== void 0 ? persisted.agentRetries : this.defaultAgentRetries,
      // Fresh per-resume: agents (and any prior timing) are rebuilt live as
      // onAgentStart/onAgentEnd fire again for this attempt (see `agents: []`
      // above); the journal, not this map, is what makes replayed agents cheap.
      agentTimestamps: /* @__PURE__ */ new Map(),
      agentsById: /* @__PURE__ */ new Map()
    };
    this.runs.set(runId, managed);
    this.persistRun(managed);
    const resumeJournal = new Map((persisted.journal ?? []).map((e) => [`${e.runId ?? runId}:${e.index}`, e]));
    this.emit("resumed", { runId });
    void this.executeRun(managed, script, args, { resumeJournal, initialTokenUsage: priorTokenUsage }).catch(() => {
    });
    return true;
  }
  /**
   * Stop a running workflow.
   *
   * Fast path: the run is live in this process (`this.runs`) — abort its
   * controller and persist "aborted" as before. Fallback: the run is not in
   * memory but is persisted as "running" or "paused" — e.g. it belongs to a
   * prior pi session that this process's recoverStaleRuns() flipped to
   * "paused" on disk without repopulating this.runs (see workflow-control-tool's
   * findRun(), which resolves candidates from disk via listRuns()). There is no
   * live controller to abort in that case — the run simply isn't executing in
   * this process — so mark it aborted on disk directly, mirroring resume()'s
   * persisted-fallback lease handling.
   */
  stop(runId) {
    const managed = this.runs.get(runId);
    if (managed) {
      if (managed.status !== "running" && managed.status !== "paused") return false;
      const hadNoPendingSettle = managed.status === "paused";
      managed.controller.abort();
      managed.status = "aborted";
      this.emit("stopped", { runId });
      this.persistRun(managed);
      this.releaseRunLease(managed);
      if (hadNoPendingSettle) this.recordTerminalRun(runId);
      return true;
    }
    const persisted = this.persistence.load(runId);
    if (!persisted || persisted.status !== "running" && persisted.status !== "paused") return false;
    const lease = this.persistence.acquireRunLease(runId);
    if (!lease) return false;
    try {
      this.persistence.save({ ...persisted, status: "aborted", updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
    } finally {
      this.persistence.releaseRunLease(lease);
    }
    this.emit("stopped", { runId });
    return true;
  }
  /**
   * Get status of a specific run.
   */
  getRun(runId) {
    return this.runs.get(runId);
  }
  /**
   * List all runs (active + persisted).
   */
  /**
   * Runs for the navigator/task panel. Once bound to a session (setSessionId), only
   * that session's runs are returned — runs from other sessions stay on disk and
   * reappear when you switch back. Unbound (tests/legacy) returns everything.
   */
  listRuns() {
    const all = this.persistence.list();
    return this.sessionId ? all.filter((r) => r.sessionId === this.sessionId) : all;
  }
  /** All persisted runs regardless of session (used by cross-session recovery). */
  listAllRuns() {
    return this.persistence.list();
  }
  /**
   * Get snapshot of a run.
   */
  getSnapshot(runId) {
    return this.runs.get(runId)?.snapshot ?? null;
  }
  /**
   * Delete a persisted run.
   *
   * If `runId` is still live in this process (running or paused-in-memory),
   * abort its controller FIRST, before any teardown below — a live run left
   * un-aborted would otherwise keep executing in the background indefinitely
   * (burning API calls/tokens/holding a worktree) after its record is gone.
   * Aborting first, while `managed` is still `this.runs.get(runId)`, costs
   * nothing extra: the abort signal is fire-and-forget (cooperative — the
   * execution winds down on its own schedule), so the exact instant we flip
   * `this.runs`/release the lease/delete files relative to it doesn't matter
   * for correctness. What DOES matter is that once this method returns, the
   * aborted execution's eventual settle (executeRun's success/catch path,
   * asynchronously, possibly much later) must be a harmless no-op rather than
   * a resurrection — that's what isCurrent() guarantees: `this.runs.delete()`
   * below means executeRun's later persistRun()/releaseRunLease() calls on
   * this same `managed` object find `this.runs.get(runId) !== managed` (in
   * fact `undefined`, since the entry is gone) and skip writing/releasing.
   */
  deleteRun(runId) {
    const managed = this.runs.get(runId);
    if (managed) {
      if (!managed.controller.signal.aborted) managed.controller.abort();
      this.releaseRunLease(managed);
    }
    this.runs.delete(runId);
    const timer = this.persistTimers.get(runId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(runId);
    }
    return this.persistence.delete(runId);
  }
  /**
   * Get the persistence layer (for saving workflows).
   */
  getPersistence() {
    return this.persistence;
  }
};

// src/workflow-tool.ts
import { defineTool as defineTool4 } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type as Type3 } from "typebox";
var WORKFLOW_GATE_GUIDELINE = "The `workflow` tool runs multi-agent orchestration \u2014 it fans decomposable work out across subagents, and fits tasks shaped like: repo-wide inspection, independent parallel research/checks, multi-perspective review, or fan-out/fan-in synthesis. ONLY call it when the user explicitly opts in \u2014 via the workflow trigger word, `/workflows run`, or their own words (e.g. 'run a workflow', 'fan this out', '\u5E76\u884C\u5BA1\u4E00\u904D'). For any other task \u2014 even one that would clearly benefit \u2014 do not call it; you may briefly offer it (with a rough cost) as an option instead.";
var workflowToolSchema = Type3.Object({
  script: Type3.Optional(
    Type3.String({
      description: [
        "Raw JavaScript workflow script, with no Markdown fences. Required unless `name` is given.",
        "First statement: export const meta = { name: 'short_snake_case', description: 'non-empty description' }. Add phases: [{ title: 'Phase' }] only when the workflow has named phases, and declare only phases it will use. With multiple phases, call phase('Exact Title') before each phase's work or set `phase` in the agent options.",
        "Use `await workflow(savedName, childArgs)` to run a saved workflow inline; nesting is limited to one level and shares the parent run's concurrency, agent, and token limits.",
        "Optional quality helpers include verify(), judgePanel(), loopUntilDry(), and completenessCheck().",
        "Optional control helpers include retry() and gate(); budget exposes total, spent(), and remaining(), and phase('Name', { budget: N }) sets a phase token limit.",
        "The optional `agentType` option selects a named user or project definition that can bind tools, a model, and role instructions; use it only when its name and purpose are provided in context. Its bound model overrides `tier`; an explicit `model` overrides both.",
        "Use plain JavaScript only; imports, require(), filesystem modules, Date.now(), Math.random(), and new Date() are unavailable.",
        "Use phase('Name'), agent(prompt, opts), parallel(arrayOfFunctions), pipeline(items, ...stages), log(message), args, cwd, process.cwd(), and budget. The workflow must call agent() at least once.",
        "parallel() requires functions, not promises, and returns results in input order: await parallel(items.map(item => () => agent(...))).",
        "pipeline(items, ...stages) runs stages sequentially for each item while items proceed concurrently; each stage receives (previousValue, originalItem, index)."
      ].join(" ")
    })
  ),
  name: Type3.Optional(
    Type3.String({
      description: `Run a saved or built-in workflow by name instead of \`script\`; its args go in \`args\`. Built-ins: ${BUILTIN_WORKFLOW_NAMES.join(", ")} \u2014 see the workflow-patterns skill for each one's args. A same-named saved workflow wins. Not combinable with resumeFromRunId.`
    })
  ),
  args: Type3.Optional(
    // Must be an explicitly typed object schema, not Type.Any(). Type.Any()
    // compiles to a schema with no "type" keyword at all (just
    // `{ description }`), and at least one MCP/tool-calling bridge observed
    // in the wild does not treat a typeless property as "accept any JSON
    // value" — it coerces/flattens it before the handler ever sees it, so
    // `args.scope` (etc.) arrives as `undefined` and every built-in pattern
    // that requires an args field fails validation regardless of what the
    // caller actually sent. Every built-in pattern's `args` is a JSON object
    // at the top level, so declaring `type: "object"` is lossless and fixes
    // the coercion. Type.Unsafe keeps the emitted schema minimal (no
    // `properties`/`additionalProperties` boilerplate — JSON Schema already
    // allows additional properties by default) to stay inside the
    // provider-visible tool definition's byte budget.
    Type3.Unsafe({
      type: "object",
      description: "Optional JSON value exposed to the workflow script as global `args`."
    })
  ),
  background: Type3.Optional(
    Type3.Boolean({
      description: "Run the workflow in the background. Default: true \u2014 the tool returns immediately with a run ID, the turn ends so the user isn't blocked, and the result is delivered back into the conversation when it finishes. Set to false only when you need the result inline in this same turn (the call will block until the workflow completes)."
    })
  ),
  maxAgents: Type3.Optional(
    Type3.Number({
      description: "Maximum number of agents allowed in this run. Default: 1000; this is a safety ceiling, not a target. Set a lower limit for dynamic or exploratory fan-out, and reserve large fan-outs for explicit user intent."
    })
  ),
  concurrency: Type3.Optional(
    Type3.Number({
      description: "Maximum concurrent agents for this run. Clamped to the runtime maximum. Use when provider/transport stability matters."
    })
  ),
  agentRetries: Type3.Optional(
    Type3.Number({
      description: "Retry attempts for recoverable agent failures such as timeout, connection failure, or empty assistant output. Default 0 unless configured."
    })
  ),
  agentTimeoutMs: Type3.Optional(
    Type3.Number({
      description: "Timeout per agent in milliseconds. Omit to use configured `defaultAgentTimeoutMs`; without one, there is no hard timeout. Set only when the user asks to bound time."
    })
  ),
  tokenBudget: Type3.Optional(
    Type3.Number({
      description: "Optional user-requested soft spend gate, not a planning target. Do not set `tokenBudget` unless the user explicitly supplies a cap or asks you to choose one; never infer or invent one from task size. If omitted, the configured `defaultTokenBudget` applies; without one, the run is unlimited. Reaching the gate blocks later `agent()` calls; concurrent in-flight work can overshoot."
    })
  ),
  resumeFromRunId: Type3.Optional(
    Type3.String({
      description: [
        "Resume a prior run (this ID) with an edited `script` instead of starting a new run.",
        "Unchanged agent() calls replay from that run's cache; the first changed/new call onward re-runs.",
        "Calls match by position: keep earlier good calls identical and in order. Always background."
      ].join(" ")
    })
  )
});
function createWorkflowTool(options = {}) {
  const fallbackCwd = options.cwd ?? process.cwd();
  const fallbackStorage = options.storage ?? createWorkflowStorage(fallbackCwd);
  const defaults = resolveWorkflowToolDefaults(options, fallbackCwd);
  const fallbackManager = options.manager ?? new WorkflowManager({
    cwd: options.cwd,
    concurrency: defaults.concurrency,
    loadSavedWorkflow: (name) => fallbackStorage.load(name)?.script,
    defaultAgentTimeoutMs: defaults.agentTimeoutMs,
    defaultAgentRetries: defaults.agentRetries
  });
  const getManager = () => options.getManager?.() ?? fallbackManager;
  const getStorage = () => options.getStorage?.() ?? fallbackStorage;
  const getCwd = () => options.getCwd?.() ?? fallbackCwd;
  return defineTool4({
    name: "workflow",
    label: "Workflow",
    description: "Run a JavaScript workflow that delegates work to subagents with agent(), optionally composing calls with parallel() and pipeline().",
    promptSnippet: "Delegate substantive independent or staged work to subagents with a JavaScript workflow, optionally composing agent calls with parallel(), pipeline(), or both",
    get promptGuidelines() {
      return [WORKFLOW_GATE_GUIDELINE];
    },
    parameters: workflowToolSchema,
    prepareArguments(args) {
      return normalizeWorkflowToolArgs(args);
    },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const manager = getManager();
      const storage = getStorage();
      const cwd = getCwd();
      let invocationTools;
      let invocationToolset;
      let script;
      if (params.name) {
        if (params.resumeFromRunId) {
          throw new Error(
            "workflow: `name` cannot be combined with `resumeFromRunId` \u2014 resume with an edited `script` instead."
          );
        }
        const resolved = resolveWorkflowInvocation(params.name, params.args, { storage, cwd });
        if (!resolved) {
          throw new Error(
            `workflow: no saved or built-in workflow named "${params.name}". Built-in names: ${BUILTIN_WORKFLOW_NAMES.join(", ")}.`
          );
        }
        script = normalizeWorkflowScript(resolved.script);
        invocationTools = resolved.tools;
        invocationToolset = resolved.toolset;
      } else {
        if (!params.script) throw new Error("workflow requires either `script` or `name`");
        script = normalizeWorkflowScript(params.script);
      }
      const parsed = parseWorkflowScript(script);
      if (params.resumeFromRunId) {
        const runId = params.resumeFromRunId;
        const resumed = await manager.resume(runId, {
          script,
          args: params.args,
          // Explicit raise only — resume keeps the start-time cap unless the
          // caller passes a higher maxAgents (see WorkflowManager.resume, #146).
          maxAgents: params.maxAgents
        });
        if (!resumed) {
          throw new Error(resumeFailureText(manager, runId, params.maxAgents));
        }
        return {
          content: [{ type: "text", text: resumedText(parsed.meta.name, runId) }],
          details: { runId, background: true, resumedFrom: runId }
        };
      }
      const uiCtx = ctx;
      const uiConfirm = uiCtx?.hasUI ? uiCtx.ui?.confirm : void 0;
      const confirm = uiConfirm ? (promptText) => uiConfirm.call(uiCtx?.ui, "Workflow checkpoint", promptText) : void 0;
      if (params.background ?? true) {
        const { runId } = manager.startInBackground(script, params.args, {
          maxAgents: params.maxAgents,
          concurrency: params.concurrency,
          agentRetries: params.agentRetries,
          agentTimeoutMs: params.agentTimeoutMs,
          tokenBudget: params.tokenBudget,
          tools: invocationTools,
          toolset: invocationToolset
        });
        return {
          content: [{ type: "text", text: backgroundStartedText(parsed.meta.name, runId) }],
          details: { runId, background: true }
        };
      }
      let snapshot = createWorkflowSnapshot(parsed.meta);
      const display = createToolUpdateWorkflowDisplay(onUpdate, void 0, {
        key: "workflow",
        streamToolUpdates: true,
        maxAgents: 4,
        showResultPreviews: false
      });
      let result2;
      try {
        result2 = await manager.runSync(script, params.args, {
          maxAgents: params.maxAgents,
          concurrency: params.concurrency,
          agentRetries: params.agentRetries,
          agentTimeoutMs: params.agentTimeoutMs,
          tokenBudget: params.tokenBudget,
          tools: invocationTools,
          toolset: invocationToolset,
          confirm,
          externalSignal: signal,
          onProgress(live) {
            snapshot = recomputeWorkflowSnapshot(live);
            display.update(snapshot);
          }
        });
      } catch (error) {
        if (signal?.aborted || error instanceof WorkflowError && error.code === "WORKFLOW_ABORTED" /* WORKFLOW_ABORTED */) {
          for (const agent of snapshot.agents) {
            if (agent.status === "running") {
              agent.status = "skipped";
              agent.error = "aborted";
            }
          }
          snapshot = recomputeWorkflowSnapshot(snapshot);
          display.complete(snapshot);
          throw new Error("Workflow was aborted");
        }
        throw error;
      }
      if (result2.agentCount === 0) {
        throw new Error(
          "workflow scripts must call agent() at least once; this workflow declared phases but did not run any subagents"
        );
      }
      snapshot.result = result2.result;
      snapshot.durationMs = result2.durationMs;
      snapshot = recomputeWorkflowSnapshot(snapshot);
      display.complete(snapshot);
      const tokenSegment = fmtTokenSegment(tokenFigures(result2.tokenUsage), fmtFull);
      const tokenInfo = tokenSegment ? `

Token usage: ${tokenSegment}${result2.tokenUsage?.cost ? ` (${fmtCost(result2.tokenUsage.cost)})` : ""}` : "";
      const formattedResult = result2.result !== void 0 ? `
\`\`\`json
${JSON.stringify(result2.result, null, 2)}
\`\`\`` : "";
      return {
        content: [
          {
            type: "text",
            text: `Workflow **${result2.meta.name}** completed with **${result2.agentCount}** agent(s).${tokenInfo}

## Result${formattedResult}

${reviseHint(result2.runId)}`
          }
        ],
        details: {
          ...snapshot,
          meta: result2.meta,
          phases: result2.phases,
          logs: result2.logs,
          result: result2.result,
          durationMs: result2.durationMs,
          tokenUsage: result2.tokenUsage,
          runId: result2.runId
        }
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("workflow")), 0, 0);
    },
    renderResult(result2, { isPartial }, theme) {
      const snapshot = result2.details;
      if (snapshot?.name) {
        return new Text(renderWorkflowText(snapshot, !isPartial), 0, 0);
      }
      const text = result2.content?.[0];
      const raw = text?.type === "text" ? text.text : theme.fg("muted", "workflow");
      const clean = raw.replace(/\*\*/g, "").replace(/```[a-z]*\n/g, "").replace(/```/g, "").replace(/^##+\s*/gm, "").trim();
      return new Text(clean || theme.fg("muted", "workflow"), 0, 0);
    }
  });
}
function resolveWorkflowToolDefaults(options, cwd) {
  const settings = loadWorkflowSettings({ cwd });
  return {
    agentTimeoutMs: options.defaultAgentTimeoutMs !== void 0 ? options.defaultAgentTimeoutMs : settings.defaultAgentTimeoutMs ?? null,
    concurrency: options.defaultConcurrency ?? options.concurrency ?? settings.defaultConcurrency,
    agentRetries: options.defaultAgentRetries ?? settings.defaultAgentRetries ?? 0
  };
}
function backgroundStartedText(name, runId) {
  return [
    `Workflow "${name}" started in the background.`,
    `Run ID: ${runId}`,
    "It keeps running on its own. When it finishes, the result is delivered back",
    "here and the conversation continues automatically \u2014 the user does not need to",
    "do anything. Tell the user they can simply wait here for it to finish (it will",
    "resume the conversation by itself), or keep chatting / working on other things",
    "in the meantime; either way the result will come back to this conversation.",
    `They can also track or cancel it with /workflows status ${runId} or /workflows stop ${runId}.`,
    reviseHint(runId)
  ].join("\n");
}
function reviseHint(runId) {
  if (!runId) return "";
  return `To revise without re-running everything: re-call workflow with resumeFromRunId="${runId}" and an edited script \u2014 unchanged agent() calls replay from cache, only edited/new ones re-run.`;
}
function resumedText(name, runId) {
  return [
    `Workflow "${name}" resumed from run ${runId} with your edited script.`,
    "Unchanged agent() calls replay from that run's journal (cache); the first",
    "edited or newly inserted agent() call \u2014 and everything after it \u2014 re-runs live.",
    "It runs in the background; the result is delivered back here when it finishes,",
    "and the conversation continues automatically. The user can wait or keep working.",
    `Track or cancel it with /workflows status ${runId} or /workflows stop ${runId}.`
  ].join("\n");
}
function resumeFailureText(manager, runId, requestedMaxAgents) {
  const active = manager.getRun(runId);
  if (active?.status === "running") {
    return `Cannot resume workflow run "${runId}": it is still running. Wait for it to finish (or /workflows stop ${runId}) before resuming with an edited script.`;
  }
  const persisted = manager.getPersistence().load(runId);
  if (!persisted) {
    return `Cannot resume workflow run "${runId}": no run with that ID was found. Use the runId from a prior workflow result, or omit resumeFromRunId to start a new run.`;
  }
  if (persisted.status === "completed") {
    return `Cannot resume workflow run "${runId}": it already completed. Start a new run instead (omit resumeFromRunId).`;
  }
  if (persisted.status === "aborted" || active?.status === "aborted") {
    return `Cannot resume workflow run "${runId}": it was stopped/aborted and is not resumable. Start a new run instead (omit resumeFromRunId).`;
  }
  if (!persisted.script) {
    return `Cannot resume workflow run "${runId}": it has no persisted script to resume. Start a new run instead (omit resumeFromRunId).`;
  }
  if (typeof requestedMaxAgents === "number" && Number.isFinite(requestedMaxAgents)) {
    const effectivePrior = persisted.maxAgents ?? MAX_AGENTS_PER_RUN;
    if (Math.floor(requestedMaxAgents) <= effectivePrior) {
      return `Cannot resume workflow run "${runId}": cannot lower or keep maxAgents at ${effectivePrior}; pass maxAgents > ${effectivePrior}.`;
    }
  }
  return `Cannot resume workflow run "${runId}": it is not currently resumable (it may be busy under another process). Try again shortly, or start a new run.`;
}
function normalizeWorkflowToolArgs(args) {
  if (!args || typeof args !== "object")
    throw new Error("workflow requires an object argument with a `script` string or a `name`");
  const value = args;
  if (typeof value.name === "string" && value.name.trim()) {
    if (value.script !== void 0 && typeof value.script !== "string") {
      throw new Error("workflow's `script` must be a string when provided alongside `name`");
    }
    return {
      ...value,
      name: value.name.trim(),
      script: typeof value.script === "string" ? normalizeWorkflowScript(value.script) : void 0
    };
  }
  if (typeof value.script !== "string") throw new Error("workflow requires either `script` or `name` to be a string");
  return { ...value, script: normalizeWorkflowScript(value.script) };
}
function normalizeWorkflowScript(script) {
  let text = script.trim();
  const fence = text.match(/^```(?:js|javascript)?\s*\n([\s\S]*?)\n```$/i);
  if (fence) text = fence[1].trim();
  return text;
}

// src/workflows-models-command.ts
import {
  Container,
  SelectList,
  Spacer,
  Text as Text2
} from "@earendil-works/pi-tui";
function registerWorkflowModelsCommand(pi) {
  pi.registerCommand("workflows-models", {
    description: "View and edit model tiers used by workflows (small/medium/big)",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      const currentModel = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : void 0;
      let config = loadModelTierConfig() ?? buildDefaultTierConfig(currentModel, listAvailableModels(ctx.modelRegistry));
      let dirty = false;
      const ensureFresh = (cfg) => {
        config = cfg;
        dirty = true;
      };
      while (true) {
        const tiers = sortedTierNames(config);
        const menuOptions = [];
        menuOptions.push("\u2500".repeat(30));
        for (const name of tiers) {
          const model = config.tiers[name];
          menuOptions.push(`${name} tier \u2192 ${model}`);
        }
        menuOptions.push("\u2500".repeat(30));
        menuOptions.push("Reset to defaults");
        menuOptions.push(dirty ? "Save and exit" : "Exit");
        const choice = await ctx.ui.select("Model tier configuration", menuOptions);
        if (!choice) break;
        for (const name of tiers) {
          if (choice.startsWith(`${name} tier \u2192`)) {
            const updatedTiers = await editSingleTier(ctx, config.tiers, name);
            if (updatedTiers !== null) {
              ensureFresh({ ...config, tiers: updatedTiers });
            }
            break;
          }
        }
        if (choice === "Reset to defaults") {
          const confirmed = await ctx.ui.confirm(
            "Reset model tiers",
            "This will reset tiers from your available model list. Continue?"
          );
          if (confirmed) {
            ensureFresh(buildDefaultTierConfig(currentModel, listAvailableModels(ctx.modelRegistry)));
            ctx.ui.notify("Tiers reset to defaults. Use 'Save and exit' to persist.", "info");
          }
        }
        if (choice === "Save and exit" || choice === "Exit") {
          if (choice === "Save and exit") {
            saveModelTierConfig(config);
            ctx.ui.notify("Model tiers saved.", "info");
          }
          break;
        }
      }
    }
  });
}
var DEFAULT_THINKING_CHOICE = "Default thinking (session setting)";
var THINKING_CHOICES = [DEFAULT_THINKING_CHOICE, ...THINKING_LEVELS];
function fromThinkingChoice(choice) {
  return THINKING_LEVELS.find((level) => level === choice);
}
async function editSingleTier(ctx, tiers, tierName) {
  const available = listAvailableModelSpecs(ctx.modelRegistry);
  const knownSpecs = available.length > 0 ? available : void 0;
  const current = tiers[tierName];
  const currentParts = splitModelSpecThinking(current, knownSpecs);
  const items = available.map((m) => ({ value: m, label: m }));
  const selectedModel = await ctx.ui.custom((tui, theme, _keybindings, done) => {
    const container = new Container();
    const titleText = current ? `Pick a model for "${tierName}" (current: ${current})` : `Pick a model for "${tierName}"`;
    container.addChild(new Text2(theme.fg("accent", titleText), 1, 0));
    container.addChild(new Spacer(1));
    const selectTheme = {
      selectedPrefix: (t) => theme.bg("selectedBg", theme.fg("accent", t)),
      selectedText: (t) => theme.bg("selectedBg", theme.bold(t)),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t)
    };
    const selectList = new SelectList(items, 12, selectTheme);
    if (currentParts.modelSpec) {
      const idx = items.findIndex((i) => i.value === currentParts.modelSpec);
      if (idx >= 0) selectList.setSelectedIndex(idx);
    }
    selectList.onSelect = (item) => done(item.value);
    selectList.onCancel = () => done(null);
    container.addChild(selectList);
    container.addChild(new Spacer(1));
    container.addChild(
      new Text2(theme.fg("dim", "\u2191\u2193 navigate  enter select  esc cancel  \xB7 thinking is chosen next"), 1, 0)
    );
    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        selectList.handleInput(data);
        tui.requestRender();
      }
    };
  });
  if (!selectedModel) return null;
  const currentThinkingLabel = currentParts.thinkingLevel ?? DEFAULT_THINKING_CHOICE;
  const thinkingChoice = await ctx.ui.select(
    `Thinking for "${tierName}" tier (current: ${currentThinkingLabel})`,
    THINKING_CHOICES.map((choice) => String(choice))
  );
  if (!thinkingChoice) return null;
  const thinkingLevel = fromThinkingChoice(thinkingChoice);
  const result2 = formatModelSpecWithThinking(selectedModel, thinkingLevel);
  if (result2 === current) return null;
  ctx.ui.notify(`"${tierName}" tier \u2192 ${result2}`, "info");
  return { ...tiers, [tierName]: result2 };
}

// extensions/workflow.ts
var SESSION_HEADER_SCAN_BYTES = 64 * 1024;
function sessionFileCwd(sessionFile) {
  if (!sessionFile || !existsSync5(sessionFile)) return void 0;
  let fd;
  try {
    fd = openSync(sessionFile, "r");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(4096);
    const chunks = [];
    let scanned = 0;
    while (scanned < SESSION_HEADER_SCAN_BYTES) {
      const n = readSync(fd, buffer, 0, Math.min(buffer.length, SESSION_HEADER_SCAN_BYTES - scanned), null);
      if (n === 0) {
        chunks.push(decoder.end());
        break;
      }
      scanned += n;
      const chunk = decoder.write(buffer.subarray(0, n));
      const nl = chunk.indexOf("\n");
      if (nl !== -1) {
        chunks.push(chunk.slice(0, nl));
        break;
      }
      chunks.push(chunk);
    }
    const line = chunks.join("").trim();
    if (!line) return void 0;
    const entry = JSON.parse(line);
    if (entry.type !== "session" || typeof entry.cwd !== "string" || !entry.cwd) return void 0;
    return resolve3(entry.cwd);
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) {
      try {
        closeSync(fd);
      } catch {
      }
    }
  }
}
function buildManagerOptions(cwd, storage) {
  const settings = loadWorkflowSettings({ cwd });
  return {
    loadSavedWorkflow: (name) => storage.load(name)?.script,
    toolsets: {},
    excludeSubagentTools: settings.excludeSubagentTools,
    defaultAgentTimeoutMs: settings.defaultAgentTimeoutMs ?? null,
    defaultTokenBudget: settings.defaultTokenBudget ?? null,
    concurrency: settings.defaultConcurrency,
    defaultAgentRetries: settings.defaultAgentRetries,
    persistAgentSessions: settings.persistAgentSessions
  };
}
function extension(pi) {
  let cwd = resolve3(process.cwd());
  let storage = createWorkflowStorage(cwd);
  let managerOptions = buildManagerOptions(cwd, storage);
  const runtimeClaim = claimWorkflowRuntime();
  const previousRuntime = runtimeClaim.compatible;
  let pausedForMismatch = runtimeClaim.versionMismatch ? pauseStrandedWorkflowRuntime(runtimeClaim.versionMismatch) : 0;
  if (previousRuntime) {
    const claimedCwd = resolve3(previousRuntime.manager.getCwd());
    if (claimedCwd !== cwd) {
      cwd = claimedCwd;
      storage = createWorkflowStorage(cwd);
      managerOptions = buildManagerOptions(cwd, storage);
    }
  }
  let manager = previousRuntime?.manager ?? new WorkflowManager({ cwd, ...managerOptions });
  if (previousRuntime) manager.reconfigureAfterReload(managerOptions);
  const effort = (previousRuntime ?? runtimeClaim.versionMismatch)?.effort ?? createEffortState();
  if (previousRuntime?.effort && previousRuntime.effort !== effort) {
    effort.level = previousRuntime.effort.level;
  }
  const getManager = () => manager;
  const getCwd = () => cwd;
  const getStorage = () => storage;
  installResultDelivery(pi, manager, { loadSettings: () => loadWorkflowSettings({ cwd: getCwd() }) });
  const workflowTool = createWorkflowTool({
    getManager,
    getCwd,
    getStorage,
    get manager() {
      return manager;
    },
    get cwd() {
      return cwd;
    },
    get storage() {
      return storage;
    }
  });
  const workflowControlTool = createWorkflowControlTool({ getManager });
  pi.registerTool(workflowTool);
  pi.registerTool(workflowControlTool);
  let usageLimitScheduler = new UsageLimitScheduler(manager);
  pi.on("session_shutdown", (event) => {
    usageLimitScheduler.dispose();
    const outgoingSessionId = manager.getSessionId?.();
    suspendResultDelivery(manager);
    const reason = event?.reason;
    const runtime = {
      cwd,
      extensionVersion: WORKFLOW_EXTENSION_VERSION,
      manager,
      effort
    };
    if (reason && SESSION_REPLACEMENT_REASONS.has(reason)) {
      if (reason === "resume") {
        const targetCwd = sessionFileCwd(event?.targetSessionFile);
        if (targetCwd !== cwd) {
          pauseStrandedWorkflowRuntime(runtime);
          discardWorkflowRuntime(cwd, runtime);
          dropSessionDelivery(outgoingSessionId);
          return;
        }
        handoffWorkflowRuntime(runtime);
        return;
      }
      if (reason === "fork") {
        const targetCwd = sessionFileCwd(event?.targetSessionFile);
        if (targetCwd && targetCwd !== cwd) {
          pauseStrandedWorkflowRuntime(runtime);
          discardWorkflowRuntime(cwd, runtime);
          dropSessionDelivery(outgoingSessionId);
          return;
        }
        handoffWorkflowRuntime(runtime);
        return;
      }
      handoffWorkflowRuntime(runtime);
      return;
    }
    pauseStrandedWorkflowRuntime(runtime);
    discardWorkflowRuntime(cwd, runtime);
    dropSessionDelivery(outgoingSessionId);
  });
  registerWorkflowCommands(pi, getManager, {
    getStorage,
    getCwd,
    effort
  });
  registerWorkflowModelsCommand(pi);
  registerBuiltinWorkflows(pi, { getManager, getCwd, getStorage });
  registerEffortCommand(pi, effort);
  let armingInstalled = false;
  pi.on("session_start", (_event, ctx) => {
    const sessionCwd = resolve3(ctx.cwd || process.cwd());
    if (sessionCwd !== resolve3(manager.getCwd())) {
      const stranded = {
        cwd: manager.getCwd(),
        extensionVersion: WORKFLOW_EXTENSION_VERSION,
        manager,
        effort
      };
      const n = pauseStrandedWorkflowRuntime(stranded);
      if (n > 0) pausedForMismatch += n;
      cwd = sessionCwd;
      storage = createWorkflowStorage(cwd);
      managerOptions = buildManagerOptions(cwd, storage);
      manager = new WorkflowManager({ cwd, ...managerOptions });
      installResultDelivery(pi, manager, { loadSettings: () => loadWorkflowSettings({ cwd: getCwd() }) });
      usageLimitScheduler.dispose();
      usageLimitScheduler = new UsageLimitScheduler(manager);
    } else if (cwd !== sessionCwd) {
      cwd = sessionCwd;
      storage = createWorkflowStorage(cwd);
      managerOptions = buildManagerOptions(cwd, storage);
      manager.reconfigureAfterReload(managerOptions);
    }
    registerAllSavedWorkflows(pi, getCwd, getStorage, getManager);
    if (pausedForMismatch > 0) {
      ctx.ui.notify(
        `Paused ${pausedForMismatch} active workflow(s) that could not safely continue in this session (extension update or project switch). Resume them from /workflows when ready.`,
        "warning"
      );
      pausedForMismatch = 0;
    }
    manager.setMainModel(ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : void 0);
    manager.setModelRegistry(ctx.modelRegistry);
    const active = pi.getActiveTools();
    const workflowTools = [workflowTool.name, workflowControlTool.name];
    const missing = workflowTools.filter((name) => !active.includes(name));
    if (missing.length) pi.setActiveTools([...active, ...missing]);
    let sessionId;
    try {
      sessionId = ctx.sessionManager?.getSessionId();
    } catch {
    }
    const previousSessionId = manager.getSessionId();
    manager.adoptLiveRunsToSession(sessionId, previousSessionId);
    manager.setSessionId(sessionId);
    if (sessionId) {
      bindSessionDelivery(sessionId, pi, {
        loadSettings: () => loadWorkflowSettings({ cwd: getCwd() }),
        manager,
        sessionManager: ctx.sessionManager
      });
      if (previousSessionId && previousSessionId !== sessionId) {
        dropSessionDelivery(previousSessionId);
      }
    }
    installTaskPanel(pi, manager, ctx.ui, {
      storage,
      cwd,
      loadSettings: () => loadWorkflowSettings({ cwd: getCwd() })
    });
    if (!armingInstalled) {
      installWorkflowKeywordArming(pi, effort, {
        settingsStore: {
          load: () => loadWorkflowSettings({ cwd: getCwd() }),
          save: (nextSettings) => saveWorkflowSettingsForCwd(nextSettings, getCwd())
        }
      });
      armingInstalled = true;
    }
  });
  pi.on("model_select", (event) => {
    const m = event.model;
    manager.setMainModel(m ? `${m.provider}/${m.id}` : void 0);
  });
}
export {
  extension as default,
  sessionFileCwd
};
