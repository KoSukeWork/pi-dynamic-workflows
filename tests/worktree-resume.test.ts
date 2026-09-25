import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { type JournalEntry, runWorkflow } from "../src/workflow.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8", stdio: "pipe" },
  ).trim();
}

function fixture(t: { after: (cleanup: () => void) => void }): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-wt-prefix-"));
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

function quota(): never {
  throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
}

const childScript = `export const meta = { name: 'child', description: 'test' };
return await agent('edit', { label: 'editor', isolation: 'worktree' });`;

for (const committed of [false, true]) {
  test(`unchanged concurrent nested work resumes after an upstream cache miss, committed=${committed}`, async (t) => {
    const cwd = fixture(t);
    const script = `export const meta = { name: 'parent', description: 'test' };
const pending = agent('plan', { label: 'planner' });
return await Promise.all([pending, workflow('child')]);`;
    let childStarted!: () => void;
    const childReady = new Promise<void>((resolve) => {
      childStarted = resolve;
    });
    const journal = new Map<string, JournalEntry>();
    let retained = "";
    let retainedHead = "";
    await assert.rejects(
      runWorkflow(script, {
        cwd,
        runId: "concurrent-resume",
        concurrency: 2,
        persistLogs: false,
        loadSavedWorkflow: () => childScript,
        onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
        agent: {
          run: async (prompt, options) => {
            if (prompt === "plan") {
              await childReady;
              return quota();
            }
            retained = options?.cwd ?? "";
            writeFileSync(join(retained, "file.txt"), "partial work\n");
            if (committed) {
              git(retained, "add", "file.txt");
              git(retained, "commit", "-qm", "partial");
            }
            retainedHead = git(retained, "rev-parse", "HEAD");
            childStarted();
            return quota();
          },
        },
      }),
      /provider quota/,
    );
    assert.equal(journal.size, 0);
    let resumedCalls = 0;
    const result = await runWorkflow(script, {
      cwd,
      runId: "concurrent-resume",
      concurrency: 1,
      persistLogs: false,
      loadSavedWorkflow: () => childScript,
      // A journal alone also enables resume; no extra public option is required.
      resumeJournal: journal,
      agent: {
        run: async (prompt, options) => {
          if (prompt === "edit") {
            resumedCalls++;
            assert.equal(options?.cwd, retained);
            assert.equal(readFileSync(join(retained, "file.txt"), "utf8"), "partial work\n");
            assert.equal(git(retained, "rev-parse", "HEAD"), retainedHead);
          }
          return "done";
        },
      },
    });
    assert.equal(resumedCalls, 1);
    assert.deepEqual(Array.from(result.result as string[]), ["done", "done"]);
    assert.ok(existsSync(retained));
    assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "base\n");
  });
}

for (const nested of [false, true]) {
  test(`invalidated completed agents start fresh without losing their retained edits, nested=${nested}`, async (t) => {
    const cwd = fixture(t);
    const source = (prompt: string) => `export const meta = { name: 'parent', description: 'test' };
await agent('${prompt}', { label: 'planner' });
await ${nested ? "workflow('child')" : "agent('edit', { label: 'editor', isolation: 'worktree' })"};
return await agent('gate');`;
    const journal = new Map<string, JournalEntry>();
    let retained = "";
    await assert.rejects(
      runWorkflow(source("old plan"), {
        cwd,
        runId: "completed-resume",
        persistLogs: false,
        loadSavedWorkflow: () => childScript,
        onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
        agent: {
          run: async (prompt, options) => {
            if (prompt === "gate") return quota();
            if (prompt === "edit") {
              retained = options?.cwd ?? "";
              writeFileSync(join(retained, "file.txt"), "completed old work\n");
            }
            return "done";
          },
        },
      }),
      /provider quota/,
    );
    assert.equal(journal.size, 2);
    let resumedCwd = "";
    let resumedContents = "";
    let editorCalls = 0;
    await runWorkflow(source("new plan"), {
      cwd,
      runId: "completed-resume",
      persistLogs: false,
      loadSavedWorkflow: () => childScript,
      resumeJournal: journal,
      agent: {
        run: async (prompt, options) => {
          if (prompt === "edit") {
            editorCalls++;
            resumedCwd = options?.cwd ?? "";
            resumedContents = readFileSync(join(resumedCwd, "file.txt"), "utf8");
          }
          return "done";
        },
      },
    });
    assert.equal(editorCalls, 1, "the invalidated completed agent must execute again");
    assert.notEqual(resumedCwd, retained);
    assert.equal(resumedContents, "base\n");
    assert.equal(readFileSync(join(retained, "file.txt"), "utf8"), "completed old work\n");
  });

  for (const upstream of ["agent", "checkpoint"] as const) {
    for (const changed of [false, true]) {
      test(`worktree identity follows the upstream ${upstream}, nested=${nested}, changed=${changed}`, async (t) => {
        const cwd = fixture(t);
        const source = (prompt: string) => `export const meta = { name: 'parent', description: 'test' };
await ${upstream}('${prompt}');
return await ${nested ? "workflow('child')" : "agent('edit', { label: 'editor', isolation: 'worktree' })"};`;
        const journal = new Map<string, JournalEntry>();
        let retained = "";
        await assert.rejects(
          runWorkflow(source("old plan"), {
            cwd,
            runId: "prefix-resume",
            persistLogs: false,
            loadSavedWorkflow: () => childScript,
            onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
            agent: {
              run: async (prompt, options) => {
                if (prompt !== "edit") return "planned";
                retained = options?.cwd ?? "";
                writeFileSync(join(retained, "file.txt"), "old partial work\n");
                return quota();
              },
            },
          }),
          /provider quota/,
        );
        assert.equal(journal.size, 1);
        let resumedCwd = "";
        let resumedContents = "";
        const result = await runWorkflow(source(changed ? "new plan" : "old plan"), {
          cwd,
          runId: "prefix-resume",
          persistLogs: false,
          loadSavedWorkflow: () => childScript,
          resumeJournal: journal,
          resumeFromRunId: "prefix-resume",
          agent: {
            run: async (prompt, options) => {
              if (prompt !== "edit") return "planned";
              resumedCwd = options?.cwd ?? "";
              resumedContents = readFileSync(join(resumedCwd, "file.txt"), "utf8");
              return "done";
            },
          },
        });
        assert.equal(result.result, "done");
        assert.equal(resumedContents, changed ? "base\n" : "old partial work\n");
        assert.equal(resumedCwd === retained, !changed);
        assert.equal(readFileSync(join(retained, "file.txt"), "utf8"), "old partial work\n");
        assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "base\n");
      });
    }
  }
}
