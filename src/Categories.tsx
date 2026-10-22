import { useState } from 'react';
import { categoryEntries, type Category, type Entry, type Settings } from './model';
import { Modal } from './ui';
export function Categories({ entries, settings, save, busy }: { entries: Entry[]; settings: Settings; save: (next: Settings) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState<Category | null>(null), [filter, setFilter] = useState('');
  const folders = entries.filter(e => e.url === undefined && e.parentId);
  const [kind, setKind] = useState<'folders' | 'bookmarks'>('folders');
  const [showFolders, setShowFolders] = useState(settings.categories.length === 0);
  const ordered = [...settings.categories].sort((a, b) => {
    const ai = settings.home.indexOf(a.id), bi = settings.home.indexOf(b.id);
    return (ai < 0 ? 10000 : ai) - (bi < 0 ? 10000 : bi);
  });
  function toggleHome(id: string) { void save({ ...settings, home: settings.home.includes(id) ? settings.home.filter(x => x !== id) : [...settings.home, id] }).catch(() => {}); }
  function reorder(id: string, direction: number) {
    const home = [...settings.home], index = home.indexOf(id); const target = index + direction;
    if (target < 0 || target >= home.length) return;
    [home[index], home[target]] = [home[target], home[index]]; void save({ ...settings, home }).catch(() => {});
  }
  function edit(category?: Category) { setFilter(''); setKind('folders'); setDraft(category ? structuredClone(category) : { id: crypto.randomUUID(), title: '', folderIds: [], bookmarkIds: [] }); }
  return <section><div className="section-heading"><div><h2>首页分类</h2><p>勾选首页显示，↑ ↓ 调整顺序。</p></div><button className="button" onClick={() => edit()}>新建分类</button></div>
    {ordered.length > 0 && <div className="category-settings">{ordered.map(c => { const position = settings.home.indexOf(c.id); return <div className="category-setting" key={c.id}>
      <label className="check-label"><input type="checkbox" checked={position >= 0} disabled={busy} onChange={() => toggleHome(c.id)} /><span>{c.title}<small>{categoryEntries(c, entries).length} 个网址</small></span></label>
      <div className="row-actions">{position >= 0 && <><button aria-label={`上移 ${c.title}`} disabled={busy || position === 0} onClick={() => reorder(c.id, -1)}>↑</button><button aria-label={`下移 ${c.title}`} disabled={busy || position === settings.home.length - 1} onClick={() => reorder(c.id, 1)}>↓</button></>}<button onClick={() => edit(c)}>调整</button><button disabled={busy} onClick={() => void save({ ...settings, categories: settings.categories.filter(x => x.id !== c.id), home: settings.home.filter(id => id !== c.id) }).catch(() => {})}>移除分类</button></div>
    </div>; })}</div>}
    {folders.length > 0 && <details open={showFolders} onToggle={e => setShowFolders(e.currentTarget.open)} className="folder-choices"><summary>从原生文件夹添加入口</summary><div>{folders.map(folder => {
      const existing = settings.categories.find(c => c.folderIds.length === 1 && c.folderIds[0] === folder.id && !c.bookmarkIds.length);
      return <button key={folder.id} disabled={busy || !!existing} onClick={() => {
        const category = { id: crypto.randomUUID(), title: folder.title || '未命名', folderIds: [folder.id], bookmarkIds: [] };
        void save({ ...settings, categories: [...settings.categories, category], home: [...settings.home, category.id] }).catch(() => {});
      }}><span>{folder.title || '未命名'}</span><small>{folder.path.join(' / ') || '根目录'}</small><span aria-hidden="true">{existing ? '已添加' : '+'}</span></button>;
    })}</div></details>}
    {draft && <Modal title="编辑展示分类" onClose={() => setDraft(null)}><form onSubmit={e => { e.preventDefault(); if (!draft.title.trim()) return; const next = settings.categories.some(c => c.id === draft.id) ? settings.categories.map(c => c.id === draft.id ? { ...draft, title: draft.title.trim() } : c) : [...settings.categories, { ...draft, title: draft.title.trim() }]; void save({ ...settings, categories: next }).then(() => setDraft(null)).catch(() => {}); }}>
      <label className="field">分类名称<input autoFocus required maxLength={100} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
      <div className="small-tabs"><button type="button" aria-pressed={kind === 'folders'} onClick={() => setKind('folders')}>连接文件夹</button><button type="button" aria-pressed={kind === 'bookmarks'} onClick={() => setKind('bookmarks')}>选择书签</button></div>
      <input className="filter" aria-label="筛选可映射的条目" placeholder="筛选名称或路径" value={filter} onChange={e => setFilter(e.target.value)}/>
      <div className="selection-list">{entries.filter(e => (kind === 'folders' ? e.url === undefined && e.parentId : e.url !== undefined) && e.searchText.includes(filter.toLowerCase())).map(entry => {
        const field = kind === 'folders' ? 'folderIds' : 'bookmarkIds'; return <label key={entry.id} className="check-label"><input type="checkbox" checked={draft[field].includes(entry.id)} onChange={() => setDraft({ ...draft, [field]: draft[field].includes(entry.id) ? draft[field].filter(id => id !== entry.id) : [...draft[field], entry.id] })}/><span>{entry.title || '未命名'}<small>{entry.path.join(' / ')}</small></span></label>;
      })}</div><p className="hint">只改变展示，不移动书签。</p>
      <footer className="dialog-actions"><button type="button" onClick={() => setDraft(null)}>取消</button><button className="button primary" disabled={busy || (!draft.folderIds.length && !draft.bookmarkIds.length)}>保存分类</button></footer>
    </form></Modal>}
  </section>;
}
