import { useState } from 'react';
import { duplicateGroups, topSelection, type Entry, type Settings } from './model';
import { preparePlan, type Plan } from './operations';
import { Modal, Empty } from './ui';
export function Bookmarks({ entries, run, busy, mode, scopeIds }: { entries: Entry[]; settings: Settings; run: (plan: Plan) => Promise<void>; busy: boolean; mode: string; scopeIds?: string[] }) {
  const [folderId, setFolderId] = useState('0'), [selected, setSelected] = useState<string[]>([]), [filter, setFilter] = useState(''), [duplicates, setDuplicates] = useState(false);
  const [dialog, setDialog] = useState<Plan | null>(null);
  const [title, setTitle] = useState(''), [url, setUrl] = useState(''), [parentId, setParentId] = useState('');
  const folders = entries.filter(e => e.url === undefined && e.parentId && !e.unmodifiable);
  const current = entries.find(e => e.id === folderId);
  const duplicateIds = new Set(duplicateGroups(entries).flat().map(e => e.id));
  const scoped = scopeIds !== undefined, scope = new Set(scopeIds);
  const rows = entries.filter(e => e.parentId && (scoped ? scope.has(e.id) && (!filter || e.searchText.includes(filter.toLowerCase())) : duplicates ? duplicateIds.has(e.id) : filter ? e.searchText.includes(filter.toLowerCase()) : e.parentId === folderId));
  const selectedEntries = topSelection(selected, entries);
  const impacted = new Set(selectedEntries.flatMap(e => entries.filter(n => n.id === e.id || n.ancestors.includes(e.id)).map(n => n.id))).size;
  const [limit, setLimit] = useState(100);
  function open(kind: Plan['kind'], folder = false) {
    const first = selectedEntries[0]; const target = folders.find(f => f.id === folderId)?.id ?? folders[0]?.id ?? '';
    setParentId(target); setTitle(kind === 'update' ? first?.title ?? '' : ''); setUrl(kind === 'update' ? first?.url ?? '' : '');
    setDialog(preparePlan({ kind, ids: kind === 'create' ? [] : selected, folder, ...(kind === 'create' || kind === 'move' ? { parentId: target } : {}) }, entries));
  }
  function navigate(id: string) { setFolderId(id); setSelected([]); setFilter(''); setDuplicates(false); setLimit(100); }
  const native = mode === 'native';
  return <section className={scoped ? 'scoped-manager' : ''}>{!scoped && <div className="section-heading"><div><h2>原生书签</h2><p>{native ? '这里的新增、编辑、移动和删除会同步到 Chrome。' : '预览中的改动仅在当前页面有效，不会修改 Chrome 或导出文件。'}</p></div></div>}
    <div className="manager-toolbar"><input aria-label="筛选管理条目" placeholder="筛选名称、网址或路径" value={filter} onChange={e => { setFilter(e.target.value); setSelected([]); setLimit(100); }}/>{!scoped && <><button className={duplicates ? 'active' : ''} onClick={() => { setDuplicates(!duplicates); setSelected([]); }}>重复候选</button><button onClick={() => open('create')}>新增书签</button><button onClick={() => open('create', true)}>新建文件夹</button></>}</div>
    {!scoped && <nav className="breadcrumbs" aria-label="书签目录"><button onClick={() => navigate('0')}>全部</button>{current?.ancestors.filter(id => id !== '0').map(id => <span key={id}> / <button onClick={() => navigate(id)}>{entries.find(e => e.id === id)?.title}</button></span>)}{current?.id !== '0' && current && <span> / {current.title}</span>}</nav>}
    {duplicates && <p className="hint">只标记完整 URL 完全相同的候选。不同路径可能各有用途，查询参数和片段均保持原样。</p>}
    <div className="batch-toolbar"><span>{selected.length ? `已选 ${selected.length} 项` : '选择要管理的书签'}</span><button disabled={busy || selectedEntries.length !== 1} onClick={() => open('update')}>编辑</button><button disabled={busy || !selected.length} onClick={() => open('move')}>移动</button><button className="danger-text" disabled={busy || !selected.length} onClick={() => open('delete')}>删除</button>{selected.length > 0 && <button onClick={() => setSelected([])}>取消选择</button>}</div>
    {rows.length > 0 ? <div className="manage-list"><label className="select-all"><input type="checkbox" aria-label="选择当前筛选的全部条目" checked={rows.filter(e => !e.protected).length > 0 && rows.filter(e => !e.protected).every(e => selected.includes(e.id))} onChange={e => setSelected(e.target.checked ? rows.filter(e => !e.protected).map(e => e.id) : [])}/>选择当前范围</label>{rows.slice(0, limit).map(e => <div className="manage-row" key={e.id}>
      <input type="checkbox" aria-label={`选择 ${e.title}`} disabled={e.protected} checked={selected.includes(e.id)} onChange={() => setSelected(selected.includes(e.id) ? selected.filter(id => id !== e.id) : [...selected, e.id])}/>
      {e.url === undefined ? <button className="folder-link" onClick={() => navigate(e.id)}><span>{e.title || '未命名文件夹'}</span><small>{filter ? e.path.join(' / ') : '文件夹'}</small><span aria-hidden="true">→</span></button> : <div className="manage-title"><span>{e.title || e.url}</span><small>{filter || duplicates ? e.path.join(' / ') : e.url}</small></div>}
      {e.protected && <small className="muted">系统目录</small>}
    </div>)}</div> : <Empty title={filter ? '没有找到匹配项' : '这里还没有书签'} />}
    {rows.length > limit && <button className="load-more" onClick={() => setLimit(limit + 100)}>继续显示 · 还有 {rows.length - limit} 项</button>}
    {dialog && <Modal title={{ create: dialog.folder ? '新建文件夹' : '新增书签', update: '编辑条目', move: '移动到原生文件夹', delete: '删除原生条目' }[dialog.kind]} onClose={() => { if (!busy) setDialog(null); }}><form onSubmit={e => { e.preventDefault(); const plan = { ...dialog, ...(['create', 'update'].includes(dialog.kind) ? { title, ...(dialog.folder || (dialog.kind === 'update' && selectedEntries[0]?.url === undefined) ? {} : { url }) } : {}), ...(['create', 'move'].includes(dialog.kind) ? { parentId } : {}) }; // Changing only the destination is part of the user-reviewed plan.
      plan.expected = dialog.expected && JSON.stringify({ ...JSON.parse(dialog.expected), parent: ['create', 'move'].includes(dialog.kind) ? parentId : undefined });
      void run(plan).then(() => { setDialog(null); setSelected([]); }).catch(() => {});
    }}>
      {['create', 'update'].includes(dialog.kind) && <><label className="field">名称<input autoFocus required maxLength={2000} value={title} onChange={e => setTitle(e.target.value)}/></label>{!dialog.folder && !(dialog.kind === 'update' && selectedEntries[0]?.url === undefined) && <label className="field">网址<input required value={url} placeholder="https://" onChange={e => setUrl(e.target.value)}/></label>}</>}
      {['create', 'move'].includes(dialog.kind) && <label className="field">目标文件夹<select value={parentId} onChange={e => setParentId(e.target.value)}>{folders.filter(f => dialog.kind !== 'move' || !selectedEntries.some(s => s.id === f.id || f.ancestors.includes(s.id))).map(f => <option key={f.id} value={f.id}>{[...f.path, f.title].join(' / ')}</option>)}</select></label>}
      {['delete', 'move'].includes(dialog.kind) && <><p>将{dialog.kind === 'delete' ? '删除' : '移动'} {selectedEntries.length} 个顶层条目，含子目录共 {impacted} 项。</p><ul className="confirm-list">{selectedEntries.slice(0, 20).map(e => <li key={e.id}>{e.title}<small>{e.path.join(' / ')}</small></li>)}</ul>{selectedEntries.length > 20 && <p>以及其余 {selectedEntries.length - 20} 项。</p>}</>}
      <p className="hint">{native ? '确认后先保存本地恢复快照，再写入 Chrome。最近一次操作可在「备份与恢复」撤销。' : '这是预览操作，刷新页面后恢复原始快照。'}</p>
      {dialog.kind === 'delete' && <p className="hint">删除后的恢复会创建新节点，Chrome 原节点 ID 无法保留。</p>}
      <footer className="dialog-actions"><button type="button" disabled={busy} onClick={() => setDialog(null)}>取消</button><button className={`button ${dialog.kind === 'delete' ? 'danger' : 'primary'}`} disabled={busy || (['move', 'create'].includes(dialog.kind) && !parentId)}>{busy ? '正在保存…' : dialog.kind === 'delete' ? '备份并确认删除' : dialog.kind === 'move' ? '备份并确认移动' : native ? '保存到 Chrome' : '保存到预览'}</button></footer>
    </form></Modal>}
  </section>;
}
