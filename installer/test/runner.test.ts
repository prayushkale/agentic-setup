import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ctx } from '../src/fs/ctx.js';
import { makeRunner } from '../src/run/runner.js';
import { FakeRunner } from './helpers.js';

const mk = (o: { dryRun?: boolean; npmPrefix?: string } = {}) => {
  const home = mkdtempSync(join(tmpdir(), 'as-run-'));
  return { home, ctx: new Ctx({ home, repoRoot: home, ...o }) };
};

describe('runner', () => {
  it('dry-run runner executes nothing', async () => {
    const { home, ctx } = mk({ dryRun: true });
    const f = join(home, 'x');
    const r = await makeRunner(ctx).run(`touch ${f}`);
    expect(r.code).toBe(0);
    expect(existsSync(f)).toBe(false);
    expect(ctx.plannedCommands).toEqual([`touch ${f}`]);
  });

  it('readOnly probe runs in dry-run', async () => {
    const { ctx } = mk({ dryRun: true });
    const r = await makeRunner(ctx).run('echo hi', { readOnly: true });
    expect(r.stdout).toBe('hi');
    expect(ctx.plannedCommands).toEqual([]);
  });

  it('runner passes HOME and NPM_CONFIG_PREFIX', async () => {
    const { home, ctx } = mk({ npmPrefix: '/tmp/pfx' });
    const r = await makeRunner(ctx).run('echo $HOME $NPM_CONFIG_PREFIX; echo $PATH');
    const [line, path] = r.stdout.split('\n');
    expect(line).toBe(`${home} /tmp/pfx`);
    expect(path.startsWith('/tmp/pfx/bin:')).toBe(true);
  });

  it('does not set NPM_CONFIG_PREFIX when npmPrefix is undefined', async () => {
    const { ctx } = mk();
    const prev = process.env.NPM_CONFIG_PREFIX;
    delete process.env.NPM_CONFIG_PREFIX;
    try {
      const r = await makeRunner(ctx).run('echo "[$NPM_CONFIG_PREFIX]"');
      expect(r.stdout).toBe('[]');
    } finally {
      if (prev !== undefined) process.env.NPM_CONFIG_PREFIX = prev;
    }
  });

  it('failing command throws unless allowFail', async () => {
    const { ctx } = mk();
    const run = makeRunner(ctx);
    await expect(run.run('echo boom >&2; exit 3')).rejects.toMatchObject({
      cmd: 'echo boom >&2; exit 3', code: 3, stderr: 'boom',
    });
    const r = await run.run('exit 4', { allowFail: true });
    expect(r.code).toBe(4);
  });

  it('FakeRunner records calls, applies effects and scripted results', async () => {
    let hit = '';
    const fake = new FakeRunner([
      { match: /^npm/, result: { stdout: 'ok' }, effect: (c) => { hit = c; } },
      { match: 'bad', result: { code: 1 } },
    ]);
    expect((await fake.run('npm i')).stdout).toBe('ok');
    expect(hit).toBe('npm i');
    await expect(fake.run('bad')).rejects.toBeTruthy();
    expect((await fake.run('bad', { allowFail: true })).code).toBe(1);
    expect(fake.calls).toEqual(['npm i', 'bad', 'bad']);
  });
});
