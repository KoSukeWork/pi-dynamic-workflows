/**
 * In-memory key-value store scoped to a single workflow run.
 *
 * One `SharedStore` instance is created at run start and disposed when the run
 * ends. Two MCP-compatible tool definitions (`store_put` / `store_get`) are
 * injected into every agent's tool list so parallel agents can share
 * intermediate state without coordinating through the script itself.
 *
 * Journal integration: `commitJournalDelta` snapshots values and their actual
 * write versions. Versioned `applyDelta` rebuilds the latest successful write
 * per key even when cached calls replay in a different order. Reserve all
 * journal versions before resuming so new writes also supersede future replays.
 *
 * `deltaKey` must be unique across every run that shares this store instance,
 * not just within one run's callSeq. A nested `workflow()` call restarts its own
 * callSeq at 0 while inheriting the parent's store (so parent and nested-run
 * agents can share state), so a bare callIndex would collide between a parent
 * agent and a concurrently-running nested-run agent that both got index 0 —
 * whichever commits its delta last would clobber the other's entry in
 * `agentDeltas`. Callers compose `deltaKey` as `${runId}:${callIndex}`, and
 * since every run (including each nested run) gets its own distinct `runId`,
 * the composite key is unique across the whole store's lifetime.
 */

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface StoreWrite {
  value: unknown;
  version: number;
}

export interface JournalStoreDelta {
  values: Record<string, unknown>;
  versions: Record<string, number>;
}

interface PendingWrites {
  // A wrapper distinguishes a present undefined value from an absent key.
  base?: StoreWrite;
  // Insertion order is write order, with only the latest write per attempt.
  writes: Map<string, StoreWrite>;
}

export class SharedStore {
  private readonly map = new Map<string, StoreWrite>();
  private version = 0;
  // Per-agent write deltas for delta-journaling; keyed by a run-unique
  // `${runId}:${callIndex}` string (see class doc) so nested workflow() runs
  // sharing this store can't collide on a bare callIndex.
  private readonly agentDeltas = new Map<string, Map<string, StoreWrite>>();
  // Retain pending writers above the latest committed value. Settling an
  // attempt removes its writes even when hidden under a sibling's write, so
  // later rollbacks cannot resurrect them. History is bounded by active writers.
  private readonly pendingWrites = new Map<string, PendingWrites>();

  /** Store a value under `key`. Overwrites any existing value. */
  put(key: string, value: unknown): void {
    this.pendingWrites.delete(key);
    this.map.set(key, { value, version: ++this.version });
  }

  /**
   * Store a value and record the write in the per-agent delta for `deltaKey`
   * (a run-unique `${runId}:${callIndex}` string — see class doc). Used by
   * per-agent tools created via `createAgentStoreTools` so that each agent's
   * writes can be journaled and replayed independently.
   */
  trackPut(key: string, value: unknown, deltaKey: string): void {
    const write = { value, version: ++this.version };
    let pending = this.pendingWrites.get(key);
    if (!pending) {
      pending = { base: this.map.get(key), writes: new Map() };
      this.pendingWrites.set(key, pending);
    }
    pending.writes.delete(deltaKey);
    pending.writes.set(deltaKey, write);
    this.map.set(key, write);
    let delta = this.agentDeltas.get(deltaKey);
    if (!delta) {
      delta = new Map();
      this.agentDeltas.set(deltaKey, delta);
    }
    delta.set(key, write);
  }

  /** Retrieve the value for `key`, or `undefined` when absent. */
  get(key: string): unknown {
    return this.map.get(key)?.value;
  }

  /** Whether `key` is present in the store. */
  has(key: string): boolean {
    return this.map.has(key);
  }

  /** Return a deep-copied plain-object snapshot of all entries. */
  snapshot(): Record<string, unknown> {
    return structuredClone(Object.fromEntries([...this.map].map(([key, write]) => [key, write.value])));
  }

  /**
   * Extract and clear the write delta accumulated for `deltaKey`.
   * Called after an agent completes to get the set of keys it wrote.
   */
  commitDelta(deltaKey: string): Record<string, unknown> {
    return this.commitJournalDelta(deltaKey).values;
  }

  /** Capture independent values and per-key write order for durable replay. */
  commitJournalDelta(deltaKey: string): JournalStoreDelta {
    const delta = this.agentDeltas.get(deltaKey);
    if (!delta) return { values: {}, versions: {} };
    const values = structuredClone(Object.fromEntries([...delta].map(([key, write]) => [key, write.value])));
    const versions = Object.fromEntries([...delta].map(([key, write]) => [key, write.version]));
    for (const [key, write] of delta) {
      const pending = this.pendingWrites.get(key);
      if (!pending?.writes.has(deltaKey)) continue;
      this.commitWrite(key, write);
    }
    this.agentDeltas.delete(deltaKey);
    return { values, versions };
  }

