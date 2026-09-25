import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import type { TSchema } from "typebox";
import type { AgentRunOptions, AgentRunResult, WorkflowAgent } from "../src/agent.js";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { WorkflowManager } from "../src/workflow-manager.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

function quota(): never {
  throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
}

function textAgent(
  run: (prompt: string, options?: Pick<AgentRunOptions, "cwd">) => Promise<string>,
): Pick<WorkflowAgent, "run"> {
  return {
    async run<TSchemaDef extends TSchema | undefined = undefined>(
      prompt: string,
      options?: AgentRunOptions<TSchemaDef>,
    ): Promise<AgentRunResult<TSchemaDef>> {
      assert.equal(options?.schema, undefined, "these fixtures only use text agents");
      return (await run(prompt, options)) as AgentRunResult<TSchemaDef>;
    },
  };
}

function fixture(t: TestContext): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-manager-args-"));
  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    assert.ok(cwd.split(/[\\/]/).at(-1)?.startsWith("pi-manager-args-"));
    rmSync(cwd, { recursive: true, force: true });
  });
  return cwd;
}

function settled(manager: WorkflowManager): Promise<void> {
  return new Promise((resolve) => {
    const end = () => {
      for (const event of ["complete", "paused", "error"]) manager.off(event, end);
      resolve();
    };
    for (const event of ["complete", "paused", "error"]) manager.on(event, end);
  });
}

for (const sync of [false, true]) {
  for (const cold of [false, true]) {
    for (const edited of [false, true]) {
      test(`manager preserves initial args across repeated resumes: sync=${sync}, cold=${cold}, edited=${edited}`, async (t) => {
        const cwd = fixture(t);
        await withFakeHomeAsync(fixture(t), async () => {
          const cachedCalls: string[] = [];
          let gates = 0;
          const options = {
            cwd,
            defaultAgentRetries: 0,
            agent: textAgent(async (prompt) => {
              if (prompt === "gate") {
                if (++gates < 3) return quota();
                return "done";
              }
              cachedCalls.push(prompt);
              return prompt;
            }),
          };
          let manager = new WorkflowManager(options);
          const input = { version: "initial", nested: { count: 0 }, items: ["first", "second"] };
          const original = structuredClone(input);
          const script = `export const meta={name:'mutating-args',description:'test'};
const version = args.version;
args.version = 'mutated';
const result = await agent(version + ':' + args.nested.count++ + ':' + args.items.shift());
await agent('gate'); return result;`;
          let runId: string;
          if (sync) {
            await assert.rejects(manager.runSync(script, input), /provider quota/);
            runId = manager.listRuns()[0].runId;
          } else {
            const started = manager.startInBackground(script, input);
            runId = started.runId;
            await assert.rejects(started.promise, /provider quota/);
          }
          assert.deepEqual(input, original, "the script must not mutate its caller's argument object");
          input.nested.count = 999;
          assert.deepEqual(manager.getRun(runId)?.args, original, "the manager must own its input snapshot");
          let expected = original;
          for (let attempt = 1; attempt <= 2; attempt++) {
            const persisted = manager.getPersistence().load(runId);
            assert.equal(persisted?.status, "paused");
            assert.deepEqual(persisted.args, expected);
            if (cold) manager = new WorkflowManager(options);
            const replacement =
              edited && attempt === 1 ? { ...structuredClone(original), version: "edited" } : undefined;
            const done = settled(manager);
            assert.equal(await manager.resume(runId, replacement ? { args: replacement } : undefined), true);
            await done;
            if (replacement) {
              expected = { ...structuredClone(original), version: "edited" };
              assert.deepEqual(replacement, expected);
              replacement.items.length = 0;
              assert.deepEqual(manager.getRun(runId)?.args, expected);
            }
          }
          assert.equal(manager.getRun(runId)?.status, "completed");
          assert.equal(manager.getRun(runId)?.result?.result, `${edited ? "edited" : "initial"}:0:first`);
          assert.deepEqual(manager.getPersistence().load(runId)?.args, expected);
          assert.deepEqual(cachedCalls, edited ? ["initial:0:first", "edited:0:first"] : ["initial:0:first"]);
        });
      });
    }
  }
}

