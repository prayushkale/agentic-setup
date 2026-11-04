import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectAgents, hasBinary, type Env } from '../src/detect.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'as-det-'));

describe('detectAgents', () => {
  it('detects agents from config dirs in temp HOME with empty PATH', async () => {
    const home = tmp();
    mkdirSync(join(home, '.codex'));
    mkdirSync(join(home, '.claude'));
    const env: Env = { home, path: '', platform: 'darwin' };
    expect(await detectAgents(env)).toEqual(['claude-code', 'codex', 'generic']);
  });

  it('generic always detected', async () => {
    expect(await detectAgents({ home: tmp(), path: '', platform: 'linux' })).toEqual(['generic']);
  });

  it('detects agents from binaries on PATH', async () => {
    const bin = tmp();
    writeFileSync(join(bin, 'gemini'), '#!/bin/sh\n');
    chmodSync(join(bin, 'gemini'), 0o755);
    writeFileSync(join(bin, 'cmd'), 'x');
    chmodSync(join(bin, 'cmd'), 0o644); // not executable
    const env: Env = { home: tmp(), path: `/nonexistent:${bin}`, platform: 'linux' };
    expect(hasBinary('gemini', env)).toBe(true);
    expect(hasBinary('cmd', env)).toBe(false);
    expect(await detectAgents(env)).toEqual(['gemini-cli', 'generic']);
  });
});
