/**
 * Shared schema validation, normalization, deduplication, and index builders
 * for Language Hub Pro (voca_data).
 * Zero external dependencies (Node 20+ ES Module).
 */

export const SCHEMA_VERSION = 1;
export const VALID_LANGS = ['English', 'German'];
export const VALID_POS = ['noun', 'verb', 'adj', 'adv', 'phrase', 'other'];
export const VALID_GENDERS = ['der', 'die', 'das'];

/**
 * Create a deterministic, URL-safe ID from language and text.
 */
export function slugifyId(lang, text, prefix = '') {
  const langPrefix = lang === 'German' ? 'de' : lang === 'English' ? 'en' : 'xx';
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  const base = [prefix, langPrefix, normalized || 'item'].filter(Boolean).join('-');
  return base;
}

/**
 * Exact legacy key matching index.html's original getItemKey(item).
 */
export function buildLegacyKey(lang, mainText) {
  return `${lang || ''}:${mainText || ''}`;
}

/**
 * Normalize text for case-insensitive duplicate detection.
 */
export function normalizeForDedup(lang, text) {
  return `${String(lang || '').trim().toLowerCase()}::${String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()}`;
}

/**
 * Infer normalized POS, German gender, and plural hint from raw sheet/LLM fields.
 */
export function inferPosAndGender(posRaw, word, lang) {
  const raw = String(posRaw || '').trim();
  const lowerPos = raw.toLowerCase();
  const lowerWord = String(word || '').trim().toLowerCase();

  let gender = null;
  if (lang === 'German') {
    if (/^der\s+/i.test(lowerWord) || /\bmaskulin\b|\bmasculine\b|\bm\.\b|\(der\)/i.test(raw)) {
      gender = 'der';
    } else if (/^die\s+/i.test(lowerWord) || /\bfeminin\b|\bfeminine\b|\bf\.\b|\(die\)/i.test(raw)) {
      gender = 'die';
    } else if (/^das\s+/i.test(lowerWord) || /\bneutrum\b|\bneuter\b|\bnt\.\b|\(das\)/i.test(raw)) {
      gender = 'das';
    }
  }

  let plural = null;
  if (lang === 'German' && (gender || /\b(maskulin|feminin|neutrum)\b/i.test(raw))) {
    const parenMatch = raw.match(/\(([^)]+)\)/);
    if (parenMatch) {
      const hint = parenMatch[1].trim();
      if (!/^(der|die|das)$/i.test(hint)) {
        plural = hint;
      }
    }
  }

  let pos = 'other';
  if (VALID_POS.includes(lowerPos)) {
    pos = lowerPos;
  } else if (
    /\b(phrasal\s+verb|verb)\b|\bv\./i.test(lowerPos) ||
    lowerPos.includes('동사')
  ) {
    // Handle 'Noun/Verb' where Noun comes first vs 'Verb/Noun'
    if (/^noun\b/i.test(lowerPos)) {
      pos = 'noun';
    } else {
      pos = 'verb';
    }
  } else if (
    /\b(noun|nomen|substantiv|maskulin|feminin|neutrum)\b|\bn\./i.test(lowerPos) ||
    lowerPos.includes('명사') ||
    gender !== null
  ) {
    pos = 'noun';
  } else if (
    /\b(adjektiv|adjective|adj\.?)\b/i.test(lowerPos) ||
    lowerPos.includes('형용사')
  ) {
    pos = 'adj';
  } else if (
    /\b(adverb|adv\.?)\b/i.test(lowerPos) ||
    lowerPos.includes('부사')
  ) {
    pos = 'adv';
  } else if (
    /\b(phrase|idiom|expression|redemittel|redewendung|ausdruck|collocation)\b/i.test(lowerPos) ||
    lowerPos.includes('숙어') ||
    lowerPos.includes('표현')
  ) {
    pos = 'phrase';
  }

  return { pos, gender, plural };
}

/**
 * Attempt to find a good cloze target inside a sentence using its Key Points.
 */
