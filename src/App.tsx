import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Categories } from './Categories';
import { Bookmarks } from './Bookmarks';
import { Suggestions } from './Suggestions';
import { Backups } from './Backups';
import { categoryEntries, domain, emptySettings, flatten, makeSearchIndex, safeUrl, search, settingsSchema, type Entry, type Node, type Settings } from './model';
import { exclusive, perform, undoLast, type Plan } from './operations';
import { loadSettings, type Source } from './source';
import { Arrow, Empty } from './ui';

type Route = { page: 'home' | 'all' | 'manage' | 'category'; id?: string };
type Panel = 'categories' | 'bookmarks' | 'suggestions' | 'backups';
const panels: { id: Panel; title: string }[] = [{ id: 'categories', title: '首页分类' }, { id: 'bookmarks', title: '原生书签' }, { id: 'suggestions', title: '分类建议' }, { id: 'backups', title: '备份与恢复' }];
function readRoute(): Route { try { const value = decodeURIComponent(location.hash.slice(1)); if (value.startsWith('category/')) return { page: 'category', id: value.slice(9) }; if (['all', 'manage'].includes(value)) return { page: value as 'all' | 'manage' }; } catch { /* Broken hash falls back home. */ } return { page: 'home' }; }
export default function App({ source }: { source: Source }) {
  const [tree, setTree] = useState<Node[]>([]), [settings, setSettings] = useState<Settings>(emptySettings), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [route, setRoute] = useState<Route>(readRoute), [panel, setPanel] = useState<Panel>('categories');
  const [managingList, setManagingList] = useState(false);
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(100), [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean; undo?: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null), sequence = useRef(0), settingsSequence = useRef(0), mounted = useRef(true), writeBusy = useRef(false);
  const notify = useCallback((text: string, error = false) => setNotice({ text, error }), []);
  const refresh = useCallback(async () => {
    const seq = ++sequence.current;
    try { const value = await source.getTree(); if (mounted.current && seq === sequence.current) { setTree(value); setLoadError(''); setLoading(false); } }
    catch (e) { if (mounted.current) { setLoadError(`无法读取书签：${e instanceof Error ? e.message : String(e)}`); setLoading(false); } }
  }, [source]);
  const refreshSettings = useCallback(async () => {
    const seq = ++settingsSequence.current;
    try { const next = await loadSettings(source); if (mounted.current && seq === settingsSequence.current) setSettings(next); }
    catch { if (mounted.current) notify('展示设置无法读取。书签仍然可用；请从 JSON 备份恢复设置。', true); }
  }, [source, notify]);
  useEffect(() => {
    mounted.current = true;
    // Subscribe before the first read to close the event/read race.
    const stop = source.subscribe(() => void refresh()), stopSettings = source.subscribeSettings(() => void refreshSettings());
    void refresh(); void refreshSettings();
    const onHash = () => { setRoute(readRoute()); setLimit(100); }; window.addEventListener('hashchange', onHash);
    const onFocus = () => { void refresh(); void refreshSettings(); }; window.addEventListener('focus', onFocus);
    return () => { mounted.current = false; stop(); stopSettings(); window.removeEventListener('hashchange', onHash); window.removeEventListener('focus', onFocus); };
  }, [source, refresh, refreshSettings]);
  useEffect(() => {
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { setQuery(''); input.current?.focus(); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  useEffect(() => { if (!notice || notice.error) return; const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer); }, [notice]);
  const entries = useMemo(() => flatten(tree), [tree]), index = useMemo(() => makeSearchIndex(entries, settings), [entries, settings]);
  const deferredQuery = useDeferredValue(query), searching = !!query.trim();
  const results = useMemo(() => search(index, deferredQuery), [index, deferredQuery]);
  const activeCategory = settings.categories.find(c => c.id === route.id);
  const home = settings.home.flatMap(id => { const category = settings.categories.find(c => c.id === id); return category ? [category] : []; });
  const categoryLinks = useMemo(() => activeCategory ? categoryEntries(activeCategory, entries) : [], [activeCategory, entries]);
  const visibleLinks = searching ? results : route.page === 'all' ? index : categoryLinks;
  const folders = entries.filter(e => e.url === undefined && e.parentId);
  const [allFolder, setAllFolder] = useState('');
  const filteredLinks = route.page === 'all' && !searching && allFolder ? allFolder.startsWith('category:') ? categoryEntries(settings.categories.find(c => c.id === allFolder.slice(9))!, entries) : visibleLinks.filter(e => e.ancestors.includes(allFolder)) : visibleLinks;
  const groups = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of filteredLinks.slice(0, limit)) {
      const key = searching ? '' : (route.page === 'category' ? settings.annotations[entry.id]?.group : undefined) || entry.path.join(' / ') || '未分组';
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [filteredLinks, limit, searching, route.page, settings.annotations]);
  function go(next: Route) { setManagingList(false); setQuery(''); setRoute(next); setLimit(100); setAllFolder(''); location.hash = next.page === 'category' ? `category/${encodeURIComponent(next.id!)}` : next.page === 'home' ? '' : next.page; window.scrollTo({ top: 0 }); }
  function manage(next: Panel = 'categories') { setPanel(next); go({ page: 'manage' }); }
  async function action(fn: () => Promise<void>) {
    if (writeBusy.current) throw new Error('正在保存，请稍候。');
    writeBusy.current = true; setBusy(true);
    try { await exclusive(fn); await Promise.all([refresh(), refreshSettings()]); }
    catch (e) { await Promise.all([refresh(), refreshSettings()]); notify(e instanceof Error ? e.message : String(e), true); throw e; }
    finally { writeBusy.current = false; setBusy(false); }
  }
  async function save(next: Settings) {
    await action(async () => {
      const current = await loadSettings(source);
      if (JSON.stringify(current) !== JSON.stringify(settings)) throw new Error('展示设置已在其他标签页变化，已刷新，请重试。');
      const valid = settingsSchema.parse(next);
      await source.set('settingsUndo', current); await source.set('settings', valid);
    });
  }
  async function run(plan: Plan) { await action(async () => { const count = await perform(source, plan, await loadSettings(source)); setNotice({ text: source.mode === 'native' ? `已保存 ${count} 项` : `已保存 ${count} 项预览改动`, error: false, undo: true }); }); }
  function resultKeyboard(e: React.KeyboardEvent<HTMLElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-bookmark]'));
    if (!links.length) return;
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : e.key === 'ArrowDown' ? Math.min(index + 1, links.length - 1) : Math.max(0, index - 1);
    e.preventDefault(); links[next]?.focus();
  }
  return <div className={`app ${route.page === 'home' && !searching ? 'home-page' : ''}`}>
    <header className="topbar"><button className="brand" onClick={() => go({ page: 'home' })} aria-label="EXIT. 首页">EXIT<span>.</span></button><button className={route.page === 'manage' ? 'manage-button current' : 'manage-button'} aria-label={route.page === 'manage' ? '完成整理' : '整理'} title={route.page === 'manage' ? '完成整理' : '整理'} onClick={() => route.page === 'manage' ? go({ page: 'home' }) : manage()}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">{route.page === 'manage' ? <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="1.4"/> : <><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></>}</svg></button></header>
    <div className="search-sticky"><div className="search-box"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" strokeWidth="1.4"/><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.4"/></svg><input ref={input} type="search" aria-label="搜索全部书签" placeholder="搜索所有书签" autoComplete="off" spellCheck={false} value={query} onChange={e => { setManagingList(false); setQuery(e.target.value); setLimit(100); }} onKeyDown={e => { if (e.key === 'ArrowDown') resultKeyboard(e); if (e.key === 'Enter' && searching) document.querySelector<HTMLAnchorElement>('a[data-bookmark]')?.click(); }}/>{query ? <button aria-label="清空搜索" onClick={() => { setQuery(''); input.current?.focus(); }}>×</button> : null}</div></div>
    <main className="content" aria-busy={loading || busy}>{source.mode !== 'native' && <div className="source-note"><span className="status-dot"/>{source.mode === 'snapshot' ? '书签导出快照 · 非实时' : '模拟数据 · 安装扩展后读取 Chrome 书签'}</div>}
      {notice && <div className={`notice ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}><span>{notice.text}</span>{notice.undo && <button disabled={busy} onClick={() => void action(async () => { await undoLast(source, await loadSettings(source)); notify('已撤销'); }).catch(() => {})}>撤销</button>}<button aria-label="关闭提示" onClick={() => setNotice(null)}>×</button></div>}
      {loading ? <Empty title="正在读取书签…"/> : loadError ? <Empty title="书签暂时不可用"><p role="alert">{loadError}</p><button className="button" onClick={() => void refresh()}>重新读取</button></Empty> : <>
      {searching ? <div className="page-heading"><h1>搜索结果</h1><div className="page-actions"><span className="muted" role="status">{results.length} 个结果</span><button className="list-manage" onClick={() => setManagingList(!managingList)}>{managingList ? '完成' : '管理书签'}</button></div></div> : route.page === 'home' ? <div className="index-heading"><span>常用入口</span><button onClick={() => go({ page: 'all' })}>全部书签 <span aria-hidden="true">→</span></button></div> : <><nav className="breadcrumbs" aria-label="返回首页"><button onClick={() => go({ page: 'home' })}><Arrow back/> 首页</button><span> / {route.page === 'manage' ? '整理' : route.page === 'all' ? '全部书签' : activeCategory?.title ?? '分类不存在'}</span></nav><div className="page-heading"><h1>{route.page === 'manage' ? '整理' : route.page === 'all' ? '全部书签' : activeCategory?.title ?? '分类不存在'}</h1>{route.page !== 'manage' && <div className="page-actions"><span className="muted">{filteredLinks.length} 个网址</span><button className="list-manage" onClick={() => setManagingList(!managingList)}>{managingList ? '完成' : '管理书签'}</button></div>}</div></>}
      {!searching && route.page === 'home' && (home.length ? <div className="home-categories">{home.map((category) => <button className="category-link" key={category.id} onClick={() => go({ page: 'category', id: category.id })}><span className="category-name">{category.title}</span><Arrow/></button>)}</div> : <Empty title="首页还没有分类"><button className="button primary" onClick={() => manage()}>选择首页分类 <span aria-hidden="true">→</span></button></Empty>)}
      {!searching && route.page === 'manage' && <><nav className="panel-tabs" aria-label="整理功能">{panels.map(p => <button key={p.id} aria-current={panel === p.id ? 'page' : undefined} onClick={() => setPanel(p.id)}>{p.title}</button>)}</nav>{panel === 'categories' && <Categories entries={entries} settings={settings} save={save} busy={busy}/>}{panel === 'bookmarks' && <Bookmarks entries={entries} settings={settings} run={run} busy={busy} mode={source.mode}/>}{panel === 'suggestions' && <Suggestions entries={entries} settings={settings} save={save} notify={notify} busy={busy}/>}{panel === 'backups' && <Backups source={source} tree={tree} entries={entries} settings={settings} save={save} action={action} notify={notify} busy={busy}/>}</>}
      {(searching || route.page === 'all' || route.page === 'category') && <>
        {managingList ? <Bookmarks entries={entries} settings={settings} run={run} busy={busy} mode={source.mode} scopeIds={filteredLinks.map(e => e.id)}/> : <>
        {!searching && route.page === 'all' && <label className="folder-filter">分类<select aria-label="按分类或原生文件夹筛选" value={allFolder} onChange={e => { setAllFolder(e.target.value); setLimit(100); }}><option value="">全部</option><optgroup label="用途分类">{settings.categories.map(c => <option key={c.id} value={`category:${c.id}`}>{c.title}</option>)}</optgroup><optgroup label="原生文件夹">{folders.map(f => <option key={f.id} value={f.id}>{[...f.path, f.title].join(' / ')}</option>)}</optgroup></select></label>}
        {filteredLinks.length === 0 ? <Empty title={searching ? '没有找到这个地方' : '这里还没有网址'}><p>{searching ? '试试网站名称、域名、原目录或整理后的分类。' : '书签可能已移动或删除。可以在整理中调整映射。'}</p></Empty> : <div className="bookmark-groups" onKeyDown={resultKeyboard}>{[...groups].map(([name, group]) => <section className="bookmark-group" key={name}>{name && <h2 className="group-title">{name}</h2>}<ul className="bookmark-list">{group.map(entry => <li key={entry.id}>{safeUrl(entry.url!) ? <a data-bookmark href={entry.url} target="_blank" rel="noopener noreferrer" title={`${entry.title}\n${entry.url}\n${entry.path.join(' / ')}`}><span className="bookmark-copy"><span className="bookmark-name">{entry.title || domain(entry.url!)}</span>{searching && <small>{entry.path.join(' / ')}</small>}</span><span className="bookmark-domain">{domain(entry.url!)}</span><Arrow/></a> : <div className="invalid-link"><span>{entry.title || '未命名书签'}</span><small>无效或不可直接打开的网址</small></div>}</li>)}</ul></section>)}</div>}
        {filteredLinks.length > limit && <button className="load-more" onClick={() => setLimit(limit + 100)}>继续显示 · 还有 {filteredLinks.length - limit} 个网址</button>}
        </>}
      </>}
      </>}
    </main><span className="sr-only" role="status">{source.mode === 'native' ? loading ? '正在连接 Chrome 书签' : loadError ? 'Chrome 连接中断' : 'Chrome 书签 · 已连接' : '预览模式'}</span>
  </div>;
}
