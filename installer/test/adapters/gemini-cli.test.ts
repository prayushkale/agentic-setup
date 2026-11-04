import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../../src/adapters/index.js';
import { applyAll, fresh, mkItem } from './_agents-helpers.js';

const g = adapters['gemini-cli'];

describe('gemini-cli adapter', () => {
  it('gemini-cli maps http mcp to settings.json httpUrl', () => {
    const { home, env, repo } = fresh();
    expect(g.actions(mkItem({ mcp: { name: 'context7', transport: 'http', url: 'https://x/mcp' } }), env, repo)).toEqual([
      { kind: 'json-merge', file: join(home, '.gemini/settings.json'), patch: { mcpServers: { context7: { httpUrl: 'https://x/mcp' } } } },
    ]);
  });

  it('gemini-cli maps stdio mcp to command/args', () => {
    const { env, repo } = fresh();
    const [a] = g.actions(mkItem({ mcp: { name: 's', transport: 'stdio', command: 'npx', args: ['-y', 'p'] } }), env, repo);
    expect(a).toMatchObject({ patch: { mcpServers: { s: { command: 'npx', args: ['-y', 'p'] } } } });
  });

  it('gemini-cli maps rule to GEMINI.md', () => {
    const { home, env, repo } = fresh();
    writeFileSync(join(repo, 'r.md'), 'rule');
    expect(g.actions(mkItem({ rule: 'r.md' }, 'r1'), env, repo)).toEqual([
      { kind: 'block', file: join(home, '.gemini/GEMINI.md'), id: 'r1', body: 'rule', style: 'md' },
    ]);
  });

  it('gemini-cli maps hooks to settings.json hooks', () => {
    const { home, env, repo } = fresh();
    const a = g.actions(mkItem({ hooks: { 'gemini-cli': { event: 'BeforeTool', matcher: 'run_shell_command', command: 'rtk hook' } } }, 'h'), env, repo);
    expect(a).toEqual([{
      kind: 'json-merge', file: join(home, '.gemini/settings.json'),
      patch: { hooks: { BeforeTool: [{ matcher: 'run_shell_command', hooks: [{ name: 'h', type: 'command', command: 'rtk hook' }] }] } },
    }]);
    expect(g.supports('hooks')).toBe(true);
  });

  it('gemini settings.json round-trip restores bytes', () => {
    const { home, env, repo } = fresh();
    mkdirSync(join(home, '.gemini'), { recursive: true });
    const orig = '{\n  "theme": "dark",\n  "mcpServers": {"a": {"command": "x"}}\n}';
    writeFileSync(join(home, '.gemini/settings.json'), orig);
    const undo = applyAll(g.actions(mkItem({ mcp: { name: 'c', transport: 'http', url: 'https://x' } }), env, repo), home, repo);
    expect(JSON.parse(readFileSync(join(home, '.gemini/settings.json'), 'utf8')).mcpServers.c).toEqual({ httpUrl: 'https://x' });
    undo();
    expect(readFileSync(join(home, '.gemini/settings.json'), 'utf8')).toBe(orig);
  });
});
