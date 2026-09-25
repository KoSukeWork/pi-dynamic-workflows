import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import type { AgentRunOptions } from "../src/agent.js";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { type JournalEntry, runWorkflow } from "../src/workflow.js";

function quota(): never {
  throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
}

async function put(options: AgentRunOptions | undefined, value: string) {
  await options?.systemTools?.find((tool) => tool.name === "store_put")?.execute("", { key: "plan", value });
}

async function get(options: AgentRunOptions | undefined): Promise<string> {
  const result = await options?.systemTools?.find((tool) => tool.name === "store_get")?.execute("", { key: "plan" });
  return (result?.details as { value: string }).value;
}

function registry(version: string) {
  return new Map([["planner", { name: "planner", prompt: version, source: "project" as const }]]);
}

function fixture(t: { after: (cleanup: () => void) => void }): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-nested-prefix-"));
  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-C",
        cwd,
        "-c",
        "commit.gpgsign=false",
        "-c",
        "user.name=test",
        "-c",
        "user.email=test@example.invalid",
        ...args,
      ],
      { stdio: "pipe" },
    );
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(cwd, "file.txt"), "base\n");
  git("add", ".");
  git("commit", "-qm", "base");
  return cwd;
}

for (const sibling of [false, true]) {
  for (const change of ["prompt", "definition", "args", "removed-call", "unchanged"] as const) {
    test(`nested resume invalidates downstream results: sibling=${sibling}, change=${change}`, async () => {
      const script = `export const meta = {name:'parent',description:'test'};
await workflow('planner', args);
const result = await ${sibling ? "workflow('reader')" : "agent('read plan')"};
await agent('gate'); return result;`;
      const planner = (resumed: boolean) => `export const meta = {name:'planner',description:'test'};
await agent(${change === "args" ? "'plan:' + args" : JSON.stringify(change === "definition" ? "defined plan" : resumed && change === "prompt" ? "plan:v2" : "plan:v1")}, {agentType:'planner'});
${change === "removed-call" && !resumed ? "await agent('plan:obsolete');" : ""}`;
      const reader = "export const meta = {name:'reader',description:'test'}; return await agent('read plan');";
      const journal = new Map<string, JournalEntry>();
      const calls: string[] = [];
      let paused = true;
      const agent = {
        run: async (prompt: string, options?: AgentRunOptions) => {
          calls.push(prompt);
          if (prompt === "gate") return paused ? quota() : "done";
          if (prompt === "read plan") return get(options);
          const value = prompt === "defined plan" ? (options?.instructions ?? "") : prompt.slice("plan:".length);
          await put(options, value);
          return "planned";
        },
      };
      const common = { runId: "child-invalidation", persistLogs: false, agent };
      await assert.rejects(
        runWorkflow(script, {
          ...common,
          args: "v1",
          agentRegistry: registry("v1"),
          loadSavedWorkflow: (name) => (name === "planner" ? planner(false) : reader),
          onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
        }),
        /provider quota/,
      );
      paused = false;
      calls.length = 0;
      const result = await runWorkflow(script, {
        ...common,
        args: change === "args" ? "v2" : "v1",
        agentRegistry: registry(change === "definition" ? "v2" : "v1"),
        loadSavedWorkflow: (name) => (name === "planner" ? planner(true) : reader),
        resumeJournal: journal,
      });
      assert.equal(result.result, change === "unchanged" || change === "removed-call" ? "v1" : "v2");
      assert.equal(calls.filter((prompt) => prompt === "read plan").length, change === "unchanged" ? 0 : 1);
    });
  }
}

