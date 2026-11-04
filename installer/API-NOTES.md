# API notes (checked with Context7 on 2026-11-03)

Installed: @clack/prompts ^1.8, yaml ^2.9, execa ^9.6, vitest ^5.1, typescript ^7 (needs `"types": ["node"]` in tsconfig), @types/node ^26. Use `npm i --include=dev`.

## @clack/prompts
- `import { intro, outro, multiselect, select, confirm, text, spinner, log, note, isCancel, cancel } from '@clack/prompts'`
- `multiselect({ message, options: [{ value, label, hint?, disabled? }], initialValues?, required? (default true), maxItems? })` returns `Value[] | symbol`.
- `confirm({ message, initialValue?, active?, inactive? })` returns `boolean | symbol`.
- Always check `isCancel(result)` and then `cancel('...')` + exit.
- `const s = spinner(); s.start('msg'); s.stop('done')`; on failure `s.error('msg')`. Options: `{ indicator: 'timer', onCancel }`; `s.isCancelled`.
- Prompts need a TTY; with `--yes` or non-TTY skip them.

## yaml
- `import { parse, stringify, parseDocument, Document } from 'yaml'`
- `parse(str)` returns JS values; `stringify(obj)` returns a string.
- `parseDocument(str)` keeps comments and blank lines: `doc.get('key')`, `doc.set(key, v)`, `doc.toString()`. `doc.errors` holds parse errors. Comment handling for trailing comments is not fully stable.

## execa (ESM, v9)
- `import { execa, execaCommand } from 'execa'`; template form `` await execa({ reject: false })`cmd ${arg}` ``.
- `await execa('git', ['status'], { cwd, env, reject: false })` returns `{ stdout, stderr, exitCode, failed }`. With `reject: false` a failure is returned, not thrown.
- Pass `env: { HOME: tmp }` (with `extendEnv: true`, the default, to inherit the rest) for sandboxed runs. For shell strings from the manifest use `{ shell: true }`.

## vitest
- `import { defineConfig } from 'vitest/config'`; options under `test: { environment: 'node', include: [...] }`.
- `import { describe, it, expect } from 'vitest'`; run once with `vitest run [file]`.
- `import.meta.dirname` works (Node >= 20.11) for fixture paths; use `mkdtempSync(join(tmpdir(), ...))` for temp HOMEs.
