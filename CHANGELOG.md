# Changelog

## v0.8.0

### Added
- Syntax highlighting in `ToolResultMessage` rendering, with extended file-read detection

### Changed
- Consistent duration formatting (`formatDuration`) across `freecode` command, main entry, and message components

## v0.7.1

### Added
- Hooks configuration loader (`hooks/settings.ts`): define hooks in `.freecode/settings.json` without touching source, with Claude Code nested-shape compatibility
- `FREECODE_DEBUG` env var gates debug-level logger output
- Syntax highlighting in TUI diff rendering; mention highlighting in prompt editor

### Changed
- Replaced ad-hoc `console.warn` calls across core with the shared logger for consistent log handling

## v0.7.0

### Added
- Memory Graph Service with vector store, knowledge graph builder, and cascade retrieval
- Memory Graph CLI commands (`memory graph stats|rebuild`)
- Context Engine with tree-cache and collection strategies
- Secret filter for memory embeddings
- Deterministic k-means clustering for memory
- Embedder support (local ONNX/fastembed, optional dependency)

### Fixed
- Improved permission profiles and mode policies
- Enhanced MCP client transport and tool conversion
- Better session management with fork and archive support

### Changed
- Updated provider registry with MiniMax support
- Improved agent loop with loop-health monitoring
- Enhanced rollout/event sourcing with replay capabilities

### Infrastructure
- Effect runtime with Layer DI system
- Updated Vercel AI SDK to latest
- Improved SQLite thread store
