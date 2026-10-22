import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourcePath = path.join(root, 'private/EXIT-分类建议-待审阅.json');
const personalized = process.argv.includes('--personalized');
const build = process.argv.includes('--build');
const categories = [
  { id: 'film', title: '影视创作' },
  { id: 'ai', title: 'AI / 科技' },
  { id: 'design', title: '设计灵感' },
  { id: 'dev', title: '开发编程' },
  { id: 'read', title: '阅读知识' },
  { id: 'life', title: '生活娱乐' },
  { id: 'work', title: '工作与效率' },
];
const categoryMap = new Map([
  ['视频创作', 'film'],
  ['写作与发布', 'film'],
  ['视觉设计', 'design'],
  ['AI与科技', 'ai'],
  ['开发编程', 'dev'],
  ['阅读知识', 'read'],
  ['生活与工具', 'life'],
  ['工作协作', 'work'],
]);
const digest = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

let source;
try {
  if (personalized) source = JSON.parse(await readFile(sourcePath, 'utf8'));
} catch (error) {
  // A public checkout has no private bookmark review. Keep that build usable.
  if (error.code !== 'ENOENT') throw error;
}

const items = (source?.items ?? []).map((item, index) => {
  const { title, url, path: bookmarkPath } = item.ref ?? {};
  const categoryId = categoryMap.get(item.category);
  if (typeof title !== 'string' || typeof url !== 'string' || !Array.isArray(bookmarkPath) || !categoryId) {
    throw new Error(`Invalid reviewed suggestion at index ${index}`);
  }
  const uncertain = item.confidence === 'uncertain';
  let group = typeof item.group === 'string' ? item.group : '';
  if (item.category === '写作与发布') group = `写作与发布 / ${group}`;
  if (uncertain) group = `待确认 / ${group}`;
  const tags = [...new Set([...(item.tags ?? []), ...(uncertain ? ['待确认'] : [])])];
  return {
    exact: digest([title.trim(), url, bookmarkPath]),
    fallback: digest([title.trim(), url]),
    categoryId,
    group,
    tags,
    uncertain,
  };
});

const personalization = {
  version: 1,
  kind: 'exit-personalization',
  revision: 'purpose-2026-10-21-v2',
  generator: source?.generator ?? 'EXIT. personalization template',
  categories,
  home: items.length ? ['film', 'ai', 'design', 'dev', 'read', 'life'] : [],
  items,
};
const targets = personalized ? [path.join(root, 'private/personalization.json')] : [];
if (build) targets.push(path.join(root, 'dist/personalization.json'));
for (const target of targets) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(personalization, null, 2)}\n`);
}
console.log(`Personalization: ${items.length} bookmarks · ${categories.length} categories · ${personalization.home.length} home · ${items.filter((item) => item.uncertain).length} to review`);
