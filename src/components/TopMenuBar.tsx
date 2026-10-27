import { useEffect, useState } from 'react';
import { ArrowLeft, Redo2, Save, Settings2, Triangle, Undo2 } from 'lucide-react';
import './TopMenuBar.css';

interface TopMenuBarProps {
  onHome: () => void;
}

export const TopMenuBar = ({ onHome }: TopMenuBarProps) => {
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  useEffect(() => {
    const updateHistoryState = (event: Event) => {
      setHistoryState((event as CustomEvent<{ canUndo: boolean; canRedo: boolean }>).detail);
    };
    window.addEventListener('canvas-history-state', updateHistoryState);
    return () => window.removeEventListener('canvas-history-state', updateHistoryState);
  }, []);

  const handleCenterView = () => {
    window.dispatchEvent(new CustomEvent('canvas-center-view'));
  };

  return (
    <div className="top-menu-bar">
      <div className="top-bar-exit-group">
        <button
          className="top-bar-exit-btn"
          title="Inicio (Ctrl+N)"
          onClick={onHome}
          aria-label="Volver al menú de inicio"
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      <div className="top-bar-group">
        <button
          className="top-bar-btn top-bar-center-btn top-bar-settings-btn"
          title="Configuración del canvas"
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            window.dispatchEvent(new CustomEvent('canvas-open-canvas-settings', {
              detail: { left: bounds.left, bottom: bounds.bottom },
            }));
          }}
          aria-label="Abrir configuración"
        >
          <Settings2 size={16} />
        </button>

        <button
          className="top-bar-btn top-bar-center-btn"
          title="Centrar y encuadrar todo (Ctrl+Mayús+F)"
          onClick={handleCenterView}
          aria-label="Centrar vista"
        >
          <Triangle size={16} />
        </button>

        <button
          className="top-bar-btn"
          title="Guardar en este dispositivo (Ctrl+S)"
          onClick={() => window.dispatchEvent(new CustomEvent('canvas-save'))}
          aria-label="Guardar canvas"
        >
          <Save size={18} />
        </button>
      </div>

      <div className="top-bar-history-group" role="group" aria-label="Historial del canvas">
        <button
          type="button"
          className="top-bar-history-btn"
          title="Deshacer (Ctrl+Z)"
          aria-label="Deshacer"
          disabled={!historyState.canUndo}
          onClick={() => window.dispatchEvent(new CustomEvent('canvas-undo'))}
        >
          <Undo2 size={18} />
        </button>
        <button
          type="button"
          className="top-bar-history-btn"
          title="Rehacer (Ctrl+Mayús+Z)"
          aria-label="Rehacer"
          disabled={!historyState.canRedo}
          onClick={() => window.dispatchEvent(new CustomEvent('canvas-redo'))}
        >
          <Redo2 size={18} />
        </button>
      </div>
    </div>
  );
};
