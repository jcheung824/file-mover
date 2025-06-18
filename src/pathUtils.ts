// Utility functions for path normalization and import path handling
import path from "path";
import { isRelativeImport } from "./importUtils";

export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, "/");
}

export function removeExtension(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, parsed.name);
}

export function getMsImportPath(filePath: string): string {
  const normalized = normalizePath(filePath);
  // Matches paths like "packages/package-name/src/file/path.ts" or "apps/app-name/src/file/path.ts"
  // Group 1: package-name or app-name
  // Group 2: file/path.ts
  const matchGroups = normalized.match(/(?:packages|apps)\/([^/]+)\/src\/(.*)$/);
  // /packages|app
  if (matchGroups) {
    const pkg = matchGroups[1];
    const subpath = matchGroups[2].replace(/\.[^/.]+$/, "");
    return `@ms/${pkg}/lib/${subpath}`;
  }

  throw new Error(`⚠️  getMsImportPath not found! This should be an error: ${normalized}`);

}

export function resolveImportPath(currentFile: string, importPath: string): string {
  if (isRelativeImport(importPath)) {
    const currentDir = path.dirname(currentFile);
    return path.resolve(currentDir, importPath);
  }
  return importPath;
}
