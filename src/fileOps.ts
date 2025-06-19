// File operations for moving files and updating imports
import { promises as fs } from "fs";
import { ImportInfo, Config } from "./types.js";
import { parse } from "@babel/parser";
import traverseModule, { NodePath } from "@babel/traverse";
import {
  extractImportInfo,
  handleMovingFileImportsUpdate,
  handlePackageImportsUpdate,
  isMonorepoPackageImport,
  isRelativeImport,
} from "./importUtils.js";
import { CallExpression, ImportDeclaration } from "@babel/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const traverse: typeof traverseModule = (traverseModule as any).default || traverseModule;

export async function movePhysicalFile(oldPath: string, newPath: string): Promise<void> {
  console.log(`📦 Moving file: ${oldPath} → ${newPath}`);
  await fs.rename(oldPath, newPath);
}

export async function updateImportsInFile({
  currentFilePath,
  imports,
  newPath,
  config,
}: {
  currentFilePath: string;
  imports: ImportInfo[];
  newPath: string;
  config: Config;
}): Promise<boolean> {
  try {
    let fileContent = await fs.readFile(currentFilePath, "utf8");

    let hasChanges = false;
    for (const importInfo of imports) {
      const currentImportPath = importInfo.importPath;

      const { updated, updatedFileContent, updatedImportPath } = handlePackageImportsUpdate({
        currentImportPath,
        currentFilePath,
        newPath,
        fileContent,
      });

      hasChanges = hasChanges || updated;
      if (updated) {
        fileContent = updatedFileContent;
      }

      // if (fileDirection === "self") {
      //   if (currentImportPath.startsWith("@ms/")) {
      //     updatedImportPath = newMsPath || newRelativePath;
      //   } else if (currentImportPath.startsWith("./") || currentImportPath.startsWith("../")) {
      //     updatedImportPath = newRelativePath;
      //   } else {
      //     updatedImportPath = newRelativePath;
      //   }
      //   const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      //   const quotedPattern = new RegExp(`(['"\`])${escapeRegex(currentImportPath)}\\1`, "g");
      //   const unquotedPattern = new RegExp(`\\b${escapeRegex(currentImportPath)}\\b`, "g");
      //   if (quotedPattern.test(fileContent)) {
      //     fileContent = fileContent.replace(quotedPattern, `$1${updatedImportPath}$1`);
      //     hasChanges = true;
      //   } else if (unquotedPattern.test(fileContent)) {
      //     fileContent = fileContent.replace(unquotedPattern, updatedImportPath);
      //     hasChanges = true;
      //   }
      // } else if (fileDirection === "betweenPackages") {
      //   // Match only the file name part of the path
      //   const fileName = path.basename(newRelativePath);
      //   const matchDirectFilePath = new RegExp(`(['"])[^'"]*${fileName}\\1`, "g");
      //   const matchedDirectFilePath = fileContent.match(matchDirectFilePath);
      //   if (matchedDirectFilePath) {
      //     fileContent = fileContent.replace(matchDirectFilePath, `$1${newMsPath}$1`);
      //     hasChanges = true;
      //     if (config.verbose) {
      //       console.log(`  📝 ${currentFilePath}: ${newRelativePath} → ${newMsPath}`);
      //     }
      //   }

      //   if (currentImportPath.startsWith("@ms/")) {
      //     // Convert @ms/package/lib/path to relative path to src
      //     const srcPath = currentImportPath.replace("@ms/", "packages/").replace("/lib/", "/src/");
      //     const relativePath = normalizePath(path.relative(fileDir, srcPath));
      //     const relativePathWithoutExt = removeExtension(relativePath);

      //     // Ensure path starts with ./ or ../
      //     updatedImportPath = relativePathWithoutExt;
      //     if (!updatedImportPath.startsWith("../") && !updatedImportPath.startsWith("./")) {
      //       updatedImportPath = `./${updatedImportPath}`;
      //     }

      //     // Update the import in the file content
      //     const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      //     const quotedPattern = new RegExp(`(['"\`])${escapeRegex(currentImportPath)}\\1`, "g");
      //     if (quotedPattern.test(fileContent)) {
      //       fileContent = fileContent.replace(quotedPattern, `$1${updatedImportPath}$1`);
      //       hasChanges = true;
      //       if (config.verbose) {
      //         console.log(`  📝 ${currentFilePath}: ${currentImportPath} → ${updatedImportPath}`);
      //       }
      //     }
      //   }
      // }

      if (config.verbose && hasChanges) {
        console.log(`  📝 ${currentFilePath}: ${currentImportPath} → ${updatedImportPath}`);
      }
    }

    if (hasChanges) {
      await fs.writeFile(currentFilePath, fileContent, "utf8");
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error updating ${currentFilePath}:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function handleWithinModuleImports(
  pathNode: NodePath<ImportDeclaration>,
  content: string,
  relativeImports: ImportInfo[]
): void {
  const importPath = pathNode.node.source?.value;
  if (typeof importPath === "string" && (isRelativeImport(importPath) || isMonorepoPackageImport(importPath))) {
    relativeImports.push(extractImportInfo(pathNode, content, importPath));
  }
}

//TODO:
// 1. Should be a different algorithm for it to update to other files
// 1.1 while traversing other files, I should fine if there's a file that's relative to the current file and find the import path if
// 1.1.1 if it's intra module, I should update with relative path
// 1.1.2 if it's inter module, I should update with ms import path
export async function updateImportsInMovedFile(oldPath: string, newPath: string, config: Config): Promise<void> {
  try {
    console.log(`📝 Updating imports inside moved file: ${newPath}`);
    const content = await fs.readFile(newPath, "utf8");
    let updatedContent = content;
    let hasChanges = false;
    let needsManualResolution = false;
    let ast;

    try {
      ast = parse(content, {
        sourceType: "unambiguous",
        plugins: ["typescript", "jsx", "decorators-legacy", "classProperties", "dynamicImport"],
      });
    } catch (e) {
      if (config.verbose) {
        console.warn(`⚠️  Could not parse moved file ${newPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    // const attentionNeededImports: ImportInfo[] = []; // Do I really need this?
    const relativeImports: ImportInfo[] = [];

    // Should probably update the files whiles we are traversing the set
    traverse(ast, {
      ImportDeclaration: (pathNode: NodePath<ImportDeclaration>) => {
        handleWithinModuleImports(pathNode, content, relativeImports);
      },
      CallExpression: (pathNode: NodePath<CallExpression>) => {
        const callee = pathNode.node.callee;
        if ((callee.type === "Identifier" && callee.name === "require") || callee.type === "Import") {
          const arg0 = pathNode.node.arguments[0];
          if (arg0 && arg0.type === "StringLiteral") {
            const importPath = arg0.value;
            if (typeof importPath === "string" && (importPath.startsWith("./") || importPath.startsWith("../"))) {
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
      console.log(`Found ${relativeImports.length} relative imports to update`);
    }

    for (const importInfo of relativeImports) {
      // TODOs:
      //if: file import is part of the move. update newPath as the path in json.
      //Find all potential import path pattern and replace them all with the relative + monorepo import path

      //TODO:
      // 1. Find all potential import path pattern and replace them all with the relative + monorepo import path
      // 2. Update the newPath as the path in json.

      const { updated, updatedFileContent, updatedImportPath } = handleMovingFileImportsUpdate({
        importPath: importInfo.importPath,
        originalMovedFilePath: oldPath,
        newMovedFilePath: newPath,
        fileContent: updatedContent,
      });
      if (updated) {
        updatedContent = updatedFileContent;
        hasChanges = true;
        if (config.verbose) {
          console.log(`    📝 Updated import: ${importInfo.importPath} → ${updatedImportPath}`);
        }
      }

      // Add attention needed imports comment to the file
      // if (attentionNeededImports.length > 0) {
      //   const attentionComment = `\n\n/*\n * ATTENTION NEEDED: The following imports require manual resolution:\n${attentionNeededImports.map((imp) => ` * ${imp.originalLine}`).join("\n")}\n */\n`;
      //   updatedContent += attentionComment;
      //   hasChanges = true;
      //   needsManualResolution = true;
      // }
    }

    if (hasChanges) {
      await fs.writeFile(newPath, updatedContent, "utf8");
      console.log(`  ✅ Updated ${relativeImports.length} imports in moved file`);
      if (needsManualResolution) {
        console.log(`  ⚠️  Manual resolution needed for imports`);
      }
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
