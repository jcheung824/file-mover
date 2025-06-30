// Types and interfaces for the file-mover tool

export interface ImportInfo {
  line: number;
  originalLine: string;
  importPath: string;
  matchedText: string;
  matchedUpdateToFilePath: string;
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

export type ImportPathCache = Map<string, string[]>;
export type InvertedImportPathCache = Map<string, string>;

export type FileDirection = "self" | "betweenPackages" | "packageToApp" | "unknown";
