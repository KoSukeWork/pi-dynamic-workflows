import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkflowError, WorkflowErrorCode } from "../src/errors.js";
import { runWorkflow } from "../src/workflow.js";
import { createWorktree as createWorktreeLive, removeWorktree } from "../src/worktree.js";

// ── Existing tests (unchanged) ──

test("createWorktree no-ops (not isolated) outside a git repo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-wt-nogit-"));
  try {
    const wt = await createWorktreeLive(dir, "run-1-0-task");
    assert.equal(wt.isolated, false);
    assert.equal(wt.cwd, dir);
    assert.match(wt.reason ?? "", /not a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("createWorktree isolates in a git repo, then removeWorktree cleans up", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-git-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    const wt = await createWorktreeLive(repo, "run-9-0-edit");
    assert.equal(wt.isolated, true);
    assert.ok(wt.cwd !== repo && existsSync(wt.cwd), "worktree dir exists");
    assert.ok(existsSync(join(wt.cwd, "file.txt")), "worktree has a checkout");
    const checkout = readFileSync(join(wt.cwd, "file.txt"));

    // Editing inside the worktree must not touch the base tree.
    writeFileSync(join(wt.cwd, "file.txt"), "changed in worktree\n");
    assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "base\n");

    assert.equal(await removeWorktree(wt), false);
    assert.equal(readFileSync(join(wt.cwd, "file.txt"), "utf8"), "changed in worktree\n");
    writeFileSync(join(wt.cwd, "file.txt"), checkout);
    assert.equal(await removeWorktree(wt), true, wt.reason);
    assert.ok(!existsSync(wt.cwd), "worktree dir removed");
    const branches = execFileSync("git", ["-C", repo, "branch", "--list", wt.branch ?? ""], { encoding: "utf8" });
    assert.equal(branches.trim(), "", "branch deleted");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

// ── NEW TESTS ──

test("createWorktree falls back when git fails (non-git directory)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-wt-noexec-"));
  try {
    const wt = await createWorktreeLive(dir, "run-1-0-task");

    assert.equal(wt.isolated, false);
    assert.equal(wt.cwd, dir);
    assert.ok(wt.reason, "should provide a fallback reason when git fails");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("removeWorktree does not throw when worktree directory is already missing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-missing-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    const wt = await createWorktreeLive(repo, "run-missing-dir");
    assert.equal(wt.isolated, true);

    // Remove the worktree directory so git worktree remove --force fails
    rmSync(wt.cwd, { recursive: true, force: true });
    assert.ok(!existsSync(wt.cwd), "worktree dir removed manually before removeWorktree");

    // removeWorktree must not throw despite git commands failing
    await assert.doesNotReject(removeWorktree(wt));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("createWorktree falls back when target branch already exists", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-conflict-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    const name = "conflict-branch";
    const first = await createWorktreeLive(repo, name);
    assert.equal(first.isolated, true);

    // createWorktree should fail: git worktree add -b <existing-branch> errors out
    const wt = await createWorktreeLive(repo, name);
    assert.equal(wt.isolated, false);
    assert.equal(wt.cwd, repo);
    assert.ok(/already exists/i.test(wt.reason ?? ""), `Expected 'already exists' error, got: ${wt.reason}`);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("long agent names stay distinct and committed work survives cleanup", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-long-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-qm", "init");
    const a = await createWorktreeLive(repo, `${"long-run-".repeat(10)}0-agent`);
    const b = await createWorktreeLive(repo, `${"long-run-".repeat(10)}1-agent`);
    assert.equal(a.isolated && b.isolated, true);
    assert.notEqual(a.cwd, b.cwd);
    execFileSync("git", ["-C", a.cwd, "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-qm", "agent work"]);
    assert.equal(await removeWorktree(a), false);
    assert.equal(existsSync(a.cwd), true);
    assert.equal(await removeWorktree(b), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("workflow preserves edits and reports their retained location", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-result-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, "-c", "commit.gpgsign=false", ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-qm", "init");
    let workdir = "";
    const result = await runWorkflow(
      `export const meta = { name: 'isolation', description: 'test' }; return await agent('edit', { isolation: 'worktree' });`,
      {
        cwd: repo,
        runId: "retained-test",
        persistLogs: false,
        agent: {
          run: async (_prompt, options) => {
            workdir = options?.cwd ?? "";
            writeFileSync(join(workdir, "file.txt"), "new work\n");
            return "done";
          },
        },
      },
    );
    assert.equal(result.result, "done");
    assert.equal(readFileSync(join(workdir, "file.txt"), "utf8"), "new work\n");
    assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "base\n");
    assert.ok(result.logs.some((line) => line.includes(workdir) && line.includes("Retained")));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("explicit isolation failure never invokes the agent in the shared directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-wt-stop-"));
  let called = false;
  try {
    await assert.rejects(
      runWorkflow(
        `export const meta = { name: 'isolation', description: 'test' }; return await agent('edit', { isolation: 'worktree' });`,
        {
          cwd: dir,
          persistLogs: false,
          agent: {
            run: async () => {
              called = true;
              return "done";
            },
          },
        },
      ),
      /Worktree isolation failed/,
    );
    assert.equal(called, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const committed of [false, true]) {
  test(`quota pause resumes partial work in the same worktree, committed=${committed}`, async () => {
    const repo = mkdtempSync(join(tmpdir(), "pi-wt-resume-"));
    const git = (cwd: string, ...args: string[]) =>
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
    try {
      git(repo, "init", "-q");
      writeFileSync(join(repo, "file.txt"), "base\n");
      git(repo, "add", ".");
      git(repo, "commit", "-qm", "base");
      const script = `export const meta = { name: 'resume', description: 'test' }; return await agent('work', { label: 'worker', isolation: 'worktree' });`;
      let workdir = "";
      await assert.rejects(
        runWorkflow(script, {
          cwd: repo,
          runId: "resume-test",
          persistLogs: false,
          agent: {
            run: async (_prompt, options) => {
              workdir = options?.cwd ?? "";
              writeFileSync(join(workdir, "file.txt"), "partial work\n");
              if (committed) {
                git(workdir, "add", "file.txt");
                git(workdir, "commit", "-qm", "partial");
              }
              throw new WorkflowError("provider quota", WorkflowErrorCode.PROVIDER_USAGE_LIMIT);
            },
          },
        }),
        /provider quota/,
      );
      let calls = 0;
      const result = await runWorkflow(script, {
        cwd: repo,
        runId: "resume-test",
        persistLogs: false,
        resumeJournal: new Map(),
        resumeFromRunId: "resume-test",
        agent: {
          run: async (_prompt, options) => {
            calls++;
            assert.equal(options?.cwd, workdir);
            assert.equal(readFileSync(join(workdir, "file.txt"), "utf8"), "partial work\n");
            return "resumed";
          },
        },
      });
      assert.equal(calls, 1);
      assert.equal(result.result, "resumed");
      assert.ok(existsSync(workdir), "resumed edits and commits must still survive cleanup");
      assert.equal(readFileSync(join(repo, "file.txt"), "utf8"), "base\n");
      let fresh = "";
      await runWorkflow(script.replace("agent('work'", "agent('different work'"), {
        cwd: repo,
        runId: "resume-test",
        persistLogs: false,
        resumeJournal: new Map(),
        agent: {
          run: async (_prompt, options) => {
            fresh = options?.cwd ?? "";
            return "fresh";
          },
        },
      });
      assert.notEqual(fresh, workdir, "a changed call must not inherit stale partial edits");
      assert.ok(existsSync(workdir));
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
}

test("resume rejects unrelated ownership and a switched branch without removing work", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-owner-"));
  const git = (cwd: string, ...args: string[]) =>
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
      { encoding: "utf8", stdio: "pipe" },
    );
  try {
    git(repo, "init", "-q");
    git(repo, "commit", "--allow-empty", "-qm", "base");
    const first = await createWorktreeLive(repo, "owner-test");
    assert.equal(first.isolated, true);
    const record = join(git(first.cwd, "rev-parse", "--absolute-git-dir").trim(), "pi-workflow-owner.json");
    const original = readFileSync(record);
    writeFileSync(record, JSON.stringify({ version: 1, name: "another workflow" }));
    const unrelated = await createWorktreeLive(repo, "owner-test", { resume: true });
    assert.equal(unrelated.isolated, false);
    assert.match(unrelated.reason ?? "", /ownership/);
    writeFileSync(record, original);
    git(first.cwd, "checkout", "-qb", "another-branch");
    const switched = await createWorktreeLive(repo, "owner-test", { resume: true });
    assert.equal(switched.isolated, false);
    assert.match(switched.reason ?? "", /repository, path and branch/);
    assert.ok(existsSync(first.cwd));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("removeWorktree does not throw when git operations fail (corrupted metadata)", async () => {
  const repo = mkdtempSync(join(tmpdir(), "pi-wt-failrm-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
  try {
    git("init", "-q");
    git("config", "user.email", "t@t.t");
    git("config", "user.name", "t");
    writeFileSync(join(repo, "file.txt"), "base\n");
    git("add", ".");
    git("commit", "-q", "-m", "init");

    const wt = await createWorktreeLive(repo, "run-fail-rm");
    assert.equal(wt.isolated, true);

    // Remove worktree dir so git worktree remove fails
    rmSync(wt.cwd, { recursive: true, force: true });

    // Corrupt git worktree metadata so git worktree remove --force also fails
    const branchSuffix = wt.branch?.replace("pi/wf/", "") ?? "";
    const worktreeMeta = join(repo, ".git", "worktrees", branchSuffix);
    if (existsSync(worktreeMeta)) {
      writeFileSync(join(worktreeMeta, "gitdir"), "/nonexistent/path\n");
    }

    // Both git operations should fail silently — no throw from removeWorktree
    await assert.doesNotReject(removeWorktree(wt));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
