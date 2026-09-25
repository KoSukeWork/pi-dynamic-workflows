import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { type JournalEntry, runWorkflow, type WorkflowRunOptions } from "../src/workflow.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8", stdio: "pipe", windowsHide: true },
  ).trim();
}

function fixture(t: { after: (cleanup: () => void) => void }): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-wt-identity-"));
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

for (const labelMode of ["default", "fixed", "renamed"] as const) {
  for (const committed of [false, true]) {
    test(`resume preserves partial work across parent/child ordering: label=${labelMode}, committed=${committed}`, async (t) => {
      const cwd = fixture(t);
      const script = (resumed: boolean) => `export const meta = {name:'parent',description:'worktree identity'};
const child = workflow('child');
await agent('plan');
const edited = await agent('edit', {isolation:'worktree'${labelMode === "default" ? "" : `, label:'${labelMode === "renamed" && resumed ? "renamed editor" : "editor"}'`}});
await child; return edited;`;
      const child = `export const meta = {name:'child',description:'worktree identity'};
await agent('child-first'); return await agent('child-last');`;
      const journal = new Map<string, JournalEntry>();
      let resumed = false;
      let originalCwd = "";
      let originalHead = "";
      let observedCwd = "";
      let observedContents = "";
      let observedHead = "";
      const resumedChildCalls: string[] = [];
      const editorLabels: string[] = [];
      let editorStarted!: () => void;
      const editorReady = new Promise<void>((resolve) => {
        editorStarted = resolve;
      });
      let childFinished!: () => void;
      let childDone = new Promise<void>((resolve) => {
        childFinished = resolve;
      });
      const common: WorkflowRunOptions = {
        cwd,
        runId: "label-resume",
        concurrency: 2,
        persistLogs: false,
        agentRegistry: new Map(),
        loadSavedWorkflow: () => child,
        onAgentStart: (event) => {
          if (event.prompt === "edit") editorLabels.push(event.label);
        },
        onRuntimeEvent: (event) => {
          if (event.type === "workflow" && event.stage === "end") childFinished();
        },
        agent: {
          run: async (prompt, options) => {
            if (prompt.startsWith("child-")) {
              if (resumed) resumedChildCalls.push(prompt);
              if (prompt === "child-first" && !resumed) await editorReady;
              return "done";
            }
            if (prompt === "plan") {
              // Initial run: edit is the third call, before child-last.
              // Resume: child-first replays when the enclosing script is unchanged;
              // child-last runs live after the parent miss, before edit's fourth call.
              if (resumed) await childDone;
              return "planned";
            }
            assert.ok(options?.cwd);
            if (!resumed) {
              originalCwd = options.cwd;
              writeFileSync(join(originalCwd, "file.txt"), "partial edit\n");
              if (committed) git(originalCwd, "commit", "-am", "partial work");
              originalHead = git(originalCwd, "rev-parse", "HEAD");
              editorStarted();
              await childDone;
              throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
            }
            observedCwd = options.cwd;
            observedContents = readFileSync(join(observedCwd, "file.txt"), "utf8");
            observedHead = git(observedCwd, "rev-parse", "HEAD");
            return "done";
          },
        },
      };
      await assert.rejects(
        runWorkflow(script(false), {
          ...common,
          onAgentJournal: (entry) => journal.set(`${entry.runId}:${entry.index}`, entry),
        }),
        /provider quota/,
      );
      assert.equal(journal.size, 3);
      resumed = true;
      childDone = new Promise<void>((resolve) => {
        childFinished = resolve;
      });
      const result = await runWorkflow(script(true), { ...common, resumeJournal: journal });
      assert.equal(result.result, "done");
      assert.deepEqual(
        resumedChildCalls,
        labelMode === "renamed" ? ["child-first", "child-last"] : ["child-last"],
        "parent misses invalidate later child calls; edited enclosing scripts invalidate the entire child",
      );
      assert.equal(editorLabels.length, 2);
      assert.equal(editorLabels[0] === editorLabels[1], labelMode === "fixed");
      assert.equal(observedCwd, originalCwd, "display labels must not change the retained worktree");
      assert.equal(observedContents, "partial edit\n");
      assert.equal(observedHead, originalHead, "resume must preserve partial commits");
      assert.equal(readFileSync(join(originalCwd, "file.txt"), "utf8"), "partial edit\n");
      assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "base\n");
    });
  }
}
