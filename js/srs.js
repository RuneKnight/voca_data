/**
 * Pure SM-2 Spaced Repetition Scheduler & Adaptive Review Target Extractor
 * Shared by index.html (browser ES module), scripts/generate-daily.mjs, and unit tests.
 */

export const DEFAULT_EASE_FACTOR = 2.5;
export const MIN_EASE_FACTOR = 1.3;

export function addDaysIso(dateStr, days) {
  const parts = String(dateStr || '').split('-').map(Number);
  const dt = parts.length === 3
    ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
    : new Date();
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Computes the next SM-2 SRS record from a previous record and quality grade.
 * Backwards-compatible with legacy box-based records ({ box, nextReview, lapses }).
 *
 * @param {object|null} prev - Previous SRS record
 * @param {'again'|'hard'|'good'|'easy'} quality - User recall rating
 * @param {string} today - YYYY-MM-DD
 */
export function computeSm2Review(prev, quality, today) {
  const legacyBox = prev?.box || 1;
  const prevReps = typeof prev?.reps === 'number' ? prev.reps : Math.max(0, legacyBox - 1);
  const prevInterval = typeof prev?.interval === 'number' ? prev.interval : ([1, 3, 7, 14, 30][legacyBox - 1] || 1);
  let ease = typeof prev?.ease === 'number' ? prev.ease : DEFAULT_EASE_FACTOR;
  let lapses = prev?.lapses || 0;
  let reps = prevReps;
  let interval = prevInterval;

  if (quality === 'again') {
    reps = 0;
    interval = 1;
    lapses += 1;
    ease = Math.max(MIN_EASE_FACTOR, Number((ease - 0.2).toFixed(2)));
  } else if (quality === 'hard') {
    reps = Math.max(1, prevReps);
    interval = prevReps <= 0 ? 1 : Math.max(1, Math.round(prevInterval * 1.2));
    ease = Math.max(MIN_EASE_FACTOR, Number((ease - 0.15).toFixed(2)));
  } else if (quality === 'easy') {
    reps = prevReps + 1;
    if (reps === 1) interval = 4;
    else if (reps === 2) interval = 8;
    else interval = Math.max(4, Math.round(prevInterval * ease * 1.3));
    ease = Number((ease + 0.15).toFixed(2));
  } else {
    // 'good'
    reps = prevReps + 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.max(2, Math.round(prevInterval * ease));
  }

  // Derive legacy 1..5 box for compatibility with existing badges/stats
  const box = reps === 0 ? 1 : interval >= 30 ? 5 : interval >= 14 ? 4 : interval >= 6 ? 3 : 2;

  return {
    box,
    reps,
    interval,
    ease,
    lapses,
    lastReview: today,
    nextReview: addDaysIso(today, interval),
  };
}

/**
 * Extracts top adaptive review words (highest lapses, lowest ease, or bookmarked)
 * so daily AI generation can recycle weak vocabulary naturally in fresh sentences.
 *
 * @param {object} progressPayload - { bookmarks, mastered, srs }
 * @param {Array<object>} vocabList - Full vocab dataset for the profile
 * @param {number} maxCount - Maximum review targets to select
 */
export function extractAdaptiveReviewTargets(progressPayload, vocabList = [], maxCount = 3) {
  if (!progressPayload || !Array.isArray(vocabList) || vocabList.length === 0) return [];
  const masteredSet = new Set(progressPayload.mastered || []);
  const bookmarkSet = new Set(progressPayload.bookmarks || []);
  const srsMap = progressPayload.srs || {};

  const scored = [];
  for (const item of vocabList) {
    if (!item || !item.word) continue;
    const legacyKey = `${item.lang}:${item.word}`;
    if (masteredSet.has(item.id) || masteredSet.has(legacyKey)) continue;

    const rec = srsMap[item.id] || srsMap[legacyKey] || null;
    const isBookmarked = bookmarkSet.has(item.id) || bookmarkSet.has(legacyKey);
    const lapses = rec?.lapses || 0;
    const lowEaseBonus = rec && typeof rec.ease === 'number' && rec.ease < 2.2 ? (2.5 - rec.ease) * 4 : 0;

    const score = lapses * 10 + lowEaseBonus + (isBookmarked ? 4 : 0) + (rec && rec.box === 1 ? 2 : 0);
    if (score <= 0) continue;

    scored.push({
      id: item.id,
      lang: item.lang,
      word: item.word,
      meaning: item.meaning || '',
      lapses,
      bookmarked: isBookmarked,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || b.lapses - a.lapses || a.word.localeCompare(b.word));
  return scored.slice(0, Math.max(0, maxCount));
}
