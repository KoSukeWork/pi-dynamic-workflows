/**
 * Per-agent git worktree isolation. When an agent requests `isolation: "worktree"`,
 * it runs in a worktree on its own branch so parallel agents can edit the
 * same files without conflict. Results are NOT auto-merged — the path is surfaced for
 * the caller to inspect. Only unchanged worktrees are automatically removed.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const OWNER_FILE = "pi-workflow-owner.json";

function canonical(path: string): string {
  const value = realpathSync(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

async function gitOutput(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", cwd, ...args]);
  return stdout.trim();
}

export interface Worktree {
  /** True when a real worktree was created; false means isolation failed. */
  isolated: boolean;
  /** cwd the agent should run in (worktree path when isolated, else the base cwd). */
  cwd: string;
  branch?: string;
  /** Repo root the worktree was added to (for teardown). */
  repoRoot?: string;
  /** Commit checked out at creation; required before automatic cleanup. */
  initialHead?: string;
  /** Why isolation was skipped, when isolated === false. */
  reason?: string;
}

function slug(name: string): string {
  const prefix =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "agent";
  return `${prefix}-${createHash("sha256").update(name).digest("hex").slice(0, 16)}`;
}

/**
 * Create an isolated worktree under `<repoRoot>/.pi/worktrees/<name>` on branch
 * `pi/wf/<name>`. The `name` must be deterministic (derived from runId + call index,
 * never wall-clock) so resume keys stay stable. Callers must stop on isolation failure.
 */
export async function createWorktree(
  baseCwd: string,
  name: string,
  options: { resume?: boolean } = {},
): Promise<Worktree> {
  const id = slug(name);
  let repoRoot: string;
  try {
    const { stdout } = await exec("git", ["-C", baseCwd, "rev-parse", "--show-toplevel"]);
    repoRoot = stdout.trim();
  } catch {
    return { isolated: false, cwd: baseCwd, reason: "not a git repository" };
  }

  const path = join(repoRoot, ".pi", "worktrees", id);
  const branch = `pi/wf/${id}`;
  try {
    if (options.resume && existsSync(path)) {
      const top = await gitOutput(path, "rev-parse", "--show-toplevel");
      const common = await gitOutput(path, "rev-parse", "--git-common-dir");
      const baseCommon = await gitOutput(repoRoot, "rev-parse", "--git-common-dir");
      const currentBranch = await gitOutput(path, "symbolic-ref", "--short", "HEAD");
      if (
        canonical(top) !== canonical(path) ||
        canonical(resolve(path, common)) !== canonical(resolve(repoRoot, baseCommon)) ||
        currentBranch !== branch
      ) {
        throw new Error("Retained worktree does not match the expected repository, path and branch");
      }
      const gitDir = await gitOutput(path, "rev-parse", "--absolute-git-dir");
      const owner = JSON.parse(readFileSync(join(gitDir, OWNER_FILE), "utf8"));
      if (
        owner?.version !== 1 ||
        owner.name !== name ||
        owner.branch !== branch ||
        typeof owner.initialHead !== "string" ||
        !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(owner.initialHead)
      ) {
        throw new Error("Retained worktree has no matching workflow ownership record");
      }
      await exec("git", ["-C", path, "merge-base", "--is-ancestor", owner.initialHead, "HEAD"]);
      return { isolated: true, cwd: path, branch, repoRoot, initialHead: owner.initialHead };
    }
    const { stdout } = await exec("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
    const initialHead = stdout.trim();
    await exec("git", ["-C", repoRoot, "worktree", "add", "-b", branch, path, initialHead]);
    // Keep ownership outside the checkout so it cannot dirty or be committed by the agent.
    const gitDir = await gitOutput(path, "rev-parse", "--absolute-git-dir");
    writeFileSync(join(gitDir, OWNER_FILE), `${JSON.stringify({ version: 1, name, branch, initialHead })}\n`, {
      flag: "wx",
    });
    return { isolated: true, cwd: path, branch, repoRoot, initialHead };
  } catch (error) {
    return { isolated: false, cwd: baseCwd, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Remove only unchanged worktrees. False means retained, including on inspection failure. */
export async function removeWorktree(wt: Worktree): Promise<boolean> {
  if (!wt.isolated || !wt.repoRoot || !wt.initialHead) return false;
  try {
    const { stdout: status } = await exec("git", [
      "-C",
      wt.cwd,
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignored",
    ]);
    const { stdout: head } = await exec("git", ["-C", wt.cwd, "rev-parse", "HEAD"]);
    if (status.trim() || head.trim() !== wt.initialHead) {
      wt.reason = status.trim() || "HEAD changed";
      return false;
    }
    await exec("git", ["-C", wt.repoRoot, "worktree", "remove", wt.cwd]);
  } catch (error) {
    wt.reason = String(error);
    return false;
  }
  if (wt.branch) {
    try {
      await exec("git", ["-C", wt.repoRoot, "branch", "-d", wt.branch]);
    } catch {
      // branch already deleted
    }
  }
  return true;
}
