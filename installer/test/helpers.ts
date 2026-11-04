import { CommandError, type Runner, type RunOpts, type RunResult } from '../src/run/runner.js';
import type { Ctx } from '../src/fs/ctx.js';

export interface FakeStep {
  match: string | RegExp;
  result?: Partial<RunResult>;
  /** Runs when the step matches, e.g. to simulate a command creating files. */
  effect?: (cmd: string) => void;
}

/**
 * Scripted Runner: first matching step wins; unmatched commands succeed with empty output.
 * `calls` lists the commands it executed. Like the real runner, with a dry-run `ctx` only
 * `readOnly` commands execute and the rest go to `ctx.plannedCommands`. Failures throw CommandError.
 */
export class FakeRunner implements Runner {
  readonly calls: string[] = [];
  constructor(private readonly script: FakeStep[] = [], private readonly ctx?: Ctx) {}

  async run(cmd: string, opts: RunOpts = {}): Promise<RunResult> {
    if (this.ctx?.dryRun && !opts.readOnly) {
      this.ctx.plannedCommands.push(cmd);
      return { code: 0, stdout: '', stderr: '' };
    }
    this.calls.push(cmd);
    const step = this.script.find((s) =>
      typeof s.match === 'string' ? cmd.includes(s.match) : s.match.test(cmd));
    step?.effect?.(cmd);
    const result: RunResult = { code: 0, stdout: '', stderr: '', ...step?.result };
    if (result.code !== 0 && !opts.allowFail) throw new CommandError(cmd, result.code, result.stderr);
    return result;
  }
}