export function inferCloze(sentence, keyPoints) {
  const sent = String(sentence || '');
  const kp = String(keyPoints || '');
  if (!sent || !kp) return null;

  const parts = kp.split(/[,;·]/).map((s) => s.trim()).filter(Boolean);
  for (const part of parts) {
    const candidate = part
      .replace(/\([^)]*\)/g, '')
      .split(/[:\-–—=]/)[0]
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '');

    if (candidate.length < 3 || candidate.length > 60) continue;
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = sent.match(new RegExp(escaped, 'i'));
    if (match) {
      return match[0];
    }
  }
  return null;
}

/**
 * Lightweight topic tag inference for migrated legacy items.
 */
export function inferTags(text) {
  const lower = String(text || '').toLowerCase();
  const tags = new Set();

  if (
    /\b(deploy|pipeline|server|schema|batch|memory|retry|patch|code|commit|api|bug|database|query|production|docker|cloud|sprint|refactor|backend|frontend|log|latency|cache|release|build|script|datenbank|schnittstelle|bereitstellung|produktionsserver|wiederholungslogik|fehlerbehandlung|speicherauslastung|abrechnungslauf)\b/i.test(
      lower
    )
  ) {
    tags.add('dev');
  }
  if (
    /\b(bike|bicycle|folding bike|cycling|ride|chain|tire|frame|pedal|faltrad|fahrrad|radweg|kette|reifen|rahmen|bremsen)\b/i.test(
      lower
    )
  ) {
    tags.add('cycling');
  }
  if (
    /\b(meeting|colleague|deadline|checklist|review|project|team|office|schedule|besprechung|kolleg|frist|checkliste|projekt|büro|termin)\b/i.test(
      lower
    )
  ) {
    tags.add('work');
  }
  if (
    /\b(exercise|stretch|workout|back tension|posture|sleep|health|gymnastik|rücken|gesundheit|training|entspannen|spaziergang)\b/i.test(
      lower
    )
  ) {
    tags.add('health');
  }

  if (tags.size === 0) {
    tags.add('daily');
  }

  return Array.from(tags);
}

/**
 * Validate a Gemini daily batch payload (Track 1 & Track 2 shared format).
 * Accepts either { schemaVersion, date, pairs: [...] } or direct { pairs: [...] }.
 */
