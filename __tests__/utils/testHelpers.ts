import { promises as fs } from "fs";
import path from "path";
import os from "os";

export interface TestFile {
  path: string;
  content: string;
}

export interface TestDirectory {
  path: string;
  files: TestFile[];
}

export class TestFileSystem {
  private tempDir: string | null = null;

  async createTempDirectory(): Promise<string> {
    this.tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-move-test-"));
    return this.tempDir;
  }

  async createTestFile(filePath: string, content: string): Promise<string> {
    if (!this.tempDir) {
      throw new Error("Temp directory not created. Call createTempDirectory() first.");
    }

    const fullPath = path.join(this.tempDir, filePath);
    const dir = path.dirname(fullPath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Create file
    await fs.writeFile(fullPath, content, "utf8");
    return fullPath;
  }

  async createTestStructure(structure: TestDirectory[]): Promise<string[]> {
    const createdFiles: string[] = [];

    for (const dir of structure) {
      const dirPath = path.join(this.tempDir!, dir.path);
      await fs.mkdir(dirPath, { recursive: true });

      for (const file of dir.files) {
        const filePath = path.join(dirPath, file.path);
        await fs.writeFile(filePath, file.content, "utf8");
        createdFiles.push(filePath);
      }
    }

    return createdFiles;
  }

  async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, "utf8");
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async cleanup(): Promise<void> {
    if (this.tempDir) {
      try {
        await fs.rm(this.tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn("Failed to cleanup temp directory:", error);
      }
      this.tempDir = null;
    }
  }

  getTempDir(): string | null {
    return this.tempDir;
  }
}

export const createMockConfig = (
  overrides: Partial<{
    includedPackageFolders: string[];
    includedAppsFolders: string[];
    excludePatterns: string[];
    includePatterns: string[];
    cwd: string;
  }> = {}
) => ({
  includedPackageFolders: ["powerva-main", "powerva-shared"],
  includedAppsFolders: ["powerva-app"],
  excludePatterns: ["**/node_modules/**", "**/dist/**"],
  includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  cwd: process.cwd(),
  ...overrides,
});

export const createTestFileContent = {
  simpleImport: (importPath: string) => `import { something } from '${importPath}';
export const test = something;`,

  multipleImports: (imports: string[]) => `import { something } from '${imports[0]}';
import { other } from '${imports[1]}';
export const test = { something, other };`,

  relativeImport: (relativePath: string) => `import { Component } from '${relativePath}';
export default Component;`,

  monorepoImport: (packageName: string, path: string) => `import { util } from '@ms/${packageName}/lib/${path}';
export { util };`,

  complexFile: (
    imports: Array<{
      type: "relative" | "monorepo" | "external";
      path: string;
    }>
  ) => {
    const importStatements = imports
      .map((imp) => {
        switch (imp.type) {
          case "relative":
            return `import { local } from '${imp.path}';`;
          case "monorepo":
            return `import { shared } from '${imp.path}';`;
          case "external":
            return `import { external } from '${imp.path}';`;
        }
      })
      .join("\n");

    return `${importStatements}
export const combined = { local, shared, external };`;
  },
};

test("dummy", () => {
  expect(true).toBe(true);
});
