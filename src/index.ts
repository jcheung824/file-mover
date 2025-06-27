#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import fg from "fast-glob";

// Helpers, types, and config
import { ImportAnalysis, Config } from "./types";
import { generateImportPathVariations, findDependencyImports } from "./importUtils";
import { movePhysicalFile, updateImportsInFile, updateImportsInMovedFile } from "./fileOps";
import { removeExtension } from "./pathUtils";
import { MoveTracker, batchUpdateImports, analyzeImportsWithTracking } from "./performance/moveTracker";

// Types
interface TempArguments {
  cwd: string;
}

// App state to track information during this run, such as all before/after file move paths
interface AppState {
  fileMoves: [fromPath: string, toPath: string][];
  fileMoveMap: Map<string, string>;
  verbose: boolean;
  dryRun: boolean;
}

declare global {
  var appState: AppState;
}

globalThis.appState = {
  fileMoves: [],
  fileMoveMap: new Map(),
  verbose: process.argv.includes("--verbose"),
  dryRun: process.argv.includes("--dry-run"),
};

const TEMP_ARGUMENTS: TempArguments = {
  cwd: path.normalize("C:/Users/jamescheung/Desktop/Work/project/power-platform-ux"),
};

const INCLUDED_PACKAGE_FOLDERS = ["powerva-main", "powerva-embedded-experiences", "powerva-core"];

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
    "**/*.png",
    "**/*.txt",
    "**/*.jpg",
    "**/*.log",
    "**/*.html",
    "**/*.gif",
    "**/.eslintcache",
    "index.management.ts",
    "icon-index.ts"
  ],
  includedPackageFolders: INCLUDED_PACKAGE_FOLDERS,
  includedAppsFolders: INCLUDED_APPS_FOLDERS,
  includePatterns: INCLUDE_PATTERNS,
};

/**
 * Recursively get all files in a directory and their corresponding target paths
 */
async function getDirectoryMoves(sourceDir: string, targetDir: string): Promise<Array<[string, string]>> {
  const moves: Array<[string, string]> = [];
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      // Recursively get moves for subdirectories
      const subMoves = await getDirectoryMoves(sourcePath, targetPath);
      moves.push(...subMoves);
    } else {
      // Add file move
      moves.push([sourcePath, targetPath]);
    }
  }

  return moves;
}

/**
 * Main function to move multiple files and update all imports
 */
