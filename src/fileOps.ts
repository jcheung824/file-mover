// File operations for moving files and updating imports
import { promises as fs } from "fs";
import path from "path";
import { ImportInfo, Config } from "./types.js";
import { normalizePath, removeExtension, generateNewMsImportPath } from "./pathUtils.js";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;

export async function movePhysicalFile(oldPath: string, newPath: string): Promise<void> {
  console.log(`📦 Moving file: ${oldPath} → ${newPath}`);
  await fs.rename(oldPath, newPath);
}

export async function updateImportsInFile(
  filePath: string,
  imports: ImportInfo[],
  newPath: string,
  config: Config
): Promise<boolean> {
  try {
    let content = await fs.readFile(filePath, "utf8");
    let hasChanges = false;
    const newPathWithoutExt = removeExtension(newPath);
    const newMsPath = generateNewMsImportPath(newPath);
    const fileDir = path.dirname(filePath);
    let newRelativePath = normalizePath(path.relative(fileDir, newPathWithoutExt));
    if (!newRelativePath.startsWith("../") && !newRelativePath.startsWith("./")) {
      newRelativePath = `./${newRelativePath}`;
    }
    for (const importInfo of imports) {
      const oldImportPath = importInfo.importPath;
      let updatedImportPath: string;
      if (oldImportPath.startsWith("@ms/")) {
        updatedImportPath = newMsPath || newRelativePath;
      } else if (oldImportPath.startsWith("./") || oldImportPath.startsWith("../")) {
        updatedImportPath = newRelativePath;
      } else {
        updatedImportPath = newRelativePath;
      }
      const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const quotedPattern = new RegExp(`(['"\`])${escapeRegex(oldImportPath)}\\1`, "g");
      const unquotedPattern = new RegExp(`\\b${escapeRegex(oldImportPath)}\\b`, "g");
      if (quotedPattern.test(content)) {
        content = content.replace(quotedPattern, `$1${updatedImportPath}$1`);
        hasChanges = true;
      } else if (unquotedPattern.test(content)) {
        content = content.replace(unquotedPattern, updatedImportPath);
        hasChanges = true;
      }
      if (config.verbose && hasChanges) {
        console.log(`  📝 ${filePath}: ${oldImportPath} → ${updatedImportPath}`);
      }
    }
    if (hasChanges) {
      await fs.writeFile(filePath, content, "utf8");
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error updating ${filePath}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

export async function updateImportsInMovedFile(
  oldPath: string,
  newPath: string,
  config: Config
): Promise<void> {
  try {
    console.log(`📝 Updating imports inside moved file: ${newPath}`);
    const content = await fs.readFile(newPath, "utf8");
    let updatedContent = content;
    let hasChanges = false;
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
          `⚠️  Could not parse moved file ${newPath}: ${e instanceof Error ? e.message : String(e)
          }`
        );
      }
      return;
    }
    const oldFileDir = path.dirname(oldPath);
    const newFileDir = path.dirname(newPath);
    const relativeImports: ImportInfo[] = [];
    traverse(ast, {
      ImportDeclaration(pathNode) {
        const importPath = pathNode.node.source.value;
        if (
          typeof importPath === "string" &&
          (importPath.startsWith("./") || importPath.startsWith("../"))
        ) {
          relativeImports.push({
            line: pathNode.node.loc?.start.line || 0,
            originalLine:
              content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() ||
              "",
            importPath,
            matchedText: pathNode.toString(),
          });
        }
      },
      ExportAllDeclaration(pathNode) {
        const importPath = pathNode.node.source?.value;
        if (
          typeof importPath === "string" &&
          (importPath.startsWith("./") || importPath.startsWith("../"))
        ) {
          relativeImports.push({
            line: pathNode.node.loc?.start.line || 0,
            originalLine:
              content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() ||
              "",
            importPath,
            matchedText: pathNode.toString(),
          });
        }
      },
      ExportNamedDeclaration(pathNode) {
        const importPath = pathNode.node.source?.value;
        if (
          typeof importPath === "string" &&
          (importPath.startsWith("./") || importPath.startsWith("../"))
        ) {
          relativeImports.push({
            line: pathNode.node.loc?.start.line || 0,
            originalLine:
              content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() ||
              "",
            importPath,
            matchedText: pathNode.toString(),
          });
        }
      },
      CallExpression(pathNode) {
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
                  content.split("\n")[pathNode.node.loc?.start?.line ? pathNode.node.loc.start.line - 1 : 0]?.trim() ||
                  "",
                importPath,
                matchedText: pathNode.toString(),
              });
            }
          }
        }
      },
    });
    if (config.verbose) {
      console.log(
        `  Found ${relativeImports.length} relative imports to update`
      );
    }
    for (const importInfo of relativeImports) {
      const oldImportPath = importInfo.importPath;
      const oldResolvedPath = path.resolve(oldFileDir, oldImportPath);
      let newRelativePath = normalizePath(
        path.relative(newFileDir, oldResolvedPath)
      );
      if (
        !newRelativePath.startsWith("../") &&
        !newRelativePath.startsWith("./")
      ) {
        newRelativePath = `./${newRelativePath}`;
      }
      if (oldImportPath !== newRelativePath) {
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
          if (config.verbose) {
            console.log(
              `    📝 Updated import: ${oldImportPath} → ${newRelativePath}`
            );
          }
        }
      }
    }
    if (hasChanges) {
      await fs.writeFile(newPath, updatedContent, "utf8");
      console.log(
        `  ✅ Updated ${relativeImports.length} imports in moved file`
      );
    } else if (config.verbose) {
      console.log(`  ℹ️  No import updates needed in moved file`);
    }
  } catch (error) {
    console.error(
      `❌ Error updating imports in moved file ${newPath}:`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
