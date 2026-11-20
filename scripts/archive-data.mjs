#!/usr/bin/env node
/**
 * Builds monthly archive chunks (archive/YYYY-MM.json + recent.json) and updates
 * manifest.json with chunk metadata while keeping vocab.json & sentences.json 100% intact.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitDatasetByMonth } from '../js/archive.js';

export async function buildArchivesForDir(dataDir, { recentDays = 90 } = {}) {
  const vocab = JSON.parse(await readFile(resolve(dataDir, 'vocab.json'), 'utf8'));
  const sentences = JSON.parse(await readFile(resolve(dataDir, 'sentences.json'), 'utf8'));
  const manifestPath = resolve(dataDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  const split = splitDatasetByMonth(vocab, sentences, { recentDays });

  if (split.olderMonths.length === 0) {
    // Small or all-recent dataset: keep manifest clean without redundant chunk files
    const updatedManifest = {
      ...manifest,
      chunks: {
        recentDays,
        cutoffIso: split.cutoffIso,
        recent: null,
        archiveMonths: [],
        monthsSummary: split.months.map((m) => ({
          month: m.month,
          vocabCount: m.vocab.length,
          sentenceCount: m.sentences.length,
        })),
      },
    };
    await writeFile(manifestPath, JSON.stringify(updatedManifest, null, 2) + '\n', 'utf8');
    return { archivedMonths: 0, recentCount: split.recent.vocab.length + split.recent.sentences.length };
  }

  const archiveDir = resolve(dataDir, 'archive');
  await mkdir(archiveDir, { recursive: true });

  await writeFile(
    resolve(dataDir, 'recent.json'),
    JSON.stringify({ cutoffIso: split.cutoffIso, vocab: split.recent.vocab, sentences: split.recent.sentences }, null, 2) + '\n',
    'utf8'
  );

  for (const m of split.olderMonths) {
    await writeFile(
      resolve(archiveDir, `${m.month}.json`),
      JSON.stringify({ month: m.month, vocab: m.vocab, sentences: m.sentences }, null, 2) + '\n',
      'utf8'
    );
  }

  const updatedManifest = {
    ...manifest,
    chunks: {
      recentDays,
      cutoffIso: split.cutoffIso,
      recent: 'recent.json',
      archiveMonths: split.olderMonths.map((m) => ({
        month: m.month,
        vocabCount: m.vocab.length,
        sentenceCount: m.sentences.length,
      })),
      monthsSummary: split.months.map((m) => ({
        month: m.month,
        vocabCount: m.vocab.length,
        sentenceCount: m.sentences.length,
      })),
    },
  };
  await writeFile(manifestPath, JSON.stringify(updatedManifest, null, 2) + '\n', 'utf8');

  return {
    archivedMonths: split.olderMonths.length,
    recentVocab: split.recent.vocab.length,
    recentSentences: split.recent.sentences.length,
  };
}

async function main() {
  const cfg = JSON.parse(await readFile(resolve(process.cwd(), 'data/profiles.json'), 'utf8'));
  for (const profile of cfg.profiles) {
    const dir = resolve(process.cwd(), profile.dataDir || 'data');
    const res = await buildArchivesForDir(dir);
    console.log(`📦 [${profile.id}] Archive index updated (${res.archivedMonths} archived months)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('❌ Archive build failed:', err);
    process.exit(1);
  });
}
