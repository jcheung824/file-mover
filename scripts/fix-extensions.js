import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, "..", "dist");

async function fixExtensions() {
  const files = await fs.readdir(distDir);

  for (const file of files) {
    if (!file.endsWith(".js")) continue;

    const filePath = path.join(distDir, file);
    let content = await fs.readFile(filePath, "utf8");

    // Replace imports without extensions to add .js
    content = content.replace(
      /from ['"](\.\/[^'"]*?)(['"])/g,
      (match, importPath, quote) => {
        if (!importPath.endsWith(".js")) {
          return `from ${quote}${importPath}.js${quote}`;
        }
        return match;
      },
    );

    await fs.writeFile(filePath, content);
  }
}

fixExtensions().catch(console.error);
