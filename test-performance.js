#!/usr/bin/env node

// Simple test to verify enhanced performance tracking
import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🧪 Testing enhanced performance tracking...\n");

// Create a simple test file
const testFile = path.join(__dirname, "temp", "test-file.ts");
const testContent = `
import { something } from './test-file';
import { other } from '../utils/helper';
export { something };
`;

async function runTest() {
  try {
    // Ensure temp directory exists
    await fs.mkdir(path.join(__dirname, "temp"), { recursive: true });

    // Create test file
    await fs.writeFile(testFile, testContent);

    // Run the file mover with verbose output
    const child = spawn("npx", ["tsx", "src/index.ts", testFile, "temp/moved-test-file.ts", "--verbose", "--dry-run"], {
      stdio: "pipe",
      cwd: __dirname,
    });

    let output = "";
    let errorOutput = "";

    child.stdout.on("data", (data) => {
      output += data.toString();
    });

    child.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    child.on("close", (code) => {
      console.log("Output:");
      console.log(output);

      if (errorOutput) {
        console.log("Errors:");
        console.log(errorOutput);
      }

      console.log(`\nExit code: ${code}`);

      // Check if performance summary contains detailed breakdown
      if (
        output.includes("Import Analysis Details:") &&
        output.includes("File reading:") &&
        output.includes("AST parsing:") &&
        output.includes("Import matching:")
      ) {
        console.log("✅ Enhanced performance tracking is working correctly!");
      } else {
        console.log("❌ Enhanced performance tracking may not be working as expected.");
      }

      // Cleanup
      fs.unlink(testFile).catch(() => {});
    });
  } catch (error) {
    console.error("Test failed:", error);
  }
}

runTest();
