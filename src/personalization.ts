import { z } from 'zod';
import { emptySettings, flatten, settingsSchema, type Settings } from './model';
import type { Source } from './source';
const seedSchema = z.object({
  version: z.literal(1), kind: z.literal('exit-personalization'), revision: z.string(), generator: z.string(),
  categories: z.array(z.object({ id: z.string(), title: z.string() })), home: z.array(z.string()),
  items: z.array(z.object({ exact: z.string(), fallback: z.string(), categoryId: z.string(), group: z.string(), tags: z.array(z.string()), uncertain: z.boolean() })),
});
async function digest(value: unknown) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
}
export async function initializePersonalization(source: Source) {
  let seed: z.infer<typeof seedSchema>;
  try {
    const response = await fetch(import.meta.env.DEV ? '/private/personalization.json' : './personalization.json');
    if (!response.ok || !response.headers.get('content-type')?.includes('json')) return;
    seed = seedSchema.parse(await response.json());
  } catch { return; }
  if (!seed.items.length || await source.get('classificationRevision') === seed.revision) return;
  const entries = flatten(await source.getTree());
  const exact = new Map<string, string[]>(), fallback = new Map<string, string[]>();
  await Promise.all(entries.filter(e => e.url !== undefined).map(async entry => {
    const [a, b] = await Promise.all([digest([entry.title.trim(), entry.url, entry.path]), digest([entry.title.trim(), entry.url])]);
    exact.set(a, [...(exact.get(a) ?? []), entry.id]); fallback.set(b, [...(fallback.get(b) ?? []), entry.id]);
  }));
  const fallbackCounts = new Map<string, number>();
  seed.items.forEach(item => fallbackCounts.set(item.fallback, (fallbackCounts.get(item.fallback) ?? 0) + 1));
  const matched = seed.items.flatMap(item => {
    const a = exact.get(item.exact), b = fallback.get(item.fallback);
    const id = a?.length === 1 ? a[0] : b?.length === 1 && fallbackCounts.get(item.fallback) === 1 ? b[0] : undefined;
    return id ? [{ ...item, id }] : [];
  });
  // A personal plan applies only to the supplied collection, never an unrelated profile.
  if (matched.length < Math.min(20, seed.items.length)) return;
  const stored = await source.get('settings');
  const previous = stored === undefined ? emptySettings() : settingsSchema.parse(stored);
  const retained = previous.categories.filter(c => !c.id.startsWith('purpose:') && !(c.folderIds.length === 1 && c.bookmarkIds.length === 0 && entries.find(e => e.id === c.folderIds[0])?.title === c.title));
  const retainedIds = new Set(retained.map(c => c.id));
  const next: Settings = {
    version: 1,
    categories: [...seed.categories.map(c => ({ id: `purpose:${c.id}`, title: c.title, folderIds: [], bookmarkIds: matched.filter(row => row.categoryId === c.id).map(row => row.id) })), ...retained],
    home: [...seed.home.map(id => `purpose:${id}`), ...previous.home.filter(id => retainedIds.has(id))],
    annotations: { ...previous.annotations, ...Object.fromEntries(matched.map(row => [row.id, { group: row.group, tags: row.tags }])) },
  };
  // This revision implements the user's explicit request to aggregate this supplied collection.
  // It is a display plan, with no native bookmark writes or ongoing automatic classification.
  await source.set('settingsUndo', previous);
  await source.set('settings', settingsSchema.parse(next));
  await source.set('classificationRevision', seed.revision);
}
