#!/usr/bin/env node

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const performanceDir = path.join(__dirname, "..", "performance");

async function generatePerformanceReport() {
  try {
    // Read performance history
    const historyFile = path.join(performanceDir, "performance_history.json");
    const historyData = await fs.readFile(historyFile, "utf8");
    const history = JSON.parse(historyData);

    if (history.length === 0) {
      console.log("No performance data found. Run the tool with --verbose to collect data.");
      return;
    }

    console.log("\n📈 PERFORMANCE TREND ANALYSIS");
    console.log("=".repeat(60));

    // Calculate trends
    const trends = calculateTrends(history);
    displayTrends(trends);

    // Generate performance comparison table
    console.log("\n📊 PERFORMANCE COMPARISON TABLE");
    console.log("=".repeat(120));
    generateComparisonTable(history);

    // Generate improvement analysis
    console.log("\n🚀 PERFORMANCE IMPROVEMENT ANALYSIS");
    console.log("=".repeat(60));
    generateImprovementAnalysis(history);

    // Generate recommendations
    console.log("\n💡 PERFORMANCE RECOMMENDATIONS");
    console.log("=".repeat(60));
    generateRecommendations(history);
  } catch (error) {
    console.error("Error generating performance report:", error.message);
  }
}

function calculateTrends(history) {
  if (history.length < 2) return null;

  const latest = history[history.length - 1];
  const previous = history[history.length - 2];

  const trends = {
    totalTimePerFile: calculatePercentageChange(
      previous.summary.totalFiles > 0 ? previous.metrics.totalTime / previous.summary.totalFiles : 0,
      latest.summary.totalFiles > 0 ? latest.metrics.totalTime / latest.summary.totalFiles : 0
    ),
    avgAnalysisTime: calculatePercentageChange(previous.summary.avgAnalysisTime, latest.summary.avgAnalysisTime),
    avgMoveTime: calculatePercentageChange(previous.summary.avgMoveTime, latest.summary.avgMoveTime),
    avgUpdateTime: calculatePercentageChange(previous.summary.avgUpdateTime, latest.summary.avgUpdateTime),
    fileDiscoveryTime: calculatePercentageChange(
      previous.metrics.fileDiscovery.time,
      latest.metrics.fileDiscovery.time
    ),
    validationTime: calculatePercentageChange(previous.metrics.validation.time, latest.metrics.validation.time),
  };

  return trends;
}

function calculatePercentageChange(oldValue, newValue) {
  if (oldValue === 0) return newValue > 0 ? 100 : 0;
  return ((newValue - oldValue) / oldValue) * 100;
}

function displayTrends(trends) {
  if (!trends) {
    console.log("Need at least 2 runs to calculate trends.");
    return;
  }

  const trendEmoji = (change) => {
    if (change > 5) return "📈";
    if (change < -5) return "📉";
    return "➡️";
  };

  const trendColor = (change) => {
    if (change > 5) return "\x1b[31m"; // Red for worse
    if (change < -5) return "\x1b[32m"; // Green for better
    return "\x1b[33m"; // Yellow for neutral
  };

  console.log("METRIC                    │ CHANGE    │ STATUS");
  console.log("─────────────────────────────────────────────────────────────");
  console.log(
    `Total Time per File        │ ${trendColor(trends.totalTimePerFile)}${trends.totalTimePerFile.toFixed(1).padStart(8)}%${trendEmoji(trends.totalTimePerFile)}\x1b[0m │ ${getTrendStatus(trends.totalTimePerFile)}`
  );
  console.log(
    `Average Analysis Time      │ ${trendColor(trends.avgAnalysisTime)}${trends.avgAnalysisTime.toFixed(1).padStart(8)}%${trendEmoji(trends.avgAnalysisTime)}\x1b[0m │ ${getTrendStatus(trends.avgAnalysisTime)}`
  );
  console.log(
    `Average Move Time          │ ${trendColor(trends.avgMoveTime)}${trends.avgMoveTime.toFixed(1).padStart(8)}%${trendEmoji(trends.avgMoveTime)}\x1b[0m │ ${getTrendStatus(trends.avgMoveTime)}`
  );
  console.log(
    `Average Update Time        │ ${trendColor(trends.avgUpdateTime)}${trends.avgUpdateTime.toFixed(1).padStart(8)}%${trendEmoji(trends.avgUpdateTime)}\x1b[0m │ ${getTrendStatus(trends.avgUpdateTime)}`
  );
  console.log(
    `File Discovery Time        │ ${trendColor(trends.fileDiscoveryTime)}${trends.fileDiscoveryTime.toFixed(1).padStart(8)}%${trendEmoji(trends.fileDiscoveryTime)}\x1b[0m │ ${getTrendStatus(trends.fileDiscoveryTime)}`
  );
  console.log(
    `Validation Time            │ ${trendColor(trends.validationTime)}${trends.validationTime.toFixed(1).padStart(8)}%${trendEmoji(trends.validationTime)}\x1b[0m │ ${getTrendStatus(trends.validationTime)}`
  );
}