export function validateBatchPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['최상위 JSON은 객체(Object)여야 합니다.'], normalized: null };
  }

  const date = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date.trim())
    ? payload.date.trim()
    : new Date().toISOString().slice(0, 10);

  if (!Array.isArray(payload.pairs) || payload.pairs.length === 0) {
    errors.push('`pairs` 배열이 비어 있거나 누락되었습니다.');
    return { valid: false, errors, normalized: null };
  }

  const normalizedPairs = [];
  payload.pairs.forEach((pair, pIdx) => {
    const label = `pairs[${pIdx}]`;
    if (!pair || typeof pair !== 'object') {
      errors.push(`${label}: 객체가 아닙니다.`);
      return;
    }

    const pairId =
      typeof pair.pairId === 'string' && pair.pairId.trim()
        ? pair.pairId.trim()
        : `${date.replace(/-/g, '')}-${String(pIdx + 1).padStart(2, '0')}`;
    const topic =
      typeof pair.topic === 'string' && pair.topic.trim()
        ? pair.topic.trim().toLowerCase()
        : 'daily';

    const validateSide = (sideObj, langName, sideKey) => {
      if (!sideObj || typeof sideObj !== 'object') {
        errors.push(`${label}.${sideKey}: 누락되었습니다.`);
        return null;
      }
      const sentence = String(sideObj.sentence || '').trim();
      const translation = String(sideObj.translation || '').trim();
      const level = String(sideObj.level || (langName === 'German' ? 'B1-B2' : 'A2-B1')).trim();
      const keyPoints = String(sideObj.keyPoints || '').trim();
      let cloze = sideObj.cloze ? String(sideObj.cloze).trim() : null;

      if (!sentence) errors.push(`${label}.${sideKey}.sentence: 비어 있습니다.`);
      if (!translation) errors.push(`${label}.${sideKey}.translation: 비어 있습니다.`);
      if (cloze && sentence && !sentence.toLowerCase().includes(cloze.toLowerCase())) {
        cloze = inferCloze(sentence, keyPoints);
      }
      if (!cloze && sentence) {
        cloze = inferCloze(sentence, keyPoints);
      }

      return { lang: langName, level, sentence, translation, cloze, keyPoints };
    };

    const en = pair.en ? validateSide(pair.en, 'English', 'en') : null;
    const de = pair.de ? validateSide(pair.de, 'German', 'de') : null;
    if (!en && !de) {
      errors.push(`${label}: \`en\` 또는 \`de\` 문장이 최소 1개 이상 필요합니다.`);
    }

    const vocabList = [];
    if (Array.isArray(pair.vocab)) {
      pair.vocab.forEach((v, vIdx) => {
        const vLabel = `${label}.vocab[${vIdx}]`;
        if (!v || typeof v !== 'object') {
          errors.push(`${vLabel}: 객체가 아닙니다.`);
          return;
        }
        const lang = String(v.lang || v.Language || '').trim();
        const word = String(v.word || v['Word/Phrase'] || '').trim();
        const meaning = String(v.meaning || v.Meaning || '').trim();
        if (!VALID_LANGS.includes(lang)) {
          errors.push(`${vLabel}.lang: English 또는 German이어야 합니다 (현재값: "${lang}").`);
          return;
        }
        if (!word) {
          errors.push(`${vLabel}.word: 비어 있습니다.`);
          return;
        }
        if (!meaning) {
          errors.push(`${vLabel}.meaning: 비어 있습니다.`);
          return;
        }

        const rawPos = v.pos || v.posDetail || v['Part of Speech / Gender'] || '';
        const inferred = inferPosAndGender(rawPos, word, lang);
        const pos = VALID_POS.includes(String(v.pos || '').toLowerCase())
          ? String(v.pos).toLowerCase()
          : inferred.pos;
        const gender =
          lang === 'German'
            ? VALID_GENDERS.includes(String(v.gender || '').toLowerCase())
              ? String(v.gender).toLowerCase()
              : inferred.gender
            : null;
        const plural = v.plural ? String(v.plural).trim() : inferred.plural;
        const posDetail =
          typeof v.posDetail === 'string' && v.posDetail.trim()
            ? v.posDetail.trim()
            : buildPosDetail(pos, gender, plural, rawPos);
        const level = String(v.level || (lang === 'German' ? 'B1-B2' : 'A2-B1')).trim();
        const example = String(v.example || v['Collocation / Example'] || '').trim();
        const tags = Array.isArray(v.tags) && v.tags.length > 0
          ? [...new Set(v.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))]
          : [topic];
        const id =
          typeof v.id === 'string' && /^[a-z0-9-]+$/.test(v.id.trim())
            ? v.id.trim()
            : slugifyId(lang, word);

        vocabList.push({
          id,
          legacyKey: buildLegacyKey(lang, word),
          lang,
          level,
          word,
          pos,
          posDetail,
          gender,
          plural,
          meaning,
          example,
          tags,
          reviewStatus: String(v.reviewStatus || 'New').trim() || 'New',
          date,
          pairId,
        });
      });
    }

    normalizedPairs.push({ pairId, topic, date, en, de, vocab: vocabList });
  });

  return {
    valid: errors.length === 0,
    errors,
    normalized: {
      schemaVersion: SCHEMA_VERSION,
      date,
      pairs: normalizedPairs,
    },
  };
}

/**
 * Build human-friendly posDetail string (matching legacy card display style).
 */
export function buildPosDetail(pos, gender, plural, rawPos = '') {
  if (rawPos && !VALID_POS.includes(String(rawPos).toLowerCase())) {
    return String(rawPos).trim();
  }
  if (gender) {
    const gMap = { der: 'Maskulin', die: 'Feminin', das: 'Neutrum' };
    return plural ? `${gMap[gender]} (${plural})` : gMap[gender];
  }
  const map = {
    noun: 'Noun',
    verb: 'Verb',
    adj: 'Adjective',
    adv: 'Adverb',
    phrase: 'Phrase',
    other: 'Expression',
  };
  return map[pos] || 'Other';
}

