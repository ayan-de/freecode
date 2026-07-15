// =============================================================================
// LSP server registry — maps file extensions to a language-server command.
// Servers must be installed on the host; missing servers degrade gracefully.
// Override/extend via the FREECODE_LSP_SERVERS env var (JSON), e.g.
//   {".rs": {"command": "rust-analyzer", "args": []}}
// =============================================================================

export interface ServerSpec {
  command: string;
  args: string[];
}

const DEFAULT_SERVERS: Record<string, ServerSpec> = {
  ".ts": { command: "typescript-language-server", args: ["--stdio"] },
  ".tsx": { command: "typescript-language-server", args: ["--stdio"] },
  ".js": { command: "typescript-language-server", args: ["--stdio"] },
  ".jsx": { command: "typescript-language-server", args: ["--stdio"] },
  ".mjs": { command: "typescript-language-server", args: ["--stdio"] },
  ".cjs": { command: "typescript-language-server", args: ["--stdio"] },
  ".py": { command: "pyright-langserver", args: ["--stdio"] },
  ".rs": { command: "rust-analyzer", args: [] },
  ".go": { command: "gopls", args: [] },
};

function envOverrides(): Record<string, ServerSpec> {
  const raw = process.env.FREECODE_LSP_SERVERS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, ServerSpec>;
  } catch {
    return {};
  }
}

export function serverForExtension(ext: string): ServerSpec | undefined {
  const overrides = envOverrides();
  return overrides[ext] ?? DEFAULT_SERVERS[ext];
}

export function languageIdForExtension(ext: string): string {
  switch (ext) {
    case ".ts":
      return "typescript";
    case ".tsx":
      return "typescriptreact";
    case ".js":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".jsx":
      return "javascriptreact";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    default:
      return "plaintext";
  }
}
