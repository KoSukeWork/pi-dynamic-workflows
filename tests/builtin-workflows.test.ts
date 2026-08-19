import assert from "node:assert/strict";
import test from "node:test";
import { generateAdversarialReviewWorkflow, generateMultiPerspectiveWorkflow } from "../src/adversarial-review.js";
import { generateCodeReviewWorkflow } from "../src/code-review.js";
import { generateCodebaseAuditWorkflow } from "../src/deep-research.js";
import { parseWorkflowScript, runWorkflow } from "../src/workflow.js";

// ─── Adversarial Review ─────────────────────────────────────────────────────────

test("generateAdversarialReviewWorkflow produces a valid, parseable script", () => {
  const { meta, body } = parseWorkflowScript(generateAdversarialReviewWorkflow());
  assert.equal(meta.name, "adversarial_review");
  assert.match(body, /args && args\.task/);
  assert.match(body, /threshold/);
  assert.match(body, /survives/);
});

test("generateAdversarialReviewWorkflow phases are Investigate, Refute, Consensus", () => {
  const { meta } = parseWorkflowScript(generateAdversarialReviewWorkflow());
  assert.deepEqual(
    meta.phases?.map((p) => p.title),
    ["Investigate", "Refute", "Consensus"],
  );
});

// ─── Codebase Audit ─────────────────────────────────────────────────────────────

test("generateCodebaseAuditWorkflow produces a valid, parseable script", () => {
  const { meta } = parseWorkflowScript(
    generateCodebaseAuditWorkflow("src/", ["check types", "find bugs", "review style"]),
  );
  assert.equal(meta.name, "codebase_audit");
  assert.deepEqual(
    meta.phases?.map((p) => p.title),
    ["Individual Checks", "Cross-Validation", "Report"],
  );
});

test("generateCodebaseAuditWorkflow creates an agent per check item", () => {
  const body = generateCodebaseAuditWorkflow("src/", ["check-a", "check-b", "check-c"]);
  assert.match(body, /check-a/);
  assert.match(body, /check-b/);
  assert.match(body, /check-c/);
});

