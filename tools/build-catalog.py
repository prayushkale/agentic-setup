"""catalog/inventory.json + survey guesses -> catalog/catalog.yaml.
Preserves fields already edited in catalog.yaml (selected, tier, redistribution, upstream, status, card).
Run: python3 -I tools/build-catalog.py
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from scrub import scrub  # noqa: E402

THEMES = {
    "T1": "Workflow & spec process", "T2": "Verification & review loops",
    "T3": "Long-running / autonomous loops", "T4": "Context & memory",
    "T5": "Token & usage savings", "T6": "Design / UI", "T7": "Security & supply chain",
    "T8": "Multi-agent / teams / parallel", "T9": "Alternative agents & harnesses",
    "T10": "Skill authoring & ecosystem", "T11": "App starters & domain",
    "T12": "Business / use-case packs",
}

# id: (slug, theme, tier) -- survey first guesses; Phase 1 cards refine tier.
GUESS = {
    "L01": ("10-ai-coding-tips", "T1", "A"), "L02": ("design-prompt-templates", "T6", "B"),
    "L03": ("earn-money-design-prompt", "T12", "C"), "L04": ("al-design-video", "T6", "B"),
    "L05": ("hermes-use-cases", "T12", "C"), "L06": ("types-of-loops", "T2", "A"),
    "L07": ("chrome-extension-review", "T2", "B"), "L08": ("graph-engineering", "T2", "A"),
    "L09": ("anthropic-harness", "T2", "A"), "L10": ("code-review-eval-gate", "T2", "A"),
    "L11": ("be-ambitious", "T1", "B"), "L12": ("claude-code-large-codebases", "T4", "A"),
    "L13": ("claude-agent-harness", "T3", "B"), "L14": ("skill-creator-nano-banana-ui", "T10", "B"),
    "L15": ("ai-trends-specialists", "T8", "B"), "L16": ("head-of-design-resources", "T1", "B"),
    "L17": ("sites-that-sell", "T6", "C"), "L18": ("chatgpt-apps-n8n-agentkit", "T11", "C"),
    "L19": ("astra-video", "T11", "B"), "L20": ("beautiful-websites-archive", "T6", "C"),
    "L21": ("shopify-store", "T11", "B"), "L22": ("claude-mods", "T4", "A"),
    "L23": ("claude-chrome-errors", "T2", "B"), "L24": ("egm", "T1", "A"),
    "L25": ("loop-engineering-salon", "T3", "B"), "L26": ("astryx", "T6", "B"),
    "L27": ("unlazy-model-router", "T2", "A"), "L28": ("trending-skill-prompts", "T10", "B"),
    "L29": ("graft-source", "T4", "A"), "L30": ("claude-setup-ways", "T1", "A"),
    "L31": ("story-site-kit", "T6", "B"), "L32": ("agent-limitation-guides", "T4", "B"),
    "L33": ("okf", "T4", "B"), "L34": ("grok-bot-use-cases", "T12", "C"),
    "L35": ("karpathy-loop", "T2", "A"), "L36": ("rtk-hermes", "T5", "B"),
    "L37": ("hermes-agent", "T9", "B"), "L38": ("claude-agents", "T8", "B"),
    "L39": ("make-claude-code-last-longer", "T5", "A"), "L40": ("tokens-savings", "T5", "A"),
    "L41": ("al-design-system", "T6", "B"), "L42": ("notebooklm", "T4", "C"),
    "L43": ("figma-agent", "T6", "C"), "L44": ("stitch-resources", "T6", "B"),
    "L45": ("agentchattr", "T8", "B"), "L46": ("kibo-ui-commands", "T6", "C"),
    "L47": ("mcp2cli-claude-md", "T4", "A"), "L48": ("n8n-mcp-docs", "T11", "C"),
    "L49": ("claude-design-skills", "T6", "B"), "L50": ("al-design-video-2", "T6", "C"),
    "L51": ("jev-use-cases", "T3", "B"), "L52": ("claudemd-template", "T4", "B"),
    "L53": ("hermes-loop-engineering", "T3", "B"), "L54": ("token-economizer", "T5", "A"),
    "L55": ("openclaw-uses", "T12", "C"), "L56": ("shadcn-agent", "T6", "C"),
    "L57": ("shopify-workflow", "T1", "A"), "L58": ("tmux-agents", "T8", "C"),
    "L59": ("cc-creators-skill", "T2", "A"), "L60": ("agent-teams", "T8", "B"),
    "L61": ("fable-vs-astra", "T1", "B"), "L62": ("linear-ceo-spec", "T1", "B"),
    "L63": ("design-workflow-claude-md", "T6", "B"), "L64": ("claude-os", "T3", "B"),
    "L65": ("discover-skills", "T7", "A"), "L66": ("pencil-dev", "T6", "C"),
    "L67": ("headstart", "T1", "A"), "L68": ("wayfinder", "T1", "A"),
    "L69": ("ultimate-ui-setup", "T6", "B"), "L70": ("cursor-context-in-claude", "T4", "A"),
    "L71": ("fde", "T12", "C"), "L72": ("claude-superpowers-notes", "T1", "C"),
    "L73": ("agit-secret-guard", "T7", "B"), "L74": ("deepsec", "T7", "A"),
    "L75": ("mock-interview-app", "T11", "C"), "L76": ("company-policy-research", "T11", "C"),
    "L77": ("vercel-ceo", "T2", "A"), "L78": ("claude-design", "T6", "A"),
    "L79": ("antigravity-workflow", "T9", "B"), "L80": ("sandboxes-prompt", "T8", "C"),
    "L81": ("openclaw-installation", "T9", "C"), "L82": ("cowork-best-practices", "T4", "B"),
    "G01": ("designers-guide", "T6", "B"), "G02": ("best-practices-guide", "T1", "B"),
    "G03": ("premium-websites-guide", "T6", "B"), "G04": ("skills-vs-commands-vs-subagents", "T10", "B"),
    "G05": ("second-brain-obsidian", "T4", "B"), "G06": ("desktop-apps-guide", "T11", "B"),
    "G07": ("good-ux-guide", "T6", "B"), "G08": ("ios-apps-guide", "T11", "B"),
    "G09": ("secure-vibe-coded-app", "T7", "A"), "G10": ("project-architecture", "T1", "B"),
    "C01": ("anthropic-official-skills", "T10", "B"), "C02": ("awesome-agent-skills", "T10", "B"),
    "C03": ("awesome-claude-code", "T10", "B"), "C04": ("official-best-practices", "T1", "B"),
    "C05": ("claude-code-repo", "T9", "C"), "C06": ("codex-cli", "T9", "B"),
    "C07": ("flowise", "T11", "C"), "C08": ("hallmark", "T6", "B"),
    "C09": ("karpathy-rules", "T1", "A"), "C10": ("mcp-servers", "T10", "C"),
    "C11": ("oh-my-pi", "T9", "B"), "C12": ("open-design", "T6", "B"),
    "C13": ("repomix", "T4", "B"), "C14": ("supabase", "T11", "C"),
    "S01": ("al-design-starter", "T6", "A"), "S02": ("android-starter", "T11", "C"),
    "S03": ("desktop-starter", "T11", "C"), "S04": ("hermes-starter-pack", "T9", "A"),
    "S05": ("ios-starter", "T11", "A"), "S06": ("saas-boilerplate", "T11", "C"),
}

UPSTREAM = {
    "C01": "https://github.com/anthropics/skills", "C02": "https://github.com/VoltAgent/awesome-agent-skills",
    "C03": "https://github.com/hesreallyhim/awesome-claude-code", "C04": "https://code.claude.com/docs/en/best-practices",
    "C05": "https://github.com/anthropics/claude-code", "C06": "https://github.com/openai/codex",
    "C07": "https://github.com/FlowiseAI/Flowise", "C08": "https://github.com/Nutlope/hallmark",
    "C09": "https://github.com/multica-ai/andrej-karpathy-skills", "C10": "https://github.com/modelcontextprotocol/servers",
    "C11": "https://github.com/can1357/oh-my-pi", "C12": "https://github.com/nexu-io/open-design",
    "C13": "https://github.com/yamadashy/repomix", "C14": "https://github.com/supabase/supabase",
    "L29": "https://github.com/NanoNets/Graft", "L54": "https://github.com/microsoft/TokenEconomizer",
    "L24": "https://github.com/google/elephant-goldfish-model", "S04": "https://github.com/NousResearch/hermes-agent",
}

# Duplicate / variant groups (byte-identical dups are detected by hash).
VARIANT_OF = {"L04": "S01", "L41": "S01"}
CARRY = ["selected", "tier", "redistribution", "upstream", "status", "card", "summary"]


def q(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    return json.dumps(v, ensure_ascii=False)  # JSON strings are valid YAML


def load_existing():
    p = ROOT / "catalog/catalog.json"
    old = {r["id"]: r for r in json.loads(p.read_text())} if p.exists() else {}
    # Hand edits to `selected` in catalog.yaml win (the file has a fixed shape we emit ourselves).
    y = ROOT / "catalog/catalog.yaml"
    if y.exists():
        cur = None
        for line in y.read_text().splitlines():
            m = re.match(r"^  - id: (\w+)", line)
            if m:
                cur = m.group(1)
            m = re.match(r"^    selected: (true|false)", line)
            if m and cur in old:
                old[cur]["selected"] = m.group(1) == "true"
    return old


def main():
    inv = json.loads(scrub((ROOT / "private/inventory.json").read_text()))
    old = load_existing()
    results = {}
    rp = ROOT / "private/phase1-results.jsonl"
    if rp.exists():
        for line in rp.read_text().splitlines():
            line = line.strip()
            if line.startswith("{"):
                j = json.loads(scrub(line))
                results[j["id"]] = j
    first_by_sha, rows = {}, []
    for it in inv:
        iid = it["id"]
        slug, theme, tier = GUESS[iid]
        dup = None
        for f in it["files"]:
            s = f["sha256"]
            if s in first_by_sha and first_by_sha[s] != iid:
                dup = first_by_sha[s]
            first_by_sha.setdefault(s, iid)
        remotes = [re.sub(r"^\s*url\s*=\s*", "", f["git_remote"]) for f in it["files"] if f.get("git_remote")]
        row = {
            "id": iid, "slug": slug, "title": it["title"],
            "files": [{k: f.get(k) for k in ("path", "sha256", "size", "entry_count", "extracted")} for f in it["files"]],
            "dup_of": dup, "variant_of": VARIANT_OF.get(iid),
            "theme_guess": theme, "tier_guess": tier, "tier": None,
            "upstream": UPSTREAM.get(iid) or (remotes[0].removesuffix(".git") if remotes else None),
            "selected": False, "status": "extracted" if any(f.get("extracted") for f in it["files"]) else "raw",
            "redistribution": None, "card": None, "summary": None,
        }
        for k in CARRY:
            if k in old.get(iid, {}) and old[iid][k] is not None:
                row[k] = old[iid][k]
        res = results.get(iid)
        if res and not str(res.get("summary", "")).startswith("ERROR"):
            row.update(tier=res.get("tier"), redistribution=res.get("redistribution"),
                       summary=res.get("summary"), risk=res.get("risk"),
                       agents=res.get("agents"), overlap=res.get("overlap"))
            row["upstream"] = row["upstream"] or res.get("upstream")
        card = next((ROOT / "catalog/cards").glob(f"{iid}-*.md"), None)
        if card:
            row["card"] = str(card.relative_to(ROOT))
            row["status"] = "carded"
        rows.append(row)

    (ROOT / "catalog/catalog.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False))
    out = ["# Generated by tools/build-catalog.py. Edit `selected` here (or tell the agent IDs).",
           "# themes: " + "; ".join(f"{k}={v}" for k, v in THEMES.items()), "items:"]
    for r in rows:
        out.append(f"  - id: {r['id']}")
        for k, v in r.items():
            if k == "id":
                continue
            if k == "files":
                out.append("    files:")
                for f in v:
                    out.append("      - " + "\n        ".join(f"{fk}: {q(fv)}" for fk, fv in f.items() if fv is not None))
            else:
                out.append(f"    {k}: {q(v)}")
    (ROOT / "catalog/catalog.yaml").write_text("\n".join(out) + "\n")
    print(len(rows), "rows;", sum(1 for r in rows if r["dup_of"]), "dups;",
          sum(1 for r in rows if r["variant_of"]), "variants;",
          sum(1 for r in rows if r["tier_guess"] == "A"), "tier-A guesses")


if __name__ == "__main__":
    main()
