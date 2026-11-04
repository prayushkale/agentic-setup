import type { Adapter } from '../adapters/index.js';
import { unsupportedFields } from '../engine/plan.js';
import type { AgentId, Item } from '../manifest/types.js';

/** Card text width. clack's note box adds 4 columns, so cards stay inside 80. */
export const CARD_WIDTH = 72;

/** Word-wraps `text` to `width`, keeping its leading spaces; continuation lines indented by `indent` spaces (at least the lead). Long words are hard-cut. */
export function wrap(text: string, width = CARD_WIDTH, indent = 2): string[] {
  const out: string[] = [];
  const lead = /^ */.exec(text)![0];
  let line = lead;
  const pad = ' '.repeat(Math.max(indent, lead.length));
  const push = () => { out.push(line); line = pad; };
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width - pad.length) {
      if (line.trim()) push();
      const room = Math.max(1, width - line.length);
      out.push(line + word.slice(0, room));
      line = pad;
      word = word.slice(room);
    }
    if (line.trim() && line.length + 1 + word.length > width) push();
    line += (line.trim() ? ' ' : '') + word;
  }
  if (line.trim() || out.length === 0) out.push(line.trimEnd());
  return out;
}

/** True for items that need their own confirm even under --yes: high risk or a downloaded script. */
export const needsOwnConfirm = (item: Item): boolean => item.risk === 'high' || item.source.type === 'curl-script';

/** Lines naming what the item cannot do for each of `agents` ("hooks: not available for gemini-cli"). */
export function notAvailable(item: Item, agents: AgentId[], ads: Record<AgentId, Adapter>): string[] {
  const out: string[] = [];
  for (const a of agents) {
    if (!item.agents.includes(a)) out.push(`not available for ${a} (works with ${item.agents.join(', ')})`);
    else for (const f of unsupportedFields(item, a, ads[a])) out.push(`${f}: not available for ${a}`);
  }
  return out;
}

/** The per-item card: what it is, why it helps, token cost, risk, what you must do by hand. */
export function renderCard(item: Item, agents: AgentId[], ads: Record<AgentId, Adapter>): string {
  const lines: string[] = [];
  const add = (s: string) => lines.push(...wrap(s));
  add(`${item.name}  (${item.id} · ${item.pack})`);
  add(item.summary);
  lines.push('');
  if (item.benefit.length) add(`Helps: ${item.benefit.join(', ')}`);
  add(`Cost: ≈ +${item.token_cost} tokens at startup`);
  add(item.risk === 'low' || !item.risk_reason ? `Risk: ${item.risk}` : `Risk: ${item.risk} — ${item.risk_reason}`);
  if (item.needs_key) add(`Needs your own key: ${item.needs_key}`);
  if (item.manual) add(`Manual: ${item.manual}`);
  const applies = agents.filter((a) => item.agents.includes(a));
  if (applies.length) add(`Applies to: ${applies.join(', ')}`);
  for (const n of notAvailable(item, agents, ads)) add(n);
  if (item.source.type === 'curl-script') {
    add(`Downloads and runs a script (asks to confirm, even with --yes):`);
    add(`URL: ${item.source.ref}`);
    add(`sha256: ${item.source.sha256 ?? '(none)'}`);
  }
  return lines.join('\n');
}
