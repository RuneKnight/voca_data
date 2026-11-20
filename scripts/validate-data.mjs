#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDataFiles } from './schema.mjs';

const dataDir = resolve(process.cwd(), 'data');

async function readJson(name) {
  const raw = await readFile(resolve(dataDir, name), 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const [vocab, sentences, wordIndex, manifest] = await Promise.all([
    readJson('vocab.json'),
    readJson('sentences.json'),
    readJson('word-index.json'),
    readJson('manifest.json'),
  ]);

  const result = validateDataFiles({ vocab, sentences, wordIndex, manifest });
  if (!result.valid) {
    console.error('❌ Data validation failed:');
    for (const err of result.errors.slice(0, 30)) {
      console.error('  -', err);
    }
    if (result.errors.length > 30) {
      console.error(`  ... and ${result.errors.length - 30} more errors`);
    }
    process.exit(1);
  }

  console.log(
    `✅ Data validation passed! (${vocab.length} vocab, ${sentences.length} sentences, ${manifest.counts.pairs} parallel pairs)`
  );
}

main().catch((err) => {
  console.error('❌ Failed to validate data files:', err.message);
  process.exit(1);
});