function getTrendStatus(change) {
  if (change > 5) return "\x1b[31mWORSE\x1b[0m";
  if (change < -5) return "\x1b[32mBETTER\x1b[0m";
  return "\x1b[33mSTABLE\x1b[0m";
}

function generateComparisonTable(history) {
  const recentRuns = history.slice(-5); // Show last 5 runs

  console.log(
    "RUN ID                    │ TIME/FILE │ FILES │ MOVES │ AVG ANALYSIS │ FILE DISC │ VALIDATION │ FILE OPS"
  );
  console.log(
    "────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────"
  );

  recentRuns.forEach((run) => {
    const timePerFile =
      run.summary.totalFiles > 0 ? (run.metrics.totalTime / run.summary.totalFiles).toFixed(2) : "0.00";

    console.log(
      `${run.runId.padEnd(26)} │ ${timePerFile.padStart(9)}ms │ ${run.summary.totalFiles.toString().padStart(5)} │ ${run.summary.totalMoves.toString().padStart(5)} │ ${run.summary.avgAnalysisTime.toFixed(2).padStart(11)}ms │ ${run.metrics.fileDiscovery.time.toFixed(2).padStart(8)}ms │ ${run.metrics.validation.time.toFixed(2).padStart(9)}ms │ ${run.metrics.fileOperations.time.toFixed(2).padStart(8)}ms`
    );
  });
}

function generateImprovementAnalysis(history) {
  if (history.length < 2) {
    console.log("Need at least 2 runs to analyze improvements.");
    return;
  }

  const firstRun = history[0];
  const latestRun = history[history.length - 1];

  const improvements = {
    totalTimePerFile: calculatePercentageChange(
      firstRun.summary.totalFiles > 0 ? firstRun.metrics.totalTime / firstRun.summary.totalFiles : 0,
      latestRun.summary.totalFiles > 0 ? latestRun.metrics.totalTime / latestRun.summary.totalFiles : 0
    ),
    avgAnalysisTime: calculatePercentageChange(firstRun.summary.avgAnalysisTime, latestRun.summary.avgAnalysisTime),
    fileDiscoveryTime: calculatePercentageChange(
      firstRun.metrics.fileDiscovery.time,
      latestRun.metrics.fileDiscovery.time
    ),
    validationTime: calculatePercentageChange(firstRun.metrics.validation.time, latestRun.metrics.validation.time),
  };

  console.log(`Overall Performance Change (First vs Latest Run):`);
  console.log(
    `  Total Time per File: ${improvements.totalTimePerFile > 0 ? "+" : ""}${improvements.totalTimePerFile.toFixed(1)}%`
  );
  console.log(
    `  Average Analysis Time: ${improvements.avgAnalysisTime > 0 ? "+" : ""}${improvements.avgAnalysisTime.toFixed(1)}%`
  );
  console.log(
    `  File Discovery Time: ${improvements.fileDiscoveryTime > 0 ? "+" : ""}${improvements.fileDiscoveryTime.toFixed(1)}%`
  );
  console.log(
    `  Validation Time: ${improvements.validationTime > 0 ? "+" : ""}${improvements.validationTime.toFixed(1)}%`
  );

  // Find best and worst runs
  const bestRun = history.reduce((best, current) =>
    current.summary.avgAnalysisTime < best.summary.avgAnalysisTime ? current : best
  );
  const worstRun = history.reduce((worst, current) =>
    current.summary.avgAnalysisTime > worst.summary.avgAnalysisTime ? current : worst
  );

  console.log(
    `\nBest Performance Run: ${bestRun.runId} (${bestRun.summary.avgAnalysisTime.toFixed(2)}ms avg analysis)`
  );
  console.log(
    `Worst Performance Run: ${worstRun.runId} (${worstRun.summary.avgAnalysisTime.toFixed(2)}ms avg analysis)`
  );
}

