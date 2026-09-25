import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentRunOptions } from "../src/agent.js";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { SharedStore } from "../src/shared-store.js";
import { type JournalEntry, runWorkflow, type WorkflowRunOptions } from "../src/workflow.js";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function quota(): never {
  throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
}

async function put(options: Pick<AgentRunOptions, "systemTools"> | undefined, value: string) {
  await options?.systemTools
    ?.find((tool) => tool.name === "store_put")
    ?.execute("", { key: "plan", value }, undefined, undefined, {} as ExtensionContext);
}

async function get(options: Pick<AgentRunOptions, "systemTools"> | undefined): Promise<string> {
  const result = await options?.systemTools
    ?.find((tool) => tool.name === "store_get")
    ?.execute("", { key: "plan" }, undefined, undefined, {} as ExtensionContext);
  return (result?.details as { value: string | null }).value ?? "missing";
}

function registry(value: string) {
  return new Map([["writer", { name: "writer", prompt: value, source: "project" as const }]]);
}

for (const reader of ["agent", "checkpoint"] as const) {
  for (const change of ["prompt", "args", "mutated-args", "definition", "unfinished", "unchanged"] as const) {
    test(`running child observes a later parent miss: reader=${reader}, change=${change}`, async () => {
      const script = (version: string) => `export const meta = {name:'parent',description:'test'};
${change === "mutated-args" ? "const version = args.version; args.version = 'mutated';" : ""}
const child = workflow('child');
await agent(${change === "args" ? "'write:' + args.version" : change === "mutated-args" ? "'write:' + version" : JSON.stringify(`write:${change === "prompt" ? version : "v1"}`)}, {agentType:'writer'});
const result = await child; await agent('gate'); return result;`;
      const child = `export const meta = {name:'child',description:'test'};
await agent('first'); return await ${reader}('read plan');`;
      const journal = new Map<string, JournalEntry>();
      let resumed = false;
      let writer = deferred();
      let store = new SharedStore();
      let reads = 0;
      const common: WorkflowRunOptions = {
        runId: "parent-miss",
        concurrency: 2,
        persistLogs: false,
        loadSavedWorkflow: () => child,
        onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
        confirm: async () => {
          reads++;
          await writer.promise;
          return store.get("plan") ?? "missing";
        },
        agent: {
          run: async (prompt, options) => {
            if (prompt === "gate") return resumed ? "done" : quota();
            if (prompt.startsWith("write:")) {
              if (change === "unfinished" && !resumed) {
                writer.release();
                throw new WorkflowError("temporary failure", WorkflowErrorCode.AGENT_EXECUTION_ERROR, {
                  recoverable: true,
                });
              }
              await put(
                options,
                change === "definition"
                  ? (options?.instructions ?? "")
                  : change === "unfinished"
                    ? "v2"
                    : prompt.slice(6),
              );
              writer.release();
              return "written";
            }
            await writer.promise;
            if (prompt === "first") return "ready";
            reads++;
            return get(options);
          },
        },
      };
      await assert.rejects(
        runWorkflow(script("v1"), {
          ...common,
          args: { version: "v1" },
          agentRegistry: registry("v1"),
          sharedStore: store,
        }),
        /provider quota/,
      );
      assert.equal(reads, 1);
      resumed = true;
      reads = 0;
      writer = deferred();
      store = new SharedStore();
      const result = await runWorkflow(script("v2"), {
        ...common,
        args: { version: change === "args" || change === "mutated-args" ? "v2" : "v1" },
        agentRegistry: registry(change === "definition" ? "v2" : "v1"),
        sharedStore: store,
        resumeJournal: new Map(journal),
      });
      assert.equal(result.result, change === "unchanged" ? "v1" : "v2");
      assert.equal(reads, 1, "a running child must re-evaluate downstream reads after a parent miss");
    });
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8", stdio: "pipe", windowsHide: true },
  ).trim();
}

function fixture(t: { after: (cleanup: () => void) => void }): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-parent-resume-"));
  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    rmSync(cwd, { recursive: true, force: true });
  });
  git(cwd, "init", "-q");
  git(cwd, "config", "core.autocrlf", "false");
  writeFileSync(join(cwd, "file.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base");
  return cwd;
}

