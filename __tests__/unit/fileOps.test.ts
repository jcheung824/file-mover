import { TestFileSystem, createTestFileContent } from "../utils/testHelpers";
import { updateImportsInFile, updateImportsInMovedFile } from "../../src/fileOps";

// Mock global appState
declare global {
  var appState: {
    fileMoves: [fromPath: string, toPath: string][];
    fileMoveMap: Map<string, string>;
    verbose: boolean;
    dryRun: boolean;
  };
}

globalThis.appState = {
  fileMoves: [],
  fileMoveMap: new Map(),
  verbose: false,
  dryRun: false,
};

describe("fileOps", () => {
  let testFS: TestFileSystem;

  beforeEach(async () => {
    testFS = new TestFileSystem();
    await testFS.createTempDirectory();
    globalThis.appState.fileMoveMap.clear();
    globalThis.appState.fileMoves = [];
    globalThis.appState.verbose = false;
    globalThis.appState.dryRun = false;
  });

  afterEach(async () => {
    await testFS.cleanup();
  });

  describe("updateImportsInFile", () => {
    it("should update relative imports when file is moved", async () => {
      // Create a file in a proper package structure
      const filePath = await testFS.createTestFile(
        "packages/powerva-main/src/components/Button.ts",
        createTestFileContent.simpleImport("./utils/helper")
      );

      const imports = [
        {
          line: 1,
          originalLine: "import { something } from './utils/helper';",
          importPath: "./utils/helper",
          matchedText: "import { something } from './utils/helper';",
        },
      ];

      // Use relative path from temp directory root
      const newPath = "packages/powerva-main/src/utils/helper.ts";
      const config = {
        includedPackageFolders: ["powerva-main"],
        includedAppsFolders: [],
        excludePatterns: [],
        includePatterns: ["**/*.ts"],
        cwd: testFS.getTempDir()!,
      };

      // Temporarily change working directory to temp directory
      const originalCwd = process.cwd();
      process.chdir(testFS.getTempDir()!);

      try {
        const result = await updateImportsInFile({
          currentFilePath: filePath,
          imports,
          targetFileMoveToNewPath: newPath,
          config,
        });

        expect(result).toBe(true);

        const updatedContent = await testFS.readFile(filePath);
        expect(updatedContent).toContain("@ms/powerva-main/lib/utils/helper");
      } finally {
        // Restore original working directory
        process.chdir(originalCwd);
      }
    });

    it("should not update file when no imports match", async () => {
      const filePath = await testFS.createTestFile(
        "packages/powerva-main/src/components/Button.ts",
        createTestFileContent.simpleImport("react")
      );

      const imports = [
        {
          line: 1,
          originalLine: "import React from 'react';",
          importPath: "react",
          matchedText: "import React from 'react';",
        },
      ];

      // Use relative path from temp directory root
      const newPath = "packages/powerva-main/src/utils/helper.ts";
      const config = {
        includedPackageFolders: ["powerva-main"],
        includedAppsFolders: [],
        excludePatterns: [],
        includePatterns: ["**/*.ts"],
        cwd: testFS.getTempDir()!,
      };

      // Temporarily change working directory to temp directory
      const originalCwd = process.cwd();
      process.chdir(testFS.getTempDir()!);

      try {
        const result = await updateImportsInFile({
          currentFilePath: filePath,
          imports,
          targetFileMoveToNewPath: newPath,
          config,
        });

        expect(result).toBe(false);

        const updatedContent = await testFS.readFile(filePath);
        expect(updatedContent).toBe(createTestFileContent.simpleImport("react"));
      } finally {
        // Restore original working directory
        process.chdir(originalCwd);
      }
    });

    it("should handle file not found gracefully", async () => {
      const imports = [
        {
          line: 1,
          originalLine: "import { something } from './utils/helper';",
          importPath: "./utils/helper",
          matchedText: "import { something } from './utils/helper';",
        },
      ];

      // Use relative path from temp directory root
      const newPath = "packages/powerva-main/src/utils/helper.ts";
      const config = {
        includedPackageFolders: ["powerva-main"],
        includedAppsFolders: [],
        excludePatterns: [],
        includePatterns: ["**/*.ts"],
        cwd: testFS.getTempDir()!,
      };

      const result = await updateImportsInFile({
        currentFilePath: "/nonexistent/file.ts",
        imports,
        targetFileMoveToNewPath: newPath,
        config,
      });

      expect(result).toBe(false);
    });
  });

  describe("updateImportsInMovedFile", () => {
    it("should update imports within the moved file", async () => {
      const oldPath = "packages/powerva-main/src/components/Button.ts";
      const newPath = await testFS.createTestFile(
        "packages/powerva-main/src/components/forms/Button.ts",
        createTestFileContent.simpleImport("./utils/helper")
      );

      // Temporarily change working directory to temp directory
      const originalCwd = process.cwd();
      process.chdir(testFS.getTempDir()!);

      try {
        await updateImportsInMovedFile(oldPath, newPath);

        const updatedContent = await testFS.readFile(newPath);
        expect(updatedContent).toContain("../utils/helper");
      } finally {
        // Restore original working directory
        process.chdir(originalCwd);
      }
    });

    it("should handle monorepo imports in moved file", async () => {
      const oldPath = "packages/powerva-main/src/components/Button.ts";
      const newPath = await testFS.createTestFile(
        "packages/powerva-main/src/components/forms/Button.ts",
        createTestFileContent.monorepoImport("powerva-main", "utils/helper")
      );

      // Temporarily change working directory to temp directory
      const originalCwd = process.cwd();
      process.chdir(testFS.getTempDir()!);

      try {
        await updateImportsInMovedFile(oldPath, newPath);

        const updatedContent = await testFS.readFile(newPath);
        expect(updatedContent).toContain("../utils/helper");
      } finally {
        // Restore original working directory
        process.chdir(originalCwd);
      }
    });

    it("should handle files with parsing errors gracefully", async () => {
      const oldPath = "packages/powerva-main/src/components/Button.ts";
      const newPath = await testFS.createTestFile(
        "packages/powerva-main/src/components/forms/Button.ts",
        "invalid syntax {"
      );

      globalThis.appState.verbose = true;
      await updateImportsInMovedFile(oldPath, newPath);

      // Should not throw error
      const content = await testFS.readFile(newPath);
      expect(content).toBe("invalid syntax {");
    });
  });
});
