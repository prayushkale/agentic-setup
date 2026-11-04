/**
 * What an adapter asks the engine to do. Paths are absolute, resolved against the HOME and
 * the repo root. Ruling R1: this union lives here; adapters, the engine and state import it.
 */
export type Action =
  | { kind: 'json-merge'; file: string; patch: object }
  | { kind: 'block'; file: string; id: string; body: string; style: 'md'|'toml' }
  | { kind: 'copy'; from: string; to: string; mode?: number }
  | {
      kind: 'run'; cmd: string; undo?: string; snapshot?: string[];
      /** Key paths the command itself writes in a JSON file; uninstall removes the ones it added (R18). */
      jsonTrack?: { file: string; paths: string[][] };
    };
