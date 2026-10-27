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
    ChevronRight,
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
    childIds?: string[];
    expanded?: boolean;
}

interface LayerBarProps {
    items: LayerBarItem[];
    selectedIds: string[];
    isOpen: boolean;
    onToggle: () => void;
    onSelect: (id: string, additive: boolean) => void;
    onReorder: (draggedId: string, targetId: string, placement: 'before' | 'after') => void;
    onToggleContainer: (id: string) => void;
    onMoveSelected: (direction: 'up' | 'down') => void;
    onDeleteSelected: () => void;
}

interface LayerDragState {
    id: string;
    pointerId: number;
    startY: number;
    deltaY: number;
    sourceIndex: number;
    targetIndex: number;
    rowHeight: number;
    rowCenters: number[];
}

const typeLabels: Record<string, string> = {
    note: 'Nota',
    file: 'Archivo',
    page: 'Página',
    group: 'Grupo',
    folder: 'Carpeta',
};

const getLayerImageUrl = (item: LayerBarItem) =>
    item.type === 'page'
        ? item.captureUrl
        : item.type === 'file' && item.mimeType?.startsWith('image/')
            ? item.previewUrl
            : undefined;

const LayerThumbnail = ({ item }: { item: LayerBarItem }) => {
    const imageUrl = getLayerImageUrl(item);

    if (imageUrl) {
        return <img className="layer-thumbnail-image" src={imageUrl} alt="" />;
    }

    if (item.type === 'note') {
        const preview = item.text?.trim();
        return (
            <span className={`layer-thumbnail-note ${preview ? '' : 'is-empty'}`}>
                {preview ? preview.slice(0, 72) : <StickyNote size={16} />}
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
    onToggleContainer,
    onMoveSelected,
    onDeleteSelected,
}: LayerBarProps) => {
    const [dragState, setDragState] = useState<LayerDragState | null>(null);
    const dragStateRef = useRef<LayerDragState | null>(null);
    const listItemRefs = useRef(new Map<string, HTMLLIElement>());
    const orderedItems = [...items].reverse();
    const itemById = new Map(orderedItems.map((item) => [item.id, item]));
    const parentByChild = new Map<string, string>();
    orderedItems.forEach((item) => {
        if (item.type !== 'group' && item.type !== 'folder') return;
        item.childIds?.forEach((childId) => {
            if (itemById.has(childId) && !parentByChild.has(childId)) parentByChild.set(childId, item.id);
        });
    });
    const visibleItems: Array<{ item: LayerBarItem; depth: number }> = [];
    const appendChildren = (parent: LayerBarItem, depth: number, path: Set<string>) => {
        if (!parent.expanded || path.has(parent.id)) return;
        const nextPath = new Set(path).add(parent.id);
        orderedItems
            .filter((item) => parent.childIds?.includes(item.id))
            .forEach((child) => {
                visibleItems.push({ item: child, depth });
                appendChildren(child, depth + 1, nextPath);
            });
    };
    orderedItems
        .filter((item) => !parentByChild.has(item.id))
        .forEach((item) => {
            visibleItems.push({ item, depth: 0 });
            appendChildren(item, 1, new Set());
        });
    const layerItems = visibleItems.map(({ item }) => item);

    const finishDrag = (pointerId: number) => {
        const drag = dragStateRef.current;
        if (!drag || drag.pointerId !== pointerId) return;

        if (drag.targetIndex !== drag.sourceIndex) {
            const placement = drag.targetIndex < drag.sourceIndex ? 'before' : 'after';
            const target = layerItems[drag.targetIndex];
            if (target) onReorder(drag.id, target.id, placement);
        }
        dragStateRef.current = null;
        setDragState(null);
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
                                {visibleItems.map(({ item, depth }, index) => {
                                    const isDragged = dragState?.id === item.id;
                                    const movesUp = dragState && dragState.sourceIndex < dragState.targetIndex && index > dragState.sourceIndex && index <= dragState.targetIndex;
                                    const movesDown = dragState && dragState.targetIndex < dragState.sourceIndex && index >= dragState.targetIndex && index < dragState.sourceIndex;
                                    const rowOffset = isDragged
                                        ? dragState.deltaY
                                        : movesUp
                                            ? -dragState.rowHeight
                                            : movesDown
                                                ? dragState.rowHeight
                                                : 0;

                                    return (
                                    <li
                                        key={item.id}
                                        ref={(element) => {
                                            if (element) listItemRefs.current.set(item.id, element);
                                            else listItemRefs.current.delete(item.id);
                                        }}
                                        data-layer-id={item.id}
                                        className={`layer-list-item ${selectedIds.includes(item.id) ? 'is-selected' : ''} ${isDragged ? 'is-dragging' : ''}`}
                                        style={{ paddingLeft: `${4 + depth * 18}px`, ...(rowOffset ? { transform: `translateY(${rowOffset}px)` } : {}) }}
                                    >
                                        {item.type === 'group' || item.type === 'folder' ? (
                                            <button
                                                type="button"
                                                className={`layer-expand-toggle ${item.expanded ? 'is-expanded' : ''}`}
                                                aria-label={`${item.expanded ? 'Contraer' : 'Expandir'} ${typeLabels[item.type].toLowerCase()}`}
                                                aria-expanded={Boolean(item.expanded)}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    onToggleContainer(item.id);
                                                }}
                                            >
                                                <ChevronRight size={14} />
                                            </button>
                                        ) : <span className="layer-expand-spacer" />}
                                        <button
                                            type="button"
                                            className={`layer-list-item-select ${selectedIds.includes(item.id) ? 'selected' : ''}`}
                                            title={item.title || typeLabels[item.type] || 'Elemento'}
                                            aria-pressed={selectedIds.includes(item.id)}
                                            onClick={(event) => onSelect(item.id, event.ctrlKey || event.metaKey)}
                                        >
                                            <span className={`layer-thumbnail layer-thumbnail-${item.type} ${getLayerImageUrl(item) ? 'has-image' : ''}`}>
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
                                                const sourceIndex = layerItems.findIndex((entry) => entry.id === item.id);
                                                const rect = listItemRefs.current.get(item.id)?.getBoundingClientRect();
                                                if (!rect) return;
                                                const nextDragState: LayerDragState = {
                                                    id: item.id,
                                                    pointerId: event.pointerId,
                                                    startY: event.clientY,
                                                    deltaY: 0,
                                                    sourceIndex,
                                                    targetIndex: sourceIndex,
                                                    rowHeight: rect.height,
                                                    rowCenters: layerItems
                                                        .filter((entry) => entry.id !== item.id)
                                                        .map((entry) => {
                                                            const row = listItemRefs.current.get(entry.id)?.getBoundingClientRect();
                                                            return row ? row.top + row.height / 2 : 0;
                                                        }),
                                                };
                                                dragStateRef.current = nextDragState;
                                                setDragState(nextDragState);
                                                event.currentTarget.setPointerCapture(event.pointerId);
                                            }}
                                            onPointerMove={(event) => {
                                                const currentDrag = dragStateRef.current;
                                                if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;
                                                event.preventDefault();
                                                event.stopPropagation();
                                                const deltaY = event.clientY - currentDrag.startY;
                                                const pointerY = event.clientY;
                                                const targetIndex = currentDrag.rowCenters.filter((center) => pointerY > center).length;
                                                const nextDragState = { ...currentDrag, deltaY, targetIndex };
                                                dragStateRef.current = nextDragState;
                                                setDragState(nextDragState);
                                            }}
                                            onPointerUp={(event) => {
                                                event.stopPropagation();
                                                finishDrag(event.pointerId);
                                            }}
                                            onPointerCancel={(event) => {
                                                if (dragStateRef.current?.pointerId === event.pointerId) {
                                                    dragStateRef.current = null;
                                                    setDragState(null);
                                                }
                                            }}
                                        >
                                            <GripVertical size={14} />
                                        </button>
                                    </li>
                                );
                                })}
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