function generateRecommendations(history) {
  const latestRun = history[history.length - 1];
  const recommendations = [];

  // Analyze file analysis time
  if (latestRun.summary.avgAnalysisTime > 100) {
    recommendations.push("🔧 File analysis is slow - consider optimizing AST parsing or import matching");
  }

  // Analyze move vs analysis time ratio
  const moveAnalysisRatio = latestRun.summary.avgMoveTime / latestRun.summary.avgAnalysisTime;
  if (moveAnalysisRatio < 0.1) {
    recommendations.push("🔧 Analysis time dominates - focus on optimizing import analysis");
  }

  // Analyze file discovery efficiency
  const discoveryEfficiency = latestRun.summary.totalFiles / latestRun.metrics.fileDiscovery.time;
  if (discoveryEfficiency < 10) {
    recommendations.push("🔧 File discovery is slow - consider optimizing glob patterns or file system access");
  }

  // Analyze validation time
  if (latestRun.metrics.validation.time > 100) {
    recommendations.push("🔧 Validation is taking too long - consider optimizing file existence checks");
  }

  // Analyze detailed timing breakdown
  const totalAnalysisTime =
    latestRun.metrics.importAnalysis.fileReadTime +
    latestRun.metrics.importAnalysis.astParseTime +
    latestRun.metrics.importAnalysis.importMatchingTime;
  if (latestRun.metrics.importAnalysis.astParseTime / totalAnalysisTime > 0.7) {
    recommendations.push("🔧 AST parsing dominates analysis time - consider caching parsed ASTs");
  }

  if (latestRun.metrics.importAnalysis.fileReadTime / totalAnalysisTime > 0.5) {
    recommendations.push("🔧 File reading dominates analysis time - consider batch file reading or caching");
  }

  if (recommendations.length === 0) {
    recommendations.push("✅ Performance looks good! No specific recommendations at this time.");
  }

  recommendations.forEach((rec) => console.log(`  ${rec}`));
}

// Generate HTML report
async function generateHTMLReport() {
  try {
    const historyFile = path.join(performanceDir, "performance_history.json");
    const historyData = await fs.readFile(historyFile, "utf8");
    const history = JSON.parse(historyData);

    if (history.length === 0) return;

    const html = generateHTMLContent(history);
    const htmlFile = path.join(performanceDir, "performance_report.html");
    await fs.writeFile(htmlFile, html);
    console.log(`\n📄 HTML report generated: ${htmlFile}`);
  } catch (error) {
    console.error("Error generating HTML report:", error.message);
  }
}

