import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORKFLOW_AUTHORING_FROZEN_FILES } from "./workflow-authoring-coverage.js";

const COVERAGE_MANIFEST_PATH = "src/workflow-authoring-coverage.ts";

/** A reviewed frozen-guidance hash transition recorded in the coverage manifest. */
export interface WorkflowGuidanceAcceptance {
  path: string;
  previousSha256: string;
  sha256: string;
  changed: boolean;
}

function sha256(source: string): string {
  // Guidance is a text artifact. Hash its canonical LF form so the frozen
  // review checkpoint is identical on Windows checkouts and POSIX checkouts.
  return createHash("sha256").update(source.replace(/\r\n?/g, "\n")).digest("hex");
}

function manifestEntry(path: string, hash: string, newline = "\n"): string {
  return `    path: ${JSON.stringify(path)},${newline}    sha256: ${JSON.stringify(hash)},`;
}

/**
 * Accepts reviewed changes to explicitly named frozen workflow-authoring files.
 *
 * Throws before writing when no path is supplied, a path is not frozen, a file
 * is missing, or the coverage manifest no longer contains the expected entry.
 */
export function acceptWorkflowGuidance(root: string, requestedPaths: readonly string[]): WorkflowGuidanceAcceptance[] {
  if (requestedPaths.length === 0) {
    throw new Error("Pass at least one frozen workflow-authoring path to accept.");
  }

  const frozenByPath: ReadonlyMap<string, (typeof WORKFLOW_AUTHORING_FROZEN_FILES)[number]> = new Map(
    WORKFLOW_AUTHORING_FROZEN_FILES.map((entry) => [entry.path, entry]),
  );
  const paths = [...new Set(requestedPaths.map((path) => path.replace(/^\.\//, "")))];
  const entries = paths.map((path) => {
    const frozen = frozenByPath.get(path);
    if (frozen === undefined) {
      throw new Error(`${path} is not a frozen workflow-authoring guidance file.`);
    }
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      throw new Error(`Frozen workflow-authoring guidance file is missing: ${path}.`);
    }
    return {
      path,
      previousSha256: frozen.sha256,
      sha256: sha256(readFileSync(absolute, "utf8")),
    };
  });

  const manifestPath = join(root, COVERAGE_MANIFEST_PATH);
  const originalManifest = readFileSync(manifestPath, "utf8");
  // Keep the fixture/repository's existing line ending when replacing an
  // entry.  Node preserves CRLF when reading text, so a hard-coded LF here
  // would fail to find the entry on Windows and would rewrite the whole
  // manifest with mixed line endings.
  const newline = originalManifest.includes("\r\n") ? "\r\n" : "\n";
  let nextManifest = originalManifest;
  for (const entry of entries) {
    const previous = manifestEntry(entry.path, entry.previousSha256, newline);
    if (!nextManifest.includes(previous)) {
      throw new Error(`Coverage manifest does not contain the expected frozen entry for ${entry.path}.`);
    }
    nextManifest = nextManifest.replace(previous, manifestEntry(entry.path, entry.sha256, newline));
  }

  if (nextManifest !== originalManifest) {
    writeFileSync(manifestPath, nextManifest);
  }

  return entries.map((entry) => ({ ...entry, changed: entry.previousSha256 !== entry.sha256 }));
}
