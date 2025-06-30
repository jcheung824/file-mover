import { promises as fs } from "fs";

import path from "path";

import { ImportAnalysis, InvertedImportPathCache } from "../types";

import { updateImportsInFile } from "../fileOps";

import { findDependencyImports } from "../importUtils";

// Core performance tracking functionality

export interface PerformanceMetrics {
  totalTime: number;
  fileDiscovery: { time: number; fileCount: number };
  validation: { time: number; moveCount: number };
  importAnalysis: {
    time: number;
    totalFiles: number;
    filesWithImports: number;
    fileReadTime: number;
    astParseTime: number;
    importMatchingTime: number;
    individualFileTimes: Array<{
      file: string;
      readTime: number;
      parseTime: number;
      matchTime: number;
      totalTime: number;
      importCount: number;
    }>;
  };

  fileOperations: {
    time: number;

    moves: number;

    updates: number;

    writeTime: number;

    moveTime: number;
  };

  cachePerformance: { astCacheHits: number; fileCacheHits: number; totalCacheLookups: number };

  individualMoves: Array<{
    fromPath: string;

    toPath: string;

    analysisTime: number;

    moveTime: number;

    movedFileUpdateTime: number;

    updateTime: number;

    filesUpdated: number;

    detailedAnalysis: {
      fileReadTime: number;

      astParseTime: number;

      importMatchingTime: number;

      filesProcessed: number;

      filesWithImports: number;
    };
  }>;
}

export interface PerformanceLogEntry {
  timestamp: string;

  runId: string;

  metrics: PerformanceMetrics;

  summary: {
    totalFiles: number;

    totalMoves: number;

    totalUpdates: number;

    avgAnalysisTime: number;

    avgMoveTime: number;

    avgUpdateTime: number;

    avgFileAnalysisTime: number;

    cacheHitRate: number;
  };
}

export interface PerformanceTimer {
  end: () => number;
}

// No-op timer for when performance tracking is disabled

class NoOpTimer implements PerformanceTimer {
  end(): number {
    return 0;
  }
}

class Performance {
  private metrics: PerformanceMetrics;

  private verbose: boolean;

  private timerStack: Map<string, number>;

  private runId: string;

  private logDir: string;

  constructor(verbose = false) {
    this.verbose = verbose;

    this.metrics = this.getInitialMetrics();

    this.timerStack = new Map();

    this.runId = this.generateRunId();

    this.logDir = path.join(process.cwd(), "performance");

    this.ensureLogDirectory();
  }

  private generateRunId(): string {
    const now = new Date();

    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
  }

