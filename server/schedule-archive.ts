// Schedules `pending.ts auto-archive` to run later: a systemd user timer, else a detached sleep.

import { spawn, spawnSync } from "node:child_process";

export const ARCHIVE_DELAY_S = 600;

export function scheduleAutoArchive(cli: string, agentId: string, scheduledAt: Date, attempt: number, env: Record<string, string | undefined> = process.env): void {
  const args = [cli, "auto-archive", "--agent", agentId, "--scheduled", scheduledAt.toISOString(), "--attempt", String(attempt)];
  const setenv = ["PATH", "HOME", "XDG_STATE_HOME", "PASEO_HOME", "PASEO_CLI_ROOT"].filter((k) => env[k]).map((k) => `--setenv=${k}=${env[k]}`);
  const unit = `paseo-tabs-archive-${agentId.slice(0, 8)}-${attempt}`;
  const r = spawnSync(
    "systemd-run",
    ["--user", "--quiet", "--collect", `--on-active=${ARCHIVE_DELAY_S}`, `--unit=${unit}`, ...setenv, process.execPath, ...args],
    { stdio: "ignore", timeout: 10_000, env: env as NodeJS.ProcessEnv },
  );
  if (r.status === 0) return;
  spawn("sh", ["-c", `sleep ${ARCHIVE_DELAY_S}; exec "$0" "$@"`, process.execPath, ...args], { detached: true, stdio: "ignore", env: env as NodeJS.ProcessEnv }).unref();
}
