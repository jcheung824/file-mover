// Types and interfaces for the file-mover tool

export interface ImportInfo {
  line: number;
  originalLine: string;
  importPath: string;
  matchedText: string;
}

export interface ImportAnalysis {
  file: string;
  imports: ImportInfo[];
}

export interface Config {
  includedPackageFolders: string[];
  includedAppsFolders: string[];
  excludePatterns: string[];
  includePatterns: string[];
  cwd: string;
}

export type FileDirection = "self" | "betweenPackages" | "packageToApp" | "unknown";

export type NormalizedFilePath = string;
export type NormalizedFilePathWithoutExtension = string;
export type ImportPath = string;
