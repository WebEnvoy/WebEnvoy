import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function previousRoot(input) {
  if (!input) return undefined;
  const path = resolve(input);
  const candidates = [path, join(path, 'Contents/Resources/app')];
  for (const candidate of candidates) {
    try {
      const canonical = await realpath(candidate);
      await readFile(join(canonical, 'agent-entry/bundle.mjs'));
      return canonical;
    } catch {}
  }
  throw new Error('previous_installation_invalid');
}
