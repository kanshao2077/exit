import { z } from 'zod';

export type Node = Omit<chrome.bookmarks.BookmarkTreeNode, 'children' | 'syncing'> & { children?: Node[]; syncing?: boolean };
export type Entry = Node & { path: string[]; ancestors: string[]; searchText: string; protected: boolean };
const text = z.string().max(500);
export const categorySchema = z.object({ id: text.min(1), title: text.min(1), folderIds: z.array(text).max(50000), bookmarkIds: z.array(text).max(50000) });
export const settingsSchema = z.object({
  version: z.literal(1), categories: z.array(categorySchema).max(200), home: z.array(text).max(200),
  annotations: z.record(z.string(), z.object({ group: text, tags: z.array(text).max(30) })),
});
export type Category = z.infer<typeof categorySchema>;
export type Settings = z.infer<typeof settingsSchema>;
export const emptySettings = (): Settings => ({ version: 1, categories: [], home: [], annotations: {} });
export const referenceSchema = z.object({ id: text.optional(), title: z.string().max(20000), url: z.string().max(50000).optional(), path: z.array(text).max(100) });
export type Reference = z.infer<typeof referenceSchema>;
export const suggestionSchema = z.object({
  version: z.literal(1), kind: z.literal('exit-suggestions'), generator: text.min(1),
  items: z.array(z.object({ ref: referenceSchema, category: text, group: text.default(''), tags: z.array(text).max(30).default([]),
    reason: z.string().min(1).max(2000), confidence: z.enum(['high', 'medium', 'uncertain']) })).max(50000),
});
export type Suggestion = z.infer<typeof suggestionSchema>['items'][number];
export type SuggestionDocument = z.infer<typeof suggestionSchema>;
export type Review = Suggestion & { key: number; match?: Entry; problem?: string; selected: boolean };

