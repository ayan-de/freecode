// =============================================================================
// Path Formatter - Convert project paths to session directory names
// =============================================================================
//
// Converts a project path like /home/ayande/Project/opencode
// to a safe directory name like home-ayande-Project-opencode
//
// The separator is chosen to avoid collisions with path characters:
// - Forward slashes are replaced with PATH_SEP
// - Hyphens are escaped as HYPHEN_ESCAPE in segments
//
// Usage:
//   formatSessionDirName("/home/ayande/Project/opencode")
//   // → "home-ayande-Project-opencode"
//
//   parseSessionDirName("home-ayande-Project-opencode")
//   // → "/home/ayande/Project/opencode"

const PATH_SEP = "-";
const HYPHEN_ESCAPE = "_h_";
const SEGMENT_SEP = "__";

/**
 * Convert an absolute project path to a safe directory name.
 *
 * Examples:
 *   /home/ayande/Project/opencode → home-ayande-Project-opencode
 *   /home/ayande/Project/my-project → home-ayande-Project-my_ h_project
 *   /Users/john/code/my-project → Users-john-code-my_ h_project
 *   C:\Users\john\projects\myapp → C-Users-john-projects-my_ h_app
 */
export function formatSessionDirName(projectPath: string): string {
  // Normalize backslashes to forward slashes
  const normalized = projectPath.replace(/\\/g, "/");

  // Remove leading/trailing slashes
  const stripped = normalized.replace(/^\/+|\/+$/g, "");

  if (!stripped) return "";

  // Split into segments and process each
  const segments = stripped.split("/");

  const formatted = segments
    .map((segment) => {
      // Escape hyphens within segments (they're our separator)
      return segment.replace(/-/g, HYPHEN_ESCAPE);
    })
    .join(SEGMENT_SEP);

  return formatted;
}

/**
 * Convert a session directory name back to an absolute project path.
 *
 * Examples:
 *   home__ayande__Project__opencode → /home/ayande/Project/opencode
 *   home__ayande__Project__my_ h_project → /home/ayande/Project/my-project
 */
export function parseSessionDirName(dirName: string): string {
  if (!dirName) return "";

  // Split by segment separator, unescape hyphens, rejoin with slashes
  const segments = dirName.split(SEGMENT_SEP);

  const path = segments
    .map((segment) => {
      return segment.replace(new RegExp(HYPHEN_ESCAPE, "g"), "-");
    })
    .join("/");

  return "/" + path;
}

/**
 * Check if a string looks like a formatted session directory name.
 */
export function isSessionDirName(str: string): boolean {
  return str.length > 0 && str.indexOf(SEGMENT_SEP) !== -1;
}