test("a previously unfinished child invalidates a following cached parent checkpoint", async () => {
  const script = `export const meta = {name:'parent',description:'test'};
await workflow('child'); const result = await checkpoint('accept plan'); await agent('gate'); return result;`;
  const child = "export const meta = {name:'child',description:'test'}; return await agent('plan');";
  const journal = new Map<string, JournalEntry>();
  let resumed = false;
  let confirmations = 0;
  const common = {
    runId: "child-miss",
    persistLogs: false,
    loadSavedWorkflow: () => child,
    confirm: async () => {
      confirmations++;
      return resumed ? "new answer" : "old answer";
    },
    agent: {
      run: async (prompt: string) => {
        if (!resumed && prompt === "gate") return quota();
        if (!resumed)
          throw new WorkflowError("temporary failure", WorkflowErrorCode.AGENT_EXECUTION_ERROR, { recoverable: true });
        return "done";
      },
    },
  };
  await assert.rejects(
    runWorkflow(script, { ...common, onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry) }),
    /provider quota/,
  );
  assert.equal(journal.size, 1);
  resumed = true;
  const result = await runWorkflow(script, { ...common, resumeJournal: journal });
  assert.equal(result.result, "new answer");
  assert.equal(confirmations, 2);
});

test("a parent waits for live results when an overlapping child can miss after its next await", async () => {
  const script = `export const meta = {name:'parent',description:'test'};
const child = workflow('child'); const reader = agent('read plan');
const results = await Promise.all([child, reader]); await agent('gate'); return results[1];`;
  const child = `export const meta = {name:'child',description:'test'};
await agent('first plan'); return await agent('late plan');`;
  const journal = new Map<string, JournalEntry>();
  let resumed = false;
  let readers = 0;
  let finish!: () => void;
  let finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const common = {
    runId: "overlapping-child",
    persistLogs: false,
    concurrency: 2,
    loadSavedWorkflow: () => child,
    onRuntimeEvent: (event: { type: string; stage?: string }) => {
      if (event.type === "workflow" && event.stage === "end") finish();
    },
    agent: {
      run: async (prompt: string, options?: AgentRunOptions) => {
        if (prompt === "read plan") {
          readers++;
          await finished;
          return get(options);
        }
        if (prompt === "gate") return resumed ? "done" : quota();
        if (prompt === "late plan" && !resumed)
          throw new WorkflowError("temporary failure", WorkflowErrorCode.AGENT_EXECUTION_ERROR, { recoverable: true });
        await put(options, prompt === "late plan" ? "v2" : "v1");
        return "planned";
      },
    },
  };
  await assert.rejects(
    runWorkflow(script, { ...common, onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry) }),
    /provider quota/,
  );
  resumed = true;
  readers = 0;
  finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const result = await runWorkflow(script, { ...common, resumeJournal: journal });
  assert.equal(result.result, "v2");
  assert.equal(readers, 1);
});

for (const sibling of [false, true]) {
  for (const changed of [false, true]) {
    test(`nested definitions determine retained downstream worktrees: sibling=${sibling}, changed=${changed}`, async (t) => {
      const cwd = fixture(t);
      const edit = "agent('edit', {label:'editor',isolation:'worktree'})";
      const script = `export const meta = {name:'parent',description:'test'};
await workflow('planner'); return await ${sibling ? "workflow('editor')" : edit};`;
      const journal = new Map<string, JournalEntry>();
      const common = {
        cwd,
        runId: "nested-worktree",
        persistLogs: false,
        loadSavedWorkflow: (name: string) =>
          name === "planner"
            ? "export const meta = {name:'planner',description:'test'}; return await agent('plan', {agentType:'planner'});"
            : `export const meta = {name:'editor',description:'test'}; return await ${edit};`,
      };
      let retained = "";
      await assert.rejects(
        runWorkflow(script, {
          ...common,
          agentRegistry: registry("v1"),
          onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
          agent: {
            run: async (prompt, options) => {
              if (prompt === "plan") return "planned";
              retained = options?.cwd ?? "";
              writeFileSync(join(retained, "file.txt"), "partial v1\n");
              return quota();
            },
          },
        }),
        /provider quota/,
      );
      let observed = "";
      let observedCwd = "";
      await runWorkflow(script, {
        ...common,
        agentRegistry: registry(changed ? "v2" : "v1"),
        resumeJournal: journal,
        agent: {
          run: async (prompt, options) => {
            if (prompt === "plan") return "planned";
            observedCwd = options?.cwd ?? "";
            observed = readFileSync(join(observedCwd, "file.txt"), "utf8");
            return "done";
          },
        },
      });
      assert.equal(observed, changed ? "base\n" : "partial v1\n");
      assert.equal(observedCwd === retained, !changed);
      assert.equal(readFileSync(join(retained, "file.txt"), "utf8"), "partial v1\n");
    });
  }
}

