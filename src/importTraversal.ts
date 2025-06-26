import { promises as fs } from "fs";
import path from "path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { ImportInfo } from "./types";
import { normalizePath } from "./pathUtils";
import { NodePath } from "@babel/traverse";
import { CallExpression, ExportAllDeclaration, ExportNamedDeclaration, ImportDeclaration } from "@babel/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;

export interface ImportUpdateResult {
  hasChanges: boolean;
  updatedContent: string;
  imports: ImportInfo[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function parseFileContent(filePath: string): Promise<{ ast: any; content: string } | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const ast = parse(content, {
      sourceType: "unambiguous",
      plugins: ["typescript", "jsx", "decorators-legacy", "classProperties", "dynamicImport"],
    });
    return { ast, content };
  } catch (e) {
    if (globalThis.appState.verbose) {
      console.warn(`⚠️  Could not parse file ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findRelativeImports(ast: any, content: string): ImportInfo[] {
  const relativeImports: ImportInfo[] = [];

  traverse(ast, {
    ImportDeclaration(pathNode) {
      const importPath = pathNode.node.source.value;
      if (typeof importPath === "string" && (importPath.startsWith("./") || importPath.startsWith("../"))) {
        relativeImports.push(createImportInfo(pathNode, content, importPath));
      }
    },
    ExportAllDeclaration(pathNode) {
      const importPath = pathNode.node.source?.value;
      if (typeof importPath === "string" && (importPath.startsWith("./") || importPath.startsWith("../"))) {
        relativeImports.push(createImportInfo(pathNode, content, importPath));
      }
    },
    ExportNamedDeclaration(pathNode) {
      const importPath = pathNode.node.source?.value;
      if (typeof importPath === "string" && (importPath.startsWith("./") || importPath.startsWith("../"))) {
        relativeImports.push(createImportInfo(pathNode, content, importPath));
      }
    },
    CallExpression(pathNode) {
      const callee = pathNode.node.callee;
      if ((callee.type === "Identifier" && callee.name === "require") || callee.type === "Import") {
        const arg0 = pathNode.node.arguments[0];
        if (arg0 && arg0.type === "StringLiteral") {
          const importPath = arg0.value;
          if (typeof importPath === "string" && (importPath.startsWith("./") || importPath.startsWith("../"))) {
            relativeImports.push(createImportInfo(pathNode, content, importPath));
          }
        }
      }
    },
  });

  return relativeImports;
}

function createImportInfo(
  pathNode: NodePath<ImportDeclaration | ExportAllDeclaration | ExportNamedDeclaration | CallExpression>,
  content: string,
  importPath: string
): ImportInfo {
  return {
    line: pathNode.node.loc?.start.line || 0,
    originalLine:
      content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() || "",
    importPath,
    matchedText: pathNode.toString(),
  };
}

export function updateImportPaths(
  content: string,
  imports: ImportInfo[],
  oldFileDir: string,
  newFileDir: string
): ImportUpdateResult {
  let updatedContent = content;
  let hasChanges = false;

  for (const importInfo of imports) {
    const oldImportPath = importInfo.importPath;
    const oldResolvedPath = path.resolve(oldFileDir, oldImportPath);
    let newRelativePath = normalizePath(path.relative(newFileDir, oldResolvedPath));

    if (!newRelativePath.startsWith("../") && !newRelativePath.startsWith("./")) {
      newRelativePath = `./${newRelativePath}`;
    }

    if (oldImportPath !== newRelativePath) {
      const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const quotedPattern = new RegExp(`(['"\`])${escapeRegex(oldImportPath)}\\1`, "g");

      if (quotedPattern.test(updatedContent)) {
        updatedContent = updatedContent.replace(quotedPattern, `$1${newRelativePath}$1`);
        hasChanges = true;
        if (globalThis.appState.verbose) {
          console.log(`    📝 Updated import: ${oldImportPath} → ${newRelativePath}`);
        }
      }
    }
  }

  return { hasChanges, updatedContent, imports };
}

export async function writeFileIfChanged(filePath: string, content: string, hasChanges: boolean): Promise<boolean> {
  if (hasChanges) {
    await fs.writeFile(filePath, content, "utf8");
    if (globalThis.appState.verbose) {
      console.log(`  ✅ Updated file: ${filePath}`);
    }
    return true;
  }
  return false;
}
