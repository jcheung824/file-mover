// Performance tracking and metrics module
export interface PerformanceMetrics {
  totalTime: number;
  fileDiscovery: { time: number; fileCount: number };
  validation: { time: number; moveCount: number };
  importAnalysis: { time: number; totalFiles: number; filesWithImports: number };
  fileOperations: { time: number; moves: number; updates: number };
  cachePerformance: { astCacheHits: number; fileCacheHits: number; totalCacheLookups: number };
  individualMoves: Array<{
    fromPath: string;
    toPath: string;
    analysisTime: number;
    moveTime: number;
    updateTime: number;
    filesUpdated: number;
  }>;
}

export interface PerformanceTimer {
  end: () => number;
}

export interface PerformanceTracker {
  start: (label: string) => PerformanceTimer;
  metrics: PerformanceMetrics;
  printSummary: () => void;
  clearCaches: () => void;
  reset: () => void;
}

/**
 * Performance timing utilities
 */
class PerformanceTrackerImpl implements PerformanceTracker {
  public metrics: PerformanceMetrics = {
    totalTime: 0,
    fileDiscovery: { time: 0, fileCount: 0 },
    validation: { time: 0, moveCount: 0 },
    importAnalysis: { time: 0, totalFiles: 0, filesWithImports: 0 },
    fileOperations: { time: 0, moves: 0, updates: 0 },
    cachePerformance: { astCacheHits: 0, fileCacheHits: 0, totalCacheLookups: 0 },
    individualMoves: [],
  };

  private verbose: boolean;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  start(label: string): PerformanceTimer {
    const start = performance.now();
    return {
      end: () => {
        const end = performance.now();
        const duration = end - start;
        if (this.verbose) {
          console.log(`⏱️  ${label}: ${duration.toFixed(2)}ms`);
        }
        return duration;
      }
    };
  }

  /**
   * Clear all caches to free memory
   */
  clearCaches(): void {
    // Clear AST cache from importUtils
    if (typeof globalThis !== 'undefined' && (globalThis as any).astCache) {
      (globalThis as any).astCache.clear();
    }
    
    // Clear file content cache from fileOps
    if (typeof globalThis !== 'undefined' && (globalThis as any).fileContentCache) {
      (globalThis as any).fileContentCache.clear();
    }
    
    if (this.verbose) {
      console.log("🧹 Caches cleared");
    }
  }

  /**
   * Print detailed performance summary
   */
  printSummary(): void {
    console.log("\n📊 PERFORMANCE SUMMARY");
    console.log("=".repeat(50));
    console.log(`Total execution time: ${this.metrics.totalTime.toFixed(2)}ms`);
    console.log(`\nBreakdown:`);
    console.log(`  File discovery: ${this.metrics.fileDiscovery.time.toFixed(2)}ms (${this.metrics.fileDiscovery.fileCount} files)`);
    console.log(`  Validation: ${this.metrics.validation.time.toFixed(2)}ms (${this.metrics.validation.moveCount} moves)`);
    console.log(`  File operations: ${this.metrics.fileOperations.time.toFixed(2)}ms (${this.metrics.fileOperations.moves} moves, ${this.metrics.fileOperations.updates} updates)`);
    
    // Cache performance
    if (this.metrics.cachePerformance.totalCacheLookups > 0) {
      const astHitRate = (this.metrics.cachePerformance.astCacheHits / this.metrics.cachePerformance.totalCacheLookups * 100).toFixed(1);
      const fileHitRate = (this.metrics.cachePerformance.fileCacheHits / this.metrics.cachePerformance.totalCacheLookups * 100).toFixed(1);
      console.log(`\nCache Performance:`);
      console.log(`  AST cache hit rate: ${astHitRate}% (${this.metrics.cachePerformance.astCacheHits}/${this.metrics.cachePerformance.totalCacheLookups})`);
      console.log(`  File cache hit rate: ${fileHitRate}% (${this.metrics.cachePerformance.fileCacheHits}/${this.metrics.cachePerformance.totalCacheLookups})`);
    }
    
    if (this.metrics.individualMoves.length > 0) {
      console.log(`\nIndividual move performance:`);
      this.metrics.individualMoves.forEach((move, index) => {
        const totalMoveTime = move.analysisTime + move.moveTime + move.updateTime;
        console.log(`  Move ${index + 1}: ${totalMoveTime.toFixed(2)}ms total`);
        console.log(`    Analysis: ${move.analysisTime.toFixed(2)}ms`);
        console.log(`    Physical move: ${move.moveTime.toFixed(2)}ms`);
        console.log(`    Import updates: ${move.updateTime.toFixed(2)}ms (${move.filesUpdated} files updated)`);
      });
    }
    
    // Performance insights
    console.log(`\n💡 Performance Insights:`);
    const avgAnalysisTime = this.metrics.individualMoves.reduce((sum, move) => sum + move.analysisTime, 0) / this.metrics.individualMoves.length;
    const avgUpdateTime = this.metrics.individualMoves.reduce((sum, move) => sum + move.updateTime, 0) / this.metrics.individualMoves.length;
    
    console.log(`  Average analysis time per move: ${avgAnalysisTime.toFixed(2)}ms`);
    console.log(`  Average update time per move: ${avgUpdateTime.toFixed(2)}ms`);
    console.log(`  File discovery efficiency: ${(this.metrics.fileDiscovery.fileCount / this.metrics.fileDiscovery.time * 1000).toFixed(1)} files/ms`);
    
    // Clear caches to free memory
    this.clearCaches();
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.metrics = {
      totalTime: 0,
      fileDiscovery: { time: 0, fileCount: 0 },
      validation: { time: 0, moveCount: 0 },
      importAnalysis: { time: 0, totalFiles: 0, filesWithImports: 0 },
      fileOperations: { time: 0, moves: 0, updates: 0 },
      cachePerformance: { astCacheHits: 0, fileCacheHits: 0, totalCacheLookups: 0 },
      individualMoves: [],
    };
  }
}

// Global performance tracker instance
let globalPerformanceTracker: PerformanceTracker | null = null;

/**
 * Get or create the global performance tracker
 */
export function getPerformanceTracker(verbose: boolean = false): PerformanceTracker {
  if (!globalPerformanceTracker) {
    globalPerformanceTracker = new PerformanceTrackerImpl(verbose);
  }
  return globalPerformanceTracker;
}

/**
 * Reset the global performance tracker
 */
export function resetPerformanceTracker(): void {
  globalPerformanceTracker = null;
}

/**
 * Track cache performance metrics
 */
export function trackCacheHit(type: 'ast' | 'file'): void {
  if (globalPerformanceTracker) {
    globalPerformanceTracker.metrics.cachePerformance.totalCacheLookups++;
    if (type === 'ast') {
      globalPerformanceTracker.metrics.cachePerformance.astCacheHits++;
    } else {
      globalPerformanceTracker.metrics.cachePerformance.fileCacheHits++;
    }
  }
}

/**
 * Track cache lookup (miss)
 */
export function trackCacheLookup(): void {
  if (globalPerformanceTracker) {
    globalPerformanceTracker.metrics.cachePerformance.totalCacheLookups++;
  }
} 