import { ArrowLeft, FileText, Sliders, Check, Download, FolderOpen, PanelRightOpen, Save, Triangle } from 'lucide-react';
import { useState } from 'react';
import './TopMenuBar.css';

export const TopMenuBar = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  const emitCanvasAction = (type: string) => {
    window.dispatchEvent(new CustomEvent(type));
  };

  const handleCenterView = () => {
    emitCanvasAction('canvas-center-view');
  };

  return (
    <div className="top-menu-bar">
      <div className="top-bar-exit-group">
        <button
          className="top-bar-exit-btn"
          title="Menú principal"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Abrir menú principal"
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      <div className="top-bar-group">
        <button
          className="top-bar-btn"
          title="Configuración de archivo"
          onClick={() => emitCanvasAction('canvas-open-file-settings')}
          aria-label="Configuración de archivo"
        >
          <FileText size={18} />
        </button>

        <button
          className="top-bar-btn top-bar-center-btn"
          title="Centrar vista"
          onClick={handleCenterView}
          aria-label="Centrar vista"
        >
          <Triangle size={16} />
        </button>

        <button
          className="top-bar-btn"
          title="Configuración del canvas"
          onClick={() => emitCanvasAction('canvas-open-canvas-settings')}
          aria-label="Configuración del canvas"
        >
          <Sliders size={18} />
        </button>

        <button
          className="top-bar-btn"
          title="Guardar"
          onClick={() => emitCanvasAction('canvas-save')}
          aria-label="Guardar canvas"
        >
          <Check size={18} />
        </button>
      </div>

      {menuOpen && (
        <div className="top-bar-menu-panel" role="menu" aria-label="Menú principal">
          <button type="button" onClick={() => { emitCanvasAction('canvas-save'); setMenuOpen(false); }}>
            <Save size={15} />
            <span>Guardar</span>
          </button>
          <button type="button" onClick={() => { emitCanvasAction('canvas-open-project'); setMenuOpen(false); }}>
            <FolderOpen size={15} />
            <span>Abrir</span>
          </button>
          <button type="button" onClick={() => { emitCanvasAction('canvas-open-file-settings'); setMenuOpen(false); }}>
            <Download size={15} />
            <span>Archivo</span>
          </button>
          <button type="button" onClick={() => { emitCanvasAction('canvas-open-canvas-settings'); setMenuOpen(false); }}>
            <PanelRightOpen size={15} />
            <span>Canvas</span>
          </button>
          <button type="button" className="top-bar-menu-close" onClick={() => setMenuOpen(false)}>
            <ArrowLeft size={15} />
            <span>Volver</span>
          </button>
        </div>
      )}
    </div>
  );
};