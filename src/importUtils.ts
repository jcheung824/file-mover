// Import analysis and import statement finding logic
import { ImportInfo, Config, FileDirection, InvertedImportPathCache } from "./types.js";
import {
  normalizePath,
  removeExtension,
  getMsImportPath,
  resolveImportPath,
  getModuleType,
  handleMonoRepoImportPathToAbsolutePath,
  isIndexFile,
} from "./pathUtils.js";
import { parse } from "@babel/parser";
import traverseModule, { NodePath } from "@babel/traverse";
import { CallExpression, ExportAllDeclaration, ImportDeclaration } from "@babel/types";
import path from "path";
import { getPerformance } from "./performance/moveTracker";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse = (traverseModule as any).default || traverseModule;

export const isRelativeImport = (importPath: string): boolean =>
  typeof importPath === "string" && (importPath.startsWith("./") || importPath.startsWith("../"));

// Helper function to check if import path is a monorepo package import
export const isMonorepoPackageImport = (importPath: string): boolean =>
  typeof importPath === "string" && importPath.startsWith("@ms/");

export const getRelativeImportPath = (fromFile: string, toFile: string) => {
  let relativePath = normalizePath(path.relative(path.dirname(fromFile), path.dirname(toFile)));

  if (!relativePath) {
    relativePath = ".";
  }

  const ext = path.extname(toFile);
  let fileName = path.basename(toFile);

  // Keep extension such as .png so that it'd remain valid import path
  if (ext === ".ts" || ext === ".tsx") {
    fileName = path.basename(toFile, ext);
  }

  if (relativePath === ".") {
    return `./${fileName}`;
  } else {
    return `${relativePath}/${fileName}`;
  }
};

export const checkIfFileIsPartOfMove = (filePath: string): boolean => globalThis.appState.fileMoveMap.has(filePath);

// Helper function to extract imports from AST node
export const extractImportInfo = ({
  pathNode,
  content,
  importPath,
  matchedUpdateToFilePath,
}: {
  pathNode: NodePath;
  content: string;
  importPath: string;
  matchedUpdateToFilePath: string;
}): ImportInfo => {
  return {
    line: pathNode.node.loc?.start.line || 0,
    originalLine:
      content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() || "",
    importPath,
    matchedText: pathNode.toString(),
    matchedUpdateToFilePath,
  };
};

export const generateImportPathVariations = (targetPath: string, config: Config): string[] => {
  const normalized = path.resolve(targetPath);
  const paths = new Set<string>();

  // Check if this is an index file
  const isIndexFileResult = isIndexFile(normalized);

  // Helper function to add path variations (with and without extension)
  const addPathVariations = (basePath: string) => {
    const withoutExt = removeExtension(basePath);
    paths.add(normalizePath(basePath));
    paths.add(normalizePath(withoutExt));

    // Add directory variations if this is an index file
    if (isIndexFileResult) {
      const dirPath = path.dirname(basePath);
      const dirPathWithoutExt = removeExtension(dirPath);
      paths.add(normalizePath(dirPath));
      paths.add(normalizePath(dirPathWithoutExt));
    }
  };

  // Add variations for absolute path
  addPathVariations(normalized);

  // Handle MS import path
  const msImportPath = getMsImportPath(normalized);
  if (msImportPath) {
    paths.add(msImportPath);

    // Add directory-based MS import path variations
    if (isIndexFileResult) {
      const msDirPath = msImportPath.replace(/\/index$/, "");
      if (msDirPath !== msImportPath) {
        paths.add(msDirPath);
      }
    }
  }

  // Add variations for relative to CWD path
  const relativeToCwd = path.relative(config.cwd, normalized);
  addPathVariations(relativeToCwd);

  return Array.from(paths);
};

// Cache for parsed ASTs to avoid re-parsing the same files
const astCache = new Map<string, unknown>();

// Make cache globally accessible for metrics
declare global {
  var astCache: Map<string, unknown>;
}
globalThis.astCache = astCache;

