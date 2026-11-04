export const AGENT_IDS = ['claude-code', 'command-code', 'codex', 'gemini-cli', 'generic'] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const PACK_IDS = [
  'core', 'verification', 'design', 'core-extras', 'security', 'cloudflare', 'threejs', 'video',
] as const;
export type PackId = (typeof PACK_IDS)[number];

export const KINDS = [
  'skill', 'hook', 'command', 'agent', 'mcp', 'plugin', 'cli-tool', 'rule', 'settings',
] as const;
export type Kind = (typeof KINDS)[number];

export const BENEFITS = ['quality', 'speed', 'cost'] as const;
export const SOURCE_TYPES = [
  'npx-skills', 'git', 'npm', 'brew', 'plugin-marketplace', 'local', 'curl-script',
] as const;
export const REDISTRIBUTION = ['own', 'upstream-public', 'link-only'] as const;
export const RISKS = ['low', 'med', 'high'] as const;

export interface HookSpec {
  event: string;
  matcher?: string;
  command: string;
}

export interface McpSpec {
  name: string;
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  env_keys?: string[];
}

export interface InstallSpec {
  skills?: { repo: string; names: string[] };
  /** Repo-relative dirs containing SKILL.md. */
  local_skills?: string[];
  /** Repo-relative .md file. */
  rule?: string;
  hooks?: Partial<Record<AgentId, HookSpec>>;
  mcp?: McpSpec;
  /** claude-code settings.json only. */
  settings?: Record<string, unknown>;
  plugin?: { marketplace: string; name: string };
  /** cli-tool installs. */
  commands?: string[];
  /** readOnly probe (e.g. `command -v ccusage`): when it exits 0, `commands` and their uninstall are skipped (R24). */
  commands_unless?: string;
  /** `to` starts with `~/`. */
  files?: { from: string; to: string; mode?: number }[];
}

export interface Item {
  id: string;
  name: string;
  pack: PackId;
  summary: string;
  benefit: (typeof BENEFITS)[number][];
  /** Path `docs/items/<id>.md`. */
  details: string;
  kinds: Kind[];
  agents: AgentId[];
  source: { type: (typeof SOURCE_TYPES)[number]; ref: string; sha256?: string };
  redistribution: (typeof REDISTRIBUTION)[number];
  requires?: string[];
  conflicts?: string[];
  risk: (typeof RISKS)[number];
  risk_reason?: string;
  token_cost: number;
  manual?: string;
  needs_key?: string;
  install: InstallSpec;
  uninstall?: string[];
  update?: string[];
  post_install?: string[];
  detect?: string;
  verify: string;
}

export interface Pack {
  id: PackId;
  title: string;
  default: boolean;
  summary: string;
}

export interface Manifest {
  packs: Pack[];
  items: Item[];
}
