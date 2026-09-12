import { copyFileSync, existsSync, lstatSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const source = join(root, "..", "packages", "runtime-api", "src", "camoufox-bundle-validator.py");
const targetDir = join(root, "..", "dist", "packages", "runtime-api", "src");
const target = join(targetDir, "camoufox-bundle-validator.py");
const staleGeneratedFiles = [
  "camoufox-driver.py",
  "camoufox-native-playwright.py",
  "camoufox-driver.js",
  "camoufox-driver.d.ts",
  "camoufox-driver.test.js",
  "camoufox-driver.test.d.ts",
  "camoufox-interaction.test.js",
  "camoufox-interaction.test.d.ts"
];

if (!existsSync(source)) throw new Error(`Camoufox bundle validator source is missing: ${source}`);
mkdirSync(targetDir, { recursive: true });

for (const file of staleGeneratedFiles) {
  const stale = join(targetDir, file);
  try {
    const metadata = lstatSync(stale);
    if (metadata.isDirectory()) throw new Error(`Refusing to remove stale Camoufox output directory: ${stale}`);
    if (!metadata.isFile() && !metadata.isSymbolicLink()) throw new Error(`Refusing to remove stale Camoufox output with unsafe type: ${stale}`);
    unlinkSync(stale);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
    throw error;
  }
}

copyFileSync(source, target);