export const findDependencyImports = (arg: {
  content: string;
  targetImportPaths: InvertedImportPathCache;
  currentFile: string;
}): ImportInfo[] => {
  const { content, targetImportPaths, currentFile } = arg;
  const imports: ImportInfo[] = [];

  // Performance tracking
  const perf = getPerformance(globalThis.appState.verbose);
  const readTimer = perf.startTimer(`File read: ${currentFile}`);
  const parseTimer = perf.startTimer(`AST parse: ${currentFile}`);
  const matchTimer = perf.startTimer(`Import match: ${currentFile}`);

  // OPTIMIZATION: Check if we have a cached AST for this file
  let ast = astCache.get(currentFile);

  // Track cache performance
  perf.trackCacheLookup();

  if (!ast) {
    try {
      ast = parse(content, {
        sourceType: "unambiguous",
        plugins: ["typescript", "jsx", "decorators-legacy", "classProperties", "dynamicImport"],
      });
      // Cache the AST for potential reuse
      astCache.set(currentFile, ast);
    } catch (e) {
      if (globalThis.appState.verbose) {
        console.warn(`⚠️  Could not parse ${currentFile}: ${e instanceof Error ? e.message : String(e)}`);
      }
      // End timers even on error
      readTimer.end();
      parseTimer.end();
      matchTimer.end();
      return imports;
    }
  } else {
    // Cache hit
    perf.trackCacheHit("ast");
  }

  const parseTime = parseTimer.end();

  traverse(ast, {
    ImportDeclaration: (pathNode: NodePath<ImportDeclaration>) => {
      const importPath = pathNode.node.source?.value;
      const matchedUpdateToFilePath = matchesTarget({ importPath, targetImportPaths, currentFile });
      if (typeof importPath === "string" && matchedUpdateToFilePath) {
        imports.push(extractImportInfo({ pathNode, content, importPath, matchedUpdateToFilePath }));
      }
    },
    ExportAllDeclaration: (pathNode: NodePath<ExportAllDeclaration>) => {
      const importPath = pathNode.node.source?.value;
      const matchedUpdateToFilePath = matchesTarget({ importPath, targetImportPaths, currentFile });
      if (typeof importPath === "string" && matchedUpdateToFilePath) {
        imports.push(extractImportInfo({ pathNode, content, importPath, matchedUpdateToFilePath }));
      }
    },
    CallExpression: (pathNode: NodePath<CallExpression>) => {
      const callee = pathNode.node.callee;

      // Handle require() calls
      if (callee.type === "Identifier" && callee.name === "require") {
        const arg0 = pathNode.node.arguments[0];
        if (arg0 && arg0.type === "StringLiteral") {
          const importPath = arg0.value;
          const matchedUpdateToFilePath = matchesTarget({ importPath, targetImportPaths, currentFile });
          if (typeof importPath === "string" && matchedUpdateToFilePath) {
            imports.push(extractImportInfo({ pathNode, content, importPath, matchedUpdateToFilePath }));
          }
        }
      }

      // Handle dynamic import() calls
      if (callee.type === "Import") {
        const arg0 = pathNode.node.arguments[0];
        if (arg0 && arg0.type === "StringLiteral") {
          const importPath = arg0.value;
          const matchedUpdateToFilePath = matchesTarget({ importPath, targetImportPaths, currentFile });
          if (typeof importPath === "string" && matchedUpdateToFilePath) {
            imports.push(extractImportInfo({ pathNode, content, importPath, matchedUpdateToFilePath }));
          }
        }
      }

      // Handle jest.mock() calls
      if (
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.object.name === "jest" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "mock" &&
        pathNode.node.arguments.length > 0 &&
        pathNode.node.arguments[0].type === "StringLiteral"
      ) {
        const importPath = pathNode.node.arguments[0].value;
        const matchedUpdateToFilePath = matchesTarget({ importPath, targetImportPaths, currentFile });
        if (typeof importPath === "string" && matchedUpdateToFilePath) {
          imports.push(extractImportInfo({ pathNode, content, importPath, matchedUpdateToFilePath }));
        }
      }

      // Handle Loadable() calls with dynamic imports
      if (callee.type === "Identifier" && callee.name === "Loadable") {
        // Look for dynamic import() calls within the Loadable arguments
        pathNode.traverse({
          CallExpression: (nestedPathNode) => {
            const nestedCallee = nestedPathNode.node.callee;
            if (nestedCallee.type === "Import") {
              const arg0 = nestedPathNode.node.arguments[0];
              if (arg0 && arg0.type === "StringLiteral") {
                const importPath = arg0.value;
                const matchedUpdateToFilePath = matchesTarget({ importPath, targetImportPaths, currentFile });
                if (typeof importPath === "string" && matchedUpdateToFilePath) {
                  imports.push(
                    extractImportInfo({ pathNode: nestedPathNode, content, importPath, matchedUpdateToFilePath })
                  );
                }
              }
            }
          },
        });
      }
    },
  });

  const readTime = readTimer.end();
  const matchTime = matchTimer.end();

  // Track detailed file analysis timing
  perf.trackFileAnalysis(currentFile, readTime, parseTime, matchTime, imports.length);

  return imports;
};

