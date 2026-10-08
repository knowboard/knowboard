# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0](https://github.com/knowboard/knowboard/releases/tag/v0.3.0) - 2026-10-08

### Added

- **Find references** (`textDocument/references`) - look up references to the
  token at the cursor. Reference counts are also shown as a "Code Lens" over
  subjects.
- **Hover preview refinements** - the SHACL shape lookup for previews was
  overhauled which enabled better support for things like label and icon
  resolution for nested references.
- **Icon inlay hints** (enable via `experimental.iconInlayHints` config) -
  displays icons inline next to RDF or `[[wiki-link]]` references based on the
  associated SHACL shape.
- **Wiki-link discovery**:
  - `[[wiki-links]]` are now queryable. Outgoing links are exposed as
    `kb:linksToKey` predicates. Documents include `kb:matchableAs` for the valid
    suffixes that would resolve to that document. These follow Unicode-aware
    normalization to lower-case for matching.
  - Links are included in find-references results, supporting "backlink" lookup.
- **Format-preserving Turtle edits** (enable via `experimental.turtleEdits` config) -
  SPARQL updates will now edit Turtle `.ttl` files "in-place" by selectively
  inserting or removing the affected sections. This would previously replace
  the entire file, discarding existing formatting and comments.
- **SPARQL read-query command** (`knowboard.executeSparqlQuery`) -
  Enables LSP clients to directly execute SPARQL read queries instead of going
  through the HTTP endpoint.
- **SPARQL endpoint discovery** - Reports an "Info" diagnostic
  (`knowboard/sparql-endpoint`) on `.knowboard.toml` to allow LSP clients to
  more easily look up the bound endpoint in cases that they do not have access
  to run the LSP command directly.

### Changed

- `language_preference` moved from the `[hover]` section to the **top level** of
  `.knowboard.toml` since it is now applied more universally when loading
  language-aware strings like `sh:message`.
- Default `include` globs now cover `**/*.xml` (RDF/XML).
- SHACL `sh:node` violations provide clearer error messages. Custom `sh:message`
  values are now included, and opaque internal blank-node ids are replaced with
  a readable nested path to the location of the error.
- Unsupported `sh:sparql` constraints are now clearly reported with a
  **Warning** diagnostic instead of silently ignored.

### Fixed

- Stale diagnostic messages are cleared more reliably.
- Background file updates are more reliably handled. Previoulsy
  `workspace/didChangeWatchedFiles` events for files not currently open in the
  bypassed an update step, allowing the graph state to become stale until
  the file was opened.
- `include` / `exclude` globs from `.knowboard.toml` are properly applied.
  The were previously parsed, but the hard-coded default list was always used.
- JSON-LD updates preserve `@context` and compaction. This was previously
  applied in YAML-LD and Markdown files, while `.jsonld` files were
  re-written without the context.
- Allow escapes inside `[[wiki-link]]` syntax, notably in order to be able to
  use aliases inside Markdown tables like `[[wiki-link\|alias]]`.

## [0.2.0](https://github.com/knowboard/knowboard/releases/tag/v0.2.0) - 2026-07-11

### Added

- _(lsp)_ SPARQL update support. Enables running SPARQL queries to update the workspace. Can be run over HTTP, or with a Code Lens in the editor. Requires enabling experimental option in LSP config settings.
- _(lsp)_ Define custom "resourceAction" Code Lenses. Supports associating SPARQL updates with a shape which are then shown on resources with the shape's associated type.
- _(vscode)_ SPARQL update UI support: show settings to enable updates. Use the "quick pick" input to override the default dialog shown when the LSP prompts for actions to run.

## [0.1.2](https://github.com/knowboard/knowboard/releases/tag/v0.1.2) - 2026-06-04

### Fix

- _(vscode)_ fix error downloading new lsp over the old path

## [0.1.1](https://github.com/knowboard/knowboard/releases/tag/v0.1.1) - 2026-06-04 (removed)

### Fix

- _(vscode)_ prefer calling `knowboard-lsp` from the PATH if it exists
- _(vscode)_ store version of downloaded `knowboard-lsp` so we can download updates to match the extension version
- _(lsp)_ always include default properties like `kb:label` for Markdown files even if they do not have frontmatter

### Other

- _(vscode)_ include an icon for the extension

## [0.1.0](https://github.com/knowboard/knowboard/releases/tag/v0.1.0) - 2026-06-02

### Added

- Initial release
