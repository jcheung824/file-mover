import {
  isRelativeImport,
  isMonorepoPackageImport,
  getRelativeImportPath,
  checkIfFileIsPartOfMove,
  extractImportInfo,
  generateImportPathVariations,
  findDependencyImports,
  fileMoveDirection,
  updateSrcToLib,
  matchesTarget,
  createImportStatementRegexPatterns,
  setFileContentIfRegexMatches,
  handlePackageImportsUpdate,
  handleMovingFileImportsUpdate,
} from "../../src/importUtils";
import { normalizePath } from "../../src/pathUtils";
import { createMockConfig } from "../utils/testHelpers";
import path from "path";
import { NodePath } from "@babel/traverse";

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

describe("importUtils", () => {
  beforeEach(() => {
    globalThis.appState.fileMoveMap.clear();
    globalThis.appState.fileMoves = [];
    globalThis.appState.verbose = false;
    globalThis.appState.dryRun = false;
  });

  describe("isRelativeImport", () => {
    it("should identify relative imports", () => {
      expect(isRelativeImport("./utils/helper")).toBe(true);
      expect(isRelativeImport("../components/Button")).toBe(true);
      expect(isRelativeImport("../../shared/constants")).toBe(true);
    });

    it("should reject non-relative imports", () => {
      expect(isRelativeImport("react")).toBe(false);
      expect(isRelativeImport("@ms/powerva-main/lib/utils")).toBe(false);
      expect(isRelativeImport("lodash")).toBe(false);
    });
  });

  describe("isMonorepoPackageImport", () => {
    it("should identify monorepo package imports", () => {
      expect(isMonorepoPackageImport("@ms/powerva-main/lib/utils")).toBe(true);
      expect(isMonorepoPackageImport("@ms/powerva-shared/lib/components/Button")).toBe(true);
    });

    it("should reject non-monorepo imports", () => {
      expect(isMonorepoPackageImport("react")).toBe(false);
      expect(isMonorepoPackageImport("./utils/helper")).toBe(false);
      expect(isMonorepoPackageImport("lodash")).toBe(false);
    });
  });

  describe("getRelativeImportPath", () => {
    it("should generate relative paths correctly", () => {
      const fromFile = "/project/src/components/Button.ts";
      const toFile = "/project/src/utils/helper.ts";

      expect(getRelativeImportPath(fromFile, toFile)).toBe("../utils/helper");
    });

    it("should handle same directory imports", () => {
      const fromFile = "/project/src/components/Button.ts";
      const toFile = "/project/src/components/Icon.ts";

      expect(getRelativeImportPath(fromFile, toFile)).toBe("./Icon");
    });

    it("should handle TypeScript files without extension", () => {
      const fromFile = "/project/src/components/Button.ts";
      const toFile = "/project/src/utils/helper.tsx";

      expect(getRelativeImportPath(fromFile, toFile)).toBe("../utils/helper");
    });

    it("should preserve non-TypeScript extensions", () => {
      const fromFile = "/project/src/components/Button.ts";
      const toFile = "/project/src/assets/icon.png";

      expect(getRelativeImportPath(fromFile, toFile)).toBe("../assets/icon.png");
    });
  });

  describe("checkIfFileIsPartOfMove", () => {
    it("should check if file is in move map", () => {
      globalThis.appState.fileMoveMap.set("/old/path/file.ts", "/new/path/file.ts");

      expect(checkIfFileIsPartOfMove("/old/path/file.ts")).toBe(true);
      expect(checkIfFileIsPartOfMove("/other/path/file.ts")).toBe(false);
    });
  });

  describe("extractImportInfo", () => {
    it("should extract import information from AST node", () => {
      const mockPathNode = {
        node: {
          loc: { start: { line: 5 } },
          toString: () => "import { test } from './test';",
        },
        toString: () => "import { test } from './test';",
      };
      const content = "line1\nline2\nline3\nline4\nimport { test } from './test';";
      const importPath = "./test";

      const result = extractImportInfo(mockPathNode as NodePath, content, importPath);

      expect(result).toEqual({
        line: 5,
        originalLine: "import { test } from './test';",
        importPath: "./test",
        matchedText: "import { test } from './test';",
      });
    });

    it("should handle nodes without location", () => {
      const mockPathNode = {
        node: {
          loc: null,
          toString: () => "import { test } from './test';",
        },
        toString: () => "import { test } from './test';",
      };
      const content = "import { test } from './test';";
      const importPath = "./test";

      const result = extractImportInfo(mockPathNode as NodePath, content, importPath);

      expect(result.line).toBe(0);
      expect(result.originalLine).toBe("import { test } from './test';");
    });
  });

  describe("generateImportPathVariations", () => {
    const config = createMockConfig({ cwd: "/project" });

    it("should generate variations for regular files", () => {
      const targetPath = "/project/packages/powerva-main/src/utils/helper.ts";
      const variations = generateImportPathVariations(targetPath, config);

      expect(variations).toContain("packages/powerva-main/src/utils/helper");
      expect(variations).toContain("@ms/powerva-main/lib/utils/helper");
      expect(variations).toContain("packages/powerva-main/src/utils/helper.ts");
    });

    it("should generate variations for index files", () => {
      const targetPath = "/project/packages/powerva-main/src/utils/index.ts";
      const variations = generateImportPathVariations(targetPath, config);

      expect(variations).toContain("packages/powerva-main/src/utils");
      expect(variations).toContain("@ms/powerva-main/lib/utils");
      expect(variations).toContain("packages/powerva-main/src/utils/index");
    });
  });

  describe("fileMoveDirection", () => {
    it("should identify self moves", () => {
      const result = fileMoveDirection({
        oldPath: "packages/powerva-main/src/utils/helper.ts",
        newPath: "packages/powerva-main/src/utils/helper-new.ts",
      });

      expect(result).toBe("self");
    });

    it("should identify between packages moves", () => {
      const result = fileMoveDirection({
        oldPath: "packages/powerva-main/src/utils/helper.ts",
        newPath: "packages/powerva-shared/src/utils/helper.ts",
      });

      expect(result).toBe("betweenPackages");
    });

    it("should handle package to app moves", () => {
      const result = fileMoveDirection({
        oldPath: "packages/powerva-main/src/utils/helper.ts",
        newPath: "apps/powerva-app/src/utils/helper.ts",
      });

      expect(result).toBe("unknown");
    });
  });

  describe("updateSrcToLib", () => {
    it("should convert src to lib", () => {
      expect(updateSrcToLib("src/utils/helper")).toBe("lib/utils/helper");
      expect(updateSrcToLib("packages/package/src/components/Button")).toBe("packages/package/lib/components/Button");
    });

    it("should return unchanged path if no src found", () => {
      expect(updateSrcToLib("lib/utils/helper")).toBe("lib/utils/helper");
      expect(updateSrcToLib("utils/helper")).toBe("utils/helper");
    });
  });

  describe("matchesTarget", () => {
    const mockRoot = path.resolve("/project");
    it("should match exact import paths", () => {
      const result = matchesTarget({
        importPath: "./utils/helper",
        targetImportPaths: ["./utils/helper", "./other/file"],
        currentFile: "/project/src/components/Button.ts",
      });

      expect(result).toBe(true);
    });

    it("should match resolved paths", () => {
      const result = matchesTarget({
        importPath: "./utils/helper",
        targetImportPaths: [normalizePath(path.resolve(mockRoot, "src/components/utils/helper"))],
        currentFile: path.resolve(mockRoot, "src/components/Button.ts"),
      });

      expect(result).toBe(true);
    });

    it("should not match non-matching paths", () => {
      const result = matchesTarget({
        importPath: "./utils/helper",
        targetImportPaths: ["./other/file"],
        currentFile: "/project/src/components/Button.ts",
      });

      expect(result).toBe(false);
    });
  });

  describe("createImportStatementRegexPatterns", () => {
    it("should create regex patterns for import statements", () => {
      const patterns = createImportStatementRegexPatterns("./utils/helper");

      expect(patterns.quotedPattern).toBeInstanceOf(RegExp);
      expect(patterns.unquotedPattern).toBeInstanceOf(RegExp);
    });

    it("should escape special regex characters", () => {
      const patterns = createImportStatementRegexPatterns("./utils/helper.ts");

      expect(patterns.quotedPattern.source).toContain("\\.\\/utils\\/helper\\.ts");
    });
  });

  describe("setFileContentIfRegexMatches", () => {
    it("should replace content when regex matches", () => {
      const content = "import { test } from './old/path';";
      const regex = /'\.\/old\/path'/g;
      const replacement = "'./new/path'";

      const result = setFileContentIfRegexMatches(content, regex, replacement);

      expect(result).toBe("import { test } from './new/path';");
    });

    it("should return null when regex does not match", () => {
      const content = "import { test } from './old/path';";
      const regex = /'\.\/nonexistent\/path'/g;
      const replacement = "'./new/path'";

      const result = setFileContentIfRegexMatches(content, regex, replacement);

      expect(result).toBeNull();
    });
  });

  describe("handlePackageImportsUpdate", () => {
    it("should update relative imports to monorepo imports when moving between packages", () => {
      const result = handlePackageImportsUpdate({
        currentImportPath: "./utils/helper",
        currentFilePath: "/project/packages/powerva-shared/src/components/Button.ts",
        targetFileMoveToNewPath: "/project/packages/powerva-main/src/utils/helper.ts",
        fileContent: "import { helper } from './utils/helper';",
      });

      expect(result.updated).toBe(true);
      expect(result.updatedFileContent).toContain("@ms/powerva-main/lib/utils/helper");
    });
  });

  describe("handleMovingFileImportsUpdate", () => {
    it("should update relative imports when file is moved within same package", () => {
      const result = handleMovingFileImportsUpdate({
        importPath: "./utils/helper",
        originalMovedFilePath: "/project/packages/powerva-main/src/components/Button.ts",
        newMovedFilePath: "/project/packages/powerva-main/src/components/forms/Button.ts",
        fileContent: "import { helper } from './utils/helper';",
      });

      expect(result.updated).toBe(true);
      expect(result.updatedFileContent).toContain("../utils/helper");
      expect(result.updatedImportPath).toBe("../utils/helper");
    });

    it("should update monorepo imports when file is moved between packages", () => {
      const result = handleMovingFileImportsUpdate({
        importPath: "@ms/powerva-main/lib/utils/helper",
        originalMovedFilePath: "/project/packages/powerva-main/src/components/Button.ts",
        newMovedFilePath: "/project/packages/powerva-shared/src/components/Button.ts",
        fileContent: "import { helper } from '@ms/powerva-main/lib/utils/helper';",
      });

      expect(result.updated).toBe(true);
      expect(result.updatedFileContent).toContain("@ms/powerva-main/lib/utils/helper");
      expect(result.updatedImportPath).toBe("@ms/powerva-main/lib/utils/helper");
    });

    it("should update relative imports to monorepo imports when moving between packages", () => {
      // Setup: File is moving from powerva-main to powerva-shared
      // The file contains a relative import that should become a monorepo import
      const result = handleMovingFileImportsUpdate({
        importPath: "./utils/helper",
        originalMovedFilePath: "/project/packages/powerva-main/src/components/Button.ts",
        newMovedFilePath: "/project/packages/powerva-shared/src/components/Button.ts",
        fileContent: "import { helper } from './utils/helper';",
      });

      expect(result.updated).toBe(true);
      expect(result.updatedImportPath).toBe("@ms/powerva-main/lib/utils/helper");
    });

    it("should not update imports when no changes are needed", () => {
      // Setup: File is moving but import path doesn't need updating
      const result = handleMovingFileImportsUpdate({
        importPath: "react",
        originalMovedFilePath: "/project/packages/powerva-main/src/components/Button.ts",
        newMovedFilePath: "/project/packages/powerva-main/src/components/forms/Button.ts",
        fileContent: "import React from 'react';",
      });

      expect(result.updated).toBe(false);
      expect(result.updatedFileContent).toBe("import React from 'react';");
    });
  });

  describe("findDependencyImports", () => {
    it("should find import declarations", () => {
      const content = "import { helper } from './utils/helper';";
      const targetImportPaths = ["./utils/helper"];
      const currentFile = "/project/src/components/Button.ts";

      const result = findDependencyImports({
        content,
        targetImportPaths,
        currentFile,
      });

      expect(result).toHaveLength(1);
      expect(result[0].importPath).toBe("./utils/helper");
    });

    it("should find export declarations", () => {
      const content = "export { helper } from './utils/helper';";
      const targetImportPaths = ["./utils/helper"];
      const currentFile = "/project/src/components/Button.ts";

      const result = findDependencyImports({
        content,
        targetImportPaths,
        currentFile,
      });

      expect(result).toHaveLength(1);
      expect(result[0].importPath).toBe("./utils/helper");
    });

    it("should find require statements", () => {
      const content = "const helper = require('./utils/helper');";
      const targetImportPaths = ["./utils/helper"];
      const currentFile = "/project/src/components/Button.ts";

      const result = findDependencyImports({
        content,
        targetImportPaths,
        currentFile,
      });

      expect(result).toHaveLength(1);
      expect(result[0].importPath).toBe("./utils/helper");
    });

    it("should handle parsing errors gracefully", () => {
      const content = "invalid syntax {";
      const targetImportPaths = ["./utils/helper"];
      const currentFile = "/project/src/components/Button.ts";

      globalThis.appState.verbose = true;
      const result = findDependencyImports({
        content,
        targetImportPaths,
        currentFile,
      });

      expect(result).toHaveLength(0);
    });
  });
});