export const fileMoveDirection = ({ oldPath, newPath }: { oldPath: string; newPath: string }): FileDirection => {
  const oldModuleType = getModuleType(oldPath);
  const newModuleType = getModuleType(newPath);

  if (oldModuleType.moduleType === newModuleType.moduleType && oldModuleType.moduleName === newModuleType.moduleName) {
    return "self";
  } else if (oldModuleType.moduleType === "packages" && newModuleType.moduleType === "apps") {
    console.warn(`⚠️  Could not determine file move direction for ${oldPath} → ${newPath}`);
    return "unknown";
  } else {
    return "betweenPackages";
  }
};

export const updateSrcToLib = (path: string): string => {
  const matchGroups = path.match(/src\/(.*)$/);
  if (matchGroups) {
    return `lib/${matchGroups[1]}`;
  }
  return path;
};

export const matchesTarget = ({
  currentFile,
  importPath,
  targetImportPaths,
}: {
  currentFile: string;
  importPath: string;
  targetImportPaths: InvertedImportPathCache;
}): string | null => {
  // Track import path hits for reporting
  const currentCount = globalThis.appState.importPathHits.get(importPath) || 0;
  globalThis.appState.importPathHits.set(importPath, currentCount + 1);

  if (targetImportPaths.has(importPath)) {
    const newPath = globalThis.appState.fileMoveMap.get(targetImportPaths.get(importPath) || "");
    return newPath || null;
  }

  const resolvedPath = normalizePath(resolveImportPath(currentFile, importPath));
  if (targetImportPaths.has(resolvedPath)) {
    const newPath = globalThis.appState.fileMoveMap.get(targetImportPaths.get(resolvedPath) || "");
    return newPath || null;
  }
  // const resolvedPathWithoutExt = normalizePath(removeExtension(resolvedPath));
  // if (targetImportPaths.has(resolvedPathWithoutExt)) {
  //   const newPath = globalThis.appState.fileMoveMap.get(targetImportPaths.get(resolvedPathWithoutExt) || "");
  //   return newPath || null;
  // }

  return null;
};

//TODO: We shouldn't need to match with regex. We should be able to use the info from import analysis
// to directly match and update the import statement. Since pref is minimal, defer this to later.
export const createImportStatementRegexPatterns = (
  importPath: string
): {
  staticImportPattern: RegExp;
  dynamicImportPattern: RegExp;
  requirePattern: RegExp;
  jestMockPattern: RegExp;
  jestRequireMockPattern: RegExp;
} => {
  const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Static import: import ... from '...'
  const staticImportPattern = new RegExp(`from\\s+(['"\`])${escapeRegex(importPath)}\\1`, "g");

  // Dynamic import: import('...')
  const dynamicImportPattern = new RegExp(`import\\(\\s*(['"\`])${escapeRegex(importPath)}\\1\\s*\\)`, "g");

  // require('...')
  const requirePattern = new RegExp(`require\\(\\s*(['"\`])${escapeRegex(importPath)}\\1\\s*\\)`, "g");

  // jest.mock('...')
  const jestMockPattern = new RegExp(`jest\\.mock\\(\\s*(['"\`])${escapeRegex(importPath)}\\1\\s*,`, "g");

  // jest.requireMock('...')
  const jestRequireMockPattern = new RegExp(
    `jest\\.requireMock\\(\\s*(['"\`])${escapeRegex(importPath)}\\1\\s*\\)`,
    "g"
  );

  return { staticImportPattern, dynamicImportPattern, requirePattern, jestMockPattern, jestRequireMockPattern };
};

export const setFileContentIfRegexMatches = (
  fileContent: string,
  regex: RegExp,
  replacement: string
): string | null => {
  if (regex.test(fileContent)) {
    return fileContent.replace(regex, replacement);
  }
  return null;
};

// TODO: ideally we should just match the import path and update the import statement directly
// Helper function to apply all import path replacements
export const applyImportPathReplacements = (
  fileContent: string,
  importPath: string,
  updatedImportPath: string
): string | null => {
  const { staticImportPattern, dynamicImportPattern, requirePattern, jestMockPattern, jestRequireMockPattern } =
    createImportStatementRegexPatterns(importPath);

  return (
    setFileContentIfRegexMatches(fileContent, staticImportPattern, `from $1${updatedImportPath}$1`) ??
    setFileContentIfRegexMatches(fileContent, dynamicImportPattern, `import($1${updatedImportPath}$1)`) ??
    setFileContentIfRegexMatches(fileContent, requirePattern, `require($1${updatedImportPath}$1)`) ??
    setFileContentIfRegexMatches(fileContent, jestMockPattern, `jest.mock($1${updatedImportPath}$1,`) ??
    setFileContentIfRegexMatches(fileContent, jestRequireMockPattern, `jest.requireMock($1${updatedImportPath}$1)`)
  );
};