export function flatten(tree: Node[]): Entry[] {
  const out: Entry[] = [];
  const visit = (nodes: Node[], path: string[], ancestors: string[], inheritedLock: boolean) => nodes.forEach(node => {
    const locked = inheritedLock || !!node.unmodifiable;
    out.push({ ...node, unmodifiable: locked ? 'managed' : undefined, path, ancestors, protected: !node.parentId || node.parentId === '0' || !!node.folderType || locked,
      searchText: `${node.title} ${node.url ?? ''} ${path.join(' ')}`.normalize('NFKC').toLocaleLowerCase() });
    if (node.children) visit(node.children, node.title ? [...path, node.title] : path, [...ancestors, node.id], locked);
  });
  visit(tree, [], [], false); return out;
}
export function refOf(entry: Entry): Reference { return { id: entry.id, title: entry.title, url: entry.url, path: entry.path }; }
export function resolveRef(ref: Reference, entries: Entry[]): Entry | undefined {
  // IDs are profile-local. Never trust an ID without matching the content and path.
  const candidates = entries.filter(e => e.title === ref.title && e.url === ref.url && JSON.stringify(e.path) === JSON.stringify(ref.path));
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) return undefined;
  // HTML exports may omit the system 'Other bookmarks' wrapper. A unique title + exact URL is safe.
  if (ref.url !== undefined) { const links = entries.filter(e => e.url === ref.url && e.title === ref.title); if (links.length === 1) return links[0]; }
}
export function categoryEntries(category: Category, entries: Entry[]): Entry[] {
  const folders = new Set(category.folderIds), bookmarks = new Set(category.bookmarkIds);
  return entries.filter(e => e.url !== undefined && (bookmarks.has(e.id) || e.ancestors.some(id => folders.has(id))));
}
export function makeSearchIndex(entries: Entry[], settings: Settings): Entry[] {
  const names = new Map<string, string[]>();
  for (const category of settings.categories) for (const e of categoryEntries(category, entries)) names.set(e.id, [...(names.get(e.id) ?? []), category.title]);
  return entries.filter(e => e.url !== undefined).map(e => ({ ...e, searchText: `${e.searchText} ${(names.get(e.id) ?? []).join(' ')} ${settings.annotations[e.id]?.group ?? ''} ${settings.annotations[e.id]?.tags.join(' ') ?? ''}`.normalize('NFKC').toLocaleLowerCase() }));
}
export function search(index: Entry[], query: string) {
  const tokens = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return index.filter(e => tokens.every(token => e.searchText.includes(token)));
}
export function duplicateGroups(entries: Entry[]): Entry[][] {
  const groups = new Map<string, Entry[]>();
  // Exact URL only. Queries, fragments, scheme and trailing slashes all remain significant.
  for (const e of entries) if (e.url) groups.set(e.url, [...(groups.get(e.url) ?? []), e]);
  return [...groups.values()].filter(group => group.length > 1);
}
export function safeUrl(value: string): string | undefined {
  try { const u = new URL(value); if (['https:', 'http:', 'ftp:', 'file:', 'chrome:', 'chrome-extension:', 'chrome-native:'].includes(u.protocol)) return value; } catch { /* Invalid bookmarks stay visible, never execute. */ }
}
export function domain(value: string) { try { return new URL(value).hostname.replace(/^www\./, '') || new URL(value).protocol; } catch { return '无效网址'; } }
export function topSelection(ids: string[], entries: Entry[]): Entry[] {
  const selected = new Set(ids);
  return entries.filter(e => selected.has(e.id) && !e.ancestors.some(id => selected.has(id)));
}
export function assertWritable(entry: Entry | undefined) { if (!entry || entry.protected) throw new Error('系统根目录或受管理的书签不能修改。'); }
export function assertDestination(parent: Entry | undefined, selected: Entry[] = []) {
  if (!parent || parent.url !== undefined || !parent.parentId || parent.unmodifiable || selected.some(e => e.id === parent.id || parent.ancestors.includes(e.id))) throw new Error('请选择有效文件夹，不能移入自己或自己的子目录。');
}
export function reviewSuggestions(doc: SuggestionDocument, entries: Entry[]): Review[] {
  const used = new Set<string>();
  return doc.items.map((item, key) => {
    const match = resolveRef(item.ref, entries);
    const problem = !match || match.url === undefined ? '书签已变化、缺失或匹配不唯一' : used.has(match.id) ? '同一书签有多条建议，请保留一条' : undefined;
    if (match) used.add(match.id);
    return { ...item, key, match, problem, selected: !problem && item.confidence === 'high' && !!item.category.trim() };
  });
}
export function applySuggestions(settings: Settings, reviews: Review[]): Settings {
  const next = structuredClone(settings);
  for (const row of reviews.filter(r => r.selected && r.match && !r.problem && r.category.trim())) {
    let category = next.categories.find(c => c.title === row.category.trim());
    if (!category) { category = { id: crypto.randomUUID(), title: row.category.trim(), folderIds: [], bookmarkIds: [] }; next.categories.push(category); }
    if (!category.bookmarkIds.includes(row.match!.id)) category.bookmarkIds.push(row.match!.id);
    next.annotations[row.match!.id] = { group: row.group, tags: row.tags };
  }
  // Intentionally preserve home selection and Chrome tree verbatim.
  return next;
}
export function validateTree(value: unknown): Node[] {
  let count = 0; const ids = new Set<string>();
  const visit = (v: unknown, depth: number): Node => {
    if (depth > 100 || ++count > 100000 || !v || typeof v !== 'object') throw new Error('书签备份结构无效或过大。');
    const n = v as Node;
    if (typeof n.id !== 'string' || ids.has(n.id) || typeof n.title !== 'string' || n.title.length > 20000 || (n.url !== undefined && (typeof n.url !== 'string' || n.url.length > 50000))) throw new Error('书签节点无效。');
    ids.add(n.id);
    if (n.url !== undefined && n.children !== undefined) throw new Error('网址不能含子节点。');
    return { id: n.id, title: n.title, url: n.url, parentId: typeof n.parentId === 'string' ? n.parentId : undefined,
      index: Number.isInteger(n.index) ? n.index : undefined, folderType: n.folderType, unmodifiable: n.unmodifiable,
      children: n.children === undefined ? undefined : Array.isArray(n.children) ? n.children.map(c => visit(c, depth + 1)) : (() => { throw new Error('子目录无效。'); })() };
  };
  if (!Array.isArray(value) || value.length !== 1) throw new Error('书签树根节点无效。');
  const tree = value.map(v => visit(v, 0));
  if (tree[0].id !== '0' || tree[0].url !== undefined || !tree[0].children) throw new Error('需要完整 Chrome 书签树。');
  return tree;
}
export function htmlBackup(tree: Node[]): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const visit = (nodes: Node[]): string => nodes.map(n => n.url !== undefined ? `<DT><A HREF="${escape(n.url)}">${escape(n.title)}</A>` : `<DT><H3${n.folderType === 'bookmarks-bar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''}>${escape(n.title)}</H3>\n<DL><p>\n${visit(n.children ?? [])}\n</DL><p>`).join('\n');
  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>EXIT bookmarks backup</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${visit(tree[0]?.children ?? [])}\n</DL><p>`;
}