  private commitWrite(key: string, write: StoreWrite): void {
    const pending = this.pendingWrites.get(key);
    if (!pending) {
      if (write.version >= (this.map.get(key)?.version ?? -1)) this.map.set(key, write);
      return;
    }
    if (!pending.base || write.version >= pending.base.version) pending.base = write;
    // Replayed writes can arrive underneath newer live attempts. Retain the
    // committed base so a later failure of those attempts reveals this replay.
    for (const [owner, current] of pending.writes) {
      if (current.version <= write.version) pending.writes.delete(owner);
    }
    this.map.set(key, pending.base);
    for (const current of pending.writes.values()) this.map.set(key, current);
    if (pending.writes.size === 0) this.pendingWrites.delete(key);
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
   * inconsistent. Remove this attempt by identity, including writes hidden
   * under a sibling. Each key exposes its latest surviving write, or its
   * committed base when no pending writes remain. Equal values from another
   * writer remain distinct, and discarded writers cannot be restored later.
   *
   * A no-op if `deltaKey` never wrote anything (nothing to roll back).
   */
  discardDelta(deltaKey: string): void {
    const delta = this.agentDeltas.get(deltaKey);
    if (!delta) return;
    for (const key of delta.keys()) {
      const pending = this.pendingWrites.get(key);
      if (!pending?.writes.delete(deltaKey)) continue;
      if (pending.writes.size > 0) {
        // Map preserves write order even when a writer rewrites the key.
        for (const value of pending.writes.values()) this.map.set(key, value);
      } else {
        if (pending.base) this.map.set(key, pending.base);
        else this.map.delete(key);
        this.pendingWrites.delete(key);
      }
    }
    this.agentDeltas.delete(deltaKey);
  }

  /**
   * Apply values without clearing unrelated keys. With versions, preserve the
   * actual write order and isolate the journal from later store mutations.
   * An empty versions object replays legacy entries at version zero, retaining
   * call-order behavior among them without overwriting newer versioned writes.
   * Omitting versions keeps the original unconditional-write API.
   */
  applyDelta(delta: Record<string, unknown>, versions?: Record<string, number>): void {
    if (versions) this.reserveVersions(versions);
    for (const [key, value] of Object.entries(structuredClone(delta))) {
      if (versions === undefined) this.put(key, value);
      else this.commitWrite(key, { value, version: validVersion(versions[key]) });
    }
  }

  /** Allocate live writes after every persisted version, including future hits. */
  reserveVersions(versions: Record<string, number>): void {
    for (const version of Object.values(versions)) this.version = Math.max(this.version, validVersion(version));
  }

  /**
   * Replace all entries with a snapshot (for full resets).
   * Prefer `applyDelta` for resume replay — see journal integration above.
   */
  restore(snap: Record<string, unknown>): void {
    this.map.clear();
    this.pendingWrites.clear();
    for (const [k, v] of Object.entries(snap)) {
      this.put(k, v);
    }
  }

  /** Clear all entries (called when the run ends). */
  dispose(): void {
    this.map.clear();
    this.agentDeltas.clear();
    this.pendingWrites.clear();
    this.version = 0;
  }
}

function validVersion(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/**
 * Create per-agent store tools that attribute writes to `deltaKey`, a
 * run-unique `${runId}:${callIndex}` string (see the `SharedStore` class doc
 * for why the bare callIndex alone is not enough once a nested `workflow()`
 * call shares this store).
 * Used internally by `runWorkflow` so each agent's puts are tracked in the
 * store's delta journal and can be replayed additively on resume.
 */
export function createAgentStoreTools(store: SharedStore, deltaKey: string): ToolDefinition[] {
  const storePut = defineTool({
    name: "store_put",
    label: "Store Put",
    description:
      "Write a value to the shared run store. Any other agent in this workflow run can read it with store_get. Overwrites any existing value for the key. Note: when two parallel agents write the same key, the last write wins — no merge is performed.",
    promptSnippet: "Write a value to the shared store",
    parameters: Type.Object({
      key: Type.String({ description: "The key to store the value under." }),
      value: Type.Any({ description: "The value to store (any JSON-serializable value)." }),
    }),
    async execute(_id: string, params: { key: string; value: unknown }) {
      store.trackPut(params.key, params.value, deltaKey);
      return {
        content: [{ type: "text", text: `Stored value under key "${params.key}".` }],
        details: { key: params.key },
      };
    },
  }) as unknown as ToolDefinition;

  const storeGet = defineTool({
    name: "store_get",
    label: "Store Get",
    description:
      "Read a value from the shared run store previously written by store_put. Returns the stored value, or null when the key does not exist.",
    promptSnippet: "Read a value from the shared store",
    parameters: Type.Object({
      key: Type.String({ description: "The key to read." }),
    }),
    async execute(_id: string, params: { key: string }) {
      const found = store.has(params.key);
      const value = store.get(params.key);
      const text = found
        ? `Value for key "${params.key}": ${JSON.stringify(value)}`
        : `Key "${params.key}" not found in store.`;
      return {
        content: [{ type: "text", text }],
        details: { key: params.key, value: found ? value : null, found },
      };
    },
  }) as unknown as ToolDefinition;

  return [storePut, storeGet];
}