  private async ensureLogDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
    } catch {
      // Directory might already exist, ignore error
    }
  }

  private getInitialMetrics(): PerformanceMetrics {
    return {
      totalTime: 0,

      fileDiscovery: { time: 0, fileCount: 0 },

      validation: { time: 0, moveCount: 0 },

      importAnalysis: {
        time: 0,

        totalFiles: 0,

        filesWithImports: 0,

        fileReadTime: 0,

        astParseTime: 0,

        importMatchingTime: 0,

        individualFileTimes: [],
      },

      fileOperations: {
        time: 0,

        moves: 0,

        updates: 0,

        writeTime: 0,

        moveTime: 0,
      },

      cachePerformance: { astCacheHits: 0, fileCacheHits: 0, totalCacheLookups: 0 },

      individualMoves: [],
    };
  }

  private calculateSummary(): PerformanceLogEntry["summary"] {
    const totalFiles = this.metrics.importAnalysis.totalFiles;

    const totalMoves = this.metrics.individualMoves.length;

    const totalUpdates = this.metrics.fileOperations.updates;

    const avgAnalysisTime =
      totalMoves > 0 ? this.metrics.individualMoves.reduce((sum, move) => sum + move.analysisTime, 0) / totalMoves : 0;

    const avgMoveTime =
      totalMoves > 0 ? this.metrics.individualMoves.reduce((sum, move) => sum + move.moveTime, 0) / totalMoves : 0;

    const avgUpdateTime =
      totalMoves > 0 ? this.metrics.individualMoves.reduce((sum, move) => sum + move.updateTime, 0) / totalMoves : 0;

    const avgFileAnalysisTime =
      this.metrics.importAnalysis.individualFileTimes.length > 0
        ? this.metrics.importAnalysis.individualFileTimes.reduce((sum, file) => sum + file.totalTime, 0) /
          this.metrics.importAnalysis.individualFileTimes.length
        : 0;

    const cacheHitRate =
      this.metrics.cachePerformance.totalCacheLookups > 0
        ? (this.metrics.cachePerformance.astCacheHits + this.metrics.cachePerformance.fileCacheHits) /
          this.metrics.cachePerformance.totalCacheLookups
        : 0;

    return {
      totalFiles,

      totalMoves,

      totalUpdates,

      avgAnalysisTime,

      avgMoveTime,

      avgUpdateTime,

      avgFileAnalysisTime,

      cacheHitRate,
    };
  }

  private async savePerformanceLog(): Promise<void> {
    if (!this.verbose) return;

    const logEntry: PerformanceLogEntry = {
      timestamp: new Date().toISOString(),

      runId: this.runId,

      metrics: this.metrics,

      summary: this.calculateSummary(),
    };

    const logFile = path.join(this.logDir, `performance_${this.runId}.json`);

    await fs.writeFile(logFile, JSON.stringify(logEntry, null, 2));
  }

  private async updatePerformanceHistory(): Promise<void> {
    if (!this.verbose) return;

    const historyFile = path.join(this.logDir, "performance_history.json");
    let history: PerformanceLogEntry[] = [];

    try {
      const existingData = await fs.readFile(historyFile, "utf8");
      history = JSON.parse(existingData);
    } catch {
      // File doesn't exist or is invalid, start with empty array
    }

    const logEntry: PerformanceLogEntry = {
      timestamp: new Date().toISOString(),

      runId: this.runId,

      metrics: this.metrics,

      summary: this.calculateSummary(),
    };

    // Add new entry and keep only the last 50 runs

    history.push(logEntry);

    if (history.length > 50) {
      history = history.slice(-50);
    }

    await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
  }

  private generatePerformanceTable(): string {
    if (!this.verbose) return "";

    const summary = this.calculateSummary();

    const table = `
╔══════════════════════════════════════════════════════════════════════════════╗
║                              PERFORMANCE SUMMARY                             ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ Total Execution Time: ${this.metrics.totalTime.toFixed(2)}ms                                    ║
║ Files Discovered: ${this.metrics.fileDiscovery.fileCount} (${this.metrics.fileDiscovery.time.toFixed(2)}ms)                    ║
║ Moves Validated: ${this.metrics.validation.moveCount} (${this.metrics.validation.time.toFixed(2)}ms)                        ║
║ Files Analyzed: ${this.metrics.importAnalysis.totalFiles} (${this.metrics.importAnalysis.time.toFixed(2)}ms)                    ║
║ Files with Imports: ${this.metrics.importAnalysis.filesWithImports}                                    ║
║ Total Moves: ${this.metrics.individualMoves.length}                                              ║
║ Total Updates: ${this.metrics.fileOperations.updates}                                            ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ AVERAGE TIMES (per move)                                                     ║
║ Analysis: ${summary.avgAnalysisTime.toFixed(2)}ms | Move: ${summary.avgMoveTime.toFixed(2)}ms | Update: ${summary.avgUpdateTime.toFixed(2)}ms ║
║ File Analysis: ${summary.avgFileAnalysisTime.toFixed(2)}ms | Cache Hit Rate: ${(summary.cacheHitRate * 100).toFixed(1)}%    ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;

    return table;
  }

  startTimer(label: string): PerformanceTimer {
    if (!this.verbose) {
      return new NoOpTimer();
    }

    const startTime = globalThis.performance.now();

    this.timerStack.set(label, startTime);

    return {
      end: () => {
        const endTime = globalThis.performance.now();

        const duration = endTime - startTime;

        this.timerStack.delete(label);

        return duration;
      },
    };
  }

  trackFileAnalysis(file: string, readTime: number, parseTime: number, matchTime: number, importCount: number): void {
    if (!this.verbose) return;

    this.metrics.importAnalysis.individualFileTimes.push({
      file,

      readTime,

      parseTime,

      matchTime,

      totalTime: readTime + parseTime + matchTime,

      importCount,
    });
  }

  addFileOpTime(type: "move" | "write", time: number) {
    if (!this.verbose) return;

    if (type === "move") {
      this.metrics.fileOperations.moveTime += time;
    } else {
      this.metrics.fileOperations.writeTime += time;
    }
  }

  addFileOpUpdates(count: number) {
    if (!this.verbose) return;

    this.metrics.fileOperations.updates += count;
  }

  addFileOpMoves(count: number) {
    if (!this.verbose) return;

    this.metrics.fileOperations.moves += count;
  }

  setFileOpTotalTime(time: number) {
    if (!this.verbose) return;

    this.metrics.fileOperations.time = time;
  }

  addValidationTime(time: number, moveCount: number) {
    if (!this.verbose) return;

    this.metrics.validation.time += time;

    this.metrics.validation.moveCount += moveCount;
  }

  addDiscoveryTime(time: number, fileCount: number) {
    if (!this.verbose) return;

    this.metrics.fileDiscovery.time += time;

    this.metrics.fileDiscovery.fileCount = fileCount;
  }

  setImportAnalysisTime(time: number, totalFiles: number, filesWithImports: number) {
    if (!this.verbose) return;

    this.metrics.importAnalysis.time = time;

    this.metrics.importAnalysis.totalFiles = totalFiles;

    this.metrics.importAnalysis.filesWithImports = filesWithImports;
  }

  setImportAnalysisBreakdown(read: number, parse: number, match: number) {
    if (!this.verbose) return;

    this.metrics.importAnalysis.fileReadTime = read;

    this.metrics.importAnalysis.astParseTime = parse;

    this.metrics.importAnalysis.importMatchingTime = match;
  }

  clearFileAnalysisTimes() {
    if (!this.verbose) return;

    this.metrics.importAnalysis.individualFileTimes = [];
  }

  addMoveMetrics(move: PerformanceMetrics["individualMoves"][number]) {
    if (!this.verbose) return;

    this.metrics.individualMoves.push(move);
  }

  setTotalTime(time: number) {
    if (!this.verbose) return;

    this.metrics.totalTime = time;
  }

  async printSummary() {
    if (!this.verbose) return;

    console.log(this.generatePerformanceTable());

    // Save performance data

    await this.savePerformanceLog();

    await this.updatePerformanceHistory();
  }

  clearCaches(): void {
    if (!this.verbose) return;

    this.metrics.cachePerformance = { astCacheHits: 0, fileCacheHits: 0, totalCacheLookups: 0 };
  }

  reset(): void {
    if (!this.verbose) return;

    this.metrics = this.getInitialMetrics();
  }

  getMetrics(): PerformanceMetrics {
    return this.metrics;
  }

  trackCacheHit(type: "ast" | "file") {
    if (!this.verbose) return;

    if (type === "ast") {
      this.metrics.cachePerformance.astCacheHits++;
    } else {
      this.metrics.cachePerformance.fileCacheHits++;
    }
  }

  trackCacheLookup() {
    if (!this.verbose) return;

    this.metrics.cachePerformance.totalCacheLookups++;
  }
}

export function getPerformance(verbose = false): Performance {
  return new Performance(verbose);
}

export interface MoveMetrics {
  fromPath: string;

  toPath: string;

  analysisTime: number;

  moveTime: number;

  movedFileUpdateTime: number;

  updateTime: number;

  filesUpdated: number;

  detailedAnalysis: {
    fileReadTime: number;

    astParseTime: number;

    importMatchingTime: number;

    filesProcessed: number;

    filesWithImports: number;
  };
}

export interface BatchMoveTracker {
  startTotalTimer(): void;

  startValidationTimer(): void;

  endValidationTimer(moveCount: number): void;

  startFileDiscoveryTimer(): void;

  endFileDiscoveryTimer(fileCount: number): void;

  startPrecomputeTimer(): void;

  endPrecomputeTimer(): void;

  startFileOpsTimer(): void;

  endFileOpsTimer(): void;

  startAnalysisTimer(moveIndex: number): void;

  endAnalysisTimer(): number;

  clearFileAnalysisTimes(): void;

  getFileAnalysisTimes(): Array<{
    file: string;

    readTime: number;

    parseTime: number;

    matchTime: number;

    totalTime: number;

    importCount: number;
  }>;

  startMoveTimer(moveIndex: number): void;

  endMoveTimer(): number;

  startUpdateMovedFileTimer(moveIndex: number): void;

  endUpdateMovedFileTimer(): number;

  startUpdateTimer(moveIndex: number): void;

  endUpdateTimer(): number;

  addMoveMetrics(metrics: MoveMetrics): void;

  setTotalTime(): void;

  printSummary(): Promise<void>;

  addFileOpUpdates(totalUpdates: number): void;

  setImportAnalysisTime(time: number, totalFiles: number, filesWithImports: number): void;

  setImportAnalysisBreakdown(read: number, parse: number, match: number): void;

  startOverallAnalysisTimer(): PerformanceTimer;
}

export class MoveTracker implements BatchMoveTracker {
  private perf: ReturnType<typeof getPerformance>;

  private totalTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private validationTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private fileDiscoveryTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private precomputeTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private fileOpsTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private analysisTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private moveTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private updateMovedFileTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  private updateTimer: ReturnType<ReturnType<typeof getPerformance>["startTimer"]> | null = null;

  constructor(verbose: boolean) {
    this.perf = getPerformance(verbose);
  }

  startTotalTimer(): void {
    this.totalTimer = this.perf.startTimer("Total execution");
  }

  startValidationTimer(): void {
    this.validationTimer = this.perf.startTimer("Validation");
  }

  endValidationTimer(moveCount: number): void {
    if (this.validationTimer) {
      this.perf.addValidationTime(this.validationTimer.end(), moveCount);

      this.validationTimer = null;
    }
  }

  startFileDiscoveryTimer(): void {
    this.fileDiscoveryTimer = this.perf.startTimer("File discovery");
  }

  endFileDiscoveryTimer(fileCount: number): void {
    if (this.fileDiscoveryTimer) {
      this.perf.addDiscoveryTime(this.fileDiscoveryTimer.end(), fileCount);

      this.fileDiscoveryTimer = null;
    }
  }

  startPrecomputeTimer(): void {
    this.precomputeTimer = this.perf.startTimer("Pre-computing import paths");
  }

  endPrecomputeTimer(): void {
    if (this.precomputeTimer) {
      this.precomputeTimer.end();

      this.precomputeTimer = null;
    }
  }

  startFileOpsTimer(): void {
    this.fileOpsTimer = this.perf.startTimer("File operations");
  }

  endFileOpsTimer(): void {
    if (this.fileOpsTimer) {
      this.perf.addFileOpTime("move", this.fileOpsTimer.end());

      this.fileOpsTimer = null;
    }
  }

  startAnalysisTimer(moveIndex: number): void {
    this.analysisTimer = this.perf.startTimer(`Import analysis for move ${moveIndex + 1}`);
  }

  endAnalysisTimer(): number {
    if (this.analysisTimer) {
      const time = this.analysisTimer.end();

      this.analysisTimer = null;

      return time;
    }

    return 0;
  }

  clearFileAnalysisTimes(): void {
    this.perf.clearFileAnalysisTimes();
  }

  getFileAnalysisTimes(): Array<{
    file: string;

    readTime: number;

    parseTime: number;

    matchTime: number;

    totalTime: number;

    importCount: number;
  }> {
    return this.perf.getMetrics().importAnalysis.individualFileTimes;
  }

  startMoveTimer(moveIndex: number): void {
    this.moveTimer = this.perf.startTimer(`Physical file move ${moveIndex + 1}`);
  }

  endMoveTimer(): number {
    if (this.moveTimer) {
      const time = this.moveTimer.end();

      this.moveTimer = null;

      return time;
    }

    return 0;
  }

  startUpdateMovedFileTimer(moveIndex: number): void {
    this.updateMovedFileTimer = this.perf.startTimer(`Moved file import updates ${moveIndex + 1}`);
  }

  endUpdateMovedFileTimer(): number {
    if (this.updateMovedFileTimer) {
      const time = this.updateMovedFileTimer.end();

      this.updateMovedFileTimer = null;

      return time;
    }

    return 0;
  }

  startUpdateTimer(moveIndex: number): void {
    this.updateTimer = this.perf.startTimer(`Import updates for move ${moveIndex + 1}`);
  }

  endUpdateTimer(): number {
    if (this.updateTimer) {
      const time = this.updateTimer.end();

      this.updateTimer = null;

      return time;
    }

    return 0;
  }

  addMoveMetrics(metrics: MoveMetrics): void {
    this.perf.addMoveMetrics(metrics);
  }

  setTotalTime(): void {
    if (this.totalTimer) {
      this.perf.setTotalTime(this.totalTimer.end());

      this.totalTimer = null;
    }
  }

  async printSummary(): Promise<void> {
    await this.perf.printSummary();
  }

  addFileOpUpdates(totalUpdates: number): void {
    this.perf.addFileOpUpdates(totalUpdates);
  }

  setImportAnalysisTime(time: number, totalFiles: number, filesWithImports: number): void {
    this.perf.setImportAnalysisTime(time, totalFiles, filesWithImports);
  }

  setImportAnalysisBreakdown(read: number, parse: number, match: number): void {
    this.perf.setImportAnalysisBreakdown(read, parse, match);
  }

  startOverallAnalysisTimer(): PerformanceTimer {
    return this.perf.startTimer("Overall import analysis");
  }
}

/**
 * Batch update imports in multiple files to reduce I/O overhead
 */
export async function batchUpdateImports({
  importAnalysis,
  tracker,
}: {
  importAnalysis: ImportAnalysis[];
  tracker: BatchMoveTracker;
}): Promise<number> {
  const updatePromises = importAnalysis.map(async ({ file, imports }) => {
    const updated = await updateImportsInFile({
      currentFilePath: file,
      imports,
    });
    return updated ? 1 : 0;
  });

  const results = await Promise.all(updatePromises);
  const totalUpdates = results.reduce((sum: number, count: number) => sum + count, 0);

  // Update performance metrics
  tracker.addFileOpUpdates(totalUpdates);

  return totalUpdates;
}

/**
 * Analyze which files import the target file with performance tracking
 */
export async function analyzeImportsWithTracking(
  sourceFiles: string[],
  targetImportPaths: InvertedImportPathCache,
  tracker: BatchMoveTracker
): Promise<ImportAnalysis[]> {
  const results: ImportAnalysis[] = [];

  if (globalThis.appState.verbose) {
    // console.log(`🔍 Analyzing imports for target: ${targetPath}`);
    // console.log(`🎯 Target import paths to match:`, targetImportPaths);
  }

  // Track overall analysis timing
  const overallAnalysisTimer = tracker.startOverallAnalysisTimer();

  let totalFileReadTime = 0;
  let totalAstParseTime = 0;
  let totalImportMatchingTime = 0;
  let filesWithImports = 0;

  // OPTIMIZATION: Use Promise.all for parallel file reading and analysis
  const analysisPromises = sourceFiles.map(async (file) => {
    try {
      if (globalThis.appState.verbose) {
        // console.log(`📂 Analyzing file: ${file}`);
      }

      const content = await fs.readFile(file, "utf8");

      const imports = findDependencyImports({
        content,
        targetImportPaths,
        currentFile: file,
      });

      if (globalThis.appState.verbose) {
        // console.log(`📂 Analyzing ${file}: ${imports.length} import(s) found`);
      }

      if (imports.length > 0) {
        filesWithImports++;
        return { file, imports };
      }

      return null;
    } catch (error) {
      const normalizedFile = path.normalize(file);
      const scanningSelf = globalThis.appState.fileMoves.some(([fromPath]) => normalizedFile === fromPath);

      if (!scanningSelf) {
        console.warn(`⚠️  Could not read ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }

      return null;
    }
  });

  const analysisResults = await Promise.all(analysisPromises);

  // Filter out null results and add to results array
  for (const result of analysisResults) {
    if (result) {
      results.push(result);
    }
  }

  // Update overall metrics
  const overallAnalysisTime = overallAnalysisTimer.end();
  tracker.setImportAnalysisTime(overallAnalysisTime, sourceFiles.length, filesWithImports);

  // Aggregate individual file times
  const individualFileTimes = tracker.getFileAnalysisTimes();
  totalFileReadTime = individualFileTimes.reduce((sum, file) => sum + file.readTime, 0);
  totalAstParseTime = individualFileTimes.reduce((sum, file) => sum + file.parseTime, 0);
  totalImportMatchingTime = individualFileTimes.reduce((sum, file) => sum + file.matchTime, 0);
  tracker.setImportAnalysisBreakdown(totalFileReadTime, totalAstParseTime, totalImportMatchingTime);

  return results;
}
