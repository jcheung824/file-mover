// Utility functions for path normalization and import path handling
import path from "path";
import { isMonorepoPackageImport, isRelativeImport } from "./importUtils";

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
  return normalizePath(importPath);
}

/**
 * @param importPath - The import path to get the module type for.
 * @returns The module type as 'packages/package-name' or 'apps/app-name', or null if it cannot be determined.
 */
export const getModuleType = (importPath: string): { moduleType: string; moduleName: string } => {
  const normalized = normalizePath(importPath);

  const packageName = isMonorepoPackageImport(normalized)
    ? `packages/${normalized.match(/@ms\/([^/]+)/)?.[1]}`
    : normalized.match(/(?:packages|apps)\/([^/]+)/)?.[0];
  if (!packageName) {
    throw new Error(`⚠️  Could not determine package name for ${importPath}`);
  }

  return { moduleType: packageName, moduleName: packageName.split("/")[1] };
};

// Helper function to determine if a path is in packages or apps folder
export const getPathType = ({
  filePath,
  includedPackageFolders,
  includedAppsFolders,
}: {
  filePath: string;
  includedPackageFolders: string[];
  includedAppsFolders: string[];
}): "package" | "app" | "unknown" => {
  const normalizedPath = filePath.replace(/\\/g, "/");

  for (const packageFolder of includedPackageFolders) {
    if (normalizedPath.includes(`packages/${packageFolder}`)) {
      return "package";
    }
  }

  for (const appFolder of includedAppsFolders) {
    if (normalizedPath.includes(`apps/${appFolder}`)) {
      return "app";
    }
  }

  return "unknown";
};

export const handleMonoRepoImportPathToAbsolutePath = (directory: string, importPath: string): string => {
  if (!isMonorepoPackageImport(importPath)) {
    return importPath;
  }

  // Parse import: @ms/powerva-main/lib/base/Telemetry -> powerva-main/src/base/Telemetry
  const [, packageName, ...pathParts] = importPath.split("/");
  const srcPath = pathParts.join("/").replace(/^lib/, "src");

  // Find packages directory from current file path
  const currentDir = path.dirname(directory);
  const packagesIndex = currentDir.indexOf("packages");

  // Might need to improve this logic
  if (packagesIndex === -1) {
    throw new Error("Could not find packages directory in the current path");
  }

  // Build absolute path: packages/packageName/srcPath
  const packagesDir = currentDir.substring(0, packagesIndex + "packages".length);

  return normalizePath(path.join(packagesDir, packageName, srcPath));
};
