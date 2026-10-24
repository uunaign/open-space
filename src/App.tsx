import { Canvas } from './components/Canvas';
import { ToolBar } from './components/ToolBar';
import { TopMenuBar } from './components/TopMenuBar';

export function App() {
  return (
    <div className="app-shell">
      <Canvas />
      <TopMenuBar />
      <ToolBar />
    </div>
  );
}

export default App;