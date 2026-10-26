import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
    FileText,
    FolderClosed,
    GripVertical,
    Globe,
    Layers,
    LayersArrowUp,
    LayersArrowDown,
    StickyNote,
    Trash2,
} from 'lucide-react';
import './LayerBar.css';

export interface LayerBarItem {
    id: string;
    title: string;
    type: string;
    text?: string;
    url?: string;
    captureUrl?: string;
    previewUrl?: string;
    mimeType?: string;
}

interface LayerBarProps {
    items: LayerBarItem[];
    selectedIds: string[];
    isOpen: boolean;
    onToggle: () => void;
    onSelect: (id: string, additive: boolean) => void;
    onReorder: (draggedId: string, targetId: string) => void;
    onMoveSelected: (direction: 'up' | 'down') => void;
    onDeleteSelected: () => void;
}

const typeLabels: Record<string, string> = {
    note: 'Nota',
    file: 'Archivo',
    page: 'Página',
    group: 'Grupo',
    folder: 'Carpeta',
};

const LayerThumbnail = ({ item }: { item: LayerBarItem }) => {
    const imageUrl =
        item.type === 'page'
            ? item.captureUrl
            : item.type === 'file' && item.mimeType?.startsWith('image/')
                ? item.previewUrl
                : undefined;

    if (imageUrl) {
        return <img className="layer-thumbnail-image" src={imageUrl} alt="" />;
    }

    if (item.type === 'note') {
        return (
            <span className="layer-thumbnail-note">
                {item.text?.trim().slice(0, 48) || <StickyNote size={18} />}
            </span>
        );
    }

    const Icon = item.type === 'folder'
        ? FolderClosed
        : item.type === 'group'
            ? Layers
            : item.type === 'page'
                ? Globe
                : FileText;

    return (
        <span className="layer-thumbnail-icon">
            <Icon size={18} />
        </span>
    );
};

export const LayerBar = ({
    items = [],
    selectedIds = [],
    isOpen,
    onToggle,
    onSelect,
    onReorder,
    onMoveSelected,
    onDeleteSelected,
}: LayerBarProps) => {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    return createPortal(
        <div
            className="layerbar-wrapper"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className={`layerbar-shell ${isOpen ? 'expanded' : ''}`}>
                <div
                    className={`layer-bar-panel ${isOpen ? 'open' : ''}`}
                    aria-label="Capas del canvas"
                    aria-hidden={!isOpen}
                >
                    <div className="layer-bar-content">
                        {items.length === 0 ? (
                            <p className="layer-bar-empty">No hay elementos en el canvas</p>
                        ) : (
                            <ul className="layer-list">
                                {[...items].reverse().map((item) => (
                                    <li
                                        key={item.id}
                                        className={`layer-list-item ${dropTargetId === item.id ? 'drop-target' : ''}`}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            setDropTargetId(item.id);
                                            event.dataTransfer.dropEffect = 'move';
                                        }}
                                        onDrop={(event) => {
                                            event.preventDefault();
                                            const sourceId = draggedId ?? event.dataTransfer.getData('text/plain');
                                            if (sourceId && sourceId !== item.id) {
                                                onReorder(sourceId, item.id);
                                            }
                                            setDraggedId(null);
                                            setDropTargetId(null);
                                        }}
                                    >
                                        <button
                                            type="button"
                                            className="layer-drag-handle"
                                            title={`Reordenar ${item.title || 'elemento'}`}
                                            aria-label={`Arrastrar para reordenar ${item.title || 'elemento'}`}
                                            draggable
                                            onDragStart={(event) => {
                                                setDraggedId(item.id);
                                                event.dataTransfer.effectAllowed = 'move';
                                                event.dataTransfer.setData('text/plain', item.id);
                                            }}
                                            onDragEnd={() => {
                                                setDraggedId(null);
                                                setDropTargetId(null);
                                            }}
                                        >
                                            <GripVertical size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            className={`layer-list-item-select ${selectedIds.includes(item.id) ? 'selected' : ''}`}
                                            title={item.title || typeLabels[item.type] || 'Elemento'}
                                            aria-pressed={selectedIds.includes(item.id)}
                                            onClick={(event) => onSelect(item.id, event.ctrlKey || event.metaKey)}
                                        >
                                            <span className={`layer-thumbnail layer-thumbnail-${item.type}`}>
                                                <LayerThumbnail item={item} />
                                            </span>
                                            <span className="layer-list-item-copy">
                                                <span className="layer-list-item-title">{item.title || 'Elemento'}</span>
                                                <span className="layer-list-item-type">{typeLabels[item.type] || item.type}</span>
                                            </span>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>

                <div className="layerbar-container">
                    <button
                        type="button"
                        className={`toolbar-btn ${isOpen ? 'active' : ''}`}
                        title="View layers (L)"
                        aria-expanded={isOpen}
                        onClick={onToggle}
                    >
                        <Layers size={20} />
                        Layers
                    </button>

                    <div className="layerbar-container-small">
                        <button
                            type="button"
                            className="toolbar-btn-small layer-up-btn"
                            title="Move selected layer up"
                            aria-label="Move selected layer up"
                            disabled={selectedIds.length !== 1}
                            onClick={() => onMoveSelected('up')}
                        >
                            <LayersArrowUp size={20} />
                        </button>
                        <button
                            type="button"
                            className="toolbar-btn-small layer-down-btn"
                            title="Move selected layer down"
                            aria-label="Move selected layer down"
                            disabled={selectedIds.length !== 1}
                            onClick={() => onMoveSelected('down')}
                        >
                            <LayersArrowDown size={20} />
                        </button>
                        <button
                            type="button"
                            className="toolbar-btn-small"
                            title="Delete selected"
                            aria-label="Delete selected"
                            disabled={selectedIds.length === 0}
                            onClick={onDeleteSelected}
                        >
                            <Trash2 size={20} />
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
};
