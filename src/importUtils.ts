// Import analysis and import statement finding logic
import { ImportInfo, Config, FileDirection } from "./types.js";
import {
  normalizePath,
  removeExtension,
  getMsImportPath,
  resolveImportPath,
  getModuleType,
  handleMonoRepoImportPathToAbsolutePath,
} from "./pathUtils.js";
import { parse } from "@babel/parser";
import traverseModule, { NodePath } from "@babel/traverse";
import { CallExpression, ExportAllDeclaration, ExportNamedDeclaration, ImportDeclaration } from "@babel/types";
import path from "path";

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
export const extractImportInfo = (pathNode: NodePath, content: string, importPath: string): ImportInfo => {
  return {
    line: pathNode.node.loc?.start.line || 0,
    originalLine:
      content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() || "",
    importPath,
    matchedText: pathNode.toString(),
  };
};

export const generateImportPathVariations = (targetPath: string, config: Config): string[] => {
  const normalized = path.resolve(targetPath);
  const withoutExt = removeExtension(normalized);
  const paths = new Set<string>();
  paths.add(normalizePath(normalized));
  paths.add(normalizePath(withoutExt));
  const msImportPath = getMsImportPath(normalized);
  if (msImportPath) {
    paths.add(msImportPath);
  }
  const relativeToCwd = path.relative(config.cwd, normalized);
  const relativeToCwdWithoutExt = removeExtension(relativeToCwd);
  paths.add(normalizePath(relativeToCwd));
  paths.add(normalizePath(relativeToCwdWithoutExt));
  return Array.from(paths);
};

export const findDependencyImports = (arg: {
  content: string;
  targetImportPaths: string[];
  currentFile: string;
}): ImportInfo[] => {
  const { content, targetImportPaths, currentFile } = arg;
  const imports: ImportInfo[] = [];
  let ast;
  try {
    ast = parse(content, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx", "decorators-legacy", "classProperties", "dynamicImport"],
    });
  } catch (e) {
    if (globalThis.appState.verbose) {
      console.warn(`⚠️  Could not parse ${currentFile}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return imports;
  }
  traverse(ast, {
    ImportDeclaration: (pathNode: NodePath<ImportDeclaration>) => {
      const importPath = pathNode.node.source?.value;
      if (typeof importPath === "string" && matchesTarget({ importPath, targetImportPaths, currentFile })) {
        imports.push(extractImportInfo(pathNode, content, importPath));
      }
    },
    ExportAllDeclaration: (pathNode: NodePath<ExportAllDeclaration>) => {
      const importPath = pathNode.node.source?.value;
      if (typeof importPath === "string" && matchesTarget({ importPath, targetImportPaths, currentFile })) {
        imports.push(extractImportInfo(pathNode, content, importPath));
      }
    },
    ExportNamedDeclaration: (pathNode: NodePath<ExportNamedDeclaration>) => {
      const importPath = pathNode.node.source?.value;
      if (typeof importPath === "string" && matchesTarget({ importPath, targetImportPaths, currentFile })) {
        imports.push(extractImportInfo(pathNode, content, importPath));
      }
    },
    CallExpression: (pathNode: NodePath<CallExpression>) => {
      const callee = pathNode.node.callee;
      if ((callee.type === "Identifier" && callee.name === "require") || callee.type === "Import") {
        const arg0 = pathNode.node.arguments[0];
        if (arg0 && arg0.type === "StringLiteral") {
          const importPath = arg0.value;
          if (matchesTarget({ importPath, targetImportPaths, currentFile })) {
            imports.push(extractImportInfo(pathNode, content, importPath));
          }
        }
      }
    },
  });
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
  importPath,
  targetImportPaths,
  currentFile,
}: {
  importPath: string;
  targetImportPaths: string[];
  currentFile: string;
}): boolean => {
  if (targetImportPaths.includes(importPath)) {
    return true;
  }

  const resolvedPath = resolveImportPath(currentFile, importPath);
  const resolvedPathWithoutExt = removeExtension(resolvedPath);
  return targetImportPaths.some(
    (targetPath) =>
      normalizePath(resolvedPath) === targetPath ||
      normalizePath(resolvedPathWithoutExt) === targetPath ||
      normalizePath(resolvedPath) === removeExtension(targetPath) ||
      normalizePath(resolvedPathWithoutExt) === removeExtension(targetPath)
  );
};

export const createImportStatementRegexPatterns = (
  importPath: string
): { quotedPattern: RegExp; unquotedPattern: RegExp } => {
  const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileNameWithoutExt = path.basename(importPath, path.extname(importPath));
  const quotedPattern = new RegExp(`(['"\`])${escapeRegex(importPath)}\\1`, "g");
  const unquotedPattern = new RegExp(`\\b${escapeRegex(fileNameWithoutExt)}\\b`, "g");
  return { quotedPattern, unquotedPattern };
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

  const { quotedPattern, unquotedPattern } = createImportStatementRegexPatterns(currentImportPath);

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

  const updatedContent =
    setFileContentIfRegexMatches(fileContent, quotedPattern, `$1${updatedImportPath}$1`) ??
    setFileContentIfRegexMatches(fileContent, unquotedPattern, updatedImportPath);

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

  const { quotedPattern, unquotedPattern } = createImportStatementRegexPatterns(importPath);

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

  const updatedContent =
    setFileContentIfRegexMatches(fileContent, quotedPattern, `$1${updatedImportPath}$1`) ??
    setFileContentIfRegexMatches(fileContent, unquotedPattern, updatedImportPath);

  return {
    updated: !!updatedContent,
    updatedFileContent: updatedContent || fileContent,
    updatedImportPath,
  };
};
