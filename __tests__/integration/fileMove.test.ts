import { promises as fs } from "fs";
import path from "path";
import { TestFileSystem, createTestFileContent, createMockConfig } from "../utils/testHelpers";

// Mock the main functionality - we'll test the core logic without the CLI
import { findDependencyImports } from "../../src/importUtils";
import { updateImportsInFile } from "../../src/fileOps";
import { generateImportPathVariations } from "../../src/importUtils";

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

// TODO: Fix this test
describe.skip("File Move Integration Tests", () => {
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

  describe("Complete File Move Workflow", () => {
    it("should move a file and update all imports across multiple files", async () => {
      const config = createMockConfig({ cwd: testFS.getTempDir()! });

      // Create a monorepo structure
      const structure = [
        {
          path: "packages/powerva-main/src/utils",
          files: [
            {
              path: "helper.ts",
              content: createTestFileContent.simpleImport("lodash"),
            },
          ],
        },
        {
          path: "packages/powerva-main/src/components",
          files: [
            {
              path: "Button.ts",
              content: createTestFileContent.simpleImport("./utils/helper"),
            },
            {
              path: "Icon.ts",
              content: createTestFileContent.simpleImport("./utils/helper"),
            },
          ],
        },
        {
          path: "packages/powerva-shared/src/components",
          files: [
            {
              path: "Card.ts",
              content: createTestFileContent.monorepoImport("powerva-main", "utils/helper"),
            },
          ],
        },
      ];

      const createdFiles = await testFS.createTestStructure(structure);
      const helperFile = createdFiles.find((f) => f.includes("helper.ts"))!;
      const buttonFile = createdFiles.find((f) => f.includes("Button.ts"))!;
      const iconFile = createdFiles.find((f) => f.includes("Icon.ts"))!;
      const cardFile = createdFiles.find((f) => f.includes("Card.ts"))!;

      // Simulate moving helper.ts to a new location
      const oldPath = helperFile;
      const newPath = path.join(path.dirname(helperFile), "..", "shared", "helper.ts");

      // Create the new directory and move the file
      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.rename(oldPath, newPath);

      // Update the global file move map
      globalThis.appState.fileMoveMap.set(oldPath, newPath);

      // Generate import path variations for the moved file
      const importPathVariations = generateImportPathVariations(newPath, config);

      // Find and update imports in all files
      const filesToUpdate = [buttonFile, iconFile, cardFile];
      let totalUpdates = 0;

      for (const filePath of filesToUpdate) {
        const content = await testFS.readFile(filePath);
        const imports = findDependencyImports({
          content,
          targetImportPaths: importPathVariations,
          currentFile: filePath,
        });

        if (imports.length > 0) {
          const updated = await updateImportsInFile({
            currentFilePath: filePath,
            imports,
            targetFileMoveToNewPath: newPath,
            config,
          });
          if (updated) totalUpdates++;
        }
      }

      // Verify the results
      expect(totalUpdates).toBeGreaterThan(0);

      // Check that imports were updated correctly
      const updatedButtonContent = await testFS.readFile(buttonFile);
      const updatedIconContent = await testFS.readFile(iconFile);
      const updatedCardContent = await testFS.readFile(cardFile);

      // Button and Icon should now import from the new location
      expect(updatedButtonContent).toContain("../shared/helper");
      expect(updatedIconContent).toContain("../shared/helper");

      // Card should still use the monorepo import but updated path
      expect(updatedCardContent).toContain("@ms/powerva-main/lib/shared/helper");
    });

    it("should handle moving files between packages", async () => {
      const config = createMockConfig({ cwd: testFS.getTempDir()! });

      // Create files in different packages
      const structure = [
        {
          path: "packages/powerva-main/src/utils",
          files: [
            {
              path: "helper.ts",
              content: 'export const helper = () => "help";',
            },
          ],
        },
        {
          path: "packages/powerva-shared/src/components",
          files: [
            {
              path: "Button.ts",
              content: createTestFileContent.monorepoImport("powerva-main", "utils/helper"),
            },
          ],
        },
      ];

      const createdFiles = await testFS.createTestStructure(structure);
      const helperFile = createdFiles.find((f) => f.includes("helper.ts"))!;
      const buttonFile = createdFiles.find((f) => f.includes("Button.ts"))!;

      // Move helper from powerva-main to powerva-shared
      const oldPath = helperFile;
      const newPath = path.join(testFS.getTempDir()!, "packages", "powerva-shared", "src", "utils", "helper.ts");

      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.rename(oldPath, newPath);

      globalThis.appState.fileMoveMap.set(oldPath, newPath);

      // Update imports
      const importPathVariations = generateImportPathVariations(newPath, config);
      const content = await testFS.readFile(buttonFile);
      const imports = findDependencyImports({
        content,
        targetImportPaths: importPathVariations,
        currentFile: buttonFile,
      });

      const updated = await updateImportsInFile({
        currentFilePath: buttonFile,
        imports,
        targetFileMoveToNewPath: newPath,
        config,
      });

      expect(updated).toBe(true);

      const updatedContent = await testFS.readFile(buttonFile);
      expect(updatedContent).toContain("@ms/powerva-shared/lib/utils/helper");
    });

    it("should handle complex import scenarios with multiple import types", async () => {
      const config = createMockConfig({ cwd: testFS.getTempDir()! });

      const structure = [
        {
          path: "packages/powerva-main/src/utils",
          files: [
            {
              path: "helper.ts",
              content: 'export const helper = () => "help";',
            },
          ],
        },
        {
          path: "packages/powerva-main/src/components",
          files: [
            {
              path: "ComplexComponent.ts",
              content: createTestFileContent.complexFile([
                { type: "relative", path: "./utils/helper" },
                { type: "monorepo", path: "@ms/powerva-main/lib/utils/helper" },
                { type: "external", path: "react" },
              ]),
            },
          ],
        },
      ];

      const createdFiles = await testFS.createTestStructure(structure);
      const helperFile = createdFiles.find((f) => f.includes("helper.ts"))!;
      const complexFile = createdFiles.find((f) => f.includes("ComplexComponent.ts"))!;

      // Move helper to a new location
      const oldPath = helperFile;
      const newPath = path.join(path.dirname(helperFile), "..", "shared", "helper.ts");

      await fs.mkdir(path.dirname(newPath), { recursive: true });
      await fs.rename(oldPath, newPath);

      globalThis.appState.fileMoveMap.set(oldPath, newPath);

      // Update imports
      const importPathVariations = generateImportPathVariations(newPath, config);
      const content = await testFS.readFile(complexFile);
      const imports = findDependencyImports({
        content,
        targetImportPaths: importPathVariations,
        currentFile: complexFile,
      });

      const updated = await updateImportsInFile({
        currentFilePath: complexFile,
        imports,
        targetFileMoveToNewPath: newPath,
        config,
      });

      expect(updated).toBe(true);

      const updatedContent = await testFS.readFile(complexFile);

      // Should update both relative and monorepo imports
      expect(updatedContent).toContain("../shared/helper");
      expect(updatedContent).toContain("@ms/powerva-main/lib/shared/helper");

      // Should not touch external imports
      expect(updatedContent).toContain("react");
    });
  });

  describe("Error Handling", () => {
    it("should handle files with syntax errors", async () => {
      const config = createMockConfig({ cwd: testFS.getTempDir()! });

      const structure = [
        {
          path: "packages/powerva-main/src/components",
          files: [
            {
              path: "BrokenComponent.ts",
              content: 'invalid syntax { import { something } from "./utils/helper";',
            },
          ],
        },
      ];

      const createdFiles = await testFS.createTestStructure(structure);
      const brokenFile = createdFiles.find((f) => f.includes("BrokenComponent.ts"))!;

      const helperPath = path.join(testFS.getTempDir()!, "packages", "powerva-main", "src", "utils", "helper.ts");
      const importPathVariations = generateImportPathVariations(helperPath, config);
      const content = await testFS.readFile(brokenFile);

      globalThis.appState.verbose = true;
      const imports = findDependencyImports({
        content,
        targetImportPaths: importPathVariations,
        currentFile: brokenFile,
      });

      // Should not crash, just return empty imports
      expect(imports).toHaveLength(0);
    });
  });
});
