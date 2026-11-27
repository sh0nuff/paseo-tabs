// Archives and restores Paseo workspaces. Restoring has no CLI command, so it goes
// through Paseo's own client library, the one the `paseo` CLI ships; archiving and
// reading an agent's status use the CLI. Everything goes through a runner, so tests
// pass a fake one and never touch the daemon.

import { execFile, spawn, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type Recovery = { kind: string; action?: string; reason?: string; message?: string };

export interface ControlRunner {
  inspect(workspaceId: string): Promise<Recovery>;
  restore(workspaceId: string): Promise<void>;
  archive(workspaceId: string): Promise<void>;
  /** The agent's status as Paseo reports it ("idle", "running", ...), or null when unknown. */
  agentStatus(agentId: string): Promise<string | null>;
}

/** Restores the workspace only when Paseo says it can be recovered. Returns what happened, in a few words. */
export async function restoreWorkspace(workspaceId: string, runner: ControlRunner): Promise<string> {
  const state = await runner.inspect(workspaceId);
  if (state.kind !== "recoverable") return `not restored: ${state.reason ?? state.message ?? state.kind}`;
  await runner.restore(workspaceId);
  return "restored";
}

export async function archiveWorkspace(workspaceId: string, runner: ControlRunner): Promise<void> {
  await runner.archive(workspaceId);
}

function onPath(name: string, env: Record<string, string | undefined>): string | null {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The installed @getpaseo/cli package folder: $PASEO_CLI_ROOT, else found from the `paseo` command. */
export function paseoCliRoot(env: Record<string, string | undefined> = process.env): string {
  if (env.PASEO_CLI_ROOT) return env.PASEO_CLI_ROOT;
  const bin = onPath("paseo", env);
  if (bin) {
    let dir = dirname(realpathSync(bin));
    for (let i = 0; i < 6; i++) {
      try {
        if (JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).name === "@getpaseo/cli") return dir;
      } catch {
        // not here
      }
      dir = dirname(dir);
    }
  }
  return join(env.HOME ?? "", ".npm-global", "lib", "node_modules", "@getpaseo", "cli");
}

type Client = {
  inspectWorkspaceRecovery(id: string): Promise<Recovery>;
  restoreWorkspace(id: string): Promise<void>;
  close(): Promise<void>;
};

async function withClient<T>(env: Record<string, string | undefined>, work: (client: Client) => Promise<T>): Promise<T> {
  const root = paseoCliRoot(env);
  const { connectToDaemon } = await import(pathToFileURL(join(root, "dist", "utils", "client.js")).href);
  const { selectDaemonTarget } = await import(pathToFileURL(join(root, "dist", "utils", "daemon-target.js")).href);
  const client: Client = await connectToDaemon({ target: selectDaemonTarget({}, env, false) });
  try {
    return await work(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** The real runner: the client library for restore, the `paseo` CLI for the rest. */
export function paseoRunner(env: Record<string, string | undefined> = process.env): ControlRunner {
  // Asynchronous, so the daemon's sweep never blocks its event loop while the CLI runs.
  const run = promisify(execFile);
  const paseo = async (args: string[]) => (await run("paseo", args, { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: 30_000 })).stdout;
  return {
    inspect: (id) => withClient(env, (c) => c.inspectWorkspaceRecovery(id)),
    restore: (id) => withClient(env, (c) => c.restoreWorkspace(id)),
    archive: async (id) => {
      await paseo(["workspace", "archive", id]);
    },
    agentStatus: async (id) => {
      const raw = JSON.parse(await paseo(["agent", "inspect", id, "--json"]));
      const status = raw?.Status ?? raw?.status;
      return typeof status === "string" ? status.toLowerCase() : null;
    },
  };
}

// The daemon loads the server half as a bundle, where import.meta.url is undefined, so
// the path is worked out when needed and falls back to the checkout the daemon loads.
function controlCli(env: Record<string, string | undefined> = process.env): string {
  try {
    if (typeof import.meta.url === "string") return join(dirname(fileURLToPath(import.meta.url)), "..", "tools", "workspace-control.ts");
  } catch {
    // fall through
  }
  return join(env.HOME ?? "", "git", "paseo-tabs", "tools", "workspace-control.ts");
}

/** The command that runs tools/workspace-control.ts, or $PASEO_TABS_CONTROL (a JSON array) when set. */
export function controlCommand(env: Record<string, string | undefined> = process.env): string[] {
  if (env.PASEO_TABS_CONTROL) {
    const parsed = JSON.parse(env.PASEO_TABS_CONTROL);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((p) => typeof p === "string")) return parsed;
  }
  return [process.execPath, controlCli(env)];
}

/** Runs `workspace-control restore <id>` and waits at most timeoutMs. Never throws; returns its one-line report. */
export function runRestore(workspaceId: string, env: Record<string, string | undefined> = process.env, timeoutMs = 20_000): string {
  try {
    const [cmd, ...args] = controlCommand(env);
    const r = spawnSync(cmd, [...args, "restore", workspaceId], { encoding: "utf8", env: env as NodeJS.ProcessEnv, timeout: timeoutMs });
    return (r.stdout || r.stderr || "").trim() || `restore exited ${r.status}`;
  } catch (error) {
    return `restore failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Starts `workspace-control restore <id>` in the background, for callers that must not wait. */
export function startRestore(workspaceId: string, env: Record<string, string | undefined> = process.env): void {
  try {
    const [cmd, ...args] = controlCommand(env);
    spawn(cmd, [...args, "restore", workspaceId], { detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv }).unref();
  } catch {
    // best effort
  }
}
