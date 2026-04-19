// basic-agent/src/loaders/skills.ts
// Filesystem scan of `<agentRoot>/.agents/skills/<name>/SKILL.md`. Codex
// natively auto-discovers this directory (progressive disclosure, assumption
// A10), so this loader is purely a diagnostic/catalog exposer — NOT a
// programmatic registration path. Keep it side-effect-free.

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface SkillSummary {
  id: string;
  path: string;
  description: string | null;
}

export async function enumerateSkills(
  agentRoot: string,
): Promise<SkillSummary[]> {
  const skillsDir = path.join(agentRoot, ".agents", "skills");
  let entries: string[];
  try {
    const dirents = await fs.readdir(skillsDir, { withFileTypes: true });
    entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return [];
    throw err;
  }

  const summaries: SkillSummary[] = [];
  for (const id of entries) {
    const skillMdPath = path.join(skillsDir, id, "SKILL.md");
    let description: string | null = null;
    try {
      const raw = await fs.readFile(skillMdPath, "utf8");
      description = extractFrontmatterDescription(raw);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
      // No SKILL.md → skip this directory entirely (not a skill).
      continue;
    }
    summaries.push({ id, path: skillMdPath, description });
  }

  summaries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return summaries;
}

// Minimal line-based frontmatter parser. Intentionally avoids a YAML dep.
// Supports the common form:
//   ---
//   name: ...
//   description: one-line string (optionally quoted)
//   ---
// If `description:` spans multiple lines or uses block scalars, returns the
// first line only — good enough for the diagnostic surface this feeds.
function extractFrontmatterDescription(raw: string): string | null {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") return null;
    const m = line.match(/^description\s*:\s*(.*)$/);
    if (m) {
      let v = m[1].trim();
      // Strip matching surrounding quotes.
      if (
        (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
        (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
      ) {
        v = v.slice(1, -1);
      }
      return v.length > 0 ? v : null;
    }
  }
  return null;
}