/**
 * Ensure unique IDs across an array of items.
 */
export function ensureUniqueId(desiredId, usedIds) {
  let id = desiredId;
  let counter = 2;
  while (usedIds.has(id)) {
    id = `${desiredId}-${counter}`;
    counter++;
  }
  usedIds.add(id);
  return id;
}

/**
 * Merge a validated batch into existing vocab[] and sentences[] arrays without duplicates.
 * Prepends new items so newest items appear first.
 */
export function mergeBatchIntoDataset(existing, batch) {
  const existingVocab = Array.isArray(existing.vocab) ? [...existing.vocab] : [];
  const existingSentences = Array.isArray(existing.sentences) ? [...existing.sentences] : [];

  const vocabDedup = new Set(existingVocab.map((v) => normalizeForDedup(v.lang, v.word)));
  const sentDedup = new Set(existingSentences.map((s) => normalizeForDedup(s.lang, s.sentence)));
  const usedVocabIds = new Set(existingVocab.map((v) => v.id));
  const usedSentIds = new Set(existingSentences.map((s) => s.id));

  const newVocab = [];
  const newSentences = [];
  let skippedVocabCount = 0;
  let skippedSentenceCount = 0;

  for (const pair of batch.pairs) {
    const pairVocabIds = { English: [], German: [] };

    for (const v of pair.vocab) {
      const dKey = normalizeForDedup(v.lang, v.word);
      if (vocabDedup.has(dKey)) {
        skippedVocabCount++;
        const existingMatch = existingVocab.find((ev) => normalizeForDedup(ev.lang, ev.word) === dKey)
          || newVocab.find((nv) => normalizeForDedup(nv.lang, nv.word) === dKey);
        if (existingMatch && pairVocabIds[v.lang]) {
          pairVocabIds[v.lang].push(existingMatch.id);
        }
        continue;
      }
      const uniqueId = ensureUniqueId(v.id, usedVocabIds);
      const item = { ...v, id: uniqueId };
      vocabDedup.add(dKey);
      newVocab.push(item);
      if (pairVocabIds[v.lang]) {
        pairVocabIds[v.lang].push(uniqueId);
      }
    }

    const addSide = (side) => {
      if (!side) return;
      const sKey = normalizeForDedup(side.lang, side.sentence);
      if (sentDedup.has(sKey)) {
        skippedSentenceCount++;
        return;
      }
      const sentId = ensureUniqueId(slugifyId(side.lang, `${pair.pairId}-${side.sentence.slice(0, 24)}`, 's'), usedSentIds);
      sentDedup.add(sKey);
      newSentences.push({
        id: sentId,
        legacyKey: buildLegacyKey(side.lang, side.sentence),
        pairId: pair.pairId,
        lang: side.lang,
        level: side.level,
        topic: pair.topic,
        tags: [pair.topic],
        sentence: side.sentence,
        translation: side.translation,
        cloze: side.cloze || null,
        keyPoints: side.keyPoints || '',
        vocabIds: pairVocabIds[side.lang] || [],
        date: pair.date,
      });
    };

    addSide(pair.en);
    addSide(pair.de);
  }

  return {
    vocab: [...newVocab, ...existingVocab],
    sentences: [...newSentences, ...existingSentences],
    addedVocabCount: newVocab.length,
    addedSentenceCount: newSentences.length,
    skippedVocabCount,
    skippedSentenceCount,
  };
}

/**
 * Build compact word-index.json for Gemini prompt duplicate avoidance.
 */
