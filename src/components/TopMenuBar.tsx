import { ArrowLeft, Save, Settings2, Triangle } from 'lucide-react';
import './TopMenuBar.css';

interface TopMenuBarProps {
  onHome: () => void;
}

export const TopMenuBar = ({ onHome }: TopMenuBarProps) => {
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
          className="top-bar-btn top-bar-center-btn"
          title="Centrar y encuadrar todo (Ctrl+Mayús+F)"
          onClick={handleCenterView}
          aria-label="Centrar vista"
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
    </div>
  );
};
