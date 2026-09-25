import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { AgentRunOptions, AgentRunResult, WorkflowAgent } from "../src/agent.js";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { type JournalEntry, runWorkflow } from "../src/workflow.js";
import { WorkflowManager } from "../src/workflow-manager.js";
import { withFakeHomeAsync } from "./helpers/fake-home.js";

function fixture(t: TestContext): string {
  const cwd = mkdtempSync(join(tmpdir(), "pi-journal-test-"));
  t.after(() => {
    assert.equal(dirname(resolve(cwd)), resolve(tmpdir()));
    assert.ok(cwd.split(/[\\/]/).at(-1)?.startsWith("pi-journal-test-"));
    rmSync(cwd, { recursive: true, force: true });
  });
  return cwd;
}

function quota(): never {
  throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function mockAgent(
  run: (prompt: string, options?: Pick<AgentRunOptions, "systemTools">) => Promise<unknown>,
): Pick<WorkflowAgent, "run"> {
  return {
    async run<TSchemaDef extends TSchema | undefined = undefined>(
      prompt: string,
      options?: AgentRunOptions<TSchemaDef>,
    ): Promise<AgentRunResult<TSchemaDef>> {
      return (await run(prompt, options)) as AgentRunResult<TSchemaDef>;
    },
  };
}

async function resume(manager: WorkflowManager, runId: string): Promise<void> {
  const done = new Promise<void>((resolve) => {
    const end = () => {
      for (const event of ["complete", "paused", "error"]) manager.off(event, end);
      resolve();
    };
    for (const event of ["complete", "paused", "error"]) manager.on(event, end);
  });
  assert.equal(await manager.resume(runId), true);
  await done;
}

for (const cold of [false, true]) {
  test(`structured results remain unchanged in the journal across repeated resumes: cold=${cold}`, async (t) => {
    const cwd = fixture(t);
    await withFakeHomeAsync(fixture(t), async () => {
      let producers = 0;
      let gates = 0;
      const original = { nested: { count: 0 }, items: [{ label: "original" }] };
      const options = {
        cwd,
        defaultAgentRetries: 0,
        agent: mockAgent(async (prompt) => {
          if (prompt === "produce") {
            producers++;
            return structuredClone(original);
          }
          if (++gates < 3) return quota();
          return "done";
        }),
      };
      let manager = new WorkflowManager(options);
      const script = `export const meta={name:'mutable-result',description:'test'};
const value = await agent('produce', {schema:{type:'object'}});
value.nested.count++;
value.items[0].label += '-edited';
await agent('gate'); return value;`;
      const { runId, promise } = manager.startInBackground(script);
      await assert.rejects(promise, /provider quota/);
      for (let attempt = 0; attempt < 2; attempt++) {
        const saved = manager.getPersistence().load(runId);
        assert.equal(saved?.status, "paused");
        assert.deepEqual(saved.journal?.find((entry) => entry.index === 0)?.result, original);
        if (cold) manager = new WorkflowManager(options);
        await resume(manager, runId);
      }
      assert.equal(manager.getRun(runId)?.status, "completed");
      assert.deepEqual(manager.getRun(runId)?.result?.result, {
        nested: { count: 1 },
        items: [{ label: "original-edited" }],
      });
      assert.equal(producers, 1);
      assert.deepEqual(manager.getRun(runId)?.journal[0].result, original);
    });
  });
}

test("checkpoint objects have independent journal snapshots on capture and replay", async () => {
  const journal: JournalEntry[] = [];
  const answer = { items: [1, 2] };
  const script = `export const meta={name:'checkpoint-copy',description:'test'};
const value = await checkpoint('approve'); value.items.push(3); return value.items.length;`;
  const options = {
    runId: "checkpoint-copy",
    persistLogs: false,
    agentRegistry: new Map(),
    confirm: async () => answer,
    onAgentJournal: (entry: JournalEntry) => journal.push(entry),
  };
  assert.equal((await runWorkflow(script, options)).result, 3);
  const resumeJournal = new Map(journal.map((entry) => [`${entry.runId}:${entry.index}`, entry]));
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(journal[0].result, { items: [1, 2] });
    assert.equal((await runWorkflow(script, { ...options, resumeJournal })).result, 3);
  }
  assert.deepEqual(journal[0].result, { items: [1, 2] });
  assert.equal(journal.length, 1);
});

