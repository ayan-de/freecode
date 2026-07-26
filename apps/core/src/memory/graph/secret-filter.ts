// =============================================================================
// Secret filter - keep credentials out of the embedding index (spec §7).
// Memories that look like they carry a secret are never embedded/stored as
// vectors. They remain reachable via the keyword/graph path (they still get a
// node), but nothing derived from their text is persisted in the sidecar, and
// nothing ever leaves the machine.
// =============================================================================

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/, // Anthropic
  /\bsk-[A-Za-z0-9]{20,}/, // OpenAI-style
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bASIA[0-9A-Z]{16}\b/, // AWS temporary key id
  /\bghp_[A-Za-z0-9]{36}\b/, // GitHub PAT (classic)
  /\bgithub_pat_[A-Za-z0-9_]{22,}/, // GitHub fine-grained PAT
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack token
  /\bAIza[0-9A-Za-z_-]{35}\b/, // Google API key
  /\bglpat-[A-Za-z0-9_-]{20,}/, // GitLab PAT
  // .env-style assignment of a secret-looking key to a non-trivial value.
  /(?:api[_-]?key|secret|token|password|passwd|access[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[^\s'"]{8,}/i,
];

export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}
