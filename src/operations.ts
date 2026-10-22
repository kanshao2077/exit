import { assertDestination, assertWritable, flatten, htmlBackup, refOf, resolveRef, safeUrl, settingsSchema, topSelection, validateTree, type Entry, type Node, type Reference, type Settings } from './model';
import type { Source } from './source';
export type Plan = { kind: 'delete' | 'move' | 'update' | 'create'; ids: string[]; parentId?: string; title?: string; url?: string; folder?: boolean; expected?: string };
type UndoRecord = { plan: Plan; before: Node[]; after: Node[]; createdAt: string };
export type Backup = { version: 1; kind: 'exit-backup'; createdAt: string; tree: Node[]; settings: Settings; refs: Record<string, Reference> };
export function makeBackup(tree: Node[], settings: Settings): Backup {
  return { version: 1, kind: 'exit-backup', createdAt: new Date().toISOString(), tree, settings, refs: Object.fromEntries(flatten(tree).map(e => [e.id, refOf(e)])) };
}
export function parseBackup(value: unknown): Backup {
  if (!value || typeof value !== 'object') throw new Error('备份格式无效');
  const b = value as Backup;
  if (b.version !== 1 || b.kind !== 'exit-backup') throw new Error('请选择 EXIT. JSON 备份');
  const tree = validateTree(b.tree); return makeBackup(tree, settingsSchema.parse(b.settings));
}
export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function exportBackup(tree: Node[], settings: Settings, html = false) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  download(`EXIT-backup-${stamp}.${html ? 'html' : 'json'}`, html ? htmlBackup(tree) : JSON.stringify(makeBackup(tree, settings), null, 2), html ? 'text/html;charset=utf-8' : 'application/json');
}
function cleanNode(e: Node): Node { const { id, title, url, parentId, index } = e; return { id, title, url, parentId, index, ...(e.children ? { children: e.children.map(cleanNode) } : {}) }; }
function selectedNodes(plan: Plan, entries: Entry[]) { return topSelection(plan.ids, entries).map(cleanNode); }
export function planSignature(plan: Plan, entries: Entry[]) { return JSON.stringify({ nodes: selectedNodes(plan, entries), parent: plan.parentId ? entries.find(e => e.id === plan.parentId)?.id : undefined }); }
export function preparePlan(plan: Plan, entries: Entry[]): Plan { return { ...plan, expected: planSignature(plan, entries) }; }
export async function perform(source: Source, plan: Plan, settings: Settings): Promise<number> {
  const tree = await source.getTree(), entries = flatten(tree); const selected = topSelection(plan.ids, entries);
  if (plan.expected !== planSignature(plan, entries)) throw new Error('预览后书签发生了变化。请重新选择并确认。');
  if (plan.kind !== 'create' && (selected.length === 0 || plan.ids.some(id => !entries.some(e => e.id === id)))) throw new Error('请选择仍然存在的书签。');
  selected.forEach(assertWritable);
  if (plan.kind === 'move' || plan.kind === 'create') assertDestination(entries.find(e => e.id === plan.parentId), selected);
  if (plan.kind === 'update' && selected.length !== 1) throw new Error('一次只能编辑一个条目。');
  if ((plan.kind === 'create' || plan.kind === 'update') && !plan.title?.trim()) throw new Error('请填写名称。');
  if (plan.url !== undefined && !safeUrl(plan.url)) throw new Error('请输入完整、安全的网址（如 https://example.com）。');
  // A failed quota/write aborts BEFORE any bookmark mutation. This is recovery data, never a browsing source.
  await source.set('safetyBackup', makeBackup(tree, settings));
  const undo: UndoRecord = { plan, before: [], after: [], createdAt: new Date().toISOString() };
  await source.set('undo', undo);
  const saveUndo = async () => {
    // Chrome mutation results omit folder descendants. Capture the full tree after
    // every completed item so an interrupted batch is also safe to undo.
    if (undo.after.length) {
      const current = flatten(await source.getTree());
      undo.after = undo.after.map(n => {
        const entry = current.find(e => e.id === n.id);
        if (!entry) throw new Error('已操作的书签不再存在。');
        return cleanNode(entry);
      });
    }
    await source.set('undo', undo);
  };
  let done = 0;
  try {
    if (plan.kind === 'create') {
      undo.after.push(await source.create({ parentId: plan.parentId, title: plan.title!.trim(), ...(plan.folder ? {} : { url: plan.url }) })); done++;
    } else {
      for (const node of selected) {
        if (plan.kind === 'delete') await source.remove(node.id);
        if (plan.kind === 'move') undo.after.push(await source.move(node.id, { parentId: plan.parentId! }));
        if (plan.kind === 'update') undo.after.push(await source.update(node.id, { title: plan.title!.trim(), ...(node.url !== undefined ? { url: plan.url } : {}) }));
        undo.before.push(cleanNode(node)); done++;
        await saveUndo();
      }
    }
    if (plan.kind === 'create') await saveUndo();
    return done;
  } catch (error) { throw new Error(`操作中止，已完成 ${done} 项。请在「备份与恢复」撤销已完成部分，或下载操作前快照。${error instanceof Error ? error.message : ''}`); }
}
async function recreate(source: Source, node: Node, parentId: string, remap: Map<string, string>, index?: number): Promise<void> {
  const created = await source.create({ title: node.title, parentId, ...(index === undefined ? {} : { index }), ...(node.url !== undefined ? { url: node.url } : {}) });
  remap.set(node.id, created.id);
  for (const child of node.children ?? []) await recreate(source, child, created.id, remap);
}
export function remapSettings(settings: Settings, remap: Map<string, string>, keepUnmapped = true): Settings {
  const map = (ids: string[]) => ids.flatMap(id => remap.has(id) ? [remap.get(id)!] : keepUnmapped ? [id] : []);
  return { ...settings, categories: settings.categories.map(c => ({ ...c, folderIds: map(c.folderIds), bookmarkIds: map(c.bookmarkIds) })),
    annotations: Object.fromEntries(Object.entries(settings.annotations).flatMap(([id, v]) => remap.has(id) ? [[remap.get(id)!, v]] : keepUnmapped ? [[id, v]] : [])) };
}
export function portableSettings(backup: Backup, entries: Entry[]) {
  const remap = new Map<string, string>();
  for (const old of flatten(backup.tree)) { const match = resolveRef(refOf(old), entries); if (match) remap.set(old.id, match.id); }
  const refs = new Set(backup.settings.categories.flatMap(c => [...c.folderIds, ...c.bookmarkIds]).concat(Object.keys(backup.settings.annotations)));
  return { settings: remapSettings(backup.settings, remap, false), unmatched: [...refs].filter(id => !remap.has(id)).length };
}
export async function undoLast(source: Source, settings: Settings): Promise<Settings> {
  const undo = await source.get<UndoRecord>('undo'); if (!undo) throw new Error('没有可以撤销的操作。');
  const tree = await source.getTree(), entries = flatten(tree); const remap = new Map<string, string>();
  if (undo.plan.kind === 'delete' && undo.before.some(n => entries.some(e => e.id === n.id))) throw new Error('待恢复的节点已存在，不能安全重复恢复。');
  // Never overwrite an intervening external edit or delete new descendants.
  for (const after of undo.after) {
    const current = entries.find(e => e.id === after.id);
    if (!current || JSON.stringify(cleanNode(current)) !== JSON.stringify(cleanNode(after))) throw new Error('相关条目已在浏览器中变化，不能安全撤销。请下载操作前备份，恢复到单独文件夹。');
  }
  for (const before of undo.before) if (undo.plan.kind === 'delete' || undo.plan.kind === 'move') assertDestination(entries.find(e => e.id === before.parentId));
  // Prevent re-applying a partially interrupted undo; the safety snapshot remains available.
  await source.set('undo', null);
  try {
    if (undo.plan.kind === 'create') for (const n of undo.after) await source.remove(n.id);
    else if (undo.plan.kind === 'update') for (const n of undo.before) await source.update(n.id, { title: n.title, ...(n.url !== undefined ? { url: n.url } : {}) });
    else for (const n of [...undo.before].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
      if (undo.plan.kind === 'delete') await recreate(source, n, n.parentId!, remap, n.index);
      else await source.move(n.id, { parentId: n.parentId!, index: n.index });
    }
    const next = remapSettings(settings, remap); await source.set('settings', next); return next;
  } catch (error) { throw new Error(`撤销未全部完成；操作前快照仍保留，请恢复到单独文件夹。${error instanceof Error ? error.message : ''}`); }
}
export async function restoreIntoFolder(source: Source, backup: Backup, parentId: string, settings: Settings): Promise<string> {
  const current = await source.getTree(); assertDestination(flatten(current).find(e => e.id === parentId));
  await source.set('safetyBackup', makeBackup(current, settings));
  const folder = await source.create({ parentId, title: `EXIT 恢复 ${new Date().toLocaleDateString('sv-SE')}` });
  await source.set('undo', null);
  try {
    for (const root of backup.tree[0].children ?? []) await recreate(source, root, folder.id, new Map());
    const final = flatten(await source.getTree()).find(e => e.id === folder.id)!;
    await source.set('undo', { plan: { kind: 'create', ids: [] }, before: [], after: [cleanNode(final)], createdAt: new Date().toISOString() });
    return folder.title;
  } catch (error) { throw new Error(`恢复未全部完成，已恢复内容保留在「${folder.title}」；原书签未覆盖。${error instanceof Error ? error.message : ''}`); }
}
export async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (globalThis.navigator?.locks) return navigator.locks.request('exit-write', fn);
  return fn();
}