test("onAgentEnd cannot mutate the result retained for resume", async () => {
  const journal: JournalEntry[] = [];
  const options = {
    runId: "result-events",
    persistLogs: false,
    agentRegistry: new Map(),
    agent: {
      async run() {
        return { nested: { value: 1 } };
      },
    },
    onAgentJournal: (entry: JournalEntry) => journal.push(entry),
    onAgentEnd: (entry: { result: unknown }) => {
      (entry.result as { nested: { value: number } }).nested.value++;
    },
  };
  const script = `export const meta={name:'result-events',description:'test'};
return await agent('produce', {schema:{type:'object'}});`;
  await runWorkflow(script, options);
  const resumeJournal = new Map(journal.map((entry) => [`${entry.runId}:${entry.index}`, entry]));
  await runWorkflow(script, { ...options, resumeJournal });
  assert.deepEqual(journal[0].result, { nested: { value: 1 } });
});

for (const cold of [false, true]) {
  for (const lastWriter of ["A", "B", "split"]) {
    test(`parallel store replay preserves actual writes: cold=${cold}, lastWriter=${lastWriter}`, async (t) => {
      const cwd = fixture(t);
      await withFakeHomeAsync(fixture(t), async () => {
        const firstWrote = deferred();
        const secondWrote = deferred();
        const reads: unknown[] = [];
        let gates = 0;
        let writers = 0;
        const expected = lastWriter === "split" ? ["B", "A"] : [lastWriter, lastWriter];
        const options = {
          cwd,
          concurrency: 2,
          defaultAgentRetries: 0,
          agent: mockAgent(async (prompt, options) => {
            const put = options?.systemTools?.find((tool) => tool.name === "store_put");
            const get = options?.systemTools?.find((tool) => tool.name === "store_get");
            assert.ok(put && get);
            const write = async (key: string) => {
              await put.execute("", { key, value: prompt }, undefined, undefined, {} as ExtensionContext);
            };
            if (prompt === "A" || prompt === "B") {
              writers++;
              if (lastWriter === "split") {
                if (prompt === "A") {
                  await write("plan");
                  firstWrote.release();
                  await secondWrote.promise;
                  await write("other");
                } else {
                  await firstWrote.promise;
                  await write("plan");
                  await write("other");
                  secondWrote.release();
                }
              } else {
                if (prompt === lastWriter) await firstWrote.promise;
                await write("plan");
                await write("other");
                if (prompt !== lastWriter) firstWrote.release();
              }
              return `${prompt} done`;
            }
            const values = [];
            for (const key of ["plan", "other"]) {
              const read = await get.execute("", { key }, undefined, undefined, {} as ExtensionContext);
              values.push((read.details as { value: unknown }).value);
            }
            reads.push(values);
            if (++gates < 3) return quota();
            return JSON.stringify(values);
          }),
        };
        let manager = new WorkflowManager(options);
        const script = `export const meta={name:'store-replay',description:'test'};
await parallel([() => agent('A'), () => agent('B')]); return await agent('gate');`;
        const { runId, promise } = manager.startInBackground(script);
        await assert.rejects(promise, /provider quota/);
        for (let attempt = 0; attempt < 2; attempt++) {
          if (cold) manager = new WorkflowManager(options);
          await resume(manager, runId);
        }
        assert.equal(manager.getRun(runId)?.status, "completed");
        assert.equal(writers, 2, "both writers must be journal hits on each resume");
        assert.deepEqual(reads, [expected, expected, expected]);
      });
    });
  }
}
