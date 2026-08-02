import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Repository } from '../db/repository.js';
import { buildPublicSnapshot, snapshotToFiles, type PublicMeta } from './publicSnapshot.js';

export async function writePublicSnapshot(
  repo: Repository,
  outDir: string,
  exportedAt = new Date(),
): Promise<PublicMeta> {
  const snapshot = buildPublicSnapshot(repo, exportedAt);
  await mkdir(outDir, { recursive: true });

  for (const [fileName, contents] of Object.entries(snapshotToFiles(snapshot))) {
    await writeFile(join(outDir, fileName), `${JSON.stringify(contents, null, 2)}\n`, 'utf8');
  }

  return snapshot.meta;
}
