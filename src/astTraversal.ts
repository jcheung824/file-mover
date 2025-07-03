import { InvertedImportPathCache, ImportInfo } from "./types";
import { matchesTarget, extractImportInfo } from "./importUtils";
import { NodePath } from "@babel/traverse";
import { ImportDeclaration, ExportAllDeclaration, CallExpression } from "@babel/types";

export const handleAstTraverse = ({
  content,
  targetImportPaths,
  currentFile,
  imports,
}: {
  content: string;
  targetImportPaths: InvertedImportPathCache;
  currentFile: string;
  imports: ImportInfo[];
}) => ({
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
