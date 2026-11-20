/**
 * Monthly Archive Splitter & Progressive Dataset Loader (Zero-Build ES Module)
 * Enables fast initial paint from recent chunks while seamlessly loading historical archives.
 */

export function getMonthBucket(dateStr) {
  const m = String(dateStr || '').match(/^(\d{4}-\d{2})/);
  return m ? m[1] : 'legacy';
}

export function splitDatasetByMonth(vocab = [], sentences = [], { recentDays = 90 } = {}) {
  const monthMap = new Map();
  const ensure = (month) => {
    if (!monthMap.has(month)) monthMap.set(month, { month, vocab: [], sentences: [] });
    return monthMap.get(month);
  };

  for (const v of vocab) ensure(getMonthBucket(v.date)).vocab.push(v);
  for (const s of sentences) ensure(getMonthBucket(s.date)).sentences.push(s);

  const months = Array.from(monthMap.values()).sort((a, b) => b.month.localeCompare(a.month));

  // Determine cutoff date from newest entry so archives stay deterministic
  const allDates = [...vocab, ...sentences]
    .map((x) => x.date)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')))
    .sort();
  const latestDateStr = allDates[allDates.length - 1] || new Date().toISOString().slice(0, 10);
  const cutoffDate = new Date(latestDateStr + 'T00:00:00Z');
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - recentDays);
  const cutoffIso = cutoffDate.toISOString().slice(0, 10);

  const recentVocab = vocab.filter((v) => !v.date || v.date >= cutoffIso);
  const recentSentences = sentences.filter((s) => !s.date || s.date >= cutoffIso);

  const olderMonths = months
    .map((m) => ({
      month: m.month,
      vocab: m.vocab.filter((v) => v.date && v.date < cutoffIso),
      sentences: m.sentences.filter((s) => s.date && s.date < cutoffIso),
    }))
    .filter((m) => m.vocab.length > 0 || m.sentences.length > 0);

  return {
    cutoffIso,
    recent: { vocab: recentVocab, sentences: recentSentences },
    months,
    olderMonths,
  };
}

export function mergeUniqueById(primary = [], incoming = []) {
  const seen = new Set(primary.map((it) => it.id));
  const out = [...primary];
  for (const it of incoming) {
    if (!it || seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

/**
 * Progressive loader:
 * - Checks manifest.json for archive chunks (`chunks.recent` + `chunks.archiveMonths`).
 * - If present and non-empty, loads recent chunk first, invokes `onPartial`, then streams
 *   remaining monthly archive chunks in parallel and returns the full merged dataset.
 * - Otherwise falls back cleanly to standard `vocab.json` + `sentences.json`.
 */
export async function loadDatasetSmart(dir, fetchJson, { onPartial = null } = {}) {
  const cleanDir = String(dir || 'data').replace(/\/+$/, '');
  let manifest = null;
  try {
    manifest = await fetchJson(`./${cleanDir}/manifest.json`);
  } catch (_) {}

  const chunks = manifest?.chunks;
  if (chunks && chunks.recent && Array.isArray(chunks.archiveMonths) && chunks.archiveMonths.length > 0) {
    try {
      const recentData = await fetchJson(`./${cleanDir}/${chunks.recent}`);
      if (recentData && Array.isArray(recentData.vocab) && Array.isArray(recentData.sentences)) {
        if (typeof onPartial === 'function') {
          onPartial({
            vocab: recentData.vocab,
            sentences: recentData.sentences,
            archiveTotalMonths: chunks.archiveMonths.length,
          });
        }

        const archiveResults = await Promise.allSettled(
          chunks.archiveMonths.map((m) => fetchJson(`./${cleanDir}/archive/${m.month}.json`))
        );

        let fullVocab = [...recentData.vocab];
        let fullSentences = [...recentData.sentences];
        for (const r of archiveResults) {
          if (r.status === 'fulfilled' && r.value) {
            if (Array.isArray(r.value.vocab)) fullVocab = mergeUniqueById(fullVocab, r.value.vocab);
            if (Array.isArray(r.value.sentences)) fullSentences = mergeUniqueById(fullSentences, r.value.sentences);
          }
        }
        return {
          vocab: fullVocab,
          sentences: fullSentences,
          partialError: archiveResults.some((r) => r.status === 'rejected'),
          usedArchiveChunks: true,
        };
      }
    } catch (_) {
      // Fallback cleanly to full vocab.json & sentences.json below
    }
  }

  const [vRes, sRes] = await Promise.allSettled([
    fetchJson(`./${cleanDir}/vocab.json`),
    fetchJson(`./${cleanDir}/sentences.json`),
  ]);
  const vOk = vRes.status === 'fulfilled' && Array.isArray(vRes.value) && vRes.value.length > 0;
  const sOk = sRes.status === 'fulfilled' && Array.isArray(sRes.value) && sRes.value.length > 0;
  if (!vOk && !sOk) throw new Error(`GitHub JSON data unavailable (${cleanDir})`);
  return {
    vocab: vOk ? vRes.value : null,
    sentences: sOk ? sRes.value : null,
    partialError: !vOk || !sOk,
    usedArchiveChunks: false,
  };
}
