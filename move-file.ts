#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import fg from "fast-glob";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
const traverse = (_traverse as any).default || _traverse;

// Types
interface ImportInfo {
  line: number;
  originalLine: string;
  importPath: string;
  matchedText: string;
}

interface ImportAnalysis {
  file: string;
  imports: ImportInfo[];
}

interface Config {
  excludePatterns: string[];
  includePatterns: string[];
  cwd: string;
  dryRun: boolean;
  verbose: boolean;
}

const TEMP_ARGUMENTS = {
  cwd: path.normalize(
    "C:/Users/jamescheung/Desktop/Work/project/power-platform-ux"
  ),
};

const INCLUDED_PACKAGE_FOLDERS = [
  "powerva-main",
  "powerva-embedded-experiences",
  "powerva-core",
];

const INCLUDED_APPS_FOLDERS = ["powerva-microsoft-com"];

const INCLUDE_PATTERNS = [
  ...INCLUDED_PACKAGE_FOLDERS.map((f) => `packages/${f}/**`),
  ...INCLUDED_APPS_FOLDERS.map((f) => `apps/${f}/**`),
];

// Configuration
const CONFIG: Config = {
  cwd: TEMP_ARGUMENTS.cwd,
  excludePatterns: [
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/lib/**",
    "**/.git/**",
    "**/*.d.ts",
    "**/*.json",
    "**/*.md",
    "**/*.svg",
  ],
  includePatterns: INCLUDE_PATTERNS,
  dryRun: process.argv.includes("--dry-run"),
  verbose: process.argv.includes("--verbose"),
};

/**
 * Normalize path to use forward slashes consistently
 */
function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, "/");
}

/**
 * Main function to move multiple files and update all imports
 */