function git(cwd: string, ...args: string[]) {
  return execFileSync(
    "git",
    ["-C", cwd, "-c", "commit.gpgsign=false", "-c", "user.name=test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8", stdio: "pipe", windowsHide: true },
  ).trim();
}

for (const cold of [false, true]) {
  for (const committed of [false, true]) {
    test(`mutating args retains the child worktree across manager resumes: cold=${cold}, committed=${committed}`, async (t) => {
      const cwd = fixture(t);
      await withFakeHomeAsync(fixture(t), async () => {
        git(cwd, "init", "-q");
        git(cwd, "config", "core.autocrlf", "false");
        writeFileSync(join(cwd, "file.txt"), "base\n");
        git(cwd, "add", ".");
        git(cwd, "commit", "-qm", "base");
        const observed: Array<{ cwd: string; contents: string; head: string }> = [];
        let partialHead = "";
        const options = {
          cwd,
          defaultAgentRetries: 0,
          loadSavedWorkflow: () => `export const meta={name:'child',description:'test'};
return await agent('edit',{isolation:'worktree'});`,
          agent: textAgent(async (_prompt, options) => {
            assert.ok(options?.cwd);
            observed.push({
              cwd: options.cwd,
              contents: readFileSync(join(options.cwd, "file.txt"), "utf8"),
              head: git(options.cwd, "rev-parse", "HEAD"),
            });
            if (observed.length === 1) {
              writeFileSync(join(options.cwd, "file.txt"), "partial\n");
              if (committed) git(options.cwd, "commit", "-am", "partial");
              partialHead = git(options.cwd, "rev-parse", "HEAD");
            }
            if (observed.length < 3) return quota();
            return "done";
          }),
        };
        let manager = new WorkflowManager(options);
        const { runId, promise } = manager.startInBackground(
          `export const meta={name:'parent',description:'test'};
args.version='mutated'; return await workflow('child');`,
          { version: "original" },
        );
        await assert.rejects(promise, /provider quota/);
        for (let attempt = 1; attempt <= 2; attempt++) {
          if (cold) manager = new WorkflowManager(options);
          const done = settled(manager);
          assert.equal(await manager.resume(runId), true);
          await done;
          assert.equal(manager.getRun(runId)?.status, attempt === 1 ? "paused" : "completed");
        }
        assert.equal(observed.length, 3);
        for (const observation of observed.slice(1)) {
          assert.equal(observation.cwd, observed[0].cwd);
          assert.equal(observation.contents, "partial\n");
          assert.equal(observation.head, partialHead);
        }
        assert.equal(readFileSync(join(cwd, "file.txt"), "utf8"), "base\n");
      });
    });
  }
}

test("invalid managed args fail before registering a run or acquiring a resume lease", async (t) => {
  const cwd = fixture(t);
  await withFakeHomeAsync(fixture(t), async () => {
    let calls = 0;
    const manager = new WorkflowManager({
      cwd,
      agent: textAgent(async () => {
        if (++calls === 1) return quota();
        return "done";
      }),
    });
    const script = "export const meta={name:'invalid-args',description:'test'}; return await agent('work');";
    const invalid = { callback: () => "opaque" };
    const isValidationError = (error: unknown) =>
      error instanceof WorkflowError && error.code === WorkflowErrorCode.SCRIPT_VALIDATION_ERROR;
    assert.throws(() => manager.startInBackground(script, invalid), isValidationError);
    await assert.rejects(manager.runSync(script, invalid), isValidationError);
    assert.equal(manager.listRuns().length, 0);
    assert.equal(calls, 0);
    const { runId, promise } = manager.startInBackground(script, { value: "original" });
    await assert.rejects(promise, /provider quota/);
    await assert.rejects(manager.resume(runId, { args: invalid }), isValidationError);
    assert.deepEqual(manager.getPersistence().load(runId)?.args, { value: "original" });
    const lease = manager.getPersistence().acquireRunLease(runId);
    assert.ok(lease, "invalid resume must not leave a lease behind");
    manager.getPersistence().releaseRunLease(lease);
    const done = settled(manager);
    assert.equal(await manager.resume(runId), true);
    await done;
    assert.equal(manager.getRun(runId)?.status, "completed");
  });
});
