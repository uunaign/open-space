import { ArrowLeft, FileText, Sliders, Check } from 'lucide-react';
import './TopMenuBar.css';

export const TopMenuBar = () => {
  return (
    <div className="top-menu-bar">
      
      {/* Contenedor exterior de salida (mismo estilo de cápsula) */}
      <div className="top-bar-exit-group">
        <button 
          className="top-bar-exit-btn" 
          title="Volver" 
          onClick={() => console.log('Exit')}
        >
          <ArrowLeft size={18} />
        </button>
      </div>

      {/* Contenedor exterior del grupo de herramientas */}
      <div className="top-bar-group">
        <button 
          className="top-bar-btn" 
          title="Configuración de archivo" 
          onClick={() => console.log('File settings')}
        >
          <FileText size={18} />
        </button>
        
        <button 
          className="top-bar-btn" 
          title="Ajustes" 
          onClick={() => console.log('Settings')}
        >
          <Sliders size={18} />
        </button>
        
        <button 
          className="top-bar-btn" 
          title="Guardar" 
          onClick={() => console.log('Save')}
        >
          <Check size={18} />
        </button>
      </div>

    </div>
  );
};