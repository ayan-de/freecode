# Changelog & Publish Workflow Design

## Status

Approved for implementation.

---

## Overview

Establish a professional changelog and manual publish workflow for the FreeCode monorepo using [Changesets](https://github.com/changesets/changesets). This enables controlled, well-documented releases with human-written changelog entries per release, without CI automation.

---

## Tools

| Tool | Purpose |
|------|---------|
| `@changesets/cli` | Changelog generation, version bumping, release management |
| pnpm workspaces | Monorepo package management |
| npm | Package registry publishing |

---

## Packages in Scope

| Package | Name on npm | Type |
|---------|-------------|------|
| `packages/shared` | `@thisisayande/freecode-shared` | Library |
| `apps/core` | `@thisisayande/freecode-core` | CLI + Library |
| `apps/tui` | `@thisisayande/freecode` | CLI |

---

## Workflow

### Step 1: Add Changeset (Per Release)

```bash
pnpm changeset
```

Interactive prompt:
- Select packages to include (can be all 3 or subset)
- Choose semver bump type: `patch` / `minor` / `major`
- Write changelog summary (1-3 sentences describing what changed)

This creates a `.changeset/<random-name>.md` file with the summary.

**Commit the changeset file** before versioning:
```bash
git add .changeset/<random-name>.md
git commit -m "chore: add changeset for vNEXT release"
```

### Step 2: Version & Generate Changelog

```bash
pnpm changeset version
```

What this does:
- Reads all `.changeset/*.md` files
- Bumps `version` in each affected `package.json`
- Updates `@thisisayande/freecode-shared` dependency refs in `core` and `tui` to match new version
- Generates `CHANGELOG.md` in each package (or root `CHANGELOG.md` if configured)
- Removes the consumed changeset files

### Step 3: Build

```bash
pnpm build
```

Rebuilds all `dist/` folders to ensure they reflect the latest source.

### Step 4: Publish

```bash
pnpm publish -r --access public
```

Publishes all packages with changes to npm. The `--access public` flag ensures scoped packages are publicly accessible.

### Step 5: Commit Release

```bash
git add -A
git commit -m "release: v<version>"
git push origin main
```

### Step 6: Tag (Optional)

```bash
git tag v<version>
git push origin v<version>
```

---

## Changeset File Format

Example: `.changeset/brave-ears-chew.md`

```md
---
"@thisisayande/freecode-shared": minor
"@thisisayande/freecode-core": minor
"@thisisayande/freecode": minor
---

feat: add danger mode with permission bypass for agent operations

Introduces a new `danger` agent mode that skips permission hooks,
enabling fully automated execution for trusted workflows. Includes
mode-specific badge colors in TUI.
```

---

## Configuration

### `.changeset/config.json`

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/changelog-github",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "minor"
}
```

### `package.json` Additions (root)

```json
{
  "scripts": {
    "release": "pnpm build && pnpm publish -r --access public"
  }
}
```

---

## Current Version State

As of this design, all three packages have been bumped to `0.2.0` locally but not yet published. The next changeset should describe the changes since `0.1.0`:

- **shared**: Added `danger` agent mode to `SessionConfig`
- **core**: Permission bypass logic in agent loop for danger mode
- **tui**: Mode display enhancements, mode-specific colors, danger mode UI

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `.changeset/config.json` |
| Create | `.changeset/pre.json` (if needed) |
| Modify | `package.json` (add `release` script) |
| Modify | Each package's `package.json` (add `"repository"` if missing) |

---

## Out of Scope

- CI/CD automated publishing (manual publish only)
- GitHub Actions integration (no bot PRs)
- Automatic CHANGELOG generation from commit history alone
- Changesets GitHub App integration

---

## Rollback Procedure

If a publish fails or needs to be undone:

1. **Before publish**: No action needed, just don't run `pnpm publish`
2. **After failed publish**: Revert the version commit + recreate changeset
3. **After successful publish**: Use `npm unpublish <pkg>@<version>` to remove bad release, then re-version

---

## Version Compatibility Notes

When `shared` bumps version, `core` and `tui` reference it via `^x.y.z`. The `pnpm changeset version` command automatically updates these references.

Current dependency refs after manual update:
- `apps/core/package.json`: `"@thisisayande/freecode-shared": "^0.2.0"`
- `apps/tui/package.json`: `"@thisisayande/freecode-shared": "^0.2.0"`