import { demoTree } from './demo';
import { initializePersonalization } from './personalization';
import { emptySettings, settingsSchema, validateTree, type Node, type Settings } from './model';
export interface Source {
  mode: 'native' | 'snapshot' | 'demo';
  getTree(): Promise<Node[]>;
  create(details: chrome.bookmarks.CreateDetails): Promise<Node>;
  update(id: string, changes: { title?: string; url?: string }): Promise<Node>;
  move(id: string, destination: { parentId: string; index?: number }): Promise<Node>;
  remove(id: string): Promise<void>;
  subscribe(callback: () => void): () => void;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  subscribeSettings(callback: () => void): () => void;
}
export function chromeSource(): Source {
  return {
    mode: 'native', getTree: () => chrome.bookmarks.getTree(), create: d => chrome.bookmarks.create(d),
    update: (id, c) => chrome.bookmarks.update(id, c), move: (id, d) => chrome.bookmarks.move(id, d),
    remove: async id => { const [n] = await chrome.bookmarks.get(id); if (n.url !== undefined) await chrome.bookmarks.remove(id); else await chrome.bookmarks.removeTree(id); },
    subscribe: callback => {
      let timer: ReturnType<typeof setTimeout>; let importing = false;
      const changed = () => { clearTimeout(timer); if (!importing) timer = setTimeout(callback, 60); };
      const begin = () => { importing = true; clearTimeout(timer); };
      const end = () => { importing = false; changed(); };
      const events = [chrome.bookmarks.onCreated, chrome.bookmarks.onRemoved, chrome.bookmarks.onChanged, chrome.bookmarks.onMoved, chrome.bookmarks.onChildrenReordered];
      events.forEach(e => e.addListener(changed)); chrome.bookmarks.onImportBegan.addListener(begin); chrome.bookmarks.onImportEnded.addListener(end);
      return () => { clearTimeout(timer); events.forEach(e => e.removeListener(changed)); chrome.bookmarks.onImportBegan.removeListener(begin); chrome.bookmarks.onImportEnded.removeListener(end); };
    },
    get: async <T,>(key: string) => (await chrome.storage.local.get(key))[key] as T | undefined,
    set: (key, value) => chrome.storage.local.set({ [key]: value }),
    subscribeSettings: callback => { const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => { if (area === 'local' && changes.settings) callback(); }; chrome.storage.onChanged.addListener(changed); return () => chrome.storage.onChanged.removeListener(changed); },
  };
}
export function memorySource(initial: Node[], mode: 'snapshot' | 'demo' = 'demo', persist = true): Source {
  const tree = structuredClone(initial); const listeners = new Set<() => void>(); const settingsListeners = new Set<() => void>();
  const memory = new Map<string, unknown>(); const prefix = `exit-${mode}-v1:`;
  const find = (id: string, nodes = tree): Node | undefined => { for (const node of nodes) { if (node.id === id) return node; const found = find(id, node.children ?? []); if (found) return found; } };
  const reindex = (parent: Node) => parent.children?.forEach((n, i) => { n.index = i; n.parentId = parent.id; });
  const emit = () => { listeners.forEach(fn => fn()); };
  return {
    mode, getTree: async () => structuredClone(tree),
    create: async d => { const parent = find(d.parentId!); if (!parent?.children) throw new Error('找不到目标目录'); const n: Node = { id: crypto.randomUUID(), parentId: parent.id, title: d.title ?? '', ...(d.url === undefined ? { children: [] } : { url: d.url }) }; parent.children.splice(d.index ?? parent.children.length, 0, n); reindex(parent); emit(); return structuredClone(n); },
    update: async (id, changes) => { const n = find(id); if (!n) throw new Error('书签已不存在'); Object.assign(n, changes); emit(); return structuredClone(n); },
    move: async (id, d) => { const n = find(id), parent = find(d.parentId); if (!n || !parent?.children) throw new Error('找不到书签或目录'); const old = find(n.parentId!); old!.children = old!.children!.filter(c => c.id !== id); reindex(old!); parent.children.splice(d.index ?? parent.children.length, 0, n); reindex(parent); emit(); return structuredClone(n); },
    remove: async id => { const n = find(id); if (!n) throw new Error('书签已不存在'); const p = find(n.parentId!); if (!p) throw new Error('不能删除根节点'); p.children = p.children!.filter(c => c.id !== id); reindex(p); emit(); },
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    get: async <T,>(key: string) => persist ? JSON.parse(localStorage.getItem(prefix + key) ?? 'null') as T ?? undefined : memory.get(key) as T | undefined,
    set: async (key, value) => { if (persist) localStorage.setItem(prefix + key, JSON.stringify(value)); else memory.set(key, structuredClone(value)); if (key === 'settings') settingsListeners.forEach(fn => fn()); },
    subscribeSettings: fn => { settingsListeners.add(fn); return () => { settingsListeners.delete(fn); }; },
  };
}
async function prepared(source: Source): Promise<Source> { await initializePersonalization(source); return source; }
export async function createSource(): Promise<Source> {
  if (location.protocol === 'chrome-extension:') {
    if (!globalThis.chrome?.bookmarks) throw new Error('Chrome 书签权限不可用。请在扩展管理页检查权限后重新加载。');
    return prepared(chromeSource());
  }
  if (import.meta.env.DEV) {
    try { const res = await fetch('/private/bookmarks.json'); if (res.ok && res.headers.get('content-type')?.includes('json')) return prepared(memorySource(validateTree(await res.json()), 'snapshot')); } catch { /* Development snapshot is optional. */ }
  }
  return memorySource(demoTree);
}
export async function loadSettings(source: Source): Promise<Settings> {
  const value = await source.get('settings');
  return value === undefined ? emptySettings() : settingsSchema.parse(value);
}
