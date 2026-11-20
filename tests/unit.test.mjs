import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import {
  buildLegacyKey,
  buildManifest,
  buildWordIndex,
  inferCloze,
  inferPosAndGender,
  mergeBatchIntoDataset,
  slugifyId,
  validateBatchPayload,
  validateDataFiles,
} from '../scripts/schema.mjs';

test('slugifyId normalizes German umlauts and punctuation', () => {
  assert.equal(slugifyId('German', 'die Prüfung'), 'de-die-pruefung');
  assert.equal(slugifyId('German', 'die Straße'), 'de-die-strasse');
  assert.equal(slugifyId('English', 'Memory Utilization!'), 'en-memory-utilization');
});

test('buildLegacyKey matches original index.html format', () => {
  assert.equal(buildLegacyKey('German', 'die Entscheidung'), 'German:die Entscheidung');
  assert.equal(buildLegacyKey('English', 'utilization'), 'English:utilization');
});

test('inferPosAndGender accurately parses German gender, plural, and POS without false positives', () => {
  assert.deepEqual(inferPosAndGender('Feminin (-en)', 'die Speicherauslastung', 'German'), {
    pos: 'noun',
    gender: 'die',
    plural: '-en',
  });
  assert.deepEqual(inferPosAndGender('Maskulin (⸚e)', 'der Lauf', 'German'), {
    pos: 'noun',
    gender: 'der',
    plural: '⸚e',
  });
  assert.deepEqual(inferPosAndGender('Neutrum (Sg.)', 'das System', 'German'), {
    pos: 'noun',
    gender: 'das',
    plural: 'Sg.',
  });
  assert.deepEqual(inferPosAndGender('Verb (unreg., trennbar)', 'losfahren', 'German'), {
    pos: 'verb',
    gender: null,
    plural: null,
  });
  assert.deepEqual(inferPosAndGender('Adjektiv', 'stabil', 'German'), {
    pos: 'adj',
    gender: null,
    plural: null,
  });
  // Regression check: words containing 'der' substring like 'order' or 'under' must not trigger German noun
  assert.deepEqual(inferPosAndGender('Preposition (under)', 'under', 'English'), {
    pos: 'other',
    gender: null,
    plural: null,
  });
});

test('inferCloze extracts verbatim phrase from sentence using Key Points', () => {
  const sent = 'We are monitoring memory utilization closely during the overnight batch settlement.';
  const kp = 'memory utilization (메모리 사용률), batch settlement (배치 정산)';
  assert.equal(inferCloze(sent, kp), 'memory utilization');
});

test('validateBatchPayload validates and normalizes Gemini JSON batch', () => {
  const validPayload = {
    schemaVersion: 1,
    date: '2026-11-20',
    pairs: [
      {
        pairId: '20261120-01',
        topic: 'dev',
        en: {
          level: 'A2-B1',
          sentence: 'We enforced strict schema validation.',
          translation: '우리는 엄격한 스키마 검증을 적용했다.',
          cloze: 'enforced',
          keyPoints: 'enforce: 시행하다',
        },
        de: {
          level: 'B1-B2',
          sentence: 'Wir haben eine strenge Schema-Prüfung eingeführt.',
          translation: '우리는 엄격한 스키마 검증을 도입했다.',
          cloze: 'eingeführt',
          keyPoints: 'einführen: 도입하다',
        },
        vocab: [
          {
            id: 'en-enforce',
            lang: 'English',
            level: 'B1',
            word: 'enforce',
            pos: 'verb',
            gender: null,
            plural: null,
            meaning: '시행하다',
            example: 'enforce strict rules',
            tags: ['dev'],
          },
          {
            id: 'de-pruefung',
            lang: 'German',
            level: 'B1',
            word: 'die Prüfung',
            pos: 'noun',
            gender: 'die',
            plural: 'die Prüfungen',
            meaning: '검증, 시험',
            example: 'eine Prüfung einführen',
            tags: ['dev'],
          },
        ],
      },
    ],
  };

  const res = validateBatchPayload(validPayload);
  assert.equal(res.valid, true);
  assert.equal(res.errors.length, 0);
  assert.equal(res.normalized.pairs.length, 1);
  assert.equal(res.normalized.pairs[0].vocab[1].gender, 'die');

  const invalid = validateBatchPayload({ date: '2026-11-20', pairs: [] });
  assert.equal(invalid.valid, false);
});

test('mergeBatchIntoDataset deduplicates existing entries and links vocabIds', () => {
  const existing = {
    vocab: [
      {
        id: 'en-enforce',
        legacyKey: 'English:enforce',
        lang: 'English',
        level: 'B1',
        word: 'enforce',
        pos: 'verb',
        posDetail: 'Verb',
        gender: null,
        plural: null,
        meaning: '시행하다',
        example: '',
        tags: ['dev'],
        reviewStatus: 'New',
        date: '2026-11-19',
        pairId: null,
      },
    ],
    sentences: [],
  };

  const batch = validateBatchPayload({
    schemaVersion: 1,
    date: '2026-11-20',
    pairs: [
      {
        pairId: '20261120-01',
        topic: 'dev',
        en: {
          level: 'A2-B1',
          sentence: 'We enforced strict rules.',
          translation: '엄격한 규칙을 시행했다.',
          cloze: 'enforced',
          keyPoints: '',
        },
        vocab: [
          { lang: 'English', word: 'enforce', pos: 'verb', meaning: '시행하다' }, // duplicate
          { lang: 'English', word: 'registry', pos: 'noun', meaning: '레지스트리' }, // new
        ],
      },
    ],
  }).normalized;

  const merged = mergeBatchIntoDataset(existing, batch);
  assert.equal(merged.addedVocabCount, 1);
  assert.equal(merged.skippedVocabCount, 1);
  assert.equal(merged.addedSentenceCount, 1);
  assert.equal(merged.vocab.length, 2);
  assert.ok(merged.sentences[0].vocabIds.includes('en-enforce'));
  assert.ok(merged.sentences[0].vocabIds.includes('en-registry'));

  const wi = buildWordIndex(merged.vocab, merged.sentences);
  const mf = buildManifest(merged.vocab, merged.sentences);
  assert.equal(validateDataFiles({ vocab: merged.vocab, sentences: merged.sentences, wordIndex: wi, manifest: mf }).valid, true);
});

test('index.html has valid inline JS syntax and no unused PapaParse dependency', async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  assert.equal(html.includes('papaparse'), false, 'Unused PapaParse CDN should be removed');

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 2, 'Expected inline Tailwind config and main app script');
  for (const [, code] of scripts) {
    new vm.Script(code);
  }
});
