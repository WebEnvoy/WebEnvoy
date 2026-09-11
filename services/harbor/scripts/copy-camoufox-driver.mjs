import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const files = ["camoufox-driver.py", "camoufox-native-playwright.py"];
for (const file of files) {
  const source = join(root, "..", "packages", "runtime-api", "src", file);
  const target = join(root, "..", "dist", "packages", "runtime-api", "src", file);
  if (!existsSync(source)) throw new Error(`Camoufox Driver helper source is missing: ${source}`);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
