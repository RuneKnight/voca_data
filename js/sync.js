/**
 * Cross-Device Progress Merge & Private GitHub Gist Sync Client (Zero-Build ES Module)
 */

export function mergeProgressPayloads(localData, remoteData, defaultProfileId = 'me') {
  const a = localData || {};
  const b = remoteData || {};

  const mergedBookmarks = Array.from(new Set([...(a.bookmarks || []), ...(b.bookmarks || [])]));
  const mergedMastered = Array.from(new Set([...(a.mastered || []), ...(b.mastered || [])]));
  const mergedStamps = Array.from(new Set([...(a.kidStamps || []), ...(b.kidStamps || [])])).sort();

  const mergedSrs = { ...(a.srs || {}) };
  for (const [key, rVal] of Object.entries(b.srs || {})) {
    const lVal = mergedSrs[key];
    if (!lVal) {
      mergedSrs[key] = rVal;
    } else {
      const lDate = String(lVal.lastReview || lVal.nextReview || '');
      const rDate = String(rVal.lastReview || rVal.nextReview || '');
      if (rDate > lDate || (rDate === lDate && (rVal.box || 0) > (lVal.box || 0))) {
        mergedSrs[key] = rVal;
      }
    }
  }

  const mergedLog = {};
  const allDates = new Set([...Object.keys(a.studyLog || {}), ...Object.keys(b.studyLog || {})]);
  for (const d of allDates) {
    const la = (a.studyLog && a.studyLog[d]) || {};
    const rb = (b.studyLog && b.studyLog[d]) || {};
    mergedLog[d] = {
      review: Math.max(la.review || 0, rb.review || 0),
      quiz: Math.max(la.quiz || 0, rb.quiz || 0),
      mastered: Math.max(la.mastered || 0, rb.mastered || 0),
    };
  }

  return {
    schemaVersion: 1,
    profileId: a.profileId || b.profileId || defaultProfileId,
    updatedAt: new Date().toISOString(),
    bookmarks: mergedBookmarks,
    mastered: mergedMastered,
    srs: mergedSrs,
    studyLog: mergedLog,
    kidStamps: mergedStamps,
    ...(Array.isArray(a.reviewTargets) ? { reviewTargets: a.reviewTargets } : Array.isArray(b.reviewTargets) ? { reviewTargets: b.reviewTargets } : {}),
  };
}

export async function syncPrivateGistProgress({
  token,
  gistId = '',
  profileId = 'me',
  localPayload,
  mode = 'merge',
  fetchImpl = globalThis.fetch,
}) {
  if (!token) throw new Error('gist 권한이 있는 GitHub 토큰이 필요합니다.');

  const filename = `progress-${profileId}.json`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  let resolvedGistId = String(gistId || '').trim();
  let remotePayload = null;

  if (resolvedGistId) {
    const getRes = await fetchImpl(`https://api.github.com/gists/${encodeURIComponent(resolvedGistId)}`, { headers });
    if (!getRes.ok) throw new Error(`Gist 조회 실패 (HTTP ${getRes.status})`);
    const gistData = await getRes.json();
    const fileObj = gistData?.files?.[filename];
    if (fileObj && fileObj.content) {
      remotePayload = JSON.parse(fileObj.content);
    }
  }

  const finalPayload =
    mode === 'pull' && remotePayload
      ? remotePayload
      : remotePayload
      ? mergeProgressPayloads(localPayload, remotePayload, profileId)
      : localPayload;

  if (!resolvedGistId) {
    const createRes = await fetchImpl('https://api.github.com/gists', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        description: 'Language Hub Pro — Family Study Progress Sync (Private)',
        public: false,
        files: { [filename]: { content: JSON.stringify(finalPayload, null, 2) } },
      }),
    });
    if (!createRes.ok) throw new Error(`비공개 Gist 생성 실패 (HTTP ${createRes.status})`);
    const created = await createRes.json();
    resolvedGistId = created.id;
  } else if (mode !== 'pull') {
    const patchRes = await fetchImpl(`https://api.github.com/gists/${encodeURIComponent(resolvedGistId)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        files: { [filename]: { content: JSON.stringify(finalPayload, null, 2) } },
      }),
    });
    if (!patchRes.ok) throw new Error(`Gist 업데이트 실패 (HTTP ${patchRes.status})`);
  }

  return { gistId: resolvedGistId, payload: finalPayload };
}
