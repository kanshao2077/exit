import { useEffect, useRef, type ReactNode } from 'react';
export function Arrow({ back = false }: { back?: boolean }) { return <span aria-hidden="true" className="arrow">{back ? '←' : '↗'}</span>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current!; el.showModal(); return () => el.close(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }}><header className="dialog-head"><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></header>{children}</dialog>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) { return <div className="empty"><h2>{title}</h2>{children}</div>; }
export async function readJSON(file: File): Promise<unknown> { if (file.size > 20_000_000) throw new Error('文件超过 20 MB，请拆分后重试。'); return JSON.parse(await file.text()); }
export function FileInput({ label, onFile, accept = '.json,application/json' }: { label: string; onFile: (file: File) => void; accept?: string }) {
  return <label className="button file-button">{label}<input type="file" accept={accept} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onFile(file); }} /></label>;
}
