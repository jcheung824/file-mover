import {
  normalizePath,
  removeExtension,
  getMsImportPath,
  resolveImportPath,
  getModuleType,
  getPathType,
  handleMonoRepoImportPathToAbsolutePath,
} from "../../src/pathUtils";
import path from "path";

describe("pathUtils", () => {
  describe("normalizePath", () => {
    it("should normalize Windows backslashes to forward slashes", () => {
      expect(normalizePath("C:\\Users\\test\\file.ts")).toBe("C:/Users/test/file.ts");
      expect(normalizePath("packages\\package-name\\src\\file.ts")).toBe("packages/package-name/src/file.ts");
    });

    it("should handle already normalized paths", () => {
      expect(normalizePath("packages/package-name/src/file.ts")).toBe("packages/package-name/src/file.ts");
    });

    it("should handle mixed separators", () => {
      expect(normalizePath("packages\\package-name/src\\file.ts")).toBe("packages/package-name/src/file.ts");
    });
  });

  describe("removeExtension", () => {
    it("should remove file extensions", () => {
      expect(removeExtension("file.ts")).toBe("file");
      expect(removeExtension("file.js")).toBe("file");
      expect(removeExtension("file.tsx")).toBe("file");
      expect(removeExtension("file.jsx")).toBe("file");
    });

    it("should handle paths with directories", () => {
      expect(removeExtension("src/components/file.ts")).toBe("src/components/file");
      expect(removeExtension("packages/package/src/utils/file.tsx")).toBe("packages/package/src/utils/file");
    });

    it("should handle files without extensions", () => {
      expect(removeExtension("file")).toBe("file");
      expect(removeExtension("src/file")).toBe("src/file");
    });

    it("should handle files with multiple dots", () => {
      expect(removeExtension("file.test.ts")).toBe("file.test");
      expect(removeExtension("file.spec.js")).toBe("file.spec");
    });
  });

  describe("getMsImportPath", () => {
    it("should convert package paths to MS import format", () => {
      expect(getMsImportPath("packages/powerva-main/src/utils/helper.ts")).toBe("@ms/powerva-main/lib/utils/helper");
      expect(getMsImportPath("packages/powerva-shared/src/components/Button.tsx")).toBe(
        "@ms/powerva-shared/lib/components/Button"
      );
    });

    it("should convert app paths to MS import format", () => {
      expect(getMsImportPath("apps/powerva-app/src/pages/Home.ts")).toBe("@ms/powerva-app/lib/pages/Home");
    });

    it("should throw error for invalid paths", () => {
      expect(() => getMsImportPath("invalid/path/file.ts")).toThrow("⚠️  getMsImportPath not found!");
      expect(() => getMsImportPath("src/file.ts")).toThrow("⚠️  getMsImportPath not found!");
    });
  });

  describe("resolveImportPath", () => {
    it("should resolve relative imports", () => {
      const currentFile = "/project/src/components/Button.ts";
      const currentDrive = process.cwd().split(path.sep)[0]; // Gets the drive letter (e.g., "C:")

      expect(resolveImportPath(currentFile, "./utils/helper")).toBe(
        `${currentDrive}/project/src/components/utils/helper`
      );
      expect(resolveImportPath(currentFile, "../utils/helper")).toBe(`${currentDrive}/project/src/utils/helper`);
      expect(resolveImportPath(currentFile, "../../shared/constants")).toBe(`${currentDrive}/project/shared/constants`);
    });

    it("should return absolute imports unchanged", () => {
      const currentFile = "/project/src/components/Button.ts";

      expect(resolveImportPath(currentFile, "@ms/powerva-main/lib/utils")).toBe("@ms/powerva-main/lib/utils");
      expect(resolveImportPath(currentFile, "react")).toBe("react");
      expect(resolveImportPath(currentFile, "lodash")).toBe("lodash");
    });

    it("should show current disk information", () => {
      console.log("Current working directory:", process.cwd());
      console.log("Current drive:", process.cwd().split(path.sep)[0]);
      console.log("Path separator:", path.sep);

      // This test will always pass, it's just for demonstration
      expect(process.cwd()).toBeTruthy();
    });
  });

  describe("getModuleType", () => {
    it("should identify monorepo package imports", () => {
      const result = getModuleType("@ms/powerva-main/lib/utils/helper");
      expect(result).toEqual({
        moduleType: "packages/powerva-main",
        moduleName: "powerva-main",
      });
    });

    it("should identify package paths", () => {
      const result = getModuleType("packages/powerva-shared/src/components/Button");
      expect(result).toEqual({
        moduleType: "packages/powerva-shared",
        moduleName: "powerva-shared",
      });
    });

    it("should identify app paths", () => {
      const result = getModuleType("apps/powerva-app/src/pages/Home");
      expect(result).toEqual({
        moduleType: "apps/powerva-app",
        moduleName: "powerva-app",
      });
    });

    it("should throw error for invalid paths", () => {
      expect(() => getModuleType("invalid/path")).toThrow("⚠️  Could not determine package name for invalid/path");
      expect(() => getModuleType("src/file")).toThrow("⚠️  Could not determine package name for src/file");
    });
  });

  describe("getPathType", () => {
    const config = {
      includedPackageFolders: ["powerva-main", "powerva-shared"],
      includedAppsFolders: ["powerva-app"],
    };

    it("should identify package paths", () => {
      expect(
        getPathType({
          filePath: "packages/powerva-main/src/utils/helper.ts",
          ...config,
        })
      ).toBe("package");

      expect(
        getPathType({
          filePath: "packages/powerva-shared/src/components/Button.tsx",
          ...config,
        })
      ).toBe("package");
    });

    it("should identify app paths", () => {
      expect(
        getPathType({
          filePath: "apps/powerva-app/src/pages/Home.ts",
          ...config,
        })
      ).toBe("app");
    });

    it("should return unknown for unrecognized paths", () => {
      expect(
        getPathType({
          filePath: "src/components/Button.ts",
          ...config,
        })
      ).toBe("unknown");

      expect(
        getPathType({
          filePath: "packages/unknown-package/src/file.ts",
          ...config,
        })
      ).toBe("unknown");
    });

    it("should handle Windows paths", () => {
      expect(
        getPathType({
          filePath: "packages\\powerva-main\\src\\utils\\helper.ts",
          ...config,
        })
      ).toBe("package");
    });
  });

  describe("handleMonoRepoImportPathToAbsolutePath", () => {
    it("should convert monorepo imports to absolute paths", () => {
      const directory = "/project/packages/powerva-main/src/components/Button.ts";
      const importPath = "@ms/powerva-main/lib/utils/helper";

      const result = handleMonoRepoImportPathToAbsolutePath(directory, importPath);
      expect(result).toBe("packages/powerva-main/src/utils/helper");
    });

    it("should return non-monorepo imports unchanged", () => {
      const directory = "/project/packages/powerva-main/src/components/Button.ts";
      const importPath = "react";

      const result = handleMonoRepoImportPathToAbsolutePath(directory, importPath);
      expect(result).toBe("react");
    });

    it("should handle complex paths", () => {
      const directory = "/project/packages/powerva-main/src/components/forms/Button.ts";
      const importPath = "@ms/powerva-main/lib/utils/validation/helper";

      const result = handleMonoRepoImportPathToAbsolutePath(directory, importPath);
      expect(result).toBe("packages/powerva-main/src/utils/validation/helper");
    });

    it("should throw error when packages directory not found", () => {
      const directory = "/project/src/components/Button.ts";
      const importPath = "@ms/powerva-main/lib/utils/helper";

      expect(() => handleMonoRepoImportPathToAbsolutePath(directory, importPath)).toThrow(
        "Could not find packages directory in the current path"
      );
    });
  });
});
