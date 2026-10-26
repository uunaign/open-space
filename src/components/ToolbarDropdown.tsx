import { useState, useRef, useEffect } from 'react';
import './ToolbarDropdown.css';

interface ToolbarDropdownProps {
  triggerIcon: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}

export const ToolbarDropdown = ({ triggerIcon, title, children }: ToolbarDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="dropdown-container" ref={dropdownRef}>
      <button 
        className={`toolbar-btn ${isOpen ? 'active' : ''}`} 
        onClick={() => setIsOpen(!isOpen)}
        title={title}
      >
        {triggerIcon}
      </button>

      {isOpen && (
        <div className="dropdown-menu" onClick={() => setIsOpen(false)}>
          {children}
        </div>
      )}
    </div>
  );
};

// --- NUEVO COMPONENTE PARA CADA OPCIÓN ---
interface DropdownItemProps {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick?: () => void;
}

export const DropdownItem = ({ icon, children, onClick }: DropdownItemProps) => {
  return (
    <button className="dropdown-item" onClick={onClick}>
      {icon && <span className="dropdown-icon">{icon}</span>}
      <span className="dropdown-text">{children}</span>
    </button>
  );
};