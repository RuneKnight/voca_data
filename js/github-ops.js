/**
 * GitHub Repository Contents & Actions Workflow Dispatch Operations (Zero-Build ES Module)
 * Powers in-app Profile/Topic Editor and one-click "Generate Today's Words" trigger.
 */

function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

export async function commitJsonToGitHub(cfg, filePath, contentObj, message, fetchImpl = globalThis.fetch) {
  if (!cfg?.token) throw new Error('GitHub PAT가 설정되지 않았습니다.');
  const owner = encodeURIComponent(cfg.owner || 'RuneKnight');
  const repo = encodeURIComponent(cfg.repo || 'voca_data');
  const branch = cfg.branch || 'main';
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  let sha;
  const getRes = await fetchImpl(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
  if (getRes.ok) {
    const meta = await getRes.json();
    sha = meta.sha;
  }

  const body = {
    message,
    content: encodeUtf8Base64(JSON.stringify(contentObj, null, 2) + '\n'),
    branch,
    ...(sha ? { sha } : {}),
  };

  const putRes = await fetchImpl(apiBase, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
  if (!putRes.ok) {
    throw new Error(`GitHub API ${putRes.status}: ${(await putRes.text()).slice(0, 200)}`);
  }
  return await putRes.json();
}

export function applyProfileDailyEdits(profilesCfg, profileId, edits) {
  const cloned = JSON.parse(JSON.stringify(profilesCfg));
  const target = (cloned.profiles || []).find((p) => p.id === profileId);
  if (!target) throw new Error(`프로필을 찾을 수 없습니다: ${profileId}`);

  target.daily = target.daily || {};
  if (edits.topics !== undefined && String(edits.topics).trim()) {
    target.daily.topics = String(edits.topics).trim();
  }
  if (edits.pairCount !== undefined) {
    const n = parseInt(edits.pairCount, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 10) target.daily.pairCount = n;
  }
  if (edits.goal !== undefined) {
    const g = parseInt(edits.goal, 10);
    if (Number.isFinite(g) && g >= 1 && g <= 30) target.daily.goal = g;
  }
  if (edits.model !== undefined && String(edits.model).trim()) {
    target.daily.model = String(edits.model).trim();
  }
  if (edits.seriesTheme !== undefined) {
    const theme = String(edits.seriesTheme).trim();
    if (theme) target.daily.seriesTheme = theme;
    else delete target.daily.seriesTheme;
  }
  if (edits.weekdayKey && edits.weekdayTopic !== undefined) {
    target.daily.weekdayTopics = target.daily.weekdayTopics || {};
    const val = String(edits.weekdayTopic).trim();
    if (val) target.daily.weekdayTopics[edits.weekdayKey] = val;
  }
  return cloned;
}

export async function triggerDailyGenerateWorkflow(
  cfg,
  { profile = 'all', topics = '', pairCount = '', model = '', dryRun = false } = {},
  fetchImpl = globalThis.fetch
) {
  if (!cfg?.token) throw new Error('GitHub PAT가 설정되지 않았습니다.');
  const owner = encodeURIComponent(cfg.owner || 'RuneKnight');
  const repo = encodeURIComponent(cfg.repo || 'voca_data');
  const branch = cfg.branch || 'main';
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/daily-generate.yml/dispatches`;

  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: branch,
      inputs: {
        profile: String(profile || 'all'),
        topics: String(topics || ''),
        pair_count: pairCount ? String(pairCount) : '',
        model: String(model || ''),
        dry_run: dryRun ? 'true' : 'false',
      },
    }),
  });

  if (!res.ok) {
    const hint = res.status === 403
      ? ' (Fine-grained PAT에 Actions: Read and write 권한을 추가해주세요)'
      : '';
    throw new Error(`워크플로우 실행 실패 (HTTP ${res.status})${hint}`);
  }
  return { triggered: true, profile };
}