function generateHTMLContent(history) {
  const chartData = history.map((run) => ({
    runId: run.runId,
    totalTimePerFile: run.summary.totalFiles > 0 ? run.metrics.totalTime / run.summary.totalFiles : 0,
    avgAnalysisTime: run.summary.avgAnalysisTime,
    avgMoveTime: run.summary.avgMoveTime,
    avgUpdateTime: run.summary.avgUpdateTime,
    fileDiscoveryTime: run.metrics.fileDiscovery.time,
    validationTime: run.metrics.validation.time,
    precomputeTime:
      run.metrics.importAnalysis.time -
      (run.metrics.importAnalysis.fileReadTime +
        run.metrics.importAnalysis.astParseTime +
        run.metrics.importAnalysis.importMatchingTime),
    fileReadTime: run.metrics.importAnalysis.fileReadTime,
    astParseTime: run.metrics.importAnalysis.astParseTime,
    importMatchingTime: run.metrics.importAnalysis.importMatchingTime,
    totalFiles: run.summary.totalFiles,
    totalMoves: run.summary.totalMoves,
  }));

  return `
<!DOCTYPE html>
<html>
<head>
    <title>File Move Tool Performance Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .chart-container { margin: 20px 0; height: 400px; }
        .metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .metric-card { background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #007bff; }
        .metric-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .metric-label { color: #666; margin-top: 5px; }
        h1, h2 { color: #333; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f8f9fa; font-weight: bold; }
        .step-breakdown { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; margin: 20px 0; }
        .step-card { background: #f8f9fa; padding: 15px; border-radius: 5px; border-left: 4px solid #28a745; }
        .step-title { font-weight: bold; color: #333; margin-bottom: 10px; }
        .step-time { font-size: 18px; color: #28a745; }
        .step-description { color: #666; font-size: 14px; margin-top: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 File Move Tool Performance Report</h1>
        <p>Generated on ${new Date().toLocaleString()}</p>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-value">${history.length}</div>
                <div class="metric-label">Total Runs</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${history[history.length - 1].summary.totalFiles}</div>
                <div class="metric-label">Latest Files Processed</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${history[history.length - 1].summary.totalMoves}</div>
                <div class="metric-label">Latest Files Moved</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${(history[history.length - 1].summary.totalFiles > 0 ? history[history.length - 1].metrics.totalTime / history[history.length - 1].summary.totalFiles : 0).toFixed(2)}ms</div>
                <div class="metric-label">Latest Time per File</div>
            </div>
        </div>

        <h2>⏱️ Detailed Step Timing (Latest Run)</h2>
        <div class="step-breakdown">
            <div class="step-card">
                <div class="step-title">File Discovery</div>
                <div class="step-time">${history[history.length - 1].metrics.fileDiscovery.time.toFixed(2)}ms</div>
                <div class="step-description">Time to scan and find all source files</div>
            </div>
            <div class="step-card">
                <div class="step-title">Validation</div>
                <div class="step-time">${history[history.length - 1].metrics.validation.time.toFixed(2)}ms</div>
                <div class="step-description">Time to validate all move operations</div>
            </div>
            <div class="step-card">
                <div class="step-title">Import Path Precompute</div>
                <div class="step-time">${(history[history.length - 1].metrics.importAnalysis.time - (history[history.length - 1].metrics.importAnalysis.fileReadTime + history[history.length - 1].metrics.importAnalysis.astParseTime + history[history.length - 1].metrics.importAnalysis.importMatchingTime)).toFixed(2)}ms</div>
                <div class="step-description">Time to pre-generate import path variations</div>
            </div>
            <div class="step-card">
                <div class="step-title">File Reading</div>
                <div class="step-time">${history[history.length - 1].metrics.importAnalysis.fileReadTime.toFixed(2)}ms</div>
                <div class="step-description">Time to read file contents from disk</div>
            </div>
            <div class="step-card">
                <div class="step-title">AST Parsing</div>
                <div class="step-time">${history[history.length - 1].metrics.importAnalysis.astParseTime.toFixed(2)}ms</div>
                <div class="step-description">Time to parse JavaScript/TypeScript AST</div>
            </div>
            <div class="step-card">
                <div class="step-title">Import Matching</div>
                <div class="step-time">${history[history.length - 1].metrics.importAnalysis.importMatchingTime.toFixed(2)}ms</div>
                <div class="step-description">Time to match and find import statements</div>
            </div>
            <div class="step-card">
                <div class="step-title">File Operations</div>
                <div class="step-time">${history[history.length - 1].metrics.fileOperations.time.toFixed(2)}ms</div>
                <div class="step-description">Time to move files and update imports</div>
            </div>
        </div>

        <h2>📈 Performance Trends: Avg Analysis Time</h2>
        <div class="chart-container">
            <canvas id="analysisTimeChart"></canvas>
        </div>

        <h2>📈 Performance Trends: Step Breakdown</h2>
        <div class="chart-container">
            <canvas id="stepBreakdownChart"></canvas>
        </div>

        <h2>📋 Recent Runs</h2>
        <table>
            <thead>
                <tr>
                    <th>Run ID</th>
                    <th>Time per File</th>
                    <th>Files</th>
                    <th>Moves</th>
                    <th>Avg Analysis</th>
                    <th>File Discovery</th>
                    <th>Validation</th>
                    <th>File Ops</th>
                </tr>
            </thead>
            <tbody>
                ${history
                  .slice(-10)
                  .reverse()
                  .map(
                    (run) => `
                    <tr>
                        <td>${run.runId}</td>
                        <td>${(run.summary.totalFiles > 0 ? run.metrics.totalTime / run.summary.totalFiles : 0).toFixed(2)}ms</td>
                        <td>${run.summary.totalFiles}</td>
                        <td>${run.summary.totalMoves}</td>
                        <td>${run.summary.avgAnalysisTime.toFixed(2)}ms</td>
                        <td>${run.metrics.fileDiscovery.time.toFixed(2)}ms</td>
                        <td>${run.metrics.validation.time.toFixed(2)}ms</td>
                        <td>${run.metrics.fileOperations.time.toFixed(2)}ms</td>
                    </tr>
                `
                  )
                  .join("")}
            </tbody>
        </table>
    </div>

    <script>
        const chartData = ${JSON.stringify(chartData)};
        // Chart 1: Avg Analysis Time Only
        const ctx1 = document.getElementById('analysisTimeChart').getContext('2d');
        new Chart(ctx1, {
            type: 'line',
            data: {
                labels: chartData.map(d => d.runId),
                datasets: [{
                    label: 'Avg Analysis Time (ms)',
                    data: chartData.map(d => d.avgAnalysisTime),
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.2)',
                    yAxisID: 'y1',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Avg Analysis Time (ms)'
                        }
                    }
                },
                plugins: {
                    legend: { position: 'top' }
                }
            }
        });

        // Chart 2: Step Breakdown (excluding Avg Analysis Time and Precompute)
        const ctx2 = document.getElementById('stepBreakdownChart').getContext('2d');
        new Chart(ctx2, {
            type: 'line',
            data: {
                labels: chartData.map(d => d.runId),
                datasets: [
                    {
                        label: 'Time per File (ms)',
                        data: chartData.map(d => d.totalTimePerFile),
                        borderColor: 'rgb(75, 192, 192)',
                        backgroundColor: 'rgba(75, 192, 192, 0.2)',
                        yAxisID: 'y2',
                    },
                    {
                        label: 'File Discovery (ms)',
                        data: chartData.map(d => d.fileDiscoveryTime),
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        yAxisID: 'y2',
                    },
                    {
                        label: 'Validation (ms)',
                        data: chartData.map(d => d.validationTime),
                        borderColor: 'rgb(255, 205, 86)',
                        backgroundColor: 'rgba(255, 205, 86, 0.2)',
                        yAxisID: 'y2',
                    },
                    {
                        label: 'File Ops (ms)',
                        data: chartData.map(d => d.avgMoveTime),
                        borderColor: 'rgb(153, 102, 255)',
                        backgroundColor: 'rgba(153, 102, 255, 0.2)',
                        yAxisID: 'y2',
                    },
                    {
                        label: 'File Read (ms)',
                        data: chartData.map(d => d.fileReadTime),
                        borderColor: 'rgb(0, 200, 83)',
                        backgroundColor: 'rgba(0, 200, 83, 0.2)',
                        yAxisID: 'y2',
                    },
                    {
                        label: 'AST Parse (ms)',
                        data: chartData.map(d => d.astParseTime),
                        borderColor: 'rgb(255, 87, 34)',
                        backgroundColor: 'rgba(255, 87, 34, 0.2)',
                        yAxisID: 'y2',
                    },
                    {
                        label: 'Import Match (ms)',
                        data: chartData.map(d => d.importMatchingTime),
                        borderColor: 'rgb(33, 150, 243)',
                        backgroundColor: 'rgba(33, 150, 243, 0.2)',
                        yAxisID: 'y2',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y2: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Step Time (ms)'
                        }
                    }
                },
                plugins: {
                    legend: { position: 'top' }
                }
            }
        });
    </script>
</body>
</html>
  `;
}

// Main execution
async function main() {
  await generatePerformanceReport();
  await generateHTMLReport();
}

main().catch(console.error);
