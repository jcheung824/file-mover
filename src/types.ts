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
  excludePatterns: string[];
  includePatterns: string[];
  cwd: string;
  dryRun: boolean;
  verbose: boolean;
}
