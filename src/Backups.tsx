import { useState } from 'react';
import { settingsSchema, type Entry, type Node, type Settings } from './model';
import { download, exportBackup, parseBackup, portableSettings, restoreIntoFolder, undoLast, type Backup } from './operations';
import { loadSettings, type Source } from './source';
import { FileInput, Modal, readJSON } from './ui';
export function Backups({ source, tree, entries, settings, save, action, notify, busy }: { source: Source; tree: Node[]; entries: Entry[]; settings: Settings; save: (s: Settings) => Promise<void>; action: (fn: () => Promise<void>) => Promise<void>; notify: (s: string, error?: boolean) => void; busy: boolean }) {
  const [backup, setBackup] = useState<Backup | null>(null), [parentId, setParentId] = useState(''), [confirm, setConfirm] = useState<'tree' | 'settings' | null>(null);
  const folders = entries.filter(e => e.url === undefined && e.parentId && !e.unmodifiable);
  const portable = backup ? portableSettings(backup, entries) : null;
  return <section><div className="section-heading"><div><h2>备份与恢复</h2><p>JSON 带走书签结构与展示设置；HTML 可由 Chrome 的书签管理器导入。</p></div></div>
    <div className="backup-row"><div><h3>带走当前书签</h3><p>导出到本地文件，不发送到网络。</p></div><div className="row-actions"><button className="button" onClick={() => exportBackup(tree, settings)}>导出 JSON 备份</button><button className="button" onClick={() => exportBackup(tree, settings, true)}>导出 HTML</button></div></div>
    <div className="backup-row"><div><h3>撤销最近一次操作</h3><p>支持新增、编辑、移动与删除。若相关条目已被外部修改，会停止撤销，避免覆盖新改动。</p></div><button className="button" disabled={busy} onClick={() => void action(async () => { await undoLast(source, await loadSettings(source)); notify('已撤销最近一次原生操作。'); }).catch(() => {})}>撤销原生操作</button></div>
    <div className="backup-row"><div><h3>恢复上一份展示设置</h3><p>撤销最近一次分类、首页顺序或建议应用，不改动 Chrome。</p></div><button className="button" disabled={busy} onClick={() => void action(async () => { const old = await source.get('settingsUndo'); if (!old) throw new Error('没有上一份展示设置。'); const parsed = settingsSchema.parse(old); await source.set('settingsUndo', settings); await source.set('settings', parsed); notify('已恢复上一份展示设置。'); }).catch(() => {})}>撤销展示修改</button></div>
    <div className="backup-row"><div><h3>操作前的恢复快照</h3><p>每次原生写入前保留一份；下一次操作会覆盖。重要整理前请额外导出文件备份。</p></div><button className="button" onClick={() => void source.get<Backup>('safetyBackup').then(b => { if (!b) throw new Error('还没有操作前快照。'); download('EXIT-before-operation.json', JSON.stringify(b, null, 2)); }).catch(e => notify(e.message, true))}>下载恢复快照</button></div>
    <div className="backup-row"><div><h3>从 EXIT. 备份恢复</h3><p>先预览。可只恢复展示设置，或将全部书签复制进单独的恢复文件夹。</p></div><FileInput label="选择 JSON 备份" onFile={file => void readJSON(file).then(value => { setBackup(parseBackup(value)); setParentId(folders[0]?.id ?? ''); }).catch(() => notify('无法读取备份，请选择完整的 EXIT. JSON 备份文件。', true))}/></div>
    {backup && portable && <div className="restore-preview"><h3>备份已读取，尚未写入</h3><p>{backup.settings.categories.length} 个展示分类；{portable.unmatched} 个映射无法唯一匹配，将略过这些映射。</p><div className="row-actions"><button className="button" onClick={() => setConfirm('settings')}>恢复展示设置</button><button className="button" onClick={() => setConfirm('tree')}>恢复书签到单独文件夹</button><button onClick={() => setBackup(null)}>取消</button></div></div>}
    {confirm && backup && portable && <Modal title={confirm === 'tree' ? '恢复书签副本' : '恢复展示设置'} onClose={() => { if (!busy) setConfirm(null); }}>
      {confirm === 'tree' ? <><p>将在目标目录新建「EXIT 恢复」文件夹，复制备份中的全部书签。原目录不被覆盖，可能产生重复链接；原 ID 和创建时间不能恢复。</p><label className="field">恢复到<select value={parentId} onChange={e => setParentId(e.target.value)}>{folders.map(f => <option value={f.id} key={f.id}>{[...f.path, f.title].join(' / ')}</option>)}</select></label></> : <p>将替换当前展示分类和首页选择。按完整标题、网址、路径重新匹配节点，{portable.unmatched} 个无法匹配的映射会略过。</p>}
      <footer className="dialog-actions"><button disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="button primary" disabled={busy || (confirm === 'tree' && !parentId)} onClick={() => {
        const task = confirm === 'tree' ? action(async () => { const name = await restoreIntoFolder(source, backup, parentId, await loadSettings(source)); notify(`已恢复到「${name}」。`); }) : save(portable.settings);
        void task.then(() => { setConfirm(null); setBackup(null); }).catch(() => {});
      }}>{busy ? '正在恢复…' : '确认恢复'}</button></footer>
    </Modal>}
  </section>;
}
