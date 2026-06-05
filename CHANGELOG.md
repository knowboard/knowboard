# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
