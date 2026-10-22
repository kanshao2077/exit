import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const resultPath = path.join(root, 'artifacts/personalization-e2e-results.json');
const original = JSON.parse(await readFile(path.join(root, 'private/bookmarks.json'), 'utf8'));
const seed = JSON.parse(await readFile(path.join(root, 'dist/personalization.json'), 'utf8'));
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
let executablePath = process.env.EXIT_CHROME_BINARY;
if (!executablePath) {
  try { await access(systemChrome); executablePath = systemChrome; } catch { /* Use Playwright Chromium if unavailable. */ }
}
const checks = [], errors = [], externalRequests = [];
const result = {
  status: 'running',
  scope: 'Fresh temporary Chrome profile; supplied export inserted using chrome.bookmarks.create; no everyday profile access and no bookmark destinations opened.',
  revision: seed.revision,
  browser: '',
  counts: {},
  matching: {},
  home: [],
  checks,
  errors,
};
const pass = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const digest = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const flatten = (nodes, ancestry = []) => nodes.flatMap(node => [
  { ...node, path: ancestry },
  ...flatten(node.children ?? [], node.title ? [...ancestry, node.title] : ancestry),
]);
const expectedCount = flatten(original).filter(node => node.url !== undefined).length;
const expectedTitles = ['影视创作', 'AI / 科技', '设计灵感', '开发编程', '阅读知识', '生活娱乐'];
const profile = await mkdtemp(path.join(tmpdir(), 'exit-personalization-profile-'));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath,
    channel: executablePath ? undefined : 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging'],
  });
  result.browser = context.browser().version();
  // Neither the UI nor this verification may navigate to any bookmarked website.
  await context.route(/^https?:\/\//, async route => {
    externalRequests.push(route.request().resourceType());
    await route.abort();
  });
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'dist') });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/index.html`);
  await page.getByText('Chrome 书签 · 已连接', { exact: true }).waitFor();
  assert.equal(await page.locator('.source-note').count(), 0);

  const inserted = await page.evaluate(async exportedTree => {
    const tree = await chrome.bookmarks.getTree();
    const roots = tree[0].children;
    const bar = roots.find(node => node.folderType === 'bookmarks-bar') ?? roots[0];
    const other = roots.find(node => node.folderType === 'other') ?? roots[1];
    if (!bar || !other) throw new Error('Native system roots unavailable');
    const counts = { bookmarks: 0, folders: 0, barBookmarks: 0, otherBookmarks: 0 };
    const visit = async (node, parentId, destination) => {
      const created = await chrome.bookmarks.create({
        parentId,
        title: node.title,
        ...(node.url === undefined ? {} : { url: node.url }),
      });
      if (node.url !== undefined) {
        counts.bookmarks++;
        counts[destination === 'bar' ? 'barBookmarks' : 'otherBookmarks']++;
      } else {
        counts.folders++;
        for (const child of node.children ?? []) await visit(child, created.id, destination);
      }
    };
    for (const top of exportedTree[0].children) {
      if (top.folderType === 'bookmarks-bar' || top.title === '书签栏' || top.title === 'Bookmarks bar') {
        for (const child of top.children ?? []) await visit(child, bar.id, 'bar');
      } else if (top.folderType === 'other' || top.id === 'snapshot-other') {
        for (const child of top.children ?? []) await visit(child, other.id, 'other');
      } else {
        await visit(top, other.id, 'other');
      }
    }
    return counts;
  }, original);
  const before = await page.evaluate(() => chrome.bookmarks.getTree());
  const links = flatten(before).filter(node => node.url !== undefined);
  result.counts = { supplied: flatten(original).filter(node => node.url !== undefined).length, inserted: inserted.bookmarks, native: links.length, insertedFolders: inserted.folders, barBookmarks: inserted.barBookmarks, otherBookmarks: inserted.otherBookmarks };
  assert.equal(result.counts.supplied, expectedCount);
  assert.equal(result.counts.inserted, expectedCount);
  assert.equal(result.counts.native, expectedCount);
  pass(`All ${expectedCount} supplied bookmarks inserted into isolated native Chrome roots`);

  const exact = new Map(), fallback = new Map(), seedFallbackCounts = new Map();
  for (const item of seed.items) seedFallbackCounts.set(item.fallback, (seedFallbackCounts.get(item.fallback) ?? 0) + 1);
  for (const entry of links) {
    const a = digest([entry.title.trim(), entry.url, entry.path]), b = digest([entry.title.trim(), entry.url]);
    exact.set(a, [...(exact.get(a) ?? []), entry.id]);
    fallback.set(b, [...(fallback.get(b) ?? []), entry.id]);
  }
  let exactMatches = 0, fallbackMatches = 0;
  const unmatched = [], expectedBindings = [];
  for (const item of seed.items) {
    const a = exact.get(item.exact) ?? [], b = fallback.get(item.fallback) ?? [];
    const nativeId = a.length === 1 ? a[0] : b.length === 1 && seedFallbackCounts.get(item.fallback) === 1 ? b[0] : undefined;
    if (nativeId) {
      if (a.length === 1) exactMatches++; else fallbackMatches++;
      expectedBindings.push({ nativeId, item });
    } else {
      unmatched.push({ digest: item.exact, exactCandidates: a.length, fallbackCandidates: b.length, seedFallbackCandidates: seedFallbackCounts.get(item.fallback) });
    }
  }
  result.matching = { suppliedSuggestions: seed.items.length, expectedUniqueMatches: expectedBindings.length, exactMatches, fallbackMatches, unmatched };
  await page.reload();
  await page.getByText('Chrome 书签 · 已连接', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('classificationRevision')).classificationRevision), seed.revision);
  const stored = await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  const assigned = stored.categories.flatMap(category => category.bookmarkIds);
  result.matching.actualMappings = assigned.length;
  result.matching.uniqueNativeIds = new Set(assigned).size;
  assert.equal(expectedBindings.length, expectedCount, JSON.stringify(result.matching));
  assert.equal(assigned.length, expectedCount);
  assert.equal(new Set(assigned).size, expectedCount);
  for (const { nativeId, item } of expectedBindings) {
    assert.ok(stored.categories.find(category => category.id === `purpose:${item.categoryId}`)?.bookmarkIds.includes(nativeId));
    assert.deepEqual(stored.annotations[nativeId], { group: item.group, tags: item.tags });
  }
  assert.deepEqual(await page.evaluate(() => chrome.bookmarks.getTree()), before);
  pass(`Reload binds all ${expectedCount} digest suggestions to real native IDs without changing any native tree data`);

  result.home = await page.locator('.category-name').allTextContents();
  assert.deepEqual(result.home, expectedTitles);
  assert.equal(stored.categories.length, 7);
  pass('Personal homepage shows the six requested purpose categories in order');

  await page.getByRole('button', { name: '整理', exact: true }).click();
  await page.getByRole('button', { name: '上移 AI / 科技', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.category-setting .check-label > span')?.textContent?.startsWith('AI / 科技'));
  const customized = await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings);
  await page.getByRole('button', { name: '完成整理', exact: true }).click();
  assert.deepEqual(await page.locator('.category-name').allTextContents(), ['AI / 科技', '影视创作', ...expectedTitles.slice(2)]);
  await page.reload();
  await page.getByText('Chrome 书签 · 已连接', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(async () => (await chrome.storage.local.get('settings')).settings), customized);
  assert.deepEqual(await page.locator('.category-name').allTextContents(), ['AI / 科技', '影视创作', ...expectedTitles.slice(2)]);
  assert.deepEqual(await page.evaluate(() => chrome.bookmarks.getTree()), before);
  pass('User homepage reorder persists after reload and is not overwritten by personalization');

  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  assert.ok(context.pages().every(tab => ['chrome-extension:', 'about:'].includes(new URL(tab.url()).protocol)));
  result.externalPageRequests = externalRequests.length;
  result.bookmarkDestinationsOpened = 0;
  result.nativeTreeUnchanged = true;
  result.localSettingsPersisted = true;
  result.status = 'passed';
  pass('No bookmark websites opened, no external page requests, no runtime exceptions');
  console.log(`Personalization E2E: ${assigned.length}/${expectedCount} mappings · ${result.home.length} homepage categories · native tree unchanged`);
} catch (error) {
  result.status = 'failed';
  result.failure = error.message;
  throw error;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
}
