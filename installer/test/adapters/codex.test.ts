import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adapters } from '../../src/adapters/index.js';
import { applyAll, fresh, mkItem } from './_agents-helpers.js';

const cx = adapters.codex;
const http = { name: 'context7', transport: 'http' as const, url: 'https://mcp.context7.com/mcp' };

describe('codex adapter', () => {
  it('codex maps http mcp to a toml block with url', () => {
    const { home, env, repo } = fresh();
    expect(cx.actions(mkItem({ mcp: http }, 'c7'), env, repo)).toEqual([{
      kind: 'block', file: join(home, '.codex/config.toml'), id: 'c7', style: 'toml',
      body: '[mcp_servers.context7]\nurl = "https://mcp.context7.com/mcp"',
    }]);
  });

  it('codex maps stdio mcp to command/args', () => {
    const { env, repo } = fresh();
    const [a] = cx.actions(mkItem({ mcp: { name: 's', transport: 'stdio', command: 'npx', args: ['-y', 'pkg'] } }), env, repo);
    expect(a).toMatchObject({ body: '[mcp_servers.s]\ncommand = "npx"\nargs = ["-y", "pkg"]' });
  });

  it('codex maps rule to ~/.codex/AGENTS.md', () => {
    const { home, env, repo } = fresh();
    writeFileSync(join(repo, 'r.md'), 'rule');
    expect(cx.actions(mkItem({ rule: 'r.md' }, 'r1'), env, repo)).toEqual([
      { kind: 'block', file: join(home, '.codex/AGENTS.md'), id: 'r1', body: 'rule', style: 'md' },
    ]);
  });

  it('codex maps hooks to hooks.json merge', () => {
    const { home, env, repo } = fresh();
    const a = cx.actions(mkItem({ hooks: { codex: { event: 'PreToolUse', matcher: '^Bash$', command: 'rtk hook' } } }), env, repo);
    expect(a).toEqual([{
      kind: 'json-merge', file: join(home, '.codex/hooks.json'),
      patch: { hooks: { PreToolUse: [{ matcher: '^Bash$', hooks: [{ type: 'command', command: 'rtk hook' }] }] } },
    }]);
    expect(cx.supports('hooks')).toBe(true);
  });

  it('codex skips mcp already defined outside our block', () => {
    const { home, env, repo } = fresh();
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex/config.toml'), '[mcp_servers.context7]\nurl = "https://other"\n');
    const item = mkItem({ mcp: http }, 'c7');
    expect(cx.actions(item, env, repo)).toEqual([]);
    expect(cx.alreadyInstalled!(item, env)).toHaveLength(1);
  });

  it('codex does not treat its own block as already installed', () => {
    const { home, env, repo } = fresh();
    const item = mkItem({ mcp: http }, 'c7');
    applyAll(cx.actions(item, env, repo), home, repo);
    expect(cx.alreadyInstalled!(item, env)).toEqual([]);
    expect(cx.actions(item, env, repo)).toHaveLength(1);
  });

  it('codex config.toml round-trip: apply then undo restores bytes', () => {
    const { home, env, repo } = fresh();
    mkdirSync(join(home, '.codex'), { recursive: true });
    const orig = 'model = "x"\n# comment\n[mcp_servers.other]\ncommand = "a"';
    writeFileSync(join(home, '.codex/config.toml'), orig);
    const undo = applyAll(cx.actions(mkItem({ mcp: http }, 'c7'), env, repo), home, repo);
    expect(readFileSync(join(home, '.codex/config.toml'), 'utf8')).toContain('[mcp_servers.context7]');
    undo();
    expect(readFileSync(join(home, '.codex/config.toml'), 'utf8')).toBe(orig);
  });
});
