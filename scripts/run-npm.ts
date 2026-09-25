import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";

/** Execute npm without trying to spawn a Windows .cmd shim as an executable. */
export function runNpm(args: string[], cwd: string): string {
  const cli =
    process.env.npm_execpath ??
    (process.platform === "win32"
      ? join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : undefined);
  return execFileSync(cli ? process.execPath : "npm", cli ? [cli, ...args] : args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
}
