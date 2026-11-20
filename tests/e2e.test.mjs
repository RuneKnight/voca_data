#!/usr/bin/env node
/**
 * Zero-dependency Headless Chromium E2E Regression Test Suite
 * Uses Node.js built-in http, child_process, and native WebSocket (CDP).
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, join } from 'node:path';
import { spawn, execSync } from 'node:child_process';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

function findChromeBinary() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      execSync(`test -x "${bin}"`);
      return bin;
    } catch (_) {}
  }
  throw new Error('No Chromium/Chrome binary found for E2E tests.');
}

function startStaticServer() {
  return new Promise((resolveServer) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
        const safePath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
        const fullPath = resolve(ROOT, safePath);
        if (!fullPath.startsWith(ROOT)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
        await stat(fullPath);
        const body = await readFile(fullPath);
        res.writeHead(200, { 'Content-Type': MIME[extname(fullPath)] || 'application/octet-stream' });
        res.end(body);
      } catch (_) {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveServer({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Page eval error: ${res.exceptionDetails.text} ${res.exceptionDetails.exception?.description || ''}`);
    }
    return res.result?.value;
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

async function waitFor(fn, timeoutMs = 8000, intervalMs = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const val = await fn();
    if (val) return val;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

async function launchChromium() {
  const bin = findChromeBinary();
  const tmpProfile = `/tmp/langhub-e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const proc = spawn(
    bin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${tmpProfile}`,
      '--remote-debugging-port=0',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  const wsBrowserUrl = await new Promise((resolveUrl, rejectUrl) => {
    let stderr = '';
    const timer = setTimeout(() => rejectUrl(new Error('Timed out waiting for Chromium DevTools URL: ' + stderr)), 30000);
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(match[1]);
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`Chromium exited early with code ${code}: ${stderr}`));
    });
  });

  const port = new URL(wsBrowserUrl).port;
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('No Chromium page target found');

  const client = new CdpClient(pageTarget.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

  return { proc, client };
}

async function runTests() {
  const { server, baseUrl } = await startStaticServer();
  const { proc, client } = await launchChromium();

  try {
    console.log('🌐 Navigating to', baseUrl);
    await client.send('Page.navigate', { url: baseUrl });
    await waitFor(() => client.eval(`document.readyState === 'complete'`));

    // Seed legacy localStorage keys BEFORE reloading to verify 100% backwards-compatibility bridge
    await client.eval(`
      localStorage.clear();
      localStorage.setItem('vh_bookmarks', JSON.stringify(['German:die Speicherauslastung']));
      localStorage.setItem('vh_mastered', JSON.stringify(['English:utilization']));
    `);
    await client.send('Page.reload', { ignoreCache: true });

    // 1. Wait for GitHub JSON data load
    const loadedCounts = await waitFor(() =>
      client.eval(`(typeof vocabData !== 'undefined' && vocabData.length > 0 && sentenceData.length > 0) ? { v: vocabData.length, s: sentenceData.length, src: activeDataSource } : null`)
    );
    console.log('✅ Test 1 — Loaded GitHub JSON:', loadedCounts);
    assert.equal(loadedCounts.src, 'github');
    assert.ok(loadedCounts.v >= 400, 'Expected migrated vocab items');
    assert.ok(loadedCounts.s >= 300, 'Expected migrated sentence items');

    // Check zero uncaught page exceptions
    const runtimeExceptions = client.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    assert.equal(runtimeExceptions.length, 0, 'Expected 0 runtime JS exceptions on load');

    // 2. Verify legacyKey localStorage compatibility bridge
    const legacyBridge = await client.eval(`
      (() => {
        const bm = vocabData.find(v => v.word === 'die Speicherauslastung');
        const ms = vocabData.find(v => v.word === 'utilization');
        return {
          bmMatched: bm ? isBookmarkedItem(bm) : false,
          msMatched: ms ? isMasteredItem(ms) : false,
        };
      })()
    `);
    assert.deepEqual(legacyBridge, { bmMatched: true, msMatched: true });
    console.log('✅ Test 2 — Legacy localStorage bookmark/mastered bridge works');

    // 3. Card flip, Flip All, List view toggle
    const flipResult = await client.eval(`
      (() => {
        const firstCard = document.querySelector('[data-card-flip]');
        firstCard.click();
        const flipped1 = firstCard.querySelector('.card-inner').classList.contains('flipped');
        toggleAllFlip();
        const allFlippedCount = document.querySelectorAll('.card-inner.flipped').length;
        setVocabLayout('list');
        const listHasMeaning = document.querySelectorAll('#vocabGrid > div').length;
        setVocabLayout('card');
        return { flipped1, allFlippedCount, listHasMeaning };
      })()
    `);
    assert.equal(flipResult.flipped1, true);
    assert.equal(flipResult.allFlippedCount, 20);
    assert.equal(flipResult.listHasMeaning, 20);
    console.log('✅ Test 3 — Card flip, Flip All, and List/Card toggle work');

    // 4. Fisher-Yates shuffle stability across pagination
    const shuffleCheck = await client.eval(`
      (() => {
        const before = [...document.querySelectorAll('#vocabGrid [data-item-id]')].map(e => e.dataset.itemId);
        toggleShuffle();
        const after1 = [...document.querySelectorAll('#vocabGrid [data-item-id]')].map(e => e.dataset.itemId);
        goToPage(2);
        goToPage(1);
        const afterReturn = [...document.querySelectorAll('#vocabGrid [data-item-id]')].map(e => e.dataset.itemId);
        toggleShuffle(); // turn off
        return {
          changed: JSON.stringify(before) !== JSON.stringify(after1),
          stableAcrossPages: JSON.stringify(after1) === JSON.stringify(afterReturn),
        };
      })()
    `);
    assert.equal(shuffleCheck.changed, true, 'Shuffle must actually reorder items');
    assert.equal(shuffleCheck.stableAcrossPages, true, 'Shuffle order must remain stable across page changes');
    console.log('✅ Test 4 — Fisher-Yates shuffle & pagination stability verified');

    // 5. Filters (Language, POS, Level, Tag, Search + Reset)
    const filterCheck = await client.eval(`
      (() => {
        setLangFilter('German');
        handlePosFilterChange('noun');
        const germanNouns = currentRenderedVocab.every(v => v.lang === 'German' && v.pos === 'noun');
        const germanNounCount = currentRenderedVocab.length;
        handleLevelFilterChange('B1-B2');
        const levelOk = currentRenderedVocab.every(v => v.level === 'B1-B2');
        resetAllFilters();
        return { germanNouns, germanNounCount, levelOk, restoredCount: currentRenderedVocab.length };
      })()
    `);
    assert.equal(filterCheck.germanNouns, true);
    assert.ok(filterCheck.germanNounCount > 0);
    assert.equal(filterCheck.levelOk, true);
    assert.equal(filterCheck.restoredCount, 20);
    console.log('✅ Test 5 — Multi-dimensional filters (Lang, POS, Level) & reset verified');

    // 6. Special character & XSS safety via Event Delegation
    const specialCheck = await client.eval(`
      (() => {
        const specialItem = normalizeVocabItem({
          id: 'test-special-chars',
          lang: 'English',
          level: 'B1',
          word: "it's a \\"quoted\\" <script>x</script>\\nword",
          pos: 'phrase',
          meaning: "따옴표 '테스트' \\"안전\\"",
          example: "Line 1\\nLine '2'",
        }, 0);
        vocabData.unshift(specialItem);
        rebuildVocabIndex();
        render();
        const card = document.querySelector('[data-item-id="test-special-chars"]');
        const hasScriptTag = card.querySelectorAll('script').length > 0;
        const bmBtn = card.querySelector('[data-action="toggle-bookmark"]');
        bmBtn.click();
        const bookmarked = isBookmarkedItem(specialItem);
        // cleanup
        vocabData.shift();
        rebuildVocabIndex();
        bookmarks.delete('test-special-chars');
        render();
        return { hasScriptTag, bookmarked };
      })()
    `);
    assert.equal(specialCheck.hasScriptTag, false, 'HTML/script tags must be escaped');
    assert.equal(specialCheck.bookmarked, true, 'Delegated bookmark click must work with quotes/newlines');
    console.log('✅ Test 6 — Special characters & XSS safety verified');

    // 7. Sentence List, Parallel EN-DE View & Vocab Chip Popover
    const sentenceCheck = await client.eval(`
      (() => {
        switchView('sentence');
        const listCount = document.getElementById('sentenceList').children.length;
        setSentenceLayout('parallel');
        const parallelCards = document.getElementById('sentenceList').children.length;
        const firstChip = document.querySelector('[data-action="open-vocab-chip"]');
        let popoverOpened = false;
        let popoverTitle = '';
        if (firstChip) {
          firstChip.click();
          popoverOpened = !document.getElementById('wordPopoverModal').classList.contains('hidden');
          popoverTitle = document.getElementById('wordPopoverTitle').innerText;
          closeModal('wordPopoverModal');
        }
        setSentenceLayout('list');
        return { listCount, parallelCards, popoverOpened, popoverTitle };
      })()
    `);
    assert.equal(sentenceCheck.listCount, 20);
    assert.equal(sentenceCheck.parallelCards, 20);
    assert.equal(sentenceCheck.popoverOpened, true);
    assert.ok(sentenceCheck.popoverTitle.length > 0);
    console.log('✅ Test 7 — Sentence list, Parallel EN-DE view, and Vocab Chip popover verified');

    // 8. Quiz Modes (Vocab + Wrong-Answer Notes, Cloze, German Article)
    const quizCheck = await client.eval(`
      (() => {
        switchView('quiz');
        document.getElementById('quizCountSelect').value = '5';
        setQuizType('vocab');
        const vocabQCount = quizQuestions.length;
        // Answer Q1 wrong intentionally, remaining 4 right
        for (let i = 0; i < vocabQCount; i++) {
          const q = quizQuestions[currentQuizIndex];
          const pickIdx = i === 0 ? (q.correctIndex === 0 ? 1 : 0) : q.correctIndex;
          document.querySelector(\`.quiz-opt-btn[data-option-index="\${pickIdx}"]\`).click();
          document.querySelector('[data-action="quiz-next"]').click();
        }
        const hasWrongNotes = document.getElementById('quizContainer').innerText.includes('오답 노트');
        const hasRetryBtn = !!document.querySelector('[data-action="quiz-retry-wrong"]');

        // Cloze quiz
        setQuizType('cloze');
        const hasBlank = quizQuestions.length > 0 && quizQuestions[0].questionText.includes('________');

        // German Article quiz
        setQuizType('article');
        const articleOpts = quizQuestions.length > 0 ? quizQuestions[0].options : [];

        return { vocabQCount, hasWrongNotes, hasRetryBtn, hasBlank, articleOpts };
      })()
    `);
    assert.equal(quizCheck.vocabQCount, 5);
    assert.equal(quizCheck.hasWrongNotes, true);
    assert.equal(quizCheck.hasRetryBtn, true);
    assert.equal(quizCheck.hasBlank, true);
    assert.deepEqual(quizCheck.articleOpts, ['der', 'die', 'das']);
    console.log('✅ Test 8 — Quiz (Vocab + Wrong Notes, Cloze, German Article) verified');

    // 9. E-Ink Mode Contrast Regression Test (PR #6 safeguard)
    const einkCheck = await client.eval(`
      (() => {
        switchView('vocab');
        if (!isEInkMode) toggleEInkMode();
        const firstCard = document.querySelector('[data-card-flip]');
        const inner = firstCard.querySelector('.card-inner');
        if (!inner.classList.contains('flipped')) firstCard.click();
        const back = firstCard.querySelector('.card-back');
        const meaningEl = back.querySelector('.card-meaning');
        const backStyle = getComputedStyle(back);
        const meaningStyle = getComputedStyle(meaningEl);
        const snapshot = {
          backDisplay: backStyle.display,
          backBg: backStyle.backgroundColor,
          backColor: backStyle.color,
          meaningColor: meaningStyle.color,
        };
        toggleEInkMode(); // restore off
        return snapshot;
      })()
    `);
    assert.equal(einkCheck.backDisplay, 'flex', 'E-Ink flipped card back must be visible');
    assert.equal(einkCheck.backBg, 'rgb(255, 255, 255)', 'E-Ink card back must have white background');
    assert.equal(einkCheck.backColor, 'rgb(0, 0, 0)', 'E-Ink card back must have pure black text');
    assert.equal(einkCheck.meaningColor, 'rgb(0, 0, 0)', 'E-Ink meaning text must be pure black (never invisible)');
    console.log('✅ Test 9 — E-Ink high-contrast black-on-white verified (PR #6 regression-proof)');

    // 10. Quick Import Modal & Stats Modal
    const modalCheck = await client.eval(`
      (() => {
        openModal('importModal');
        document.getElementById('importJsonInput').value = JSON.stringify({
          schemaVersion: 1,
          date: '2026-11-20',
          pairs: [{
            pairId: '20261120-99',
            topic: 'dev',
            en: { level: 'A2-B1', sentence: 'Unique test sentence for E2E.', translation: 'E2E 테스트 문장.', cloze: 'Unique', keyPoints: 'Unique: 고유한' },
            vocab: [
              { lang: 'English', word: 'utilization', pos: 'noun', meaning: 'dup' },
              { lang: 'English', word: 'e2e-unique-lexicon-term', pos: 'noun', meaning: '테스트 고유 단어', example: 'verify e2e-unique-lexicon-term' }
            ]
          }]
        });
        previewImportJson();
        const previewText = document.getElementById('importPreviewArea').innerText;
        closeModal('importModal');

        openModal('statsModal');
        const statsRendered = document.getElementById('statsModalBody').innerText.includes('연속 학습');
        closeModal('statsModal');
        return { previewText, statsRendered };
      })()
    `);
    assert.ok(modalCheck.previewText.includes('신규 단어 1개 (중복 제외 1개)'), 'Quick Import must detect 1 new & 1 dup vocab');
    assert.ok(modalCheck.previewText.includes('신규 문장 1개'), 'Quick Import must detect 1 new sentence');
    assert.equal(modalCheck.statsRendered, true);
    console.log('✅ Test 10 — Quick Import validation/dedup & Stats dashboard verified');

    // 11. Mobile Viewport (375x812) No Horizontal Overflow (PR #3/#4 safeguard)
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    const mobileOverflow = await client.eval(`
      (() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        headerHeight: document.querySelector('header').getBoundingClientRect().height,
        tailwindLoaded: Boolean(window.tailwind),
      }))()
    `);
    assert.ok(
      mobileOverflow.scrollWidth <= mobileOverflow.clientWidth + 1,
      `Mobile horizontal overflow detected: scrollWidth=${mobileOverflow.scrollWidth} > clientWidth=${mobileOverflow.clientWidth}`
    );
    if (mobileOverflow.tailwindLoaded) {
      assert.ok(
        mobileOverflow.headerHeight <= 165,
        `Mobile header should stay compact (<=165px), got ${mobileOverflow.headerHeight}px`
      );
    }
    console.log(`✅ Test 11 — Mobile (375px) layout has zero horizontal overflow (header ${Math.round(mobileOverflow.headerHeight)}px, tw=${mobileOverflow.tailwindLoaded})`);

    // 12. Dark Mode Verification (Warm Dark #161513)
    const darkCheck = await client.eval(`
      (async () => {
        if (!isDarkMode) toggleDarkMode();
        await new Promise(r => setTimeout(r, 240));
        const hasDarkClass = document.documentElement.classList.contains('dark');
        const bg = getComputedStyle(document.body).backgroundColor;
        const color = getComputedStyle(document.body).color;
        toggleDarkMode(); // restore light
        return { hasDarkClass, bg, color };
      })()
    `);
    assert.equal(darkCheck.hasDarkClass, true, 'html must have dark class');
    assert.equal(darkCheck.bg, 'rgb(22, 21, 19)', 'Dark mode body background must be Warm Dark #161513');
    assert.equal(darkCheck.color, 'rgb(239, 233, 222)', 'Dark mode body text must be Warm Ink #EFE9DE');
    console.log('✅ Test 12 — Dark mode Warm Ink theme verified');

    const finalExceptions = client.events.filter((e) => e.method === 'Runtime.exceptionThrown');
    assert.equal(finalExceptions.length, 0, 'Expected 0 runtime JS exceptions across all E2E tests');

    console.log('\n🎉 ALL 12 HEADLESS CHROMIUM E2E REGRESSION TESTS PASSED!');
  } finally {
    client.close();
    proc.kill('SIGTERM');
    server.close();
  }
}

runTests().catch((err) => {
  console.error('❌ E2E test failed:', err);
  process.exit(1);
});
