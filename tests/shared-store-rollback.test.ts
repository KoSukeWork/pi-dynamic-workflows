import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import fc from "fast-check";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { SharedStore } from "../src/shared-store.js";
import { type JournalEntry, runWorkflow } from "../src/workflow.js";

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

for (const initial of [false, true]) {
  for (const siblingCommitsFirst of [false, true]) {
    test(`same-value sibling survives rollback: initial=${initial}, committed=${siblingCommitsFirst}`, () => {
      const store = new SharedStore();
      if (initial) store.put("k", "initial");
      store.trackPut("k", "ready", "A");
      store.trackPut("k", "ready", "B");
      if (siblingCommitsFirst) store.commitDelta("B");
      store.discardDelta("A");
      assert.equal(store.get("k"), "ready");
      if (!siblingCommitsFirst) assert.deepEqual(store.commitDelta("B"), { k: "ready" });
    });
  }
}

for (const order of [
  ["A", "B"],
  ["B", "A"],
]) {
  test(`overlapping failures restore the original value: ${order.join(",")}`, () => {
    const store = new SharedStore();
    store.put("k", undefined);
    store.trackPut("k", "failed-A", "A");
    store.trackPut("k", "failed-B", "B");
    for (const id of order) store.discardDelta(id);
    assert.equal(store.has("k"), true);
    assert.equal(store.get("k"), undefined);
  });
}

test("interleaved rewrites roll back to a successful sibling and isolate the next retry", () => {
  const store = new SharedStore();
  store.trackPut("k", "A1", "A");
  store.trackPut("k", "B", "B");
  store.trackPut("k", "A2", "A");
  store.commitDelta("B");
  store.discardDelta("A");
  assert.equal(store.get("k"), "B");
  store.trackPut("k", "A retry", "A");
  store.trackPut("k", "C", "C");
  store.discardDelta("A");
  store.discardDelta("C");
  assert.equal(store.get("k"), "B");
  assert.deepEqual(store.commitDelta("A"), {});
});

test("direct writes, replay, and restore supersede pending writes even when their values match", () => {
  const store = new SharedStore();
  for (const replace of [
    () => store.put("k", "same"),
    () => store.applyDelta({ k: "same" }),
    () => store.restore({ k: "same" }),
  ]) {
    store.trackPut("k", "same", "A");
    replace();
    store.discardDelta("A");
    assert.equal(store.get("k"), "same");
  }
});

test("rollback matches the last non-discarded write across arbitrary interleavings", () => {
  const operation = fc.record({
    kind: fc.constantFrom("write", "commit", "discard", "put"),
    owner: fc.constantFrom("A", "B", "C"),
    key: fc.constantFrom("k", "other", "__proto__"),
    value: fc.constantFrom<unknown>(undefined, null, false, 0, "same", "different"),
  });
  fc.assert(
    fc.property(fc.array(operation, { maxLength: 100 }), (operations) => {
      const store = new SharedStore();
      // Independent reference: retain every write and remove failed attempts.
      // The production implementation must also compact settled history.
      const writes: Array<{ key: string; value: unknown; attempt?: number }> = [];
      const active = new Map<string, number>();
      let attempt = 0;
      for (const op of operations) {
        if (op.kind === "write") {
          if (!active.has(op.owner)) active.set(op.owner, ++attempt);
          writes.push({ key: op.key, value: op.value, attempt: active.get(op.owner) });
          store.trackPut(op.key, op.value, op.owner);
        } else if (op.kind === "put") {
          writes.push({ key: op.key, value: op.value });
          store.put(op.key, op.value);
        } else {
          const id = active.get(op.owner);
          const delta = new Map<string, unknown>();
          for (let index = 0; index < writes.length; index++) {
            const write = writes[index];
            if (id === undefined || write.attempt !== id) continue;
            delta.set(write.key, write.value);
            if (op.kind === "commit") delete write.attempt;
            else writes.splice(index--, 1);
          }
          active.delete(op.owner);
          if (op.kind === "commit") assert.deepEqual(store.commitDelta(op.owner), Object.fromEntries(delta));
          else store.discardDelta(op.owner);
        }
        assert.deepEqual(store.snapshot(), Object.fromEntries(writes.map(({ key, value }) => [key, value])));
      }
    }),
    { numRuns: 500, seed: 7232026 },
  );
});

for (const scenario of ["same", "different", "both-fail", "retry"] as const) {
  test(`runtime store tools preserve surviving writes: ${scenario}`, { timeout: 15000 }, async () => {
    const aWrote = deferred();
    const bWrote = deferred();
    const bJournaled = deferred();
    const aEnded = deferred();
    const journal: JournalEntry[] = [];
    let aAttempts = 0;
    const fail = () => {
      throw new WorkflowError("test failure", WorkflowErrorCode.AGENT_EXECUTION_ERROR, { recoverable: true });
    };
    const result = await runWorkflow(
      `export const meta={name:'rollback',description:'test'};
await parallel([() => agent('A'), () => agent('B')]);
return await agent('reader');`,
      {
        runId: "rollback",
        persistLogs: false,
        agentRegistry: new Map(),
        concurrency: 2,
        agentRetries: scenario === "retry" ? 1 : 0,
        onAgentJournal(entry) {
          journal.push(entry);
          if (entry.result === "B done") bJournaled.release();
        },
        onAgentEnd(entry) {
          if (entry.id.endsWith(":0")) aEnded.release();
        },
        agent: {
          async run(prompt, options) {
            if (prompt === "reader") {
              const get = options?.systemTools?.find((tool) => tool.name === "store_get");
              assert.ok(get);
              const read = await get.execute("", { key: "k" }, undefined, undefined, {} as ExtensionContext);
              return (read.details as { value: unknown }).value ?? "missing";
            }
            const put = options?.systemTools?.find((tool) => tool.name === "store_put");
            assert.ok(put);
            if (prompt === "A") {
              if (++aAttempts > 1) return "retried without writes";
              await put.execute("", { key: "k", value: "ready" }, undefined, undefined, {} as ExtensionContext);
              aWrote.release();
              await (scenario === "both-fail" ? bWrote.promise : bJournaled.promise);
              return fail();
            }
            await aWrote.promise;
            await put.execute(
              "",
              { key: "k", value: scenario === "same" || scenario === "retry" ? "ready" : "other" },
              undefined,
              undefined,
              {} as ExtensionContext,
            );
            bWrote.release();
            if (scenario === "both-fail") {
              await aEnded.promise;
              return fail();
            }
            return "B done";
          },
        },
      },
    );
    const replay = new SharedStore();
    for (const entry of journal) replay.applyDelta(entry.storeDelta ?? {});
    const expected = scenario === "both-fail" ? "missing" : scenario === "different" ? "other" : "ready";
    assert.equal(result.result, expected);
    assert.equal(replay.get("k") ?? "missing", expected);
    assert.equal(aAttempts, scenario === "retry" ? 2 : 1);
  });
}
