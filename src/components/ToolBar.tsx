import {
  StickyNote,
  LayoutGrid,
  Download,
  Folder,
  FileUp,
  Globe,
} from 'lucide-react';
import { ToolbarDropdown, DropdownItem } from './ToolbarDropdown';
import './ToolBar.css';

const emitCanvasEvent = (eventName: string) => {
  window.dispatchEvent(new CustomEvent(eventName));
};

export const ToolBar = () => {
  return (
    <div className="toolbar-container">
      <button
        className="toolbar-btn"
        title="Crear nota (N)"
        onClick={() => emitCanvasEvent('canvas-create-note')}
      >
        <StickyNote size={20} />
      </button>

      <button
        className="toolbar-btn"
        title="Agrupar elementos seleccionados (Ctrl+G)"
        onClick={() => emitCanvasEvent('canvas-group-selected')}
      >
        <LayoutGrid size={20} />
      </button>

      <ToolbarDropdown triggerIcon={<Download size={20} />} title="Importar (Ctrl+I)">
        <DropdownItem
          icon={<FileUp size={16} />}
          onClick={() => emitCanvasEvent('canvas-open-file-import')}
        >
          Archivo
        </DropdownItem>
        <DropdownItem
          icon={<Globe size={16} />}
          onClick={() => emitCanvasEvent('canvas-open-page-import')}
        >
          Página web
        </DropdownItem>
      </ToolbarDropdown>

      <button
        className="toolbar-btn"
        title="Añadir carpeta (F)"
        onClick={() => emitCanvasEvent('canvas-create-folder')}
      >
        <Folder size={20} />
      </button>
    </div>
  );
};