async function moveFileAndUpdateImports(
  moves: Array<[fromPath: string, toPath: string]>
): Promise<void> {
  console.log(`🚀 Starting batch move of ${moves.length} files`);

  // Normalize all paths in moves
  const normalizedMoves: Array<[string, string]> = moves.map(([from, to]) => [
    path.resolve(from),
    path.resolve(to),
  ]);

  // Validate all moves first
  console.log("🔍 Validating all moves...");
  for (const [fromPath, toPath] of normalizedMoves) {
    try {
      await validateInputs(fromPath, toPath);
    } catch (error) {
      console.error(`❌ Validation failed for ${fromPath} → ${toPath}:`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  // Find all files that might contain imports (do this once for all moves)
  const sourceFiles = await findSourceFiles();
  console.log(`📁 Found ${sourceFiles.length} source files to check`);
  const deadFiles: string[] = [];

  // Process each move
  for (let i = 0; i < normalizedMoves.length; i++) {
    const [fromPath, toPath] = normalizedMoves[i];
    console.log(
      `\n📦 Processing move ${i + 1}/${
        normalizedMoves.length
      }: ${fromPath} → ${toPath}`
    );

    try {
      // Analyze current imports before moving
      const importAnalysis = await analyzeImports(sourceFiles, fromPath);
      console.log(
        `🔍 Found ${importAnalysis.length} files importing this module`
      );

      if (CONFIG.dryRun) {
        console.log("🔍 DRY RUN MODE - No changes will be made for this file");
        console.log("Files that would be updated:");
        importAnalysis.forEach(({ file, imports }) => {
          console.log(`  ${file}: ${imports.length} import(s)`);
          if (CONFIG.verbose) {
            imports.forEach((imp) => {
              console.log(`    Line ${imp.line}: ${imp.originalLine}`);
            });
          }
        });
        continue; // Skip to next move in dry run
      }

      // Move the physical file
      await movePhysicalFile(fromPath, toPath);

      // Update imports inside the moved file itself
      await updateImportsInMovedFile(fromPath, toPath);

      // Update all imports in other files
      let updatedFiles = 0;
      for (const { file, imports } of importAnalysis) {
        const updated = await updateImportsInFile(
          file,
          imports,
          fromPath,
          toPath
        );
        if (updated) updatedFiles++;
      }

      if (updatedFiles > 0) {
        console.log(
          `✅ Successfully moved file and updated ${updatedFiles} files`
        );
      } else {
        console.log(`⚠️  No file usage found in other files.`);
        deadFiles.push(fromPath);
      }
    } catch (error) {
      console.error(
        `❌ Error processing move ${fromPath} → ${toPath}:`,
        error instanceof Error ? error.message : String(error)
      );
      // Continue with other moves instead of exiting
      continue;
    }
  }

  console.log(
    `\n🎉 Batch move completed! Processed ${normalizedMoves.length} files.`
  );
  if (deadFiles.length > 0) {
    console.log(
      `⚠️  Found ${deadFiles.length} files that were moved but not used in any other files:`
    );
    deadFiles.forEach((file) => console.log(`  - ${file}`));

    console.log(`Consider removing these files if they are no longer needed.`);
  }
}

// // Example usage with LLM-generated file moves:
// const LLM_GENERATED_MOVES = [
//   // LLM will generate moves like this based on codebase analysis
//   [
//     "packages/powerva-main/src/common/urlUtilities.ts",
//     "packages/powerva-main/src/common/utils/urlUtilities.ts",
//   ],
//   // Add more moves here as generated by LLM
// ];

// // Run the moves
// moveFileAndUpdateImports(LLM_GENERATED_MOVES);

/**
 * Validate that the move operation is valid
 */
async function validateInputs(oldPath: string, newPath: string): Promise<void> {
  try {
    await fs.access(oldPath);
  } catch {
    throw new Error(`Source file does not exist: ${oldPath}`);
  }

  try {
    await fs.access(newPath);
    throw new Error(`Destination file already exists: ${newPath}`);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  // Ensure destination directory exists
  const newDir = path.dirname(newPath);
  await fs.mkdir(newDir, { recursive: true });
}

/**
 * Find all source files that might contain imports
 */
async function findSourceFiles(): Promise<string[]> {
  if (CONFIG.verbose) {
    console.log("fast-glob patterns:", CONFIG.includePatterns);
    console.log("fast-glob options:", {
      cwd: CONFIG.cwd,
      ignore: CONFIG.excludePatterns,
      onlyFiles: true,
      dot: true,
    });
  }
  // Use fast-glob with include and exclude patterns
  const files = await fg(CONFIG.includePatterns, {
    cwd: CONFIG.cwd,
    ignore: CONFIG.excludePatterns,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false,
  });

  // Convert relative paths to absolute and normalize
  return files.map((file) => path.resolve(CONFIG.cwd, file));
}

/**
 * Analyze which files import the target file
 */
async function analyzeImports(
  sourceFiles: string[],
  targetPath: string
): Promise<ImportAnalysis[]> {
  const results: ImportAnalysis[] = [];

  if (CONFIG.verbose) {
    console.log(`🔍 Analyzing imports for target: ${targetPath}`);
  }

  // Generate all possible import paths for this target
  const targetImportPaths = generateTargetImportPaths(targetPath);

  if (CONFIG.verbose) {
    console.log(`🎯 Target import paths to match:`, targetImportPaths);
  }

  for (const file of sourceFiles) {
    try {
      if (CONFIG.verbose) {
        console.log(`📂 Analyzing file: ${file}`);
      }

      const content = await fs.readFile(file, "utf8");

      const imports = findImportStatements({
        content,
        targetImportPaths,
        currentFile: file,
      });

      if (CONFIG.verbose) {
        console.log(`📂 Analyzing ${file}: ${imports.length} import(s) found`);
      }
      if (imports.length > 0) {
        results.push({ file, imports });
      }
    } catch (error) {
      if (CONFIG.verbose) {
        console.warn(
          `⚠️  Could not read ${file}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return results;
}

/**
 * Generate all possible import paths for a target file
 */
function generateTargetImportPaths(targetPath: string): string[] {
  const normalized = path.resolve(targetPath);
  const withoutExt = removeExtension(normalized);
  const paths = new Set<string>();

  // Add the direct paths
  paths.add(normalizePath(normalized));
  paths.add(normalizePath(withoutExt));

  // Generate @ms/ import path if it's a package file
  const msImportPath = getMsImportPath(normalized);
  if (msImportPath) {
    paths.add(msImportPath);
  }

  // Also add relative to CONFIG.cwd versions
  const relativeToCwd = path.relative(CONFIG.cwd, normalized);
  const relativeToCwdWithoutExt = removeExtension(relativeToCwd);
  paths.add(normalizePath(relativeToCwd));
  paths.add(normalizePath(relativeToCwdWithoutExt));

  return Array.from(paths);
}

/**
 * Find import statements in file content
 */
function findImportStatements(arg: {
  content: string;
  targetImportPaths: string[];
  currentFile: string;
}): ImportInfo[] {
  const { content, targetImportPaths, currentFile } = arg;
  const imports: ImportInfo[] = [];

  // Parse the file content into an AST
  let ast;
  try {
    ast = parse(content, {
      sourceType: "unambiguous",
      plugins: [
        "typescript",
        "jsx",
        "decorators-legacy",
        "classProperties",
        "dynamicImport",
      ],
    });
  } catch (e) {
    if (CONFIG.verbose) {
      console.warn(
        `⚠️  Could not parse ${currentFile}: ${
          e instanceof Error ? e.message : String(e)
        }`
      );
    }
    return imports;
  }

  // Traverse the AST to find import/require/export-from statements
  traverse(ast, {
    ImportDeclaration(pathNode: any) {
      const importPath = pathNode.node.source.value;
      if (
        typeof importPath === "string" &&
        matchesTarget(importPath, targetImportPaths, currentFile)
      ) {
        imports.push({
          line: pathNode.node.loc?.start.line || 0,
          originalLine:
            content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
            "",
          importPath,
          matchedText: pathNode.toString(),
        });
      }
    },
    ExportAllDeclaration(pathNode: any) {
      const importPath = pathNode.node.source?.value;
      if (
        typeof importPath === "string" &&
        matchesTarget(importPath, targetImportPaths, currentFile)
      ) {
        imports.push({
          line: pathNode.node.loc?.start.line || 0,
          originalLine:
            content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
            "",
          importPath,
          matchedText: pathNode.toString(),
        });
      }
    },
    ExportNamedDeclaration(pathNode: any) {
      const importPath = pathNode.node.source?.value;
      if (
        typeof importPath === "string" &&
        matchesTarget(importPath, targetImportPaths, currentFile)
      ) {
        imports.push({
          line: pathNode.node.loc?.start.line || 0,
          originalLine:
            content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
            "",
          importPath,
          matchedText: pathNode.toString(),
        });
      }
    },
    CallExpression(pathNode: any) {
      // Handle require('...') and dynamic import('...')
      const callee = pathNode.node.callee;
      if (
        (callee.type === "Identifier" && callee.name === "require") ||
        callee.type === "Import"
      ) {
        const arg0 = pathNode.node.arguments[0];
        if (arg0 && arg0.type === "StringLiteral") {
          const importPath = arg0.value;
          if (matchesTarget(importPath, targetImportPaths, currentFile)) {
            imports.push({
              line: pathNode.node.loc?.start.line || 0,
              originalLine:
                content
                  .split("\n")
                  [pathNode.node.loc?.start.line - 1]?.trim() || "",
              importPath,
              matchedText: pathNode.toString(),
            });
          }
        }
      }
    },
  });

  return imports;
}

/**
 * Check if an import path matches any of the target paths
 */
function matchesTarget(
  importPath: string,
  targetImportPaths: string[],
  currentFile: string
): boolean {
  // Direct match against any target path
  if (targetImportPaths.includes(importPath)) {
    return true;
  }

  // For relative imports, resolve them and check
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const resolvedPath = resolveImportPath(currentFile, importPath);
    const resolvedPathWithoutExt = removeExtension(resolvedPath);

    return targetImportPaths.some(
      (targetPath) =>
        normalizePath(resolvedPath) === targetPath ||
        normalizePath(resolvedPathWithoutExt) === targetPath ||
        normalizePath(resolvedPath) === removeExtension(targetPath) ||
        normalizePath(resolvedPathWithoutExt) === removeExtension(targetPath)
    );
  }

  return false;
}

// Helper to generate @ms/ import path from a file path
function getMsImportPath(filePath: string): string | null {
  // Normalize path for consistent matching
  const normalized = normalizePath(filePath);

  // Match packages/<pkg>/src/(...) or full path containing packages/<pkg>/src/(...)
  const match = normalized.match(/packages\/([^/]+)\/src\/(.*)$/);
  if (match) {
    const pkg = match[1];
    const subpath = match[2].replace(/\.[^/.]+$/, ""); // remove extension
    return `@ms/${pkg}/lib/${subpath}`;
  }
  return null;
}

/**
 * Generate the new @ms/ import path for a moved file
 */
function generateNewMsImportPath(newPath: string): string | null {
  return getMsImportPath(newPath);
}

/**
 * Resolve import path relative to current file
 */
function resolveImportPath(currentFile: string, importPath: string): string {
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const currentDir = path.dirname(currentFile);
    return path.resolve(currentDir, importPath);
  }
  return importPath;
}

/**
 * Remove file extension
 */
function removeExtension(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, parsed.name);
}

/**
 * Move the physical file
 */
async function movePhysicalFile(
  oldPath: string,
  newPath: string
): Promise<void> {
  console.log(`📦 Moving file: ${oldPath} → ${newPath}`);
  await fs.rename(oldPath, newPath);
}

/**
 * Update imports inside the moved file itself
 */
async function updateImportsInMovedFile(
  oldPath: string,
  newPath: string
): Promise<void> {
  try {
    console.log(`📝 Updating imports inside moved file: ${newPath}`);

    const content = await fs.readFile(newPath, "utf8");
    let updatedContent = content;
    let hasChanges = false;

    // Parse the file content into an AST
    let ast;
    try {
      ast = parse(content, {
        sourceType: "unambiguous",
        plugins: [
          "typescript",
          "jsx",
          "decorators-legacy",
          "classProperties",
          "dynamicImport",
        ],
      });
    } catch (e) {
      if (CONFIG.verbose) {
        console.warn(
          `⚠️  Could not parse moved file ${newPath}: ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
      return;
    }

    const oldFileDir = path.dirname(oldPath);
    const newFileDir = path.dirname(newPath);

    // Find all relative imports in the moved file
    const relativeImports: ImportInfo[] = [];

    traverse(ast, {
      ImportDeclaration(pathNode: any) {
        const importPath = pathNode.node.source.value;
        if (
          typeof importPath === "string" &&
          (importPath.startsWith("./") || importPath.startsWith("../"))
        ) {
          relativeImports.push({
            line: pathNode.node.loc?.start.line || 0,
            originalLine:
              content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
              "",
            importPath,
            matchedText: pathNode.toString(),
          });
        }
      },
      ExportAllDeclaration(pathNode: any) {
        const importPath = pathNode.node.source?.value;
        if (
          typeof importPath === "string" &&
          (importPath.startsWith("./") || importPath.startsWith("../"))
        ) {
          relativeImports.push({
            line: pathNode.node.loc?.start.line || 0,
            originalLine:
              content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
              "",
            importPath,
            matchedText: pathNode.toString(),
          });
        }
      },
      ExportNamedDeclaration(pathNode: any) {
        const importPath = pathNode.node.source?.value;
        if (
          typeof importPath === "string" &&
          (importPath.startsWith("./") || importPath.startsWith("../"))
        ) {
          relativeImports.push({
            line: pathNode.node.loc?.start.line || 0,
            originalLine:
              content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
              "",
            importPath,
            matchedText: pathNode.toString(),
          });
        }
      },
      CallExpression(pathNode: any) {
        // Handle require('...') and dynamic import('...')
        const callee = pathNode.node.callee;
        if (
          (callee.type === "Identifier" && callee.name === "require") ||
          callee.type === "Import"
        ) {
          const arg0 = pathNode.node.arguments[0];
          if (arg0 && arg0.type === "StringLiteral") {
            const importPath = arg0.value;
            if (
              typeof importPath === "string" &&
              (importPath.startsWith("./") || importPath.startsWith("../"))
            ) {
              relativeImports.push({
                line: pathNode.node.loc?.start.line || 0,
                originalLine:
                  content
                    .split("\n")
                    [pathNode.node.loc?.start.line - 1]?.trim() || "",
                importPath,
                matchedText: pathNode.toString(),
              });
            }
          }
        }
      },
    });

    if (CONFIG.verbose) {
      console.log(
        `  Found ${relativeImports.length} relative imports to update`
      );
    }

    // Update each relative import
    for (const importInfo of relativeImports) {
      const oldImportPath = importInfo.importPath;

      // Resolve the old import path from the old file location
      const oldResolvedPath = path.resolve(oldFileDir, oldImportPath);

      // Calculate the new relative path from the new file location
      let newRelativePath = normalizePath(
        path.relative(newFileDir, oldResolvedPath)
      );

      // Ensure relative paths start with ./ or ../
      if (
        !newRelativePath.startsWith("../") &&
        !newRelativePath.startsWith("./")
      ) {
        newRelativePath = `./${newRelativePath}`;
      }

      // Only update if the path actually changed
      if (oldImportPath !== newRelativePath) {
        // Create regex to match the specific import path
        const escapeRegex = (str: string): string =>
          str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const quotedPattern = new RegExp(
          `(['"\`])${escapeRegex(oldImportPath)}\\1`,
          "g"
        );

        if (quotedPattern.test(updatedContent)) {
          updatedContent = updatedContent.replace(
            quotedPattern,
            `$1${newRelativePath}$1`
          );
          hasChanges = true;

          if (CONFIG.verbose) {
            console.log(
              `    📝 Updated import: ${oldImportPath} → ${newRelativePath}`
            );
          }
        }
      }
    }

    // Write the updated content back to the file
    if (hasChanges) {
      await fs.writeFile(newPath, updatedContent, "utf8");
      console.log(
        `  ✅ Updated ${relativeImports.length} imports in moved file`
      );
    } else if (CONFIG.verbose) {
      console.log(`  ℹ️  No import updates needed in moved file`);
    }
  } catch (error) {
    console.error(
      `❌ Error updating imports in moved file ${newPath}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function updateImportsInFile(
  filePath: string,
  imports: ImportInfo[],
  oldPath: string,
  newPath: string
): Promise<boolean> {
  try {
    let content = await fs.readFile(filePath, "utf8");
    let hasChanges = false;

    const oldPathWithoutExt = removeExtension(oldPath);
    const newPathWithoutExt = removeExtension(newPath);

    // Generate old and new @ms/ paths
    const oldMsPath = getMsImportPath(oldPath);
    const newMsPath = generateNewMsImportPath(newPath);

    // Calculate new import path relative to the file being updated
    const fileDir = path.dirname(filePath);
    let newRelativePath = normalizePath(
      path.relative(fileDir, newPathWithoutExt)
    );

    // Ensure relative paths start with ./, but do not add ./ before ../
    if (
      !newRelativePath.startsWith("../") &&
      !newRelativePath.startsWith("./")
    ) {
      newRelativePath = `./${newRelativePath}`;
    }

    for (const importInfo of imports) {
      const oldImportPath = importInfo.importPath;
      let updatedImportPath: string;

      // Determine the correct new import path based on the old import style
      if (oldImportPath.startsWith("@ms/")) {
        // For @ms/ imports, use the new @ms/ path
        updatedImportPath = newMsPath || newRelativePath;
      } else if (
        oldImportPath.startsWith("./") ||
        oldImportPath.startsWith("../")
      ) {
        // For relative imports, use the new relative path
        updatedImportPath = newRelativePath;
      } else {
        // For absolute imports, try to maintain the same style
        updatedImportPath = newRelativePath;
      }

      // Create regex to match the specific import path
      const escapeRegex = (str: string): string =>
        str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      // Try to replace with quotes first, then without
      const quotedPattern = new RegExp(
        `(['"\`])${escapeRegex(oldImportPath)}\\1`,
        "g"
      );
      const unquotedPattern = new RegExp(
        `\\b${escapeRegex(oldImportPath)}\\b`,
        "g"
      );

      if (quotedPattern.test(content)) {
        content = content.replace(quotedPattern, `$1${updatedImportPath}$1`);
        hasChanges = true;
      } else if (unquotedPattern.test(content)) {
        content = content.replace(unquotedPattern, updatedImportPath);
        hasChanges = true;
      }

      if (CONFIG.verbose && hasChanges) {
        console.log(
          `  📝 ${filePath}: ${oldImportPath} → ${updatedImportPath}`
        );
      }
    }

    if (hasChanges) {
      await fs.writeFile(filePath, content, "utf8");
      return true;
    }

    return false;
  } catch (error) {
    console.error(
      `❌ Error updating ${filePath}:`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

/**
 * Display usage information
 */
function showUsage(): void {
  console.log(`
Usage: 
  Single file: npx tsx move-file.ts <old-path> <new-path> [options]
  Batch moves: npx tsx move-file.ts moves.json [options]

Options:
  --dry-run    Show what would be changed without making changes
  --verbose    Show detailed output

Examples:
  # Single file move
  npx tsx move-file.ts src/old/file.js src/new/file.js
  npx tsx move-file.ts src/components/Button.tsx src/ui/Button.tsx --dry-run
  
  # Batch moves from JSON file
  npx tsx move-file.ts file-moves.json --dry-run --verbose
  
JSON file format:
  [
    ["path/to/old/file1.ts", "path/to/new/file1.ts"],
    ["path/to/old/file2.ts", "path/to/new/file2.ts"]
  ]

Supported file types:
  JavaScript: .js, .jsx, .mjs
  TypeScript: .ts, .tsx
  Vue: .vue
  Svelte: .svelte
`);
}

// Main execution
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Check if there's a JSON file argument for batch moves
  const jsonFileArg = process.argv.find((arg) => arg.endsWith(".json"));

  if (jsonFileArg) {
    // Load moves from JSON file
    try {
      const movesContent = await fs.readFile(jsonFileArg, "utf8");
      const moves = JSON.parse(movesContent);

      if (
        !Array.isArray(moves) ||
        !moves.every(
          (move) =>
            Array.isArray(move) &&
            move.length === 2 &&
            typeof move[0] === "string" &&
            typeof move[1] === "string"
        )
      ) {
        throw new Error(
          "JSON file must contain an array of [fromPath, toPath] tuples"
        );
      }

      await moveFileAndUpdateImports(moves);
    } catch (error) {
      console.error(
        "❌ Error loading JSON file:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  } else {
    // Original command line interface for single moves
    const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

    if (args.length !== 2) {
      showUsage();
      process.exit(1);
    }

    const [oldPath, newPath] = args;
    await moveFileAndUpdateImports([[oldPath, newPath]]);
  }
}