async function moveFileAndUpdateImports(moves: Array<[fromPath: string, toPath: string]>): Promise<void> {
  const tracker = new MoveTracker(globalThis.appState.verbose);
  tracker.startTotalTimer();
  
  // Expand directory moves into individual file moves
  const expandedMoves: Array<[string, string]> = [];
  for (const [fromPath, toPath] of moves) {
    try {
      console.log(`🔍 Checking path: ${fromPath}`);
      const stats = await fs.stat(fromPath);
      if (stats.isDirectory()) {
        console.log(`📁 Found directory: ${fromPath}, expanding into individual file moves`);
        const dirMoves = await getDirectoryMoves(fromPath, toPath);
        expandedMoves.push(...dirMoves);
      } else {
        expandedMoves.push([fromPath, toPath]);
      }
    } catch (error) {
      console.error(`❌ Error checking path ${fromPath}:`, error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }

  globalThis.appState.fileMoves = expandedMoves.map(([fromPath, toPath]) => [path.normalize(fromPath), path.normalize(toPath)]);
  globalThis.appState.fileMoveMap = new Map([
    ...globalThis.appState.fileMoves,
    ...globalThis.appState.fileMoves.map<[string, string]>((entry) => [
      removeExtension(entry[0]),
      removeExtension(entry[1]),
    ]),
  ]);

  console.log(`🚀 Starting batch move of ${expandedMoves.length} files`);

  // Normalize all paths in moves
  const normalizedMoves: Array<[string, string]> = expandedMoves.map(([from, to]) => [
    path.resolve(CONFIG.cwd, from),
    path.resolve(CONFIG.cwd, to),
  ]);

  // Validate all moves first
  tracker.startValidationTimer();
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
  tracker.endValidationTimer(normalizedMoves.length);

  // Find all files that might contain imports (do this once for all moves)
  tracker.startFileDiscoveryTimer();
  let sourceFiles = await findSourceFiles();
  // filter out files that are part of the move
  sourceFiles = sourceFiles.filter((file) => !globalThis.appState.fileMoveMap.has(file));
  tracker.endFileDiscoveryTimer(sourceFiles.length);
  
  console.log(`📁 Found ${sourceFiles.length} source files to check`);
  const deadFiles: string[] = [];

  // OPTIMIZATION: Pre-generate import path variations for all moves to avoid repeated computation
  const importPathCache = new Map<string, string[]>();
  tracker.startPrecomputeTimer();
  for (const [fromPath] of normalizedMoves) {
    const variations = generateImportPathVariations(fromPath, CONFIG);
    importPathCache.set(fromPath, variations);
  }
  tracker.endPrecomputeTimer();

  // Process each move
  tracker.startFileOpsTimer();
  for (let i = 0; i < normalizedMoves.length; i++) {
    const [fromPath, toPath] = normalizedMoves[i];
    console.log(`\n📦 Processing move ${i + 1}/${normalizedMoves.length}: ${fromPath} → ${toPath}`);

    const moveMetrics = {
      fromPath,
      toPath,
      analysisTime: 0,
      moveTime: 0,
      movedFileUpdateTime: 0,
      updateTime: 0,
      filesUpdated: 0,
      detailedAnalysis: {
        fileReadTime: 0,
        astParseTime: 0,
        importMatchingTime: 0,
        filesProcessed: 0,
        filesWithImports: 0,
      },
    };

    try {
      // Analyze current imports before moving
      tracker.startAnalysisTimer(i);
      
      // Clear previous file times to get accurate data for this move
      tracker.clearFileAnalysisTimes();
      
      const importAnalysis = await analyzeImportsWithTracking(sourceFiles, fromPath, importPathCache.get(fromPath)!, tracker);
      moveMetrics.analysisTime = tracker.endAnalysisTimer();
      moveMetrics.detailedAnalysis.filesProcessed = sourceFiles.length;
      moveMetrics.detailedAnalysis.filesWithImports = importAnalysis.length;
      
      // Get the timing data from this analysis
      const fileTimes = tracker.getFileAnalysisTimes();
      if (fileTimes.length > 0) {
        moveMetrics.detailedAnalysis.fileReadTime = fileTimes.reduce((sum: number, file: any) => sum + file.readTime, 0);
        moveMetrics.detailedAnalysis.astParseTime = fileTimes.reduce((sum: number, file: any) => sum + file.parseTime, 0);
        moveMetrics.detailedAnalysis.importMatchingTime = fileTimes.reduce((sum: number, file: any) => sum + file.matchTime, 0);
      }
      
      console.log(`🔍 Found ${importAnalysis.length} files importing this module`);

      if (globalThis.appState.dryRun) {
        console.log("🔍 DRY RUN MODE - No changes will be made for this file");
        console.log("Files that would be updated:");
        importAnalysis.forEach(({ file, imports }: { file: string; imports: any[] }) => {
          console.log(`  ${file}: ${imports.length} import(s)`);
          if (globalThis.appState.verbose) {
            imports.forEach((imp: any) => {
              console.log(`    Line ${imp.line}: ${imp.originalLine}`);
            });
          }
        });
        continue;
      }

      tracker.startMoveTimer(i);
      await movePhysicalFile(fromPath, toPath);
      moveMetrics.moveTime = tracker.endMoveTimer();

      // TODO: If we want to let the user know files are dead, we have to return update infor of 
      // the moved files 
      tracker.startUpdateMovedFileTimer(i);
      await updateImportsInMovedFile(fromPath, toPath);
      const movedFileUpdateTime = tracker.endUpdateMovedFileTimer();
      moveMetrics.movedFileUpdateTime = movedFileUpdateTime;

      // OPTIMIZATION: Batch update all imports in other files
      tracker.startUpdateTimer(i);
      const updatedFiles = await batchUpdateImports(importAnalysis, toPath, CONFIG, tracker);
      moveMetrics.updateTime = tracker.endUpdateTimer();
      moveMetrics.filesUpdated = updatedFiles;

      if (updatedFiles > 0) {
        console.log(`✅ Successfully moved file and updated ${updatedFiles} files`);
      } else {
        console.log(`⚠️  This file might not have any usage. Double check if needed`);
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

    tracker.addMoveMetrics(moveMetrics);
  }
  tracker.endFileOpsTimer();

  tracker.setTotalTime();

  console.log(`\n🎉 Batch move completed! Processed ${normalizedMoves.length} files.`);
  if (deadFiles.length > 0) {
    console.log(`⚠️  Found ${deadFiles.length} files that may or may not have any usage:`);
    deadFiles.forEach((file) => console.log(`  - ${file}`));
  }

  // Print performance summary
  await tracker.printSummary();
}

/**
 * Validate that the move operation is valid
 * @description oldPath - validate that the old path is a file or directory and if the new path file exists, throw an error
 * @description newPath - validate that the new path is a file or directory and if the old path file exists, throw an error. Create the new path if it doesn't exist.
 */
async function validateInputs(oldPath: string, newPath: string): Promise<void> {
  try {
    const stats = await fs.stat(oldPath);
    if (!stats.isFile() && !stats.isDirectory()) {
      throw new Error(`Source path is neither a file nor a directory: ${oldPath}`);
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Source path does not exist: ${oldPath}`);
  }

  try {
    const stats = await fs.stat(newPath);
    if (stats.isFile()) {
      throw new Error(`Destination file already exists: ${newPath}`);
    }
    // Allow directory to exist - we'll be adding files to it
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code !== "ENOENT") {
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
  if (globalThis.appState.verbose) {
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
  npx tsx move-file.ts file-movers.json --dry-run --verbose
  
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

// Export the main functionality for programmatic use
export { moveFileAndUpdateImports };

// Main execution
async function main() {
  // Check if there's a JSON file argument for batch moves
  try {
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
              Array.isArray(move) && move.length === 2 && typeof move[0] === "string" && typeof move[1] === "string"
          )
        ) {
          throw new Error("JSON file must contain an array of [fromPath, toPath] tuples");
        }

        await moveFileAndUpdateImports(moves);
      } catch (error) {
        console.error("❌ Error loading JSON file:", error instanceof Error ? error.message : String(error));
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
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run the main function if this file is being executed directly
if (process.argv[1]?.includes("file-mover") || process.argv[0]?.includes("node")) {
  main().catch((error) => {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