test("generateCodebaseAuditWorkflow uses parallel for checks", () => {
  const body = generateCodebaseAuditWorkflow("src/", ["lint"]);
  assert.match(body, /parallel\(/);
});

test("generateCodebaseAuditWorkflow includes validator and report phases", () => {
  const body = generateCodebaseAuditWorkflow("src/", ["test"]);
  assert.match(body, /validator/);
  assert.match(body, /report-writer/);
});

test("generateCodebaseAuditWorkflow embeds a scope/check containing quotes/backticks as a valid, parseable script", () => {
  const tricky = 'it\'s a "test" with `backticks` and \\backslashes\\';
  const body = generateCodebaseAuditWorkflow(tricky, ["find TODO's", 'quote "marks"', "back`ticks`"]);
  // JSON.stringify-embedded values must round-trip through parsing/execution
  // without breaking out of the generated script (see the quote-injection fix).
  const { meta } = parseWorkflowScript(body);
  assert.equal(meta.name, "codebase_audit");
});

test("generateCodebaseAuditWorkflow running with quote-laden scope/checks executes without a parse error", async () => {
  const tricky = 'it\'s a "test" with `backticks`';
  const body = generateCodebaseAuditWorkflow(tricky, ["find TODO's"]);
  const seenScopes: string[] = [];
  const result = await runWorkflow(body, {
    agent: {
      async run(prompt: string) {
        seenScopes.push(prompt);
        return "ok";
      },
    },
    persistLogs: false,
  });
  assert.equal(result.agentCount, 3, "the check agent + validator + report agents all run without throwing");
  assert.ok(
    seenScopes.some((p) => p.includes(tricky)),
    "the full, untruncated scope should reach the check agent's prompt",
  );
});

test("generateCodebaseAuditWorkflow truncates only the display description, never the operative scope", () => {
  const long = "x".repeat(100);
  const body = generateCodebaseAuditWorkflow(long, ["check"]);
  // The operative `const scope = ...` must carry the full, untruncated value —
  // a truncated operative scope would silently narrow what gets audited.
  assert.ok(body.includes(JSON.stringify(long)), "the operative scope must be the full 100-char string");
  // The human-readable meta.description is display-only and may be truncated.
  assert.ok(body.includes(`${"x".repeat(60)}…`), "meta.description should show the truncated, ellipsized scope");
  assert.ok(
    !body.includes(JSON.stringify(`Codebase audit: ${long}`)),
    "meta.description itself should not contain the full untruncated scope",
  );
});

// ─── Multi-Perspective ──────────────────────────────────────────────────────────

test("generateMultiPerspectiveWorkflow produces a valid, parseable script", () => {
  const { meta } = parseWorkflowScript(
    generateMultiPerspectiveWorkflow("climate change", ["economic", "environmental", "social"]),
  );
  assert.equal(meta.name, "multi_perspective_analysis");
  assert.deepEqual(
    meta.phases?.map((p) => p.title),
    ["Perspective Analysis", "Synthesis"],
  );
});

test("generateMultiPerspectiveWorkflow creates one agent per perspective", () => {
  const perspectives = ["technical", "business", "user"];
  const body = generateMultiPerspectiveWorkflow("new API", perspectives);
  assert.match(body, /technical/);
  assert.match(body, /business/);
  assert.match(body, /user/);
});

test("generateMultiPerspectiveWorkflow uses parallel for perspective analysis", () => {
  const body = generateMultiPerspectiveWorkflow("topic", ["p1", "p2"]);
  assert.match(body, /parallel\(/);
});

test("generateMultiPerspectiveWorkflow includes synthesis phase", () => {
  const body = generateMultiPerspectiveWorkflow("topic", ["p1"]);
  assert.match(body, /synthesizer/);
});

test("generateMultiPerspectiveWorkflow returns analyses and synthesis", () => {
  const body = generateMultiPerspectiveWorkflow("topic", ["p1"]);
  assert.match(body, /analyses/);
  assert.match(body, /synthesis/);
});

test("generateMultiPerspectiveWorkflow embeds a topic/perspective containing quotes/backticks as a valid, parseable script", () => {
  const trickyTopic = 'it\'s a "test" with `backticks` and \\backslashes\\';
  const body = generateMultiPerspectiveWorkflow(trickyTopic, ["user's view", 'quote "marks"', "back`ticks`"]);
  const { meta } = parseWorkflowScript(body);
  assert.equal(meta.name, "multi_perspective_analysis");
});

test("generateMultiPerspectiveWorkflow running with quote-laden topic/perspectives executes without a parse error", async () => {
  const trickyTopic = 'it\'s a "test" with `backticks`';
  const body = generateMultiPerspectiveWorkflow(trickyTopic, ["user's view", "another's angle"]);
  const seenPrompts: string[] = [];
  const result = await runWorkflow(body, {
    agent: {
      async run(prompt: string) {
        seenPrompts.push(prompt);
        return "ok";
      },
    },
    persistLogs: false,
  });
  assert.equal(result.agentCount, 3, "2 perspective agents + the synthesizer all run without throwing");
  assert.ok(
    seenPrompts.some((p) => p.includes(trickyTopic)),
    "the full topic should reach a perspective agent's prompt",
  );
});

// ─── Code Review ────────────────────────────────────────────────────────────────

test("generateCodeReviewWorkflow produces a valid, parseable script", () => {
  const { meta, body } = parseWorkflowScript(generateCodeReviewWorkflow());
  assert.equal(meta.name, "code_review");
  assert.deepEqual(
    meta.phases?.map((p) => p.title),
    ["Find", "Verify", "Report"],
  );
  assert.match(body, /parallel/);
  assert.match(body, /candidateSchema/);
});

test("generateCodeReviewWorkflow truncates an oversized diff and surfaces it", () => {
  const { body } = parseWorkflowScript(generateCodeReviewWorkflow());
  assert.match(body, /MAX_DIFF_CHARS/);
  assert.match(body, /diffTruncated/);
});
