import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../../src/adapters/index.js';
import { applyAll, fresh, mkItem } from './_agents-helpers.js';

const cmd = adapters['command-code'];

describe('command-code adapter', () => {
  it('command-code supports mcp and rule but not hooks', () => {
    expect(cmd.supports('mcp')).toBe(true);
    expect(cmd.supports('rule')).toBe(true);
    expect(cmd.supports('hooks')).toBe(false);
  });

  it('command-code maps http mcp to cmd mcp add with undo', () => {
    const { env, repo } = fresh();
    const a = cmd.actions(mkItem({ mcp: { name: 'context7', transport: 'http', url: 'https://mcp.context7.com/mcp' } }), env, repo);
    expect(a).toEqual([{
      kind: 'run', cmd: 'cmd mcp add --transport http --scope user context7 https://mcp.context7.com/mcp',
      undo: 'cmd mcp remove context7 -s user',
    }]);
  });

  it('command-code maps stdio mcp to add-json with undo', () => {
    const { env, repo } = fresh();
    const [a] = cmd.actions(mkItem({ mcp: { name: 's', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] } }), env, repo);
    expect(a).toEqual({
      kind: 'run',
      cmd: `cmd mcp add-json s -s user '{"type":"stdio","command":"npx","args":["-y","pkg"]}'`,
      undo: 'cmd mcp remove s -s user',
    });
  });

  it('command-code writes rule to ~/.agents/AGENTS.md when ~/.commandcode link resolves there', () => {
    const { home, env, repo } = fresh();
    mkdirSync(join(home, '.agents'), { recursive: true });
    mkdirSync(join(home, '.commandcode'), { recursive: true });
    writeFileSync(join(home, '.agents/AGENTS.md'), 'mine\n');
    symlinkSync(join(home, '.agents/AGENTS.md'), join(home, '.commandcode/AGENTS.md'));
    writeFileSync(join(repo, 'r.md'), 'rule');
    const a = cmd.actions(mkItem({ rule: 'r.md' }, 'r1'), env, repo);
    expect(a).toEqual([{ kind: 'block', file: join(home, '.agents/AGENTS.md'), id: 'r1', body: 'rule', style: 'md' }]);
  });

  it('command-code uses ~/.agents/AGENTS.md when ~/.commandcode/AGENTS.md is absent but shared exists', () => {
    const { home, env } = fresh();
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, '.agents/AGENTS.md'), 'mine\n');
    expect(cmd.instructionsFile(env)).toBe(join(home, '.agents/AGENTS.md'));
  });

  it('command-code falls back to ~/.commandcode/AGENTS.md when ~/.agents link absent', () => {
    const { home, env, repo } = fresh();
    writeFileSync(join(repo, 'r.md'), 'rule');
    const a = cmd.actions(mkItem({ rule: 'r.md' }, 'r1'), env, repo);
    expect(a).toEqual([{ kind: 'block', file: join(home, '.commandcode/AGENTS.md'), id: 'r1', body: 'rule', style: 'md' }]);
  });

  it('command-code keeps its own regular AGENTS.md even if ~/.agents exists', () => {
    const { home, env } = fresh();
    mkdirSync(join(home, '.agents'), { recursive: true });
    mkdirSync(join(home, '.commandcode'), { recursive: true });
    writeFileSync(join(home, '.agents/AGENTS.md'), 'a');
    writeFileSync(join(home, '.commandcode/AGENTS.md'), 'b');
    expect(cmd.instructionsFile(env)).toBe(join(home, '.commandcode/AGENTS.md'));
  });

  it('generic and command-code rule into the same AGENTS.md yields one block', () => {
    const { home, env, repo } = fresh();
    mkdirSync(join(home, '.agents'), { recursive: true });
    writeFileSync(join(home, '.agents/AGENTS.md'), 'mine\n');
    writeFileSync(join(repo, 'r.md'), 'rule');
    const it1 = mkItem({ rule: 'r.md' }, 'r1');
    applyAll(adapters.generic.actions(it1, env, repo), home, repo);
    applyAll(cmd.actions(it1, env, repo), home, repo);
    const text = readFileSync(join(home, '.agents/AGENTS.md'), 'utf8');
    expect(text.match(/rule/g)).toHaveLength(1);
  });
});
