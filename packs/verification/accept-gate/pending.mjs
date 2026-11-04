// Count background subagents still running, from a Claude Code transcript.
// A Stop fires whenever the main turn ends, including while it waits on background agents;
// a Stop with agents still running is not a done claim.
// Started: an Agent/Task result with status "async_launched", or a SendMessage to that agent.
// Finished: a queued <task-notification> for that task id with a terminal status.
// CLI: node pending.mjs <transcript.jsonl>  -> prints the count.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TERMINAL = /<status>(completed|failed|killed|cancelled|canceled|stopped|error)<\/status>/;

export function pendingAgents(transcriptPath) {
  let text;
  try { text = readFileSync(transcriptPath, 'utf8'); } catch { return 0; }
  const starts = new Map(); const ends = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    if (d.isSidechain) continue;
    if (d.toolUseResult?.status === 'async_launched' && d.toolUseResult.agentId) bump(starts, d.toolUseResult.agentId);
    if (d.type === 'assistant') {
      for (const c of d.message?.content || []) {
        if (c.type === 'tool_use' && c.name === 'SendMessage' && starts.has(c.input?.to)) bump(starts, c.input.to);
      }
    }
    if (d.type === 'queue-operation' && typeof d.content === 'string' && d.content.includes('<task-notification>')) {
      const id = d.content.match(/<task-id>([^<]+)<\/task-id>/)?.[1];
      if (id && TERMINAL.test(d.content)) bump(ends, id);
    }
  }
  let n = 0;
  for (const [id, s] of starts) if ((ends.get(id) || 0) < s) n++;
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(pendingAgents(process.argv[2]));
