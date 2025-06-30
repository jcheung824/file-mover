import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

async function fixExtensionsRecursive(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await fixExtensionsRecursive(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      let content = await fs.readFile(fullPath, "utf8");
      content = content.replace(/from ['"](\.\.\/[^'"]*?)(['"])/g, (match, importPath, quote) => {
        if (!importPath.endsWith(".js")) {
          return `from ${quote}${importPath}.js${quote}`;
        }
        return match;
      });
      content = content.replace(/from ['"](\.\/[^'"]*?)(['"])/g, (match, importPath, quote) => {
        if (!importPath.endsWith(".js")) {
          return `from ${quote}${importPath}.js${quote}`;
        }
        return match;
      });
      await fs.writeFile(fullPath, content);
    }
  }
}

fixExtensionsRecursive(distDir).catch(console.error);