// This I should separate this into two functions from many to one and one to many
export const handlePackageImportsUpdate = ({
  currentImportPath,
  currentFilePath,
  newPath,
  fileContent,
}: {
  currentImportPath: string;
  currentFilePath: string;
  newPath: string;
  fileContent: string;
}): {
  updated: boolean;
  updatedFileContent: string;
  updatedImportPath: string;
} => {
  const fileDirection = fileMoveDirection({
    oldPath: currentFilePath,
    newPath,
  });

  let updatedImportPath: string = "";
  let updated: boolean = false;
  let newRelativePath = getRelativeImportPath(currentFilePath, newPath);

  // Avoid bare import
  if (!newRelativePath.startsWith("../") && !newRelativePath.startsWith("./")) {
    newRelativePath = `./${newRelativePath}`;
  }

  if (fileDirection === "self") {
    if (isMonorepoPackageImport(currentImportPath)) {
      updatedImportPath = getRelativeImportPath(
        currentFilePath,
        handleMonoRepoImportPathToAbsolutePath(currentFilePath, newPath)
      );
    } else {
      updatedImportPath = newRelativePath;
    }
  } else if (fileDirection === "betweenPackages") {
    if (isMonorepoPackageImport(newPath)) {
      updatedImportPath = currentImportPath;
    } else {
      updatedImportPath = getMsImportPath(newPath);
    }
  } else {
    // We can't import package from app. User Have to move other dependencies to the app as well.
    console.warn(`⚠️  Currently not supported: ${currentFilePath} → ${newPath}`);
    return { updated, updatedFileContent: fileContent, updatedImportPath };
  }

  // AST have walked through the file tree, we should just directly update over there
  // instead of search again

  const updatedContent = applyImportPathReplacements(fileContent, currentImportPath, updatedImportPath);

  return {
    updated: !!updatedContent,
    updatedFileContent: updatedContent || fileContent,
    updatedImportPath,
  };
};

export const handleMovingFileImportsUpdate = ({
  importPath,
  originalMovedFilePath,
  newMovedFilePath,
  fileContent,
}: {
  importPath: string;
  originalMovedFilePath: string;
  newMovedFilePath: string;
  fileContent: string;
}): {
  updated: boolean;
  updatedFileContent: string;
  updatedImportPath: string;
} => {
  const targetImportFileAbsPath = path.resolve(path.dirname(originalMovedFilePath), importPath);

  // Check if the imported file has been moved
  const importFilePath = checkIfFileIsPartOfMove(targetImportFileAbsPath)
    ? globalThis.appState.fileMoveMap.get(targetImportFileAbsPath) || targetImportFileAbsPath
    : isRelativeImport(importPath)
      ? targetImportFileAbsPath
      : importPath;

  const fileDirection = fileMoveDirection({
    oldPath: newMovedFilePath,
    newPath: importFilePath,
  });

  let updatedImportPath: string = "";
  let updated: boolean = false;
  let newRelativePath = getRelativeImportPath(newMovedFilePath, importFilePath);

  // Avoid bare import
  if (!newRelativePath.startsWith("../") && !newRelativePath.startsWith("./")) {
    newRelativePath = `./${newRelativePath}`;
  }

  if (fileDirection === "self") {
    if (isMonorepoPackageImport(importPath)) {
      updatedImportPath = getRelativeImportPath(
        newMovedFilePath,
        handleMonoRepoImportPathToAbsolutePath(newMovedFilePath, importFilePath)
      );
    } else {
      updatedImportPath = newRelativePath;
    }
  } else if (fileDirection === "betweenPackages") {
    if (isMonorepoPackageImport(importPath)) {
      updatedImportPath = importPath;
    } else {
      updatedImportPath = getMsImportPath(importPath);
    }
  } else {
    // We can't import package from app. User Have to move other dependencies to the app as well.
    console.warn(`⚠️  Currently not supported: ${originalMovedFilePath} → ${importPath}`);
    return { updated, updatedFileContent: fileContent, updatedImportPath };
  }

  // AST have walked through the file tree, we should just directly update over there
  // instead of search again

  const updatedContent = applyImportPathReplacements(fileContent, importPath, updatedImportPath);

  return {
    updated: !!updatedContent,
    updatedFileContent: updatedContent || fileContent,
    updatedImportPath,
  };
};
