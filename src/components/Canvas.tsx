import { useEffect, useRef, useState } from 'react';
import folderFrontImage from '../assets/Carpeta_delantera.svg';
import folderBackImage from '../assets/Carpeta_trasera.svg';
import './Canvas.css';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const DEFAULT_PAGE_HEIGHT = 520;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatInlineMarkdown = (value: string) => {
  const escaped = escapeHtml(value);

  return escaped
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
};

const renderMarkdownText = (value: string) => {
  const lines = value.split(/\n/);
  const html: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    html.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      html.push('<br />');
      continue;
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushList();
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      const content = trimmed.replace(/^#{1,3}\s+/, '');
      html.push(`<h${level}>${formatInlineMarkdown(content)}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    flushList();
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return html.join('');
};

interface PanState {
  x: number;
  y: number;
}

type CanvasItemType = 'note' | 'file' | 'page' | 'group' | 'folder';

interface BaseCanvasItem {
  id: string;
  type: CanvasItemType;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

interface NoteCanvasItem extends BaseCanvasItem {
  type: 'note';
  text: string;
}

interface FileCanvasItem extends BaseCanvasItem {
  type: 'file';
  mimeType: string;
  fileName: string;
  previewUrl: string;
  textContent?: string;
  sizeLabel?: string;
}

interface PageCanvasItem extends BaseCanvasItem {
  type: 'page';
  url: string;
}

interface GroupCanvasItem extends BaseCanvasItem {
  type: 'group';
  childIds: string[];
  expanded: boolean;
}

interface FolderCanvasItem extends BaseCanvasItem {
  type: 'folder';
  childIds: string[];
  expanded: boolean;
}

type CanvasItem = NoteCanvasItem | FileCanvasItem | PageCanvasItem | GroupCanvasItem | FolderCanvasItem;

interface DragInteraction {
  kind: 'pan' | 'move' | 'resize';
  id?: string;
  startX: number;
  startY: number;
  startPanX: number;
  startPanY: number;
  lastX?: number;
  lastY?: number;
  originX?: number;
  originY?: number;
  originWidth?: number;
  originHeight?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const isContainerItem = (item: CanvasItem) => item.type === 'group' || item.type === 'folder';
const GROUP_ITEM_GAP = 15;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const getGroupExpandedPositions = (
  group: GroupCanvasItem,
  children: CanvasItem[],
): Map<string, { x: number; y: number }> => {
  const positions = new Map<string, { x: number; y: number }>();
  const placed: Array<{ x: number; y: number; width: number; height: number }> = [];
  const centerX = group.x + group.width / 2;
  const centerY = group.y + group.height / 2;

  children.forEach((child, index) => {
    let x = centerX - child.width / 2;
    let y = centerY - child.height / 2;

    if (index > 0) {
      let attempt = 0;
      let intersects = true;

      while (intersects) {
        const radius = 34 * Math.sqrt(index) + attempt * 8;
        const angle = index * GOLDEN_ANGLE + attempt * 0.35;
        x = centerX + Math.cos(angle) * radius - child.width / 2;
        y = centerY + Math.sin(angle) * radius - child.height / 2;
        intersects = placed.some(
          (other) =>
            x < other.x + other.width + GROUP_ITEM_GAP &&
            x + child.width + GROUP_ITEM_GAP > other.x &&
            y < other.y + other.height + GROUP_ITEM_GAP &&
            y + child.height + GROUP_ITEM_GAP > other.y,
        );
        attempt += 1;
      }
    }

    positions.set(child.id, { x, y });
    placed.push({ x, y, width: child.width, height: child.height });
  });

  if (placed.length > 0) {
    const minX = Math.min(...placed.map((item) => item.x));
    const minY = Math.min(...placed.map((item) => item.y));
    const maxX = Math.max(...placed.map((item) => item.x + item.width));
    const maxY = Math.max(...placed.map((item) => item.y + item.height));
    const offsetX = centerX - (minX + maxX) / 2;
    const offsetY = centerY - (minY + maxY) / 2;

    positions.forEach((position, id) => {
      positions.set(id, { x: position.x + offsetX, y: position.y + offsetY });
    });
  }

  return positions;
};

const getGroupCollapsedPositions = (group: GroupCanvasItem, children: CanvasItem[]) => {
  const centerX = group.x + group.width / 2;
  const centerY = group.y + group.height / 2;

  return new Map(
    children.map((child, index) => [
      child.id,
      {
        x: centerX - child.width / 2 + index * 10,
        y: centerY - child.height / 2 + index * 14,
      },
    ]),
  );
};

const getFolderChildPosition = (
  folder: FolderCanvasItem,
  index: number,
  childCount: number,
  expanded = folder.expanded,
) => {
  const middle = (childCount - 1) / 2;
  const spread = childCount > 1 ? Math.min(112, 420 / (childCount - 1)) : 0;
  const curve = childCount > 1 ? Math.sin((index / (childCount - 1)) * Math.PI) * 42 : 0;

  return {
    x: folder.x + folder.width / 2 - 75 + (index - middle) * spread,
    y: expanded ? folder.y - 100 - curve : folder.y + folder.height / 2 - 48,
  };
};

const repositionContainerChildren = (items: CanvasItem[]) => {
  const positions = new Map<string, { x: number; y: number }>();

  items.forEach((container) => {
    if (!isContainerItem(container)) {
      return;
    }

    const children = items.filter((item) => container.childIds.includes(item.id));
    const childPositions =
      container.type === 'folder'
        ? new Map(
            children.map((child, index) => [
              child.id,
              getFolderChildPosition(container, index, children.length),
            ]),
          )
        : container.expanded
          ? getGroupExpandedPositions(container, children)
          : getGroupCollapsedPositions(container, children);

    childPositions.forEach((position, childId) => positions.set(childId, position));
  });

  return items.map((item) => {
    const position = positions.get(item.id);
    return position ? { ...item, ...position } : item;
  });
};

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const initialItems: CanvasItem[] = [
  {
    id: makeId(),
    type: 'note',
    x: 180,
    y: 120,
    width: 220,
    height: 150,
    title: 'Nota',
    text: 'Ideas principales\n\n- estructura clara\n- flujo visual limpio\n- contenido mínimo',
  },
  {
    id: makeId(),
    type: 'note',
    x: 540,
    y: 230,
    width: 220,
    height: 150,
    title: 'Trabajo',
    text: 'Revisar la propuesta final\nDefinir necesidades del usuario',
  },
];

export const Canvas = () => {
  const [pan, setPan] = useState<PanState>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [items, setItems] = useState<CanvasItem[]>(initialItems);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [pageDrafts, setPageDrafts] = useState<Record<string, string>>({});
  const dragStartRef = useRef<DragInteraction | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hasMovedItemRef = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        setIsSpacePressed(true);
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length > 0) {
        const idsToDelete = [...selectedIds];
        setItems((current) => current.filter((item) => !idsToDelete.includes(item.id)));
        updateSelection([]);
        setEditingId(null);
      }

      if (event.key === 'Escape') {
        setContextMenu(null);
        setEditingId(null);
        collapseAllGroups();
        updateSelection([]);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    const openFileImport = () => {
      fileInputRef.current?.click();
    };

    const openPageImport = () => {
      const newItem: PageCanvasItem = {
        id: makeId(),
        type: 'page',
        x: 320,
        y: 220,
        width: 520,
        height: DEFAULT_PAGE_HEIGHT,
        title: 'Página web',
        url: '',
      };

      setItems((current) => [...current, newItem]);
      updateSelection([newItem.id]);
      setEditingId(newItem.id);
      setPageDrafts((current) => ({ ...current, [newItem.id]: '' }));
    };

    const createNote = () => {
      const newItem: NoteCanvasItem = {
        id: makeId(),
        type: 'note',
        x: 260 + items.length * 20,
        y: 180 + items.length * 20,
        width: 220,
        height: 150,
        title: 'Nota',
        text: 'Escribe aquí...',
      };

      setItems((current) => [...current, newItem]);
      updateSelection([newItem.id]);
      setEditingId(newItem.id);
    };

    const groupSelected = () => {
      createGroupFromSelection();
    };

    const createContainer = () => {
      createFolder();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('canvas-open-file-import', openFileImport);
    window.addEventListener('canvas-open-page-import', openPageImport);
    window.addEventListener('canvas-create-note', createNote);
    window.addEventListener('canvas-group-selected', groupSelected);
    window.addEventListener('canvas-create-folder', createContainer);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('canvas-open-file-import', openFileImport);
      window.removeEventListener('canvas-open-page-import', openPageImport);
      window.removeEventListener('canvas-create-note', createNote);
      window.removeEventListener('canvas-group-selected', groupSelected);
      window.removeEventListener('canvas-create-folder', createContainer);
    };
  }, [items.length, selectedId, selectedIds]);

  const updateSelection = (nextIds: string[]) => {
    setSelectedIds(nextIds);
    setSelectedId(nextIds[nextIds.length - 1] ?? null);
  };

  const updateItem = (id: string, updater: (item: CanvasItem) => CanvasItem) => {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  };

  const moveItemIntoContainer = (itemId: string, containerId: string) => {
    setItems((current) => {
      const target = current.find((entry) => entry.id === containerId && isContainerItem(entry)) as GroupCanvasItem | FolderCanvasItem | undefined;
      const moved = current.find((entry) => entry.id === itemId && !isContainerItem(entry));

      if (!target || !moved) {
        return current;
      }

      const nextChildren = [...new Set([...target.childIds, itemId])];
      const nextFolder: FolderCanvasItem | null =
        target.type === 'folder' ? { ...target, childIds: nextChildren, expanded: false } : null;
      const nextGroup: GroupCanvasItem | null =
        target.type === 'group' ? { ...target, childIds: nextChildren } : null;
      const nextTarget = nextFolder ?? nextGroup;

      const next = current
        .map((entry) => {
          if (entry.id === containerId && nextTarget) {
            return nextTarget;
          }

          if ((entry.type === 'folder' || entry.type === 'group') && entry.id !== containerId && entry.childIds.includes(itemId)) {
            return { ...entry, childIds: entry.childIds.filter((childId) => childId !== itemId) };
          }

            return entry;
        })
        .filter((entry) => entry.type !== 'group' || entry.childIds.length > 0);
      return repositionContainerChildren(next);
    });
  };

  const createFolder = () => {
    const newItem: FolderCanvasItem = {
      id: makeId(),
      type: 'folder',
      x: 280,
      y: 170,
      width: 320,
      height: 280,
      title: 'Carpeta',
      childIds: [],
      expanded: false,
    };

    setItems((current) => [...current, newItem]);
    updateSelection([newItem.id]);
  };

  const createGroupFromSelection = () => {
    if (selectedIds.length === 1) {
      const selectedGroup = items.find((item): item is GroupCanvasItem => item.id === selectedIds[0] && item.type === 'group');
      if (selectedGroup) {
        if (selectedGroup.expanded) {
          collapseGroup(selectedGroup.id);
        } else {
          toggleGroup(selectedGroup.id);
        }
        return;
      }
    }

    if (selectedIds.length < 2) {
      return;
    }

    const selected = items.filter((item) => selectedIds.includes(item.id) && !isContainerItem(item));
    if (selected.length < 2) {
      return;
    }

    const sorted = [...selected].sort((a, b) => a.width * a.height - b.width * b.height).reverse();
    const centerX = sorted.reduce((sum, item) => sum + item.x + item.width / 2, 0) / sorted.length;
    const centerY = sorted.reduce((sum, item) => sum + item.y + item.height / 2, 0) / sorted.length;
    const groupId = makeId();
    const compactGroup: GroupCanvasItem = {
      id: groupId,
      type: 'group',
      x: centerX,
      y: centerY,
      width: 6,
      height: 6,
      title: 'Grupo',
      childIds: sorted.map((item) => item.id),
      expanded: false,
    };
    const compactPositions = getGroupCollapsedPositions(compactGroup, sorted);

    setItems((current) => {
      const survivors = current.filter((item) => !selectedIds.includes(item.id) || isContainerItem(item));

      const stacked = sorted.map((item) => ({
        ...item,
        ...compactPositions.get(item.id),
      }));

      return [...survivors, ...stacked, compactGroup];
    });

    updateSelection([groupId]);
  };

  const toggleGroup = (groupId: string) => {
    const group = items.find((item): item is GroupCanvasItem => item.id === groupId && item.type === 'group');
    if (!group) {
      return;
    }

    if (group.expanded) {
      collapseGroup(groupId);
      return;
    }

    setItems((current) => {
      const currentGroup = current.find((item): item is GroupCanvasItem => item.id === groupId && item.type === 'group');
      if (!currentGroup) {
        return current;
      }

      const expandedGroup = { ...currentGroup, expanded: true };
      const children = current.filter((item) => expandedGroup.childIds.includes(item.id));
      const positions = getGroupExpandedPositions(expandedGroup, children);

      return current.map((item) => {
        if (item.id === groupId) {
          return expandedGroup;
        }

        const position = positions.get(item.id);
        return position ? { ...item, ...position } : item;
      });
    });
  };

  const collapseGroup = (groupId: string) => {
    setItems((current) => {
      const group = current.find((item) => item.id === groupId && item.type === 'group') as GroupCanvasItem | undefined;
      if (!group) {
        return current;
      }

      const collapsedGroup = { ...group, expanded: false };
      const children = current.filter((item) => collapsedGroup.childIds.includes(item.id));
      const positions = getGroupCollapsedPositions(collapsedGroup, children);

      return current.map((item) => {
        if (item.id === groupId) {
          return collapsedGroup;
        }

        const position = positions.get(item.id);
        return position ? { ...item, ...position } : item;
      });
    });
  };

  const collapseAllGroups = () => {
    setItems((current) => {
      const next = current.map((item) => {
        if (item.type === 'group') {
          return { ...item, expanded: false };
        }

        return item;
      });

      const positions = new Map<string, { x: number; y: number }>();
      next.forEach((group) => {
        if (group.type !== 'group') {
          return;
        }

        const children = next.filter((item) => group.childIds.includes(item.id));
        getGroupCollapsedPositions(group, children).forEach((position, childId) => {
          positions.set(childId, position);
        });
      });

      return next.map((item) => {
        const position = positions.get(item.id);
        return position ? { ...item, ...position } : item;
      });
    });
  };

  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
    }
    if (selectedIds.includes(id)) {
      updateSelection(selectedIds.filter((itemId) => itemId !== id));
    }
    setContextMenu(null);
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);

    for (const file of selectedFiles) {
      const objectUrl = URL.createObjectURL(file);

      const newItem: FileCanvasItem = {
        id: makeId(),
        type: 'file',
        x: 240 + Math.random() * 260,
        y: 220 + Math.random() * 180,
        width: file.type.startsWith('image/') ? 300 : file.type === 'application/pdf' ? 340 : 260,
        height: file.type.startsWith('image/') ? 200 : file.type === 'application/pdf' ? 420 : 170,
        title: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
        previewUrl: objectUrl,
        sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      };

      if (file.type.startsWith('text/') || file.name.toLowerCase().endsWith('.md') || file.name.toLowerCase().endsWith('.markdown')) {
        const textContent = await file.text();
        newItem.textContent = textContent.slice(0, 3000);
      }

      setItems((current) => [...current, newItem]);
      updateSelection([newItem.id]);
    }

    event.target.value = '';
  };

  const beginPan = (event: React.MouseEvent<HTMLDivElement>) => {
    const isBackgroundTarget = (event.target as HTMLElement).closest('.canvas-item') === null;
    const allowPan = event.button === 1 || (event.button === 0 && isSpacePressed && isBackgroundTarget) || (event.button === 0 && isBackgroundTarget && !isDragging);

    if (!allowPan) {
      return;
    }

    event.preventDefault();
    dragStartRef.current = {
      kind: 'pan',
      startX: event.clientX,
      startY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    setIsDragging(true);
    updateSelection([]);
    setEditingId(null);
    setContextMenu(null);
  };

  const startItemDrag = (event: React.MouseEvent<HTMLDivElement>, id: string) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, textarea, input, select, iframe, video, audio, embed')) {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      const nextSelection = selectedIds.includes(id)
        ? selectedIds.filter((itemId) => itemId !== id)
        : [...selectedIds, id];
      updateSelection(nextSelection);
      setEditingId(null);
      setContextMenu(null);
      return;
    }

    updateSelection([id]);
    setEditingId(null);
    setContextMenu(null);
    hasMovedItemRef.current = false;

    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }

    dragStartRef.current = {
      kind: 'move',
      id,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      lastX: 0,
      lastY: 0,
      originX: item.x,
      originY: item.y,
    };
    setIsDragging(true);
  };

  const startResize = (event: React.MouseEvent<HTMLDivElement>, id: string) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateSelection([id]);
    setEditingId(null);

    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return;
    }

    dragStartRef.current = {
      kind: 'resize',
      id,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      originWidth: item.width,
      originHeight: item.height,
    };
    setIsDragging(true);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragStartRef.current) {
      return;
    }

    const dx = event.clientX - dragStartRef.current.startX;
    const dy = event.clientY - dragStartRef.current.startY;

    if (dragStartRef.current.kind === 'move' && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      hasMovedItemRef.current = true;
    }

    if (dragStartRef.current.kind === 'pan') {
      setPan({
        x: dragStartRef.current.startPanX + dx,
        y: dragStartRef.current.startPanY + dy,
      });
      return;
    }

    if (!dragStartRef.current.id) {
      return;
    }

    if (dragStartRef.current.kind === 'move') {
      const nextX = (dragStartRef.current.originX ?? 0) + dx / zoom;
      const nextY = (dragStartRef.current.originY ?? 0) + dy / zoom;

      const draggedItem = items.find((item) => item.id === dragStartRef.current?.id);

      if (draggedItem?.type === 'folder' || (draggedItem?.type === 'group' && !draggedItem.expanded)) {
        const deltaX = (dx - (dragStartRef.current.lastX ?? 0)) / zoom;
        const deltaY = (dy - (dragStartRef.current.lastY ?? 0)) / zoom;
        dragStartRef.current.lastX = dx;
        dragStartRef.current.lastY = dy;

        setItems((current) =>
          current.map((item) => {
            if (item.id === draggedItem.id) {
              return { ...item, x: nextX, y: nextY };
            }

            if (draggedItem.childIds.includes(item.id)) {
              return { ...item, x: item.x + deltaX, y: item.y + deltaY };
            }

            return item;
          }),
        );
      } else {
        updateItem(dragStartRef.current.id, (item) => ({
          ...item,
          x: nextX,
          y: nextY,
        }));
      }
      return;
    }

    if (dragStartRef.current.kind === 'resize') {
      const nextWidth = clamp((dragStartRef.current.originWidth ?? 200) + dx / zoom, 160, 900);
      const nextHeight = clamp((dragStartRef.current.originHeight ?? 140) + dy / zoom, 120, 900);

      updateItem(dragStartRef.current.id, (item) => {
        const isLockedAspect = item.type === 'file' && (item.mimeType === 'application/pdf' || item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/'));

        if (isLockedAspect) {
          const ratio = (dragStartRef.current?.originWidth ?? item.width) / (dragStartRef.current?.originHeight ?? item.height);
          const adjustedWidth = nextWidth;
          const adjustedHeight = adjustedWidth / ratio;

          return {
            ...item,
            width: adjustedWidth,
            height: adjustedHeight,
          };
        }

        return {
          ...item,
          width: nextWidth,
          height: nextHeight,
        };
      });
    }
  };

  const stopInteraction = (event?: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging) {
      return;
    }

    if (dragStartRef.current?.kind === 'move' && event) {
      const hovered = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
      const hoveredItemEl = hovered?.closest('.canvas-item[data-item-id]');
      const hoveredItemId = hoveredItemEl?.getAttribute('data-item-id');
      const draggedId = dragStartRef.current.id;

      if (draggedId && items.find((item) => item.id === draggedId)?.type !== 'group') {
        const hoveredContainer = items.find(
          (entry): entry is GroupCanvasItem | FolderCanvasItem => entry.id === hoveredItemId && isContainerItem(entry),
        );
        const hoveredGroupChild = items.find(
          (entry): entry is GroupCanvasItem =>
            entry.type === 'group' &&
            entry.id !== draggedId &&
            hoveredItemId !== draggedId &&
            entry.childIds.includes(hoveredItemId ?? ''),
        );
        const shellRect = event.currentTarget.getBoundingClientRect();
        const worldX = (event.clientX - shellRect.left - pan.x) / zoom;
        const worldY = (event.clientY - shellRect.top - pan.y) / zoom;
        const groupUnderPointer = items.find((entry): entry is GroupCanvasItem => {
          if (entry.type !== 'group' || entry.childIds.includes(draggedId)) {
            return false;
          }

          const children = items.filter((item) => entry.childIds.includes(item.id));
          if (children.length === 0) {
            return false;
          }

          const left = Math.min(...children.map((item) => item.x));
          const top = Math.min(...children.map((item) => item.y));
          const right = Math.max(...children.map((item) => item.x + item.width));
          const bottom = Math.max(...children.map((item) => item.y + item.height));

          return (
            worldX >= left - GROUP_ITEM_GAP &&
            worldX <= right + GROUP_ITEM_GAP &&
            worldY >= top - GROUP_ITEM_GAP &&
            worldY <= bottom + GROUP_ITEM_GAP
          );
        });
        const folderUnderPointer = items.find((entry): entry is FolderCanvasItem => {
          if (entry.type !== 'folder' || entry.id === draggedId) {
            return false;
          }

          const folderElement = document.querySelector<HTMLElement>(`[data-item-id="${entry.id}"]`);
          const rect = folderElement?.getBoundingClientRect();
          return Boolean(
            rect &&
              event.clientX >= rect.left &&
              event.clientX <= rect.right &&
              event.clientY >= rect.top &&
              event.clientY <= rect.bottom,
          );
        });
        const target = hoveredContainer ?? hoveredGroupChild ?? groupUnderPointer ?? folderUnderPointer;

        if (target && target.id !== draggedId && !target.childIds.includes(draggedId)) {
          moveItemIntoContainer(draggedId, target.id);
        } else {
          const sourceContainer = items.find(
            (entry): entry is GroupCanvasItem | FolderCanvasItem =>
              (entry.type === 'folder' || entry.type === 'group') && entry.childIds.includes(draggedId),
          );

          if (sourceContainer && target?.id !== sourceContainer.id) {
            setItems((current) => {
              const next = current
                .map((entry) =>
                  (entry.type === 'folder' || entry.type === 'group') && entry.childIds.includes(draggedId)
                    ? { ...entry, childIds: entry.childIds.filter((childId) => childId !== draggedId) }
                    : entry,
                )
                .filter((entry) => entry.type !== 'group' || entry.childIds.length > 0);

              return repositionContainerChildren(next);
            });
          }
        }
      }
    }

    setIsDragging(false);
    dragStartRef.current = null;
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const zoomBefore = zoom;
    const nextZoom = clamp(
      zoomBefore * (event.deltaY < 0 ? 1.12 : 0.9),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    if (nextZoom === zoomBefore) {
      return;
    }

    const worldX = (pointerX - pan.x) / zoomBefore;
    const worldY = (pointerY - pan.y) / zoomBefore;

    setPan({
      x: pointerX - worldX * nextZoom,
      y: pointerY - worldY * nextZoom,
    });
    setZoom(nextZoom);
  };

  const handlePageCommit = (id: string) => {
    const rawValue = (pageDrafts[id] ?? '').trim();
    if (!rawValue) {
      return;
    }

    const normalized = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;

    updateItem(id, (item) => ({
      ...item,
      type: 'page',
      url: normalized,
      title: 'Página web',
    }));
  };

  const toggleContainer = (id: string) => {
    setItems((current) => {
      const container = current.find(
        (item): item is GroupCanvasItem | FolderCanvasItem =>
          item.id === id && (item.type === 'group' || item.type === 'folder'),
      );
      if (!container) {
        return current;
      }

      const expanded = !container.expanded;
      const updatedContainer = { ...container, expanded };

      if (container.type !== 'folder') {
        return current.map((item) => (item.id === id ? updatedContainer : item));
      }
      const updatedFolder: FolderCanvasItem = { ...container, expanded };

      return current.map((item) => {
        if (item.id === id) {
          return updatedFolder;
        }

        const index = container.childIds.indexOf(item.id);
        if (index !== -1) {
          return {
            ...item,
            ...getFolderChildPosition(updatedFolder, index, container.childIds.length, expanded),
          };
        }

        return item;
      });
    });
  };

  const renderFolderSummary = (item: FolderCanvasItem) => {
    const children = items.filter((entry) => item.childIds.includes(entry.id)).slice(0, 4);

    return (
      <div className="folder-compact">
        <div className="folder-layer folder-layer-back">
          <img src={folderBackImage} alt="" />
        </div>
        {children.length > 0 && (
          <div className="folder-compact-papers">
            {children.map((child, index) => (
              <div
                key={child.id}
                className="folder-compact-paper"
                style={{
                  transform: `translate(calc(-50% + ${(index - (children.length - 1) / 2) * 12}px), ${index * 5}px)`,
                }}
              >
                {child.type === 'file' && child.mimeType.startsWith('image/') ? (
                  <img src={child.previewUrl} alt={child.fileName} />
                ) : (
                  <>
                    <strong>{child.title || 'Elemento'}</strong>
                    <small>
                      {child.type === 'note'
                        ? child.text.slice(0, 42)
                        : child.type === 'page'
                          ? child.url.replace(/^https?:\/\//, '')
                          : child.type === 'file'
                            ? child.fileName
                            : ''}
                    </small>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="folder-layer folder-layer-front">
          <img src={folderFrontImage} alt="" />
        </div>
      </div>
    );
  };

  const renderFolderExpanded = () => {
    return (
      <div className="folder-scene">
        <div className="folder-layer folder-layer-back">
          <img src={folderBackImage} alt="" />
        </div>
        <div className="folder-layer folder-layer-front">
          <img src={folderFrontImage} alt="" />
        </div>
      </div>
    );
  };

  const renderContainerSummary = (item: GroupCanvasItem | FolderCanvasItem) => {
    if (item.type === 'folder') {
      return renderFolderSummary(item);
    }

    const children = items.filter((entry) => item.childIds.includes(entry.id));
    const style = 'group';

    return (
      <div className={`container-summary ${style}`}>
        <div className="container-badge" aria-hidden="true" />
        <div className="container-meta">
          <strong>{item.title}</strong>
          <span>{children.length} elementos</span>
        </div>
      </div>
    );
  };

  const renderContainerExpanded = (item: GroupCanvasItem | FolderCanvasItem) => {
    if (item.type === 'folder') {
      return renderFolderExpanded();
    }

    const children = items.filter((entry) => item.childIds.includes(entry.id));

    return (
      <div className="container-expanded-grid">
        {children.map((child) => (
          <div key={child.id} className="container-card">
            <div className="container-card-header">{child.title || 'Elemento'}</div>
            {child.type === 'note' && <div className="container-preview-note">{child.text.slice(0, 60) || 'Nota'}</div>}
            {child.type === 'page' && <div className="container-preview-page">{child.url || 'Página web'}</div>}
            {child.type === 'file' && <div className="container-preview-file">{child.fileName}</div>}
            {(child.type === 'group' || child.type === 'folder') && <div className="container-preview-file">{child.title}</div>}
          </div>
        ))}
      </div>
    );
  };

  const renderItemContent = (item: CanvasItem) => {
    if (item.type === 'group') {
      return null;
    }

    if (item.type === 'folder') {
      return item.expanded ? renderContainerExpanded(item) : renderContainerSummary(item);
    }

    if (item.type === 'note') {
      if (editingId === item.id) {
        return (
          <textarea
            className="canvas-note-input"
            value={item.text}
            autoFocus
            onFocus={() => updateSelection([item.id])}
            onBlur={() => setEditingId(null)}
            onChange={(event) =>
              updateItem(item.id, (current) => ({
                ...current,
                type: 'note',
                text: event.target.value,
              }))
            }
          />
        );
      }

      return (
        <div
          className="canvas-note-preview"
          dangerouslySetInnerHTML={{
            __html: renderMarkdownText(item.text),
          }}
        />
      );
    }

    if (item.type === 'file') {
      if (item.mimeType.startsWith('image/')) {
        return <img src={item.previewUrl} alt={item.fileName} className="canvas-media" />;
      }

      if (item.mimeType.startsWith('video/')) {
        return <video src={item.previewUrl} controls className="canvas-media" />;
      }

      if (item.mimeType.startsWith('audio/')) {
        return <audio src={item.previewUrl} controls className="canvas-media-audio" />;
      }

      if (item.mimeType === 'application/pdf') {
        return <iframe title={item.fileName} src={item.previewUrl} className="canvas-media pdf-frame" />;
      }

      if (item.mimeType.startsWith('text/') || item.fileName.toLowerCase().endsWith('.md') || item.fileName.toLowerCase().endsWith('.markdown')) {
        return <pre className="canvas-markdown-preview">{item.textContent ?? 'Sin contenido'}</pre>;
      }

      return (
        <div className="canvas-file-generic">
          <strong>{item.fileName}</strong>
          <span>{item.sizeLabel ?? 'Archivo adjunto'}</span>
        </div>
      );
    }

    if (editingId === item.id || !item.url) {
      return (
        <div className="canvas-page-skeleton">
          <input
            className="canvas-page-input"
            type="text"
            value={pageDrafts[item.id] ?? item.url}
            autoFocus
            placeholder="pega la URL"
            onChange={(event) =>
              setPageDrafts((current) => ({
                ...current,
                [item.id]: event.target.value,
              }))
            }
            onBlur={() => {
              if (item.url) {
                setEditingId(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handlePageCommit(item.id);
                setEditingId(null);
              }
            }}
          />
        </div>
      );
    }

    return (
      <div className="canvas-website-frame">
        <iframe
          title={item.title}
          src={item.url}
          className="canvas-media website-frame"
          sandbox="allow-scripts allow-same-origin"
          referrerPolicy="strict-origin-when-cross-origin"
          loading="lazy"
          scrolling="no"
          allow="fullscreen"
        />
      </div>
    );
  };

  const visibleItems = items.filter(
    (item) =>
      item.type !== 'group' &&
      !items.some((entry) => entry.type === 'folder' && !entry.expanded && entry.childIds.includes(item.id)),
  );

  return (
    <div
      className={`canvas-shell ${isDragging ? 'dragging' : ''}`}
      onMouseDown={beginPan}
      onMouseMove={handleMouseMove}
      onMouseUp={(event) => stopInteraction(event)}
      onMouseLeave={() => stopInteraction()}
      onWheel={handleWheel}
      onContextMenu={(event) => {
        event.preventDefault();
        const target = event.target as HTMLElement;
        const itemEl = target.closest('.canvas-item');
        if (!itemEl) {
          return;
        }

        const itemId = itemEl.getAttribute('data-item-id');
        if (!itemId) {
          return;
        }

        updateSelection([itemId]);
        setContextMenu({ x: event.clientX, y: event.clientY, id: itemId });
      }}
      onClick={(event) => {
        if (hasMovedItemRef.current) {
          hasMovedItemRef.current = false;
          return;
        }

        const target = event.target as HTMLElement;
        if (target.closest('.canvas-item')) {
          return;
        }

        setContextMenu(null);
        collapseAllGroups();
      }}
      aria-label="Infinite canvas"
      role="presentation"
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only-input"
        onChange={handleFiles}
        accept="image/*,video/*,audio/*,.pdf,.md,.markdown,.txt,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.json,.xml,.html,.css,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.php,.rtf"
      />

      {contextMenu && (
        <div
          className="canvas-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" onClick={() => removeItem(contextMenu.id)}>
            Eliminar
          </button>
        </div>
      )}

      <div
        className="canvas-surface"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        <div className="canvas-content">
          {visibleItems.map((item) => {
            const parentFolder = items.find(
              (entry): entry is FolderCanvasItem =>
                entry.type === 'folder' && entry.expanded && entry.childIds.includes(item.id),
            );
            const isFolderPreview = Boolean(parentFolder);
            const folderChildIndex = parentFolder?.childIds.indexOf(item.id) ?? -1;
            const folderChildCount = parentFolder?.childIds.length ?? 0;
            const folderChildMiddle = (folderChildCount - 1) / 2;
            const folderChildRotation =
              folderChildCount > 1 ? ((folderChildIndex - folderChildMiddle) / folderChildMiddle) * 11 : 0;

            return (
              <div
                key={item.id}
                data-item-id={item.id}
                className={`canvas-item ${selectedIds.includes(item.id) ? 'selected' : ''} ${isContainerItem(item) ? 'canvas-container' : ''} ${item.type === 'folder' ? 'folder-item' : ''} ${isFolderPreview ? 'folder-expanded-child' : ''}`}
                style={{
                  left: item.x,
                  top: item.y,
                  width: isFolderPreview ? 150 : item.width,
                  height: isFolderPreview ? 96 : item.height,
                  zIndex: isFolderPreview ? 4 : undefined,
                  transform: isFolderPreview ? `rotate(${folderChildRotation}deg)` : undefined,
                }}
                onMouseDown={(event) => {
                  const parentGroup = items.find(
                    (entry): entry is GroupCanvasItem => entry.type === 'group' && entry.childIds.includes(item.id),
                  );

                  if (item.type === 'folder') {
                    updateSelection([item.id]);
                    setContextMenu(null);
                    startItemDrag(event, item.id);
                    return;
                  }

                  if (isContainerItem(item)) {
                    updateSelection([item.id]);
                    setContextMenu(null);
                    return;
                  }

                  if (parentGroup) {
                    if (parentGroup.expanded) {
                      startItemDrag(event, item.id);
                    } else {
                      startItemDrag(event, parentGroup.id);
                    }
                    return;
                  }

                  startItemDrag(event, item.id);
                }}
                onClick={(event) => {
                  if (hasMovedItemRef.current) {
                    hasMovedItemRef.current = false;
                    return;
                  }

                  const parentGroup = items.find(
                    (entry): entry is GroupCanvasItem => entry.type === 'group' && entry.childIds.includes(item.id),
                  );
                  if (parentGroup) {
                    event.stopPropagation();
                    toggleGroup(parentGroup.id);
                    return;
                  }

                  if (item.type === 'folder') {
                    toggleContainer(item.id);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.shiftKey || event.metaKey || event.ctrlKey) {
                    const nextSelection = selectedIds.includes(item.id)
                      ? selectedIds.filter((id) => id !== item.id)
                      : [...selectedIds, item.id];
                    updateSelection(nextSelection);
                  } else {
                    updateSelection([item.id]);
                  }
                  setContextMenu({ x: event.clientX, y: event.clientY, id: item.id });
                }}
                onDoubleClick={(event) => {
                  const parentFolder = items.find(
                    (entry): entry is FolderCanvasItem => entry.type === 'folder' && entry.childIds.includes(item.id),
                  );

                  if (parentFolder) {
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                  }

                  if (item.type === 'group') {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleContainer(item.id);
                    return;
                  }

                  if (item.type === 'folder') {
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  updateSelection([item.id]);
                  setEditingId(item.id);
                }}
              >
                <div className="canvas-item-body">{renderItemContent(item)}</div>
                {!isContainerItem(item) && <div className="canvas-resize-handle" onMouseDown={(event) => startResize(event, item.id)} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Canvas;
