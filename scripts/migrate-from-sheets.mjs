#!/usr/bin/env node
/**
 * One-time (and re-runnable) lossless migration from Google Sheets GViz
 * to GitHub Repo JSON (data/vocab.json, data/sentences.json, data/word-index.json, data/manifest.json).
 *
 * Preserves exact legacyKey (`${Language}:${Word/Phrase}` or `${Language}:${Sentence}`)
 * so existing localStorage bookmarks and mastered records stay 100% compatible.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildLegacyKey,
  buildManifest,
  buildWordIndex,
  ensureUniqueId,
  inferCloze,
  inferPosAndGender,
  inferTags,
  normalizeForDedup,
  slugifyId,
  validateDataFiles,
} from './schema.mjs';

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1qTQXcLjq5--p-qYqG56QQ8JeqiKPWusoe4GkS22HSoI';
const VOCAB_GID = process.env.VOCAB_GID || '0';
const SENTENCE_GID = process.env.SENTENCE_GID || '765046051';

async function fetchGvizSheet(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?gid=${gid}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching sheet gid=${gid}`);
  }
  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) {
    throw new Error(`Unexpected GViz response format for gid=${gid}`);
  }
  const payload = JSON.parse(match[1]);
  const cols = payload.table.cols.map((c) => (c && c.label ? c.label.trim() : ''));
  return payload.table.rows
    .map((row) => {
      const obj = {};
      if (row && row.c) {
        row.c.forEach((cell, idx) => {
          const key = cols[idx];
          if (key) {
            const val = cell ? (cell.f !== undefined ? cell.f : cell.v !== null && cell.v !== undefined ? cell.v : '') : '';
            obj[key] = String(val).trim();
          }
        });
      }
      return obj;
    })
    .filter((r) => Object.values(r).some(Boolean));
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchVocabForSentence(sentenceText, langVocab) {
  const lowerSent = sentenceText.toLowerCase();
  const matched = [];
  for (const v of langVocab) {
    // Strip leading German article for stem/word matching in sentences
    const cleanWord = v.word.replace(/^(der|die|das)\s+/i, '').trim();
    if (cleanWord.length < 3) continue;
    const escaped = escapeRegex(cleanWord.toLowerCase());
    const pattern =
      cleanWord.length >= 5
        ? new RegExp(`\\b${escaped}(s|es|ed|ing|en|er|e|n)?\\b`, 'i')
        : new RegExp(`\\b${escaped}(s|es)?\\b`, 'i');
    if (pattern.test(lowerSent)) {
      matched.push(v.id);
    }
    if (matched.length >= 6) break;
  }
  return matched;
}

async function main() {
  console.log('🔄 Fetching Google Sheets data...');
  const [rawVocab, rawSentences] = await Promise.all([
    fetchGvizSheet(VOCAB_GID),
    fetchGvizSheet(SENTENCE_GID),
  ]);
  console.log(`📥 Fetched ${rawVocab.length} vocab rows, ${rawSentences.length} sentence rows.`);

  // 1. Convert vocab rows
  const usedVocabIds = new Set();
  const vocabDedup = new Set();
  const vocab = [];

  for (const row of rawVocab) {
    const lang = row.Language === 'German' ? 'German' : 'English';
    const word = row['Word/Phrase'] || '';
    const meaning = row.Meaning || '';
    if (!word || !meaning) continue;

    const dKey = normalizeForDedup(lang, word);
    if (vocabDedup.has(dKey)) continue;
    vocabDedup.add(dKey);

    const posRaw = row['Part of Speech / Gender'] || '';
    const { pos, gender, plural } = inferPosAndGender(posRaw, word, lang);
    const id = ensureUniqueId(slugifyId(lang, word), usedVocabIds);
    const example = row['Collocation / Example'] || '';
    const tags = inferTags(`${word} ${example} ${meaning}`);

    vocab.push({
      id,
      legacyKey: buildLegacyKey(lang, word),
      lang,
      level: row.Level || (lang === 'German' ? 'B1-B2' : 'A2-B1'),
      word,
      pos,
      posDetail: posRaw,
      gender,
      plural,
      meaning,
      example,
      tags,
      reviewStatus: row['Review Status'] || 'New',
      date: row.Date || '',
      pairId: null,
    });
  }

  // Group vocab by (date, lang) and fallback to full lang list for linking
  const vocabByDateLang = new Map();
  const vocabByLang = { English: [], German: [] };
  for (const v of vocab) {
    vocabByLang[v.lang].push(v);
    const k = `${v.date}|${v.lang}`;
    if (!vocabByDateLang.has(k)) vocabByDateLang.set(k, []);
    vocabByDateLang.get(k).push(v);
  }

  // 2. Convert sentences & infer EN-DE pairId by (Date, ordinal index within language)
  const usedSentIds = new Set();
  const sentDedup = new Set();
  const dateLangCounter = new Map();
  const rawFilteredSentences = [];

  for (const row of rawSentences) {
    const lang = row.Language === 'German' ? 'German' : 'English';
    const sentence = row.Sentence || '';
    const translation = row.Translation || '';
    if (!sentence || !translation) continue;

    const dKey = normalizeForDedup(lang, sentence);
    if (sentDedup.has(dKey)) continue;
    sentDedup.add(dKey);

    const date = row.Date || '';
    const cKey = `${date}|${lang}`;
    const ordinal = (dateLangCounter.get(cKey) || 0) + 1;
    dateLangCounter.set(cKey, ordinal);

    rawFilteredSentences.push({ row, lang, sentence, translation, date, ordinal });
  }

  // Count how many EN and DE sentences exist per date to decide safe pairing
  const dateCounts = new Map();
  for (const s of rawFilteredSentences) {
    if (!s.date) continue;
    if (!dateCounts.has(s.date)) dateCounts.set(s.date, { English: 0, German: 0 });
    dateCounts.get(s.date)[s.lang]++;
  }

  const sentences = rawFilteredSentences.map(({ row, lang, sentence, translation, date, ordinal }) => {
    const counts = date ? dateCounts.get(date) : null;
    const canPair = counts && counts.English > 0 && counts.German > 0 && ordinal <= Math.min(counts.English, counts.German);
    const pairId = canPair ? `${date.replace(/-/g, '')}-${String(ordinal).padStart(2, '0')}` : null;

    const keyPoints = row['Key Points'] || '';
    const cloze = inferCloze(sentence, keyPoints);
    const tags = inferTags(`${sentence} ${keyPoints}`);
    const topic = tags[0] || 'daily';

    const dateVocab = vocabByDateLang.get(`${date}|${lang}`) || [];
    let vocabIds = matchVocabForSentence(sentence, dateVocab);
    if (vocabIds.length < 2) {
      const more = matchVocabForSentence(sentence, vocabByLang[lang]).filter((id) => !vocabIds.includes(id));
      vocabIds = [...vocabIds, ...more].slice(0, 5);
    }

    const id = ensureUniqueId(
      slugifyId(lang, `${pairId || date || 'sent'}-${sentence.slice(0, 24)}`, 's'),
      usedSentIds
    );

    return {
      id,
      legacyKey: buildLegacyKey(lang, sentence),
      pairId,
      lang,
      level: row.Level || (lang === 'German' ? 'B1-B2' : 'A2-B1'),
      topic,
      tags,
      sentence,
      translation,
      cloze,
      keyPoints,
      vocabIds,
      date,
    };
  });

  // Ensure paired EN & DE sentences share a consistent topic tag
  const pairTopicMap = new Map();
  for (const s of sentences) {
    if (s.pairId && s.topic && s.topic !== 'daily' && !pairTopicMap.has(s.pairId)) {
      pairTopicMap.set(s.pairId, s.topic);
    }
  }
  for (const s of sentences) {
    if (s.pairId && pairTopicMap.has(s.pairId)) {
      const sharedTopic = pairTopicMap.get(s.pairId);
      s.topic = sharedTopic;
      if (!s.tags.includes(sharedTopic)) s.tags = [sharedTopic, ...s.tags.filter((t) => t !== 'daily')];
    }
  }

  const wordIndex = buildWordIndex(vocab, sentences);
  const manifest = buildManifest(vocab, sentences);

  const check = validateDataFiles({ vocab, sentences, wordIndex, manifest });
  if (!check.valid) {
    console.error('❌ Migrated data failed validation:', check.errors.slice(0, 20));
    process.exit(1);
  }

  const dataDir = resolve(process.cwd(), 'data');
  await mkdir(dataDir, { recursive: true });
  await Promise.all([
    writeFile(resolve(dataDir, 'vocab.json'), JSON.stringify(vocab, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'sentences.json'), JSON.stringify(sentences, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'word-index.json'), JSON.stringify(wordIndex, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
  ]);

  console.log(`✅ Migration complete!`);
  console.log(`   - data/vocab.json: ${vocab.length} unique entries`);
  console.log(`   - data/sentences.json: ${sentences.length} unique entries (${manifest.counts.pairs} parallel EN-DE pairs)`);
  console.log(`   - Levels: ${manifest.levels.join(', ')}`);
  console.log(`   - Tags: ${manifest.tags.join(', ')}`);
}

main().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
