import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
  captureUrl?: string;
  scale: number;
  visibleHeight: number;
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
  resizeMode?: 'scale' | 'viewport';
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
  originScale?: number;
  originViewportHeight?: number;
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
  const [pageLoadingIds, setPageLoadingIds] = useState<Record<string, boolean>>({});
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  const [fileSettingsOpen, setFileSettingsOpen] = useState(false);
  const [canvasBackground, setCanvasBackground] = useState('#ffffff');
  const [canvasGridEnabled, setCanvasGridEnabled] = useState(false);
  const dragStartRef = useRef<DragInteraction | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const centerAnimationRef = useRef<number | null>(null);
  const hasMovedItemRef = useRef(false);

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const saveCanvasProject = () => {
    const snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      pan,
      zoom,
      canvasBackground,
      canvasGridEnabled,
      items,
    };

    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `open-space-${Date.now()}.osp`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const loadCanvasProject = async (file: File) => {
    try {
      const text = await file.text();
      const snapshot = JSON.parse(text) as {
        pan?: PanState;
        zoom?: number;
        canvasBackground?: string;
        canvasGridEnabled?: boolean;
        items?: CanvasItem[];
      };

      if (snapshot.items && Array.isArray(snapshot.items)) {
        setItems(snapshot.items);
      }

      if (snapshot.pan) {
        setPan(snapshot.pan);
      }

      if (snapshot.zoom) {
        setZoom(snapshot.zoom);
      }

      if (snapshot.canvasBackground) {
        setCanvasBackground(snapshot.canvasBackground);
      }

      if (typeof snapshot.canvasGridEnabled === 'boolean') {
        setCanvasGridEnabled(snapshot.canvasGridEnabled);
      }

      updateSelection([]);
    } catch (error) {
      console.warn('No se pudo abrir el proyecto guardado:', error);
    }
  };

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

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
      const center = getViewportCenterPosition(520, DEFAULT_PAGE_HEIGHT);
      const newItem: PageCanvasItem = {
        id: makeId(),
        type: 'page',
        x: center.x,
        y: center.y,
        width: 520,
        height: DEFAULT_PAGE_HEIGHT,
        title: 'Página web',
        url: '',
        scale: 1,
        visibleHeight: DEFAULT_PAGE_HEIGHT,
      };

      setItems((current) => [...current, newItem]);
      updateSelection([newItem.id]);
      setEditingId(newItem.id);
      setPageDrafts((current) => ({ ...current, [newItem.id]: '' }));
    };

    const createNote = () => {
      const center = getViewportCenterPosition(220, 150);
      const newItem: NoteCanvasItem = {
        id: makeId(),
        type: 'note',
        x: center.x,
        y: center.y,
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

    const openFileSettings = () => {
      setFileSettingsOpen(true);
    };

    const openCanvasSettings = () => {
      setCanvasSettingsOpen(true);
    };

    const openProjectImport = () => {
      projectInputRef.current?.click();
    };

    const centerView = () => {
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }

      const allVisibleItems = items.filter(
        (item) => item.type !== 'group' && !items.some((entry) => entry.type === 'folder' && !entry.expanded && entry.childIds.includes(item.id)),
      );

      if (allVisibleItems.length === 0) {
        return;
      }

      const bounds = allVisibleItems.reduce(
        (acc, item) => ({
          minX: Math.min(acc.minX, item.x),
          minY: Math.min(acc.minY, item.y),
          maxX: Math.max(acc.maxX, item.x + item.width),
          maxY: Math.max(acc.maxY, item.y + item.height),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
      );

      const shellRect = viewport.getBoundingClientRect();
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const nextPanX = shellRect.width / 2 - centerX * zoomRef.current;
      const nextPanY = shellRect.height / 2 - centerY * zoomRef.current;
      const startX = panRef.current.x;
      const startY = panRef.current.y;
      const startTime = performance.now();
      const duration = 650;

      const tick = (time: number) => {
        const progress = Math.min((time - startTime) / duration, 1);
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const x = startX + (nextPanX - startX) * eased;
        const y = startY + (nextPanY - startY) * eased;

        panRef.current = { x, y };
        setPan({ x, y });

        if (progress < 1) {
          centerAnimationRef.current = requestAnimationFrame(tick);
        } else {
          centerAnimationRef.current = null;
        }
      };

      if (centerAnimationRef.current !== null) {
        cancelAnimationFrame(centerAnimationRef.current);
      }

      centerAnimationRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('canvas-open-file-import', openFileImport);
    window.addEventListener('canvas-open-page-import', openPageImport);
    window.addEventListener('canvas-create-note', createNote);
    window.addEventListener('canvas-group-selected', groupSelected);
    window.addEventListener('canvas-create-folder', createContainer);
    window.addEventListener('canvas-center-view', centerView);
    window.addEventListener('canvas-open-file-settings', openFileSettings);
    window.addEventListener('canvas-open-canvas-settings', openCanvasSettings);
    window.addEventListener('canvas-open-project', openProjectImport);
    window.addEventListener('canvas-save', saveCanvasProject);

    return () => {
      if (centerAnimationRef.current !== null) {
        cancelAnimationFrame(centerAnimationRef.current);
      }

      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('canvas-open-file-import', openFileImport);
      window.removeEventListener('canvas-open-page-import', openPageImport);
      window.removeEventListener('canvas-create-note', createNote);
      window.removeEventListener('canvas-group-selected', groupSelected);
      window.removeEventListener('canvas-create-folder', createContainer);
      window.removeEventListener('canvas-center-view', centerView);
      window.removeEventListener('canvas-open-file-settings', openFileSettings);
      window.removeEventListener('canvas-open-canvas-settings', openCanvasSettings);
      window.removeEventListener('canvas-open-project', openProjectImport);
      window.removeEventListener('canvas-save', saveCanvasProject);
    };
  }, [canvasBackground, canvasGridEnabled, items, pan, selectedId, selectedIds, zoom]);

  const getViewportCenterPosition = (width: number, height: number) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return { x: 0, y: 0 };
    }

    const rect = viewport.getBoundingClientRect();
    const worldX = (rect.width / 2 - pan.x) / zoom;
    const worldY = (rect.height / 2 - pan.y) / zoom;

    return {
      x: worldX - width / 2,
      y: worldY - height / 2,
    };
  };

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
    const center = getViewportCenterPosition(320 * 0.8, 280 * 0.8);
    const newItem: FolderCanvasItem = {
      id: makeId(),
      type: 'folder',
      x: center.x,
      y: center.y,
      width: 320 * 0.8,
      height: 280 * 0.8,
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
      const previewUrl = await readFileAsDataUrl(file);
      const itemWidth = file.type.startsWith('image/') ? 300 : file.type === 'application/pdf' ? 340 : 260;
      const itemHeight = file.type.startsWith('image/') ? 200 : file.type === 'application/pdf' ? 420 : 170;
      const center = getViewportCenterPosition(itemWidth, itemHeight);

      const newItem: FileCanvasItem = {
        id: makeId(),
        type: 'file',
        x: center.x,
        y: center.y,
        width: itemWidth,
        height: itemHeight,
        title: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileName: file.name,
        previewUrl,
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

  const handleProjectImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    await loadCanvasProject(file);
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

  const startPageResize = (event: React.MouseEvent<HTMLDivElement>, id: string, resizeMode: 'scale' | 'viewport') => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    updateSelection([id]);
    setEditingId(null);

    const item = items.find((entry): entry is PageCanvasItem => entry.id === id && entry.type === 'page');
    if (!item) {
      return;
    }

    dragStartRef.current = {
      kind: 'resize',
      id,
      resizeMode,
      startX: event.clientX,
      startY: event.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      originWidth: item.width,
      originHeight: item.height,
      originScale: item.scale,
      originViewportHeight: item.visibleHeight,
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
      const draggedItem = items.find((item) => item.id === dragStartRef.current?.id);

      if (draggedItem?.type === 'page') {
        if (dragStartRef.current.resizeMode === 'scale') {
          const baseWidth = dragStartRef.current.originWidth ?? draggedItem.width;
          const baseScale = dragStartRef.current.originScale ?? draggedItem.scale;
          const nextWidth = clamp(baseWidth + dx / zoom, 220, 980);
          const nextScale = clamp(baseScale + (dx / zoom) / 180, 0.7, 2.6);

          updateItem(dragStartRef.current.id, (item) => {
            if (item.type !== 'page') {
              return item;
            }

            return {
              ...item,
              width: nextWidth,
              scale: nextScale,
            };
          });
          return;
        }

        const nextVisibleHeight = clamp((dragStartRef.current.originViewportHeight ?? draggedItem.visibleHeight) + dy / zoom, 120, 980);

        updateItem(dragStartRef.current.id, (item) => {
          if (item.type !== 'page') {
            return item;
          }

          return {
            ...item,
            height: nextVisibleHeight,
            visibleHeight: nextVisibleHeight,
          };
        });
        return;
      }

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

  const capturePageImage = async (url: string) => {
    try {
      const base64 = await invoke<string>('capture_page', { url });
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      console.warn('No se pudo generar la captura local de la página:', error);
      return null;
    }
  };

  const handlePageCommit = async (id: string) => {
    const rawValue = (pageDrafts[id] ?? '').trim();
    if (!rawValue) {
      return;
    }

    const normalized = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    setPageLoadingIds((current) => ({ ...current, [id]: true }));

    try {
      const captureUrl = await capturePageImage(normalized);

      updateItem(id, (item) => ({
        ...item,
        type: 'page',
        url: normalized,
        title: 'Página web',
        captureUrl: captureUrl ?? undefined,
        scale: item.type === 'page' ? item.scale || 1 : 1,
        visibleHeight: item.type === 'page' ? item.visibleHeight || item.height : item.height,
      }));
    } finally {
      setPageLoadingIds((current) => ({ ...current, [id]: false }));
    }
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
                void handlePageCommit(item.id);
                setEditingId(null);
              }
            }}
          />
        </div>
      );
    }

    if (!item.captureUrl && pageLoadingIds[item.id]) {
      return (
        <div className="canvas-page-loading">
          <span>Generando captura…</span>
        </div>
      );
    }

    if (!item.captureUrl) {
      return (
        <div className="canvas-page-loading canvas-page-loading-empty">
          <span>Página sin captura</span>
        </div>
      );
    }

    const viewportHeight = item.visibleHeight || item.height;
    const contentScale = item.scale || 1;

    return (
      <div
        className="canvas-page-capture-wrap"
        style={{
          width: item.width,
          height: viewportHeight,
        }}
      >
        <div
          className="canvas-page-capture"
          style={{
            width: item.width,
            height: viewportHeight,
            overflow: 'hidden',
            borderRadius: '8px',
            transform: `scale(${contentScale})`,
            transformOrigin: 'top center',
          }}
        >
          <img
            src={item.captureUrl}
            alt={item.title}
            className="canvas-page-capture-image"
            loading="lazy"
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              objectFit: 'cover',
              objectPosition: 'top center',
            }}
          />
        </div>
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
      ref={viewportRef}
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

      <input
        ref={projectInputRef}
        type="file"
        className="sr-only-input"
        onChange={handleProjectImport}
        accept=".osp,application/json"
      />

      {canvasSettingsOpen && (
        <div className="canvas-settings-panel">
          <div className="canvas-settings-header">
            <strong>Configuración del canvas</strong>
            <button type="button" onClick={() => setCanvasSettingsOpen(false)}>Cerrar</button>
          </div>

          <label>
            <span>Fondo</span>
            <input
              type="color"
              value={canvasBackground}
              onChange={(event) => setCanvasBackground(event.target.value)}
            />
          </label>

          <label className="canvas-settings-toggle">
            <input
              type="checkbox"
              checked={canvasGridEnabled}
              onChange={(event) => setCanvasGridEnabled(event.target.checked)}
            />
            <span>Mostrar cuadrícula</span>
          </label>
        </div>
      )}

      {fileSettingsOpen && (
        <div className="canvas-settings-panel">
          <div className="canvas-settings-header">
            <strong>Archivo</strong>
            <button type="button" onClick={() => setFileSettingsOpen(false)}>Cerrar</button>
          </div>

          <button type="button" onClick={() => { saveCanvasProject(); setFileSettingsOpen(false); }}>
            Guardar proyecto (.osp)
          </button>
          <button type="button" onClick={() => { projectInputRef.current?.click(); setFileSettingsOpen(false); }}>
            Abrir proyecto (.osp)
          </button>
        </div>
      )}

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
          background: canvasBackground,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          boxShadow: canvasGridEnabled ? 'inset 0 0 0 1px rgba(15, 23, 42, 0.04)' : 'none',
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
                {item.type === 'page' ? (
                  <>
                    <div className="canvas-page-handle canvas-page-handle-right" onMouseDown={(event) => startPageResize(event, item.id, 'scale')} />
                    <div className="canvas-page-handle canvas-page-handle-bottom" onMouseDown={(event) => startPageResize(event, item.id, 'viewport')} />
                  </>
                ) : !isContainerItem(item) ? (
                  <div className="canvas-resize-handle" onMouseDown={(event) => startResize(event, item.id)} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Canvas;
