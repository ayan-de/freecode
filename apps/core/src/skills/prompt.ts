// =============================================================================
// Skills Prompt - Advertise available skills in the system prompt
// PRIMARY: Render the name+description list the model sees, so it knows which
//          skills exist and can load one on demand via the `skill` tool.
// NOTE: Only name+description are injected (cheap tier); full bodies are loaded
//       on demand. The list is sorted so identical skill sets produce identical
//       bytes — protecting the provider's KV/prompt cache prefix.
// =============================================================================

import { getSkillsManagerForProject } from "./manager.js";

/**
 * Render the "Available Skills" system-prompt section for a project.
 * Returns "" when no skills are found or discovery fails (never throws).
 */
export async function renderAvailableSkillsSection(
  projectPath: string,
  installDir?: string,
): Promise<string> {
  try {
    const skills = await getSkillsManagerForProject(
      projectPath,
      installDir,
    ).listSkills();
    if (skills.length === 0) return "";

    const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
    const lines = [
      "# Available Skills",
      "",
      "The following skills are specialized instruction sets you can load on demand with the `skill` tool (pass the skill `name`). When a task matches a skill's description, load that skill before doing the work it covers.",
      "",
    ];
    for (const skill of sorted) {
      lines.push(
        `- **${skill.name}**${skill.description ? `: ${skill.description}` : ""}`,
      );
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
