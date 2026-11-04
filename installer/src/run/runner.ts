import { delimiter, join } from 'node:path';
import { execa } from 'execa';
import type { Ctx } from '../fs/ctx.js';

export interface RunOpts {
  /** Return a non-zero result instead of throwing. */
  allowFail?: boolean;
  /** A probe (detect, verify, `command -v`): runs even in dry-run. */
  readOnly?: boolean;
}

export interface RunResult { code: number; stdout: string; stderr: string }

export interface Runner {
  run(cmd: string, opts?: RunOpts): Promise<RunResult>;
}

/** Error thrown for a non-zero exit without `allowFail`. */
export class CommandError extends Error {
  constructor(readonly cmd: string, readonly code: number, readonly stderr: string) {
    super(`command failed (exit ${code}): ${cmd}${stderr ? `\n${stderr}` : ''}`);
    this.name = 'CommandError';
  }
}

/**
 * Runs shell commands with HOME set to ctx.home. When ctx.npmPrefix is set it also sets
 * NPM_CONFIG_PREFIX and puts `<prefix>/bin` first on PATH. In dry-run only `readOnly`
 * commands execute; the rest are appended to ctx.plannedCommands.
 */
export function makeRunner(ctx: Ctx): Runner {
  return {
    async run(cmd, opts = {}) {
      if (ctx.dryRun && !opts.readOnly) {
        ctx.plannedCommands.push(cmd);
        return { code: 0, stdout: '', stderr: '' };
      }
      const env: Record<string, string | undefined> = { ...process.env, HOME: ctx.home };
      if (ctx.npmPrefix !== undefined) {
        env.NPM_CONFIG_PREFIX = ctx.npmPrefix;
        env.PATH = [join(ctx.npmPrefix, 'bin'), process.env.PATH].filter(Boolean).join(delimiter);
      }
      const r = await execa(cmd, { shell: true, env, extendEnv: false, reject: false });
      const result: RunResult = {
        code: r.exitCode ?? 1,
        stdout: String(r.stdout ?? ''),
        stderr: String(r.stderr ?? ''),
      };
      if (result.code !== 0 && !opts.allowFail) throw new CommandError(cmd, result.code, result.stderr);
      return result;
    },
  };
}
