import assert from "node:assert/strict";
import test from "node:test";
import fc from "fast-check";
import { type JournalStoreDelta, SharedStore } from "../src/shared-store.js";

test("reversed journal replay matches surviving writes across arbitrary completion and retry orders", () => {
  const operation = fc.record({
    kind: fc.constantFrom("write", "commit", "discard"),
    owner: fc.constantFrom("parent:0", "parent:1", "parent-nested1:0"),
    key: fc.constantFrom("k", "other", "__proto__"),
    value: fc.constantFrom<unknown>(null, false, 0, "same", "different"),
  });
  fc.assert(
    fc.property(fc.array(operation, { maxLength: 100 }), (operations) => {
      const live = new SharedStore();
      const journal: JournalStoreDelta[] = [];
      const active = new Set<string>();
      for (const op of operations) {
        if (op.kind === "write") {
          active.add(op.owner);
          live.trackPut(op.key, op.value, op.owner);
        } else {
          if (op.kind === "commit") journal.push(live.commitJournalDelta(op.owner));
          else live.discardDelta(op.owner);
          active.delete(op.owner);
        }
      }
      for (const owner of active) live.discardDelta(owner);
      const replay = new SharedStore();
      // Persistence plus opposite replay order must not change the final value.
      const persisted: JournalStoreDelta[] = JSON.parse(JSON.stringify(journal));
      for (const delta of persisted.reverse()) replay.applyDelta(delta.values, delta.versions);
      assert.deepEqual(replay.snapshot(), live.snapshot());
    }),
    { numRuns: 500, seed: 9232026 },
  );
});

for (const finish of ["discard", "commit"]) {
  test(`a replay below a newer live write is retained correctly when that write will ${finish}`, () => {
    const store = new SharedStore();
    store.reserveVersions({ future: 50 });
    store.trackPut("k", "live", "writer");
    store.applyDelta({ k: "cached" }, { k: 40 });
    assert.equal(store.get("k"), "live");
    if (finish === "discard") {
      store.discardDelta("writer");
      assert.equal(store.get("k"), "cached");
    } else {
      const delta = store.commitJournalDelta("writer");
      assert.ok(delta.versions.k > 50);
      store.applyDelta({ k: "late-cache" }, { k: 50 });
      assert.equal(store.get("k"), "live");
    }
  });
}

test("legacy replay remains in call order and cannot overwrite newer live writes", () => {
  const store = new SharedStore();
  store.applyDelta({ k: "legacy-A" }, {});
  store.applyDelta({ k: "legacy-B" }, {});
  assert.equal(store.get("k"), "legacy-B");
  store.trackPut("k", "live", "writer");
  store.applyDelta({ k: "legacy-C" }, {});
  assert.equal(store.get("k"), "live");
  store.discardDelta("writer");
  assert.equal(store.get("k"), "legacy-C");
});

test("journal delta values are isolated from live values and from replay mutations", () => {
  const live = new SharedStore();
  const value = { items: [{ count: 0 }] };
  live.trackPut("k", value, "writer");
  const delta = live.commitJournalDelta("writer");
  value.items[0].count++;
  assert.deepEqual(delta.values, { k: { items: [{ count: 0 }] } });
  const replay = new SharedStore();
  replay.applyDelta(delta.values, delta.versions);
  (replay.get("k") as typeof value).items[0].count++;
  assert.deepEqual(delta.values, { k: { items: [{ count: 0 }] } });
});

test("snapshot restore supersedes historical writes without resurrecting pending attempts", () => {
  const store = new SharedStore();
  store.reserveVersions({ k: 30 });
  store.trackPut("k", "pending", "writer");
  store.restore({ k: "restored" });
  store.applyDelta({ k: "cached" }, { k: 30 });
  store.discardDelta("writer");
  assert.equal(store.get("k"), "restored");
});
