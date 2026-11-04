import { join } from 'node:path';
import type { Action } from '../actions.js';
import type { Adapter } from './types.js';
import type { InstallSpec } from '../manifest/types.js';
import { fileCopies, localSkillCopies, ruleBlock } from './shared.js';

const SUPPORTED: (keyof InstallSpec)[] = ['skills', 'local_skills', 'rule', 'files'];

/** Canonical `~/.agents` layout, read directly by several agents. */
export const generic: Adapter = {
  id: 'generic',
  supports: (f) => SUPPORTED.includes(f),
  instructionsFile: (env) => join(env.home, '.agents', 'AGENTS.md'),
  actions(item, env, repoRoot): Action[] {
    return [
      ...ruleBlock(item, this.instructionsFile(env), repoRoot),
      ...localSkillCopies(item, repoRoot, join(env.home, '.agents', 'skills')),
      ...fileCopies(item, env, repoRoot),
    ];
  },
};
