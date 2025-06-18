// Import analysis and import statement finding logic
import { ImportInfo, Config, FileDirection } from "./types.js";
import { normalizePath, removeExtension, getMsImportPath, resolveImportPath } from "./pathUtils.js";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import path from "path";
const traverse = (traverseModule as any).default || traverseModule;

export const isRelativeImport = (importPath: string): boolean =>
  typeof importPath === "string" &&
  (importPath.startsWith("./") || importPath.startsWith("../"));

// Helper function to check if import path is a monorepo package import
export const isMonorepoPackageImport = (importPath: string): boolean =>
  typeof importPath === "string" && importPath.startsWith("@ms/");


// Helper function to determine if a path is in packages or apps folder
export const getPathType = ({ filePath, includedPackageFolders, includedAppsFolders }: { filePath: string, includedPackageFolders: string[], includedAppsFolders: string[] }): 'package' | 'app' | 'unknown' => {
  const normalizedPath = filePath.replace(/\\/g, '/');

  for (const packageFolder of includedPackageFolders) {
    if (normalizedPath.includes(`packages/${packageFolder}`)) {
      return 'package';
    }
  }

  for (const appFolder of includedAppsFolders) {
    if (normalizedPath.includes(`apps/${appFolder}`)) {
      return 'app';
    }
  }

  return 'unknown';
}

// Helper function to extract imports from AST node
export const extractImportInfo = (pathNode: any, content: string, importPath: string): ImportInfo => {
  return {
    line: pathNode.node.loc?.start.line || 0,
    originalLine: content.split("\n")[
      pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0
    ]?.trim() || "",
    importPath,
    matchedText: pathNode.toString(),
  };
}

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
  config: Config;
}): ImportInfo[] => {
  const { content, targetImportPaths, currentFile, config } = arg;
  const imports: ImportInfo[] = [];
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
    if (config.verbose) {
      console.warn(
        `⚠️  Could not parse ${currentFile}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    return imports;
  }
  traverse(ast, {
    ImportDeclaration: (pathNode: any) => {
      const importPath = pathNode.node.source.value;
      if (
        typeof importPath === "string" &&
        matchesTarget({ importPath, targetImportPaths, currentFile })
      ) {
        imports.push(extractImportInfo(pathNode, content, importPath));
      }
    },
    ExportAllDeclaration: (pathNode: any) => {
      const importPath = pathNode.node.source?.value;
      if (
        typeof importPath === "string" &&
        matchesTarget({ importPath, targetImportPaths, currentFile })
      ) {
        imports.push(extractImportInfo(pathNode, content, importPath));
      }
    },
    ExportNamedDeclaration: (pathNode: any) => {
      const importPath = pathNode.node.source?.value;
      if (
        typeof importPath === "string" &&
        matchesTarget({ importPath, targetImportPaths, currentFile })
      ) {
        imports.push(extractImportInfo(pathNode, content, importPath));
      }
    },
    CallExpression: (pathNode: any) => {
      const callee = pathNode.node.callee;
      if (
        (callee.type === "Identifier" && callee.name === "require") ||
        callee.type === "Import"
      ) {
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



export const fileMoveDirection = ({ oldPath, newPath, includedPackageFolders, includedAppsFolders }: { oldPath: string, newPath: string, includedPackageFolders: string[], includedAppsFolders: string[] }): FileDirection => {
  const oldPathType = getPathType({ filePath: oldPath, includedPackageFolders, includedAppsFolders });
  const newPathType = getPathType({ filePath: newPath, includedPackageFolders, includedAppsFolders });

  if (oldPathType === newPathType) {
    return 'self';
  }
  else if (oldPathType === 'package' && newPathType === 'app') {
    return 'packageToApp';
  }
  // This logic needs to be improved
  else if (oldPathType !== newPathType) {
    return 'betweenPackages';
  }
  console.warn(`⚠️  Could not determine file move direction for ${oldPath} → ${newPath}`);
  return 'unknown';
}

export const getPackageParts = (path: string): { packageName: string, subPath: string } => {
  const normalizedPath = normalizePath(path);
  const matchGroups = normalizedPath.match(/packages\/([^/]+)\/src\/(.*)$/);
  if (matchGroups) {
    return { packageName: matchGroups[1], subPath: matchGroups[2] };
  }
  console.warn(`⚠️  Could not determine package name for ${path}`);
  return { packageName: "", subPath: "" };
}

export const updateSrcToLib = (path: string): string => {
  const matchGroups = path.match(/src\/(.*)$/);
  if (matchGroups) {
    return `lib/${matchGroups[1]}`;
  }
  return path;
}

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

export const createImportStatementRegexPatterns = (importPath: string): { quotedPattern: RegExp, unquotedPattern: RegExp } => {
  const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fileNameWithoutExt = path.basename(importPath, path.extname(importPath));
  const quotedPattern = new RegExp(`(['"\`])${escapeRegex(importPath)}\\1`, "g");
  const unquotedPattern = new RegExp(`\\b${escapeRegex(fileNameWithoutExt)}\\b`, "g");
  return { quotedPattern, unquotedPattern };
};

export const isFromDifferentPackage = (importPath: string, incomingImportPath: string): boolean => {
  const { packageName: importPackageName } = getPackageParts(importPath);
  const { packageName: incomingImportPackageName } = getPackageParts(incomingImportPath);
  return importPackageName !== incomingImportPackageName;
}

export const setFileContentIfRegexMatches = (fileContent: string, regex: RegExp, replacement: string): string | null => {
  if (regex.test(fileContent)) {
    return fileContent.replace(regex, replacement);
  }
  return null;
}

export const handlePackageImportsUpdate = ({ config, currentImportPath, currentFilePath, newPath, fileContent }:
  { currentImportPath: string, currentFilePath: string, newPath: string, config: Config, fileContent: string, imports: ImportInfo[]; }): { updated: boolean, updatedFileContent: string, updatedImportPath: string } => {
  const fileDirection = fileMoveDirection({ oldPath: currentFilePath, newPath, includedPackageFolders: config.includedPackageFolders, includedAppsFolders: config.includedAppsFolders });
  let updatedImportPath: string = "";
  let updated: boolean = false;
  let newRelativePath = normalizePath(path.relative(currentFilePath, newPath));
  // Avoid bare import
  if (!newRelativePath.startsWith("../") && !newRelativePath.startsWith("./")) {
    newRelativePath = `./${newRelativePath}`;
  }

  const { quotedPattern, unquotedPattern } = createImportStatementRegexPatterns(currentImportPath);

  if (fileDirection === 'self') {
    updatedImportPath = newRelativePath;
  } else if (fileDirection === 'betweenPackages') {
    updatedImportPath = getMsImportPath(newPath);
  } else {
    console.warn(`⚠️  Currently not supported: ${currentFilePath} → ${newPath}`);
    return { updated, updatedFileContent: fileContent, updatedImportPath };
  }

  // Try quoted pattern first, then unquoted pattern
  const updatedContent = setFileContentIfRegexMatches(fileContent, quotedPattern, `$1${updatedImportPath}$1`)
    ?? setFileContentIfRegexMatches(fileContent, unquotedPattern, updatedImportPath);

  return {
    updated: !!updatedContent,
    updatedFileContent: updatedContent || fileContent,
    updatedImportPath
  };
}