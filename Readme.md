# File Move Refactor Tool

A CLI tool to **move files and automatically update all relevant import statements** in a monorepo or multi-package TypeScript/JavaScript project.

---

## Features

- Move one or more files to new locations.
- Automatically updates all import paths in the codebase that reference the moved files.
- Updates relative and `@ms/`-style imports.
- Handles both TypeScript and JavaScript files.
- Supports dry-run and verbose modes for safe and transparent refactoring.

---

## Installation

Clone this repository and install dependencies:

```bash
npm install
```

---

## Usage

### Move Files

Prepare a `move.json` file in the root directory, containing an array of `[from, to]` path pairs:

```json
[
  [
    "C:/path/to/source/file1.ts",
    "C:/path/to/destination/file1.ts"
  ],
  [
    "C:/path/to/source/file2.ts",
    "C:/path/to/destination/file2.ts"
  ]
]
```

Then run:

```bash
npx ts-node move-file.ts
```

Or, if you have built the project:

```bash
node move-file.js
```

### Options

- `--dry-run`  
  Show what would be changed, but do not actually move files or update imports.

- `--verbose`  
  Print detailed information about every import update.

---

## How It Works

1. **Reads** the list of file moves from `move.json`.
2. **Validates** that all source files exist and destination files do not.
3. **Finds** all source files in the workspace (excluding `node_modules`, `dist`, etc.).
4. **Analyzes** which files import the files to be moved.
5. **Moves** the files.
6. **Updates** all relevant import statements in the codebase and inside the moved files themselves.

---

## Configuration

The tool is configured to work with a monorepo structure, specifically looking for files in:

- `packages/powerva-main`
- `packages/powerva-embedded-experiences`
- `packages/powerva-core`
- `apps/powerva-microsoft-com`

You can adjust these in `move-file.ts` if your project structure is different.

---

## Scripts

- `npm run move` — Run the move tool.
- `npm run test-move` — Run in dry-run mode.
- `npm run start` — Run the built tool with increased memory.
- `npm run startv` — Run the built tool in verbose mode.

---

## TypeScript

The project is written in TypeScript. See `tsconfig.json` for compiler options.

---

## Dependencies

- `@babel/parser` and `@babel/traverse` — For parsing and traversing code to find and update import statements.
- `fast-glob` — For fast file searching.
- `glob` — For pattern-based file matching.

---

## Example

Suppose you want to move:

- `packages/powerva-main/src/pages/adaptive-authoring/AdaptiveAuthoringIcons.tsx`  
  to  
  `packages/powerva-main/src/common/icons/AdaptiveAuthoringIcons.tsx`

Add this pair to `move.json` and run the tool. All imports of `AdaptiveAuthoringIcons` will be updated across the codebase.

---

## Development

### Project Structure

- `move-file.ts` — Main CLI entry point.
- `src/types.ts` — TypeScript types and interfaces.
- `src/pathUtils.ts` — Path normalization and import path helpers.
- `src/importUtils.ts` — Import analysis and statement finding.
- `src/fileOps.ts` — File moving and import updating logic.

---

## License

MIT
