// Import analysis and import statement finding logic
import { ImportInfo, Config } from "./types.js";
import { normalizePath, removeExtension, getMsImportPath, resolveImportPath } from "./pathUtils.js";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import path from "path";
const traverse = (traverseModule as any).default || traverseModule;

export function generateTargetImportPaths(targetPath: string, config: Config): string[] {
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
}

export function findImportStatements(arg: {
  content: string;
  targetImportPaths: string[];
  currentFile: string;
  config: Config;
}): ImportInfo[] {
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
    ImportDeclaration(pathNode: any) {
      const importPath = pathNode.node.source.value;
      if (
        typeof importPath === "string" &&
        matchesTarget(importPath, targetImportPaths, currentFile, config)
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
        matchesTarget(importPath, targetImportPaths, currentFile, config)
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
        matchesTarget(importPath, targetImportPaths, currentFile, config)
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
      const callee = pathNode.node.callee;
      if (
        (callee.type === "Identifier" && callee.name === "require") ||
        callee.type === "Import"
      ) {
        const arg0 = pathNode.node.arguments[0];
        if (arg0 && arg0.type === "StringLiteral") {
          const importPath = arg0.value;
          if (matchesTarget(importPath, targetImportPaths, currentFile, config)) {
            imports.push({
              line: pathNode.node.loc?.start.line || 0,
              originalLine:
                content.split("\n")[pathNode.node.loc?.start.line - 1]?.trim() ||
                "",
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

export function matchesTarget(
  importPath: string,
  targetImportPaths: string[],
  currentFile: string,
  config: Config
): boolean {
  if (targetImportPaths.includes(importPath)) {
    return true;
  }
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
