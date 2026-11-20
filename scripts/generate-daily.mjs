#!/usr/bin/env node
/**
 * Track 1 Automation: Calls Gemini API with structured JSON output,
 * avoids duplicates using data/word-index.json, validates schema,
 * and updates data/vocab.json, data/sentences.json, data/word-index.json, data/manifest.json.
 *
 * Environment variables:
 *   GEMINI_API_KEY  (required) - Google AI Studio API key
 *   GEMINI_MODEL    (optional) - default: gemini-2.5-flash
 *   PAIR_COUNT      (optional) - default: 5
 *   DAILY_TOPICS    (optional) - comma-separated topics hint
 *   TARGET_DATE     (optional) - YYYY-MM-DD (defaults to KST today)
 *   DRY_RUN         (optional) - 'true' to validate without writing files
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildManifest,
  buildWordIndex,
  mergeBatchIntoDataset,
  validateBatchPayload,
  validateDataFiles,
} from './schema.mjs';

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const PAIR_COUNT = Math.max(1, Math.min(10, parseInt(process.env.PAIR_COUNT || '5', 10) || 5));
const DAILY_TOPICS = (process.env.DAILY_TOPICS || '개발/업무 2, 일상 2, 취미/자전거/건강 1').trim();
const DRY_RUN = process.env.DRY_RUN === 'true';

function getKstDateString() {
  if (process.env.TARGET_DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.TARGET_DATE)) {
    return process.env.TARGET_DATE;
  }
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['schemaVersion', 'date', 'pairs'],
  properties: {
    schemaVersion: { type: 'INTEGER' },
    date: { type: 'STRING' },
    pairs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['pairId', 'topic', 'en', 'de', 'vocab'],
        properties: {
          pairId: { type: 'STRING' },
          topic: { type: 'STRING' },
          en: {
            type: 'OBJECT',
            required: ['level', 'sentence', 'translation', 'cloze', 'keyPoints'],
            properties: {
              level: { type: 'STRING' },
              sentence: { type: 'STRING' },
              translation: { type: 'STRING' },
              cloze: { type: 'STRING' },
              keyPoints: { type: 'STRING' },
            },
          },
          de: {
            type: 'OBJECT',
            required: ['level', 'sentence', 'translation', 'cloze', 'keyPoints'],
            properties: {
              level: { type: 'STRING' },
              sentence: { type: 'STRING' },
              translation: { type: 'STRING' },
              cloze: { type: 'STRING' },
              keyPoints: { type: 'STRING' },
            },
          },
          vocab: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['id', 'lang', 'level', 'word', 'pos', 'meaning', 'example', 'tags'],
              properties: {
                id: { type: 'STRING' },
                lang: { type: 'STRING', enum: ['English', 'German'] },
                level: { type: 'STRING' },
                word: { type: 'STRING' },
                pos: { type: 'STRING', enum: ['noun', 'verb', 'adj', 'adv', 'phrase', 'other'] },
                gender: { type: 'STRING', nullable: true },
                plural: { type: 'STRING', nullable: true },
                meaning: { type: 'STRING' },
                example: { type: 'STRING' },
                tags: { type: 'ARRAY', items: { type: 'STRING' } },
              },
            },
          },
        },
      },
    },
  },
};

function buildPrompt(targetDate, wordIndex) {
  const enSample = (wordIndex.words?.English || []).slice(0, 180).join(', ');
  const deSample = (wordIndex.words?.German || []).slice(0, 180).join(', ');
  const dateCompact = targetDate.replace(/-/g, '');

  return `당신은 영어(A2-B1)와 독일어(B1-B2)를 함께 학습하는 한국인 개발자를 위한 어학 콘텐츠 생성기입니다.
오늘 날짜(${targetDate})의 새 학습 세트를 JSON으로 생성하세요.

[생성 규칙]
1. 정확히 ${PAIR_COUNT}개의 실용적 상황(${DAILY_TOPICS})을 선정해 pairs 배열에 담으세요.
2. 각 pair는 동일한 상황/의미를 자연스러운 영어(A2-B1)와 독일어(B1-B2) 문장으로 1:1 병렬 작성하세요.
3. pairId는 "${dateCompact}-01" 형식의 순번, topic은 영문 소문자 단일 태그(예: dev, work, daily, cycling, health)로 지정하세요.
4. 각 pair마다 문장에서 학습 가치가 높은 핵심 단어·표현 2~4개를 vocab 배열로 추출하세요(영어 1~2개, 독일어 1~2개).
5. 독일어 명사는 반드시 관사 포함 원형(예: "die Prüfung"), gender("der"|"die"|"das"), 복수형(예: "die Prüfungen" 또는 "-en")을 기입하세요. 명사가 아니면 gender와 plural은 null로 두세요.
6. cloze는 해당 sentence 안에 정확히 등장하는 핵심 표현 1개를 원문 그대로 기입하세요.
7. id는 영문 소문자·숫자·하이픈만 사용해 "en-" 또는 "de-" 접두사로 고유하게 작성하세요.
8. 아래 기존 학습 단어와 중복되지 않는 새로운 어휘와 상황을 우선 선정하세요.

[기존 영어 단어 일부]
${enSample || '(없음)'}

[기존 독일어 단어 일부]
${deSample || '(없음)'}

schemaVersion은 1, date는 "${targetDate}"로 설정하세요.`;
}

async function main() {
  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is required.');
    process.exit(1);
  }

  const dataDir = resolve(process.cwd(), 'data');
  const [vocab, sentences, wordIndex] = await Promise.all([
    readFile(resolve(dataDir, 'vocab.json'), 'utf8').then(JSON.parse),
    readFile(resolve(dataDir, 'sentences.json'), 'utf8').then(JSON.parse),
    readFile(resolve(dataDir, 'word-index.json'), 'utf8').then(JSON.parse),
  ]);

  const targetDate = getKstDateString();
  const prompt = buildPrompt(targetDate, wordIndex);

  console.log(`🤖 Calling Gemini API (${MODEL}) for ${targetDate} (${PAIR_COUNT} pairs)...`);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(API_KEY)}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const apiResp = await res.json();
  const rawText = apiResp?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Gemini API returned empty content.');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON output: ${e.message}`);
  }

  const validation = validateBatchPayload(parsed);
  if (!validation.valid) {
    console.error('❌ Generated batch failed schema validation:', validation.errors);
    process.exit(1);
  }

  const merged = mergeBatchIntoDataset({ vocab, sentences }, validation.normalized);
  const nextWordIndex = buildWordIndex(merged.vocab, merged.sentences);
  const nextManifest = buildManifest(merged.vocab, merged.sentences);

  const fileCheck = validateDataFiles({
    vocab: merged.vocab,
    sentences: merged.sentences,
    wordIndex: nextWordIndex,
    manifest: nextManifest,
  });
  if (!fileCheck.valid) {
    console.error('❌ Merged dataset failed integrity check:', fileCheck.errors);
    process.exit(1);
  }

  console.log(
    `✨ Generated: +${merged.addedVocabCount} vocab (skipped ${merged.skippedVocabCount} dup), +${merged.addedSentenceCount} sentences (skipped ${merged.skippedSentenceCount} dup)`
  );

  if (DRY_RUN) {
    console.log('🧪 DRY_RUN=true — skipping file writes.');
    return;
  }

  if (merged.addedVocabCount === 0 && merged.addedSentenceCount === 0) {
    console.log('ℹ️ No new unique entries added; skipping file writes.');
    return;
  }

  await Promise.all([
    writeFile(resolve(dataDir, 'vocab.json'), JSON.stringify(merged.vocab, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'sentences.json'), JSON.stringify(merged.sentences, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'word-index.json'), JSON.stringify(nextWordIndex, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'manifest.json'), JSON.stringify(nextManifest, null, 2) + '\n', 'utf8'),
  ]);

  console.log('✅ Updated data/*.json successfully.');
}

main().catch((err) => {
  console.error('❌ Daily generation failed:', err);
  process.exit(1);
});
