import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { createSource } from './source';
import './style.css';
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <main className="fatal"><h1>EXIT.</h1><p>界面遇到了问题。你的原生书签仍在 Chrome 中。</p><button onClick={() => location.reload()}>重新打开</button></main> : this.props.children; }
}
const root = createRoot(document.getElementById('root')!);
createSource().then(source => root.render(<StrictMode><ErrorBoundary><App source={source}/></ErrorBoundary></StrictMode>)).catch(error => root.render(<main className="fatal"><h1>无法连接 Chrome</h1><p>{error.message}</p><button onClick={() => location.reload()}>重试</button></main>));
