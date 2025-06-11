#!/usr/bin/env node
import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";
import fg from "fast-glob";
import { generateTargetImportPaths, findImportStatements, } from "./src/importUtils.js";
import { movePhysicalFile, updateImportsInFile, updateImportsInMovedFile, } from "./src/fileOps.js";
const TEMP_ARGUMENTS = {
    cwd: path.normalize("C:/Users/jamescheung/Desktop/Work/project/power-platform-ux"),
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
const CONFIG = {
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
 * Main function to move multiple files and update all imports
 */
async function moveFileAndUpdateImports(moves) {
    console.log(`🚀 Starting batch move of ${moves.length} files`);
    // Normalize all paths in moves
    const normalizedMoves = moves.map(([from, to]) => [
        path.resolve(from),
        path.resolve(to),
    ]);
    // Validate all moves first
    console.log("🔍 Validating all moves...");
    for (const [fromPath, toPath] of normalizedMoves) {
        try {
            await validateInputs(fromPath, toPath);
        }
        catch (error) {
            console.error(`❌ Validation failed for ${fromPath} → ${toPath}:`);
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    }
    // Find all files that might contain imports (do this once for all moves)
    const sourceFiles = await findSourceFiles();
    console.log(`📁 Found ${sourceFiles.length} source files to check`);
    const deadFiles = [];
    // Process each move
    for (let i = 0; i < normalizedMoves.length; i++) {
        const [fromPath, toPath] = normalizedMoves[i];
        console.log(`\n📦 Processing move ${i + 1}/${normalizedMoves.length}: ${fromPath} → ${toPath}`);
        try {
            // Analyze current imports before moving
            const importAnalysis = await analyzeImports(sourceFiles, fromPath);
            console.log(`🔍 Found ${importAnalysis.length} files importing this module`);
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
            await updateImportsInMovedFile(fromPath, toPath, CONFIG);
            // Update all imports in other files
            let updatedFiles = 0;
            for (const { file, imports } of importAnalysis) {
                const updated = await updateImportsInFile(file, imports, fromPath, toPath, CONFIG);
                if (updated)
                    updatedFiles++;
            }
            if (updatedFiles > 0) {
                console.log(`✅ Successfully moved file and updated ${updatedFiles} files`);
            }
            else {
                console.log(`⚠️  No file usage found in other files.`);
                deadFiles.push(fromPath);
            }
        }
        catch (error) {
            console.error(`❌ Error processing move ${fromPath} → ${toPath}:`, error instanceof Error ? error.message : String(error));
            // Continue with other moves instead of exiting
            continue;
        }
    }
    console.log(`\n🎉 Batch move completed! Processed ${normalizedMoves.length} files.`);
    if (deadFiles.length > 0) {
        console.log(`⚠️  Found ${deadFiles.length} files that were moved but not used in any other files:`);
        deadFiles.forEach((file) => console.log(`  - ${file}`));
        console.log(`Consider removing these files if they are no longer needed.`);
    }
}
/**
 * Validate that the move operation is valid
 */
async function validateInputs(oldPath, newPath) {
    try {
        await fs.access(oldPath);
    }
    catch {
        throw new Error(`Source file does not exist: ${oldPath}`);
    }
    try {
        await fs.access(newPath);
        throw new Error(`Destination file already exists: ${newPath}`);
    }
    catch (error) {
        if (error &&
            typeof error === "object" &&
            "code" in error &&
            error.code !== "ENOENT") {
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
async function findSourceFiles() {
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
async function analyzeImports(sourceFiles, targetPath) {
    const results = [];
    if (CONFIG.verbose) {
        console.log(`🔍 Analyzing imports for target: ${targetPath}`);
    }
    // Generate all possible import paths for this target
    const targetImportPaths = generateTargetImportPaths(targetPath, CONFIG);
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
                config: CONFIG,
            });
            if (CONFIG.verbose) {
                console.log(`📂 Analyzing ${file}: ${imports.length} import(s) found`);
            }
            if (imports.length > 0) {
                results.push({ file, imports });
            }
        }
        catch (error) {
            if (CONFIG.verbose) {
                console.warn(`⚠️  Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }
    return results;
}
/**
 * Display usage information
 */
function showUsage() {
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
            if (!Array.isArray(moves) ||
                !moves.every((move) => Array.isArray(move) &&
                    move.length === 2 &&
                    typeof move[0] === "string" &&
                    typeof move[1] === "string")) {
                throw new Error("JSON file must contain an array of [fromPath, toPath] tuples");
            }
            await moveFileAndUpdateImports(moves);
        }
        catch (error) {
            console.error("❌ Error loading JSON file:", error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    }
    else {
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
