#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDataFiles } from './schema.mjs';

const ROOT = process.cwd();

async function readJson(relPath) {
  const raw = await readFile(resolve(ROOT, relPath), 'utf8');
  return JSON.parse(raw);
}

async function validateProfileDir(profile) {
  const dir = profile.dataDir || 'data';
  const [vocab, sentences, wordIndex, manifest] = await Promise.all([
    readJson(`${dir}/vocab.json`),
    readJson(`${dir}/sentences.json`),
    readJson(`${dir}/word-index.json`),
    readJson(`${dir}/manifest.json`),
  ]);

  const result = validateDataFiles({ vocab, sentences, wordIndex, manifest });
  if (!result.valid) {
    console.error(`❌ Profile "${profile.id}" (${dir}) validation failed:`);
    for (const err of result.errors.slice(0, 20)) {
      console.error('  -', err);
    }
    return false;
  }

  console.log(
    `✅ [${profile.id}] ${profile.name} (${dir}): ${vocab.length} vocab, ${sentences.length} sentences, ${manifest.counts.pairs} pairs`
  );
  return true;
}

async function main() {
  const profilesCfg = await readJson('data/profiles.json');
  if (!profilesCfg || !Array.isArray(profilesCfg.profiles) || profilesCfg.profiles.length === 0) {
    console.error('❌ data/profiles.json must define a non-empty profiles array.');
    process.exit(1);
  }

  const seenIds = new Set();
  let allOk = true;
  for (const profile of profilesCfg.profiles) {
    if (!profile.id || seenIds.has(profile.id)) {
      console.error(`❌ Invalid or duplicate profile id: "${profile.id}"`);
      allOk = false;
      continue;
    }
    seenIds.add(profile.id);
    const ok = await validateProfileDir(profile);
    if (!ok) allOk = false;
  }

  if (!allOk) process.exit(1);
  console.log(`🎉 All ${profilesCfg.profiles.length} profile datasets validated successfully!`);
}

main().catch((err) => {
  console.error('❌ Failed to validate data files:', err.message);
  process.exit(1);
});