test("a parent worktree keeps its identity across concurrent child completion and resume", async (t) => {
  const cwd = fixture(t);
  const script = `export const meta = {name:'parent',description:'test'};
const child = workflow('child'); const editor = agent('edit', {label:'editor',isolation:'worktree'});
return await Promise.all([child, editor]);`;
  const common = {
    cwd,
    runId: "child-concurrent",
    persistLogs: false,
    agentRegistry: registry("v1"),
    loadSavedWorkflow: () =>
      "export const meta = {name:'child',description:'test'}; return await agent('plan', {agentType:'planner'});",
  };
  let started!: () => void;
  const editorStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let retained = "";
  await assert.rejects(
    runWorkflow(script, {
      ...common,
      concurrency: 2,
      agent: {
        run: async (prompt, options) => {
          if (prompt === "plan") {
            await editorStarted;
            return quota();
          }
          retained = options?.cwd ?? "";
          writeFileSync(join(retained, "file.txt"), "partial\n");
          started();
          return quota();
        },
      },
    }),
    /provider quota/,
  );
  await runWorkflow(script, {
    ...common,
    concurrency: 1,
    resumeJournal: new Map(),
    agent: {
      run: async (prompt, options) => {
        if (prompt === "edit") {
          assert.equal(options?.cwd, retained);
          assert.equal(readFileSync(join(retained, "file.txt"), "utf8"), "partial\n");
        }
        return "done";
      },
    },
  });
});

test("nested argument identity distinguishes undefined array items from null", async (t) => {
  const cwd = fixture(t);
  const script = `export const meta = {name:'parent',description:'test'};
await workflow('child', [args]); return await agent('edit', {label:'editor',isolation:'worktree'});`;
  const journal = new Map<string, JournalEntry>();
  const common = {
    cwd,
    runId: "nested-argument",
    persistLogs: false,
    loadSavedWorkflow: () =>
      "export const meta = {name:'child',description:'test'}; return await agent('plan:' + String(args[0]));",
  };
  let retained = "";
  await assert.rejects(
    runWorkflow(script, {
      ...common,
      onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
      agent: {
        run: async (prompt, options) => {
          if (prompt.startsWith("plan:")) return "planned";
          retained = options?.cwd ?? "";
          writeFileSync(join(retained, "file.txt"), "partial undefined\n");
          return quota();
        },
      },
    }),
    /provider quota/,
  );
  let observed = "";
  await runWorkflow(script, {
    ...common,
    args: null,
    resumeJournal: journal,
    agent: {
      run: async (prompt, options) => {
        if (prompt.startsWith("plan:")) return "planned";
        observed = readFileSync(join(options?.cwd ?? "", "file.txt"), "utf8");
        return "done";
      },
    },
  });
  assert.equal(observed, "base\n");
  assert.equal(readFileSync(join(retained, "file.txt"), "utf8"), "partial undefined\n");
});

test("nested calls reject nonserializable arguments before starting an agent", async () => {
  let calls = 0;
  await assert.rejects(
    runWorkflow(
      `export const meta = {name:'parent',description:'test'};
return await workflow('child', {callback: () => 1});`,
      {
        persistLogs: false,
        loadSavedWorkflow: () => "export const meta = {name:'child',description:'test'}; return await agent('work');",
        agent: {
          run: async () => {
            calls++;
            return "done";
          },
        },
      },
    ),
    /childArgs must contain serializable data/,
  );
  assert.equal(calls, 0);
});
