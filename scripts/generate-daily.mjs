#!/usr/bin/env node
/**
 * Multi-Profile Track 1 Automation:
 * Reads data/profiles.json and generates tailored daily vocabulary & sentences
 * for each enabled profile (or a specific TARGET_PROFILE) using Gemini API.
 *
 * Environment variables:
 *   GEMINI_API_KEY  (required) - Google AI Studio API key
 *   TARGET_PROFILE  (optional) - 'all' (default) or specific profile id ('me', 'wife', 'kid')
 *   GEMINI_MODEL    (optional) - overrides profile.daily.model when set
 *   PAIR_COUNT      (optional) - overrides profile.daily.pairCount when set
 *   DAILY_TOPICS    (optional) - overrides profile.daily.topics when set
 *   TARGET_DATE     (optional) - YYYY-MM-DD (defaults to KST today)
 *   DRY_RUN         (optional) - 'true' to validate without writing files
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildManifest,
  buildWordIndex,
  mergeBatchIntoDataset,
  validateBatchPayload,
  validateDataFiles,
} from './schema.mjs';

const API_KEY = process.env.GEMINI_API_KEY;
const TARGET_PROFILE = (process.env.TARGET_PROFILE || 'all').trim();
const OVERRIDE_MODEL = (process.env.GEMINI_MODEL || '').trim();
const OVERRIDE_PAIR_COUNT = process.env.PAIR_COUNT ? parseInt(process.env.PAIR_COUNT, 10) : null;
const OVERRIDE_TOPICS = (process.env.DAILY_TOPICS || '').trim();
const DRY_RUN = process.env.DRY_RUN === 'true';
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.6-flash'];

function getKstDateString() {
  if (process.env.TARGET_DATE && /^\d{4}-\d{2}-\d{2}$/.test(process.env.TARGET_DATE)) {
    return process.env.TARGET_DATE;
  }
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function buildResponseSchema(languages) {
  const hasEn = languages.includes('English');
  const hasDe = languages.includes('German');

  const sideSchema = {
    type: 'OBJECT',
    required: ['level', 'sentence', 'translation', 'cloze', 'keyPoints'],
    properties: {
      level: { type: 'STRING' },
      sentence: { type: 'STRING' },
      translation: { type: 'STRING' },
      cloze: { type: 'STRING' },
      keyPoints: { type: 'STRING' },
    },
  };

  const pairRequired = ['pairId', 'topic', 'vocab'];
  const pairProps = {
    pairId: { type: 'STRING' },
    topic: { type: 'STRING' },
    vocab: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['id', 'lang', 'level', 'word', 'pos', 'meaning', 'example', 'tags'],
        properties: {
          id: { type: 'STRING' },
          lang: { type: 'STRING', enum: languages },
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
  };

  if (hasEn) {
    pairRequired.push('en');
    pairProps.en = sideSchema;
  }
  if (hasDe) {
    pairRequired.push('de');
    pairProps.de = sideSchema;
  }

  return {
    type: 'OBJECT',
    required: ['schemaVersion', 'date', 'pairs'],
    properties: {
      schemaVersion: { type: 'INTEGER' },
      date: { type: 'STRING' },
      pairs: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          required: pairRequired,
          properties: pairProps,
        },
      },
    },
  };
}

function buildPromptForProfile(profile, targetDate, wordIndex, pairCount, topics) {
  const languages = profile.languages || ['English'];
  const hasEn = languages.includes('English');
  const hasDe = languages.includes('German');
  const enLevel = profile.levels?.English || 'A2-B1';
  const deLevel = profile.levels?.German || 'B1-B2';
  const vocabPerPair = profile.daily?.vocabPerPair || '2~3';
  const persona = profile.daily?.persona || '한국인 외국어 학습자';
  const dateCompact = targetDate.replace(/-/g, '');
  const idPrefix = profile.id === 'me' ? dateCompact : `${profile.id}-${dateCompact}`;

  const enSample = (wordIndex.words?.English || []).slice(0, 180).join(', ');
  const deSample = (wordIndex.words?.German || []).slice(0, 180).join(', ');

  const langRule =
    hasEn && hasDe
      ? `각 pair는 동일한 상황/의미를 자연스러운 영어(${enLevel})와 독일어(${deLevel}) 문장으로 1:1 병렬 작성하세요.`
      : hasEn
      ? `각 pair는 영어(${enLevel}) 문장(en 필드)만 자연스럽게 작성하세요.`
      : `각 pair는 독일어(${deLevel}) 문장(de 필드)만 자연스럽게 작성하세요.`;

  const germanRule = hasDe
    ? `5. 독일어 명사는 반드시 관사 포함 원형(예: "die Prüfung"), gender("der"|"die"|"das"), 복수형(예: "die Prüfungen" 또는 "-en")을 기입하세요. 독일어 명사가 아니면 gender와 plural은 null로 두세요.`
    : `5. 영어 단어는 gender와 plural을 null로 두세요.`;

  const existingSection = [
    hasEn ? `[기존 영어 단어 일부]\n${enSample || '(없음)'}` : '',
    hasDe ? `[기존 독일어 단어 일부]\n${deSample || '(없음)'}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  return `당신은 ${persona}를 위한 맞춤형 어학 콘텐츠 생성기입니다.
오늘 날짜(${targetDate})의 새 학습 세트를 JSON으로 생성하세요.

[생성 규칙]
1. 정확히 ${pairCount}개의 실용적 상황(${topics})을 선정해 pairs 배열에 담으세요.
2. ${langRule}
3. pairId는 "${idPrefix}-01" 형식의 순번, topic은 영문 소문자 단일 태그로 지정하세요.
4. 각 pair마다 문장에서 학습 가치가 높은 핵심 단어·표현 ${vocabPerPair}개를 vocab 배열로 추출하세요.
${germanRule}
6. cloze는 해당 sentence 안에 정확히 등장하는 핵심 표현 1개를 원문 그대로 기입하세요.
7. id는 영문 소문자·숫자·하이픈만 사용해 "${hasDe && !hasEn ? 'de-' : 'en-'}" 등 언어 접두사로 고유하게 작성하세요.
8. 아래 기존 학습 단어와 중복되지 않는 새로운 어휘와 상황을 우선 선정하세요.

${existingSection}

schemaVersion은 1, date는 "${targetDate}"로 설정하세요.`;
}

async function callGeminiWithFallback(primaryModel, prompt, responseSchema, profileId, targetDate, pairCount) {
  const candidateModels = [...new Set([primaryModel, ...FALLBACK_MODELS].filter(Boolean))];
  let lastError = null;

  for (const model of candidateModels) {
    console.log(`🤖 [${profileId}] Calling Gemini API (${model}) for ${targetDate} (${pairCount} items)...`);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(API_KEY)}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema,
        },
      }),
    });

    if (res.ok) {
      const apiResp = await res.json();
      console.log(`✅ [${profileId}] Received response from ${model}`);
      const parts = apiResp?.candidates?.[0]?.content?.parts || [];
      const textPart =
        parts.find((p) => !p.thought && typeof p.text === 'string' && p.text.trim()) ||
        parts.find((p) => typeof p.text === 'string');
      if (!textPart?.text) {
        throw new Error(`[${profileId}] Gemini API returned empty content.`);
      }
      return textPart.text;
    }

    const errText = await res.text();
    lastError = new Error(`[${profileId}] Gemini API (${model}) HTTP ${res.status}: ${errText.slice(0, 500)}`);
    if ([404, 429, 503].includes(res.status)) {
      console.warn(`⚠️ [${profileId}] ${model} unavailable (HTTP ${res.status}), trying next free-tier fallback...`);
      continue;
    }
    throw lastError;
  }

  throw lastError || new Error(`[${profileId}] All Gemini models failed.`);
}

async function readJsonSafe(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

async function generateForProfile(profile, targetDate) {
  const dataDir = resolve(process.cwd(), profile.dataDir || 'data');
  await mkdir(dataDir, { recursive: true });

  const vocab = await readJsonSafe(resolve(dataDir, 'vocab.json'), []);
  const sentences = await readJsonSafe(resolve(dataDir, 'sentences.json'), []);
  const wordIndex = await readJsonSafe(resolve(dataDir, 'word-index.json'), buildWordIndex(vocab, sentences));

  const pairCount = Math.max(
    1,
    Math.min(10, OVERRIDE_PAIR_COUNT || profile.daily?.pairCount || 3)
  );
  const topics = OVERRIDE_TOPICS || profile.daily?.topics || '일상 회화';
  const model = OVERRIDE_MODEL || profile.daily?.model || 'gemini-3.5-flash-lite';

  const schema = buildResponseSchema(profile.languages || ['English']);
  const prompt = buildPromptForProfile(profile, targetDate, wordIndex, pairCount, topics);
  const rawText = await callGeminiWithFallback(model, prompt, schema, profile.id, targetDate, pairCount);

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`[${profile.id}] Failed to parse Gemini JSON output: ${e.message}`);
  }

  const validation = validateBatchPayload(parsed);
  if (!validation.valid) {
    throw new Error(`[${profile.id}] Generated batch failed schema validation: ${validation.errors.join('; ')}`);
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
    throw new Error(`[${profile.id}] Merged dataset failed integrity check: ${fileCheck.errors.join('; ')}`);
  }

  console.log(
    `✨ [${profile.id}] Generated: +${merged.addedVocabCount} vocab (skipped ${merged.skippedVocabCount} dup), +${merged.addedSentenceCount} sentences (skipped ${merged.skippedSentenceCount} dup)`
  );

  if (DRY_RUN) {
    console.log(`🧪 [${profile.id}] DRY_RUN=true — skipping file writes.`);
    return;
  }

  if (merged.addedVocabCount === 0 && merged.addedSentenceCount === 0) {
    console.log(`ℹ️ [${profile.id}] No new unique entries added; skipping file writes.`);
    return;
  }

  await Promise.all([
    writeFile(resolve(dataDir, 'vocab.json'), JSON.stringify(merged.vocab, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'sentences.json'), JSON.stringify(merged.sentences, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'word-index.json'), JSON.stringify(nextWordIndex, null, 2) + '\n', 'utf8'),
    writeFile(resolve(dataDir, 'manifest.json'), JSON.stringify(nextManifest, null, 2) + '\n', 'utf8'),
  ]);
  console.log(`✅ [${profile.id}] Updated ${profile.dataDir}/*.json`);
}

async function main() {
  if (!API_KEY) {
    console.error('❌ GEMINI_API_KEY environment variable is required.');
    process.exit(1);
  }

  const profilesCfg = JSON.parse(await readFile(resolve(process.cwd(), 'data/profiles.json'), 'utf8'));
  const targetDate = getKstDateString();

  const selectedProfiles =
    TARGET_PROFILE === 'all'
      ? profilesCfg.profiles.filter((p) => p.daily?.enabled !== false)
      : profilesCfg.profiles.filter((p) => p.id === TARGET_PROFILE);

  if (selectedProfiles.length === 0) {
    console.error(`❌ No matching profile found for TARGET_PROFILE="${TARGET_PROFILE}"`);
    process.exit(1);
  }

  console.log(`📅 Running daily generation for ${targetDate} — profiles: ${selectedProfiles.map((p) => p.id).join(', ')}`);

  for (let i = 0; i < selectedProfiles.length; i++) {
    await generateForProfile(selectedProfiles[i], targetDate);
    if (i < selectedProfiles.length - 1) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => {
  console.error('❌ Daily generation failed:', err);
  process.exit(1);
});
