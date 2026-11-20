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

test('index.html has valid inline JS syntax, offline static CSS, and no external CDN dependencies', async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  assert.equal(html.includes('papaparse'), false, 'Unused PapaParse CDN should be removed');
  assert.equal(html.includes('cdn.tailwindcss.com'), false, 'External Tailwind Play CDN should be removed for offline PWA support');
  assert.equal(html.includes('./assets/app.css'), true, 'Offline static stylesheet ./assets/app.css must be linked');

  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length >= 1, 'Expected inline main app script');
  for (const [, code] of scripts) {
    new vm.Script(code);
  }
});

test('assets/app.css and inline style cover 100% of CSS classes used in index.html', async () => {
  const html = await readFile(resolve(process.cwd(), 'index.html'), 'utf8');
  const appCss = await readFile(resolve(process.cwd(), 'assets/app.css'), 'utf8');
  const styleBlock = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
  const combinedCss = `${appCss}\n${styleBlock}`;

  // Collect all defined class selectors (unescaping CSS backslash escapes like md\:flex or max-w-\[190px\])
  const definedClasses = new Set();
  for (const m of combinedCss.matchAll(/\.((?:\\.|[a-zA-Z0-9_-])+)/g)) {
    definedClasses.add(m[1].replace(/\\(.)/g, '$1'));
  }

  // Extract all static class tokens from HTML attributes and JS className assignments
  const usedClasses = new Set();
  for (const m of html.matchAll(/\bclass="([^"]+)"/g)) {
    const raw = m[1];
    raw.replace(/\$\{[^}]+\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
    for (const q of raw.matchAll(/\$\{[^}]+\}/g)) {
      for (const lit of q[0].matchAll(/['"]([^'"]+)['"]/g)) {
        lit[1].split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
      }
    }
  }
  for (const m of html.matchAll(/\bclassName\s*=\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    raw.replace(/\$\{[^}]+\}/g, ' ').split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
    for (const q of raw.matchAll(/\$\{[^}]+\}/g)) {
      for (const lit of q[0].matchAll(/['"]([^'"]+)['"]/g)) {
        lit[1].split(/\s+/).filter(Boolean).forEach((c) => usedClasses.add(c));
      }
    }
  }

  // Pure JS/DOM hook classes that intentionally have no dedicated style rule
  const jsHookAllowlist = new Set(['lang-btn', 'card-meaning', 'modal-panel', 'opt-badge', 'opt-text']);
  const missing = [...usedClasses].filter((c) => !definedClasses.has(c) && !jsHookAllowlist.has(c));
  assert.deepEqual(missing, [], `Missing CSS rules in assets/app.css for classes: ${missing.join(', ')}`);
});

test('manifest.json uses Warm Paper & Ink theme and exposes family profile shortcuts', async () => {
  const mf = JSON.parse(await readFile(resolve(process.cwd(), 'manifest.json'), 'utf8'));
  assert.equal(mf.background_color, '#F7F4EE');
  assert.equal(mf.theme_color, '#161513');
  assert.ok(Array.isArray(mf.shortcuts) && mf.shortcuts.length >= 3, 'Expected 3 family profile shortcuts');
  const urls = mf.shortcuts.map((s) => s.url);
  assert.ok(urls.includes('./'));
  assert.ok(urls.includes('./?profile=wife'));
  assert.ok(urls.includes('./?profile=kid'));
});

test('formatStepSummaryMarkdown produces GitHub Actions summary table and sample preview', async () => {
  const { formatStepSummaryMarkdown } = await import('../scripts/generate-daily.mjs');
  const md = formatStepSummaryMarkdown(
    [
      {
        id: 'kid',
        name: '아이',
        usedModel: 'gemini-3.5-flash-lite',
        durationMs: 2450,
        addedVocabCount: 6,
        skippedVocabCount: 0,
        addedSentenceCount: 3,
        skippedSentenceCount: 0,
        totalVocab: 18,
        totalSentences: 9,
        sampleWords: [{ lang: 'English', word: 'puppy', meaning: '강아지' }],
        sampleSentences: [{ lang: 'English', sentence: 'The puppy runs fast.', translation: '강아지가 빠르게 달려요.' }],
      },
    ],
    { targetDate: '2026-11-20', dryRun: true }
  );
  assert.ok(md.includes('Daily AI Vocabulary & Sentence Generation (2026-11-20)'));
  assert.ok(md.includes('Dry Run'));
  assert.ok(md.includes('`gemini-3.5-flash-lite`'));
  assert.ok(md.includes('+6 (skip 0)'));
  assert.ok(md.includes('**puppy**'));
  assert.ok(md.includes('The puppy runs fast.'));
});

test('data/profiles.json defines me, wife, and kid profiles with distinct dataDirs and storagePrefixes', async () => {
  const cfg = JSON.parse(await readFile(resolve(process.cwd(), 'data/profiles.json'), 'utf8'));
  assert.equal(cfg.defaultProfile, 'me');
  assert.equal(cfg.profiles.length, 3);
  const byId = Object.fromEntries(cfg.profiles.map((p) => [p.id, p]));
  assert.equal(byId.me.dataDir, 'data');
  assert.equal(byId.me.storagePrefix, '');
  assert.equal(byId.wife.dataDir, 'data/profiles/wife');
  assert.equal(byId.kid.dataDir, 'data/profiles/kid');
  assert.deepEqual(byId.wife.languages, ['English']);
  assert.deepEqual(byId.kid.languages, ['English']);

  // Single-language (EN-only) batch must validate cleanly without de side
  const enOnlyRes = validateBatchPayload({
    schemaVersion: 1,
    date: '2026-11-20',
    pairs: [
      {
        pairId: 'kid-20261120-01',
        topic: 'animals',
        en: { level: 'Pre-A1-A1', sentence: 'The cat sleeps on the bed.', translation: '고양이가 침대에서 자요.', cloze: 'sleeps', keyPoints: 'sleep: 자다' },
        vocab: [{ lang: 'English', word: 'cat', pos: 'noun', meaning: '고양이' }],
      },
    ],
  });
  assert.equal(enOnlyRes.valid, true);
});
