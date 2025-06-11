// Utility functions for path normalization and import path handling
import path from "path";

export function normalizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, "/");
}

export function removeExtension(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, parsed.name);
}

export function getMsImportPath(filePath: string): string | null {
  const normalized = normalizePath(filePath);
  const match = normalized.match(/packages\/([^/]+)\/src\/(.*)$/);
  if (match) {
    const pkg = match[1];
    const subpath = match[2].replace(/\.[^/.]+$/, "");
    return `@ms/${pkg}/lib/${subpath}`;
  }
  return null;
}

export function generateNewMsImportPath(newPath: string): string | null {
  return getMsImportPath(newPath);
}

export function resolveImportPath(currentFile: string, importPath: string): string {
  if (importPath.startsWith("./") || importPath.startsWith("../")) {
    const currentDir = path.dirname(currentFile);
    return path.resolve(currentDir, importPath);
  }
  return importPath;
}