for (const change of ["prompt", "args", "unchanged"] as const) {
  for (const committed of [false, true]) {
    test(`child worktree follows enclosing inputs across two resumes: change=${change}, committed=${committed}`, async (t) => {
      const cwd = fixture(t);
      const script = (version: string) => `export const meta = {name:'parent',description:'test'};
const child = workflow('child');
await agent(${change === "args" ? "'write:' + args" : JSON.stringify(`write:${version}`)});
return await child;`;
      const child = `export const meta = {name:'child',description:'test'};
await agent('first'); return await agent('edit', {isolation:'worktree'});`;
      const journal = new Map<string, JournalEntry>();
      let attempt = 0;
      let writer = deferred();
      const observed: Array<{ cwd: string; contents: string; head: string; plan: string }> = [];
      const writtenHeads: string[] = [];
      const common: WorkflowRunOptions = {
        cwd,
        runId: "parent-worktree",
        concurrency: 2,
        persistLogs: false,
        agentRegistry: new Map(),
        loadSavedWorkflow: () => child,
        onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
        agent: {
          run: async (prompt, options) => {
            if (prompt.startsWith("write:")) {
              await put(options, prompt.slice(6));
              writer.release();
              return "written";
            }
            await writer.promise;
            if (prompt === "first") return "ready";
            assert.ok(options?.cwd);
            observed.push({
              cwd: options.cwd,
              contents: readFileSync(join(options.cwd, "file.txt"), "utf8"),
              head: git(options.cwd, "rev-parse", "HEAD"),
              plan: await get(options),
            });
            if (attempt === 2) return "done";
            writeFileSync(join(options.cwd, "file.txt"), `partial ${attempt}\n`);
            if (committed) git(options.cwd, "commit", "-am", `partial ${attempt}`);
            writtenHeads.push(git(options.cwd, "rev-parse", "HEAD"));
            return quota();
          },
        },
      };
      for (; attempt < 3; attempt++) {
        writer = deferred();
        const version = attempt > 0 && change !== "unchanged" ? "v2" : "v1";
        const run = runWorkflow(script(change === "args" ? "v1" : version), {
          ...common,
          args: version,
          resumeJournal: attempt > 0 ? new Map(journal) : undefined,
        });
        if (attempt < 2) await assert.rejects(run, /provider quota/);
        else assert.equal((await run).result, "done");
      }
      assert.equal(observed.length, 3);
      assert.equal(observed[0].plan, "v1");
      assert.equal(observed[1].plan, change === "unchanged" ? "v1" : "v2");
      assert.equal(observed[1].cwd === observed[0].cwd, change === "unchanged");
      assert.equal(observed[1].contents, change === "unchanged" ? "partial 0\n" : "base\n");
      assert.equal(observed[1].head, change === "unchanged" ? writtenHeads[0] : git(cwd, "rev-parse", "HEAD"));
      assert.equal(observed[2].cwd, observed[1].cwd);
      assert.equal(observed[2].contents, "partial 1\n");
      assert.equal(observed[2].head, writtenHeads[1]);
      if (change !== "unchanged") {
        assert.equal(readFileSync(join(observed[0].cwd, "file.txt"), "utf8"), "partial 0\n");
        assert.equal(git(observed[0].cwd, "rev-parse", "HEAD"), writtenHeads[0]);
      }
      assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "base\n");
    });
  }
}

test("nested enclosing arguments must be serializable, without restricting top-level-only runs", async () => {
  let agents = 0;
  const options: WorkflowRunOptions = {
    args: () => "opaque",
    persistLogs: false,
    agentRegistry: new Map(),
    loadSavedWorkflow: () => "export const meta = {name:'child',description:'test'}; return await agent('child');",
    agent: {
      run: async () => {
        agents++;
        return "done";
      },
    },
  };
  await assert.rejects(
    runWorkflow("export const meta = {name:'parent',description:'test'}; return await workflow('child');", options),
    /enclosing.*serializable/,
  );
  assert.equal(agents, 0);
  const result = await runWorkflow(
    "export const meta = {name:'parent',description:'test'}; return await agent('root');",
    options,
  );
  assert.equal(result.result, "done");
  assert.equal(agents, 1);
});