export function buildWordIndex(vocab, sentences) {
  const enWords = [];
  const deWords = [];
  for (const v of vocab) {
    if (v.lang === 'English') enWords.push(v.word);
    else if (v.lang === 'German') deWords.push(v.word);
  }

  const recentSentences = sentences.slice(0, 30).map((s) => ({
    date: s.date,
    lang: s.lang,
    sentence: s.sentence,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    counts: {
      vocab: vocab.length,
      sentences: sentences.length,
      englishVocab: enWords.length,
      germanVocab: deWords.length,
    },
    words: {
      English: enWords,
      German: deWords,
    },
    recentSentences,
  };
}

/**
 * Build manifest.json metadata file.
 */
export function buildManifest(vocab, sentences) {
  const levelSet = new Set();
  const tagSet = new Set();
  const dateSet = new Set();

  for (const v of vocab) {
    if (v.level) levelSet.add(v.level);
    if (Array.isArray(v.tags)) v.tags.forEach((t) => tagSet.add(t));
    if (v.date) dateSet.add(v.date);
  }
  for (const s of sentences) {
    if (s.level) levelSet.add(s.level);
    if (s.topic) tagSet.add(s.topic);
    if (Array.isArray(s.tags)) s.tags.forEach((t) => tagSet.add(t));
    if (s.date) dateSet.add(s.date);
  }

  const pairIds = new Set(sentences.map((s) => s.pairId).filter(Boolean));

  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    counts: {
      vocab: vocab.length,
      sentences: sentences.length,
      pairs: pairIds.size,
    },
    languages: VALID_LANGS,
    levels: Array.from(levelSet).sort(),
    tags: Array.from(tagSet).sort(),
    latestDate: Array.from(dateSet).sort().pop() || '',
  };
}

/**
 * Validate persisted data files for CI / pre-commit checks.
 */
export function validateDataFiles({ vocab, sentences, wordIndex, manifest }) {
  const errors = [];

  if (!Array.isArray(vocab)) {
    errors.push('data/vocab.json must be an array.');
  } else {
    const ids = new Set();
    vocab.forEach((v, idx) => {
      if (!v.id) errors.push(`vocab[${idx}]: missing id`);
      else if (ids.has(v.id)) errors.push(`vocab[${idx}]: duplicate id "${v.id}"`);
      else ids.add(v.id);

      if (!VALID_LANGS.includes(v.lang)) errors.push(`vocab[${idx}]: invalid lang "${v.lang}"`);
      if (!v.word) errors.push(`vocab[${idx}]: missing word`);
      if (!v.meaning) errors.push(`vocab[${idx}]: missing meaning`);
      if (!VALID_POS.includes(v.pos)) errors.push(`vocab[${idx}]: invalid pos "${v.pos}"`);
      if (v.gender !== null && v.gender !== undefined && !VALID_GENDERS.includes(v.gender)) {
        errors.push(`vocab[${idx}]: invalid gender "${v.gender}"`);
      }
    });
  }

  if (!Array.isArray(sentences)) {
    errors.push('data/sentences.json must be an array.');
  } else {
    const sIds = new Set();
    const vocabIdSet = new Set(Array.isArray(vocab) ? vocab.map((v) => v.id) : []);
    sentences.forEach((s, idx) => {
      if (!s.id) errors.push(`sentences[${idx}]: missing id`);
      else if (sIds.has(s.id)) errors.push(`sentences[${idx}]: duplicate id "${s.id}"`);
      else sIds.add(s.id);

      if (!VALID_LANGS.includes(s.lang)) errors.push(`sentences[${idx}]: invalid lang "${s.lang}"`);
      if (!s.sentence) errors.push(`sentences[${idx}]: missing sentence`);
      if (!s.translation) errors.push(`sentences[${idx}]: missing translation`);
      if (Array.isArray(s.vocabIds)) {
        s.vocabIds.forEach((vid) => {
          if (!vocabIdSet.has(vid)) {
            errors.push(`sentences[${idx}]: broken vocabId reference "${vid}"`);
          }
        });
      }
    });
  }

  if (!wordIndex || typeof wordIndex !== 'object' || !wordIndex.words) {
    errors.push('data/word-index.json is invalid.');
  }
  if (!manifest || typeof manifest !== 'object' || !manifest.counts) {
    errors.push('data/manifest.json is invalid.');
  }

  return { valid: errors.length === 0, errors };
}
