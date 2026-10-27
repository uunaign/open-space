import { useRef, useState } from 'react';
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
    const listItemRefs = useRef(new Map<string, HTMLLIElement>());
    const lastDropTargetRef = useRef<string | null>(null);
    const activePointerRef = useRef<{ id: string; pointerId: number } | null>(null);

    const reorderWithAnimation = (sourceId: string, targetId: string) => {
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            onReorder(sourceId, targetId);
            return;
        }
        const previousRects = new Map<string, DOMRect>();
        listItemRefs.current.forEach((element, id) => previousRects.set(id, element.getBoundingClientRect()));
        onReorder(sourceId, targetId);

        requestAnimationFrame(() => {
            listItemRefs.current.forEach((element, id) => {
                const previous = previousRects.get(id);
                if (!previous) return;
                const current = element.getBoundingClientRect();
                const offsetY = previous.top - current.top;
                if (Math.abs(offsetY) < 1) return;
                element.style.transition = 'none';
                element.style.transform = `translateY(${offsetY}px)`;
                void element.offsetHeight;
                requestAnimationFrame(() => {
                    element.style.transition = 'transform 180ms cubic-bezier(0.2, 0, 0, 1)';
                    element.style.transform = '';
                });
            });
        });
    };

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
                                        ref={(element) => {
                                            if (element) listItemRefs.current.set(item.id, element);
                                            else listItemRefs.current.delete(item.id);
                                        }}
                                        data-layer-id={item.id}
                                        className={`layer-list-item ${selectedIds.includes(item.id) ? 'is-selected' : ''} ${dropTargetId === item.id ? 'drop-target' : ''} ${draggedId === item.id ? 'is-dragging' : ''}`}
                                    >
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
                                            </span>
                                        </button>
                                        <button
                                            type="button"
                                            className="layer-drag-handle"
                                            title={`Reordenar ${item.title || 'elemento'}`}
                                            aria-label={`Arrastrar para reordenar ${item.title || 'elemento'}`}
                                            onPointerDown={(event) => {
                                                if (event.button !== 0) return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                activePointerRef.current = { id: item.id, pointerId: event.pointerId };
                                                lastDropTargetRef.current = item.id;
                                                setDraggedId(item.id);
                                                event.currentTarget.setPointerCapture(event.pointerId);
                                            }}
                                            onPointerMove={(event) => {
                                                const activePointer = activePointerRef.current;
                                                if (!activePointer || activePointer.pointerId !== event.pointerId) return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-layer-id]');
                                                const targetId = target?.dataset.layerId;
                                                if (targetId && targetId !== activePointer.id && lastDropTargetRef.current !== targetId) {
                                                    lastDropTargetRef.current = targetId;
                                                    setDropTargetId(targetId);
                                                    reorderWithAnimation(activePointer.id, targetId);
                                                }
                                            }}
                                            onPointerUp={(event) => {
                                                event.stopPropagation();
                                                if (activePointerRef.current?.pointerId === event.pointerId) {
                                                    activePointerRef.current = null;
                                                }
                                                setDraggedId(null);
                                                setDropTargetId(null);
                                                lastDropTargetRef.current = null;
                                            }}
                                            onPointerCancel={() => {
                                                activePointerRef.current = null;
                                                setDraggedId(null);
                                                setDropTargetId(null);
                                                lastDropTargetRef.current = null;
                                            }}
                                        >
                                            <GripVertical size={14} />
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
