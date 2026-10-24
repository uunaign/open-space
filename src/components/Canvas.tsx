import { useEffect, useRef, useState } from 'react';
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
  originX?: number;
  originY?: number;
  originWidth?: number;
  originHeight?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const isContainerItem = (item: CanvasItem) => item.type === 'group' || item.type === 'folder';

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
  const [groupSnapshots, setGroupSnapshots] = useState<Record<string, Record<string, { x: number; y: number; width: number; height: number }>>>({});

  const dragStartRef = useRef<DragInteraction | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

      return current.map((entry) => {
        if (entry.id === containerId && isContainerItem(entry)) {
          const containerEntry = entry as GroupCanvasItem | FolderCanvasItem;
          return { ...containerEntry, childIds: nextChildren, expanded: true };
        }

        if (entry.id === itemId) {
          return {
            ...entry,
            x: target.x + 28,
            y: target.y + 26 + (nextChildren.length - 1) * 10,
            width: entry.width,
            height: entry.height,
          };
        }

        return entry;
      });
    });
  };

  const createFolder = () => {
    const newItem: FolderCanvasItem = {
      id: makeId(),
      type: 'folder',
      x: 280,
      y: 170,
      width: 220,
      height: 170,
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
    const snapshot = Object.fromEntries(
      sorted.map((item) => [
        item.id,
        {
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
      ]),
    );

    setGroupSnapshots((current) => ({
      ...current,
      [groupId]: snapshot,
    }));

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

    setItems((current) => {
      const survivors = current.filter((item) => !selectedIds.includes(item.id) || isContainerItem(item));

      const stacked = sorted.map((item, index) => ({
        ...item,
        x: centerX - item.width / 2 + index * 10,
        y: centerY - item.height / 2 + index * 14,
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

    const snapshot = groupSnapshots[groupId] ?? {};

    setItems((current) =>
      current.map((item) => {
        if (item.id === groupId && item.type === 'group') {
          return { ...item, expanded: true };
        }

        const saved = snapshot[item.id];
        if (saved) {
          return {
            ...item,
            x: saved.x,
            y: saved.y,
            width: saved.width,
            height: saved.height,
          };
        }

        return item;
      }),
    );
  };

  const collapseGroup = (groupId: string) => {
    setItems((current) => {
      const group = current.find((item) => item.id === groupId && item.type === 'group') as GroupCanvasItem | undefined;
      if (!group) {
        return current;
      }

      const origin = groupSnapshots[groupId] ?? {};
      const centerX = group.x + group.width / 2;
      const centerY = group.y + group.height / 2;

      return current.map((item) => {
        if (item.id === groupId) {
          return { ...item, expanded: false };
        }

        if (group.childIds.includes(item.id)) {
          const index = group.childIds.indexOf(item.id);
          const saved = origin[item.id];

          return {
            ...item,
            width: saved?.width ?? item.width,
            height: saved?.height ?? item.height,
            x: centerX - (saved?.width ?? item.width) / 2 + index * 10,
            y: centerY - (saved?.height ?? item.height) / 2 + index * 14,
          };
        }

        return item;
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

      return next.map((item) => {
        const group = next.find((entry): entry is GroupCanvasItem => entry.type === 'group' && entry.childIds.includes(item.id));
        if (!group) {
          return item;
        }

        const index = group.childIds.indexOf(item.id);
        const saved = groupSnapshots[group.id]?.[item.id];
        const width = saved?.width ?? item.width;
        const height = saved?.height ?? item.height;
        const centerX = group.x + group.width / 2;
        const centerY = group.y + group.height / 2;

        return {
          ...item,
          width,
          height,
          x: centerX - width / 2 + index * 10,
          y: centerY - height / 2 + index * 14,
        };
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

      updateItem(dragStartRef.current.id, (item) => ({
        ...item,
        x: nextX,
        y: nextY,
      }));
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
      const containerEl = hovered?.closest('.canvas-item[data-item-id]');
      const containerId = containerEl?.getAttribute('data-item-id');
      const draggedId = dragStartRef.current.id;

      if (containerId && draggedId && containerId !== draggedId) {
        const target = items.find((entry) => entry.id === containerId);
        if (target && isContainerItem(target) && !target.childIds.includes(draggedId)) {
          moveItemIntoContainer(draggedId, containerId);
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
    updateItem(id, (item) => {
      if (item.type !== 'group' && item.type !== 'folder') {
        return item;
      }

      return { ...item, expanded: !item.expanded };
    });
  };

  const folderBackSvg = `
    <svg viewBox="0 0 220 156" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Folder back">
      <path d="M16 52C16 42.059 24.059 34 34 34H74L90 48H186C196.493 48 205 56.507 205 67V118C205 130.15 195.15 140 183 140H37C24.85 140 15 130.15 15 118V52H16Z" fill="#F4DCA8"/>
      <path d="M24 60H196L184 124C181.8 131.8 175.12 137 167 137H53C44.88 137 38.2 131.8 36 124L24 60Z" fill="#F7E7BE"/>
      <path d="M46 48H80L93 59H40L46 48Z" fill="#EED190" opacity="0.9"/>
      <path d="M58 72H150" stroke="#D9B15F" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
      <path d="M58 86H170" stroke="#D9B15F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
      <path d="M58 100H165" stroke="#D9B15F" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
    </svg>
  `;

  const folderFrontSvg = `
    <svg viewBox="0 0 220 156" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Folder front">
      <path d="M18 48C18 39.163 25.163 32 34 32H76L93 48H192C201.941 48 210 56.059 210 66V121C210 132.046 201.046 141 190 141H30C18.954 141 10 132.046 10 121V56C10 51.582 13.582 48 18 48Z" fill="#F6E7B7"/>
      <path d="M24 53H196L184 121C181.08 130.242 173.759 136 164.5 136H55.5C46.241 136 38.92 130.242 36 121L24 53Z" fill="#FDF3D1"/>
      <path d="M34 48H72L80 52H34V48Z" fill="#E5BA62"/>
      <path d="M56 72H150" stroke="#D9B15F" stroke-width="3" stroke-linecap="round" opacity="0.8"/>
      <path d="M56 88H170" stroke="#D9B15F" stroke-width="3" stroke-linecap="round" opacity="0.7"/>
      <path d="M56 104H168" stroke="#D9B15F" stroke-width="3" stroke-linecap="round" opacity="0.6"/>
    </svg>
  `;

  const renderFolderPreviewCard = (child: CanvasItem) => {
    const title = child.title || 'Elemento';

    if (child.type === 'note') {
      return (
        <div className="folder-paper folder-paper-note">
          <span className="folder-paper-label">Nota</span>
          <strong>{title}</strong>
          <small>{child.text.slice(0, 18) || 'Sin texto'}</small>
        </div>
      );
    }

    if (child.type === 'file') {
      return (
        <div className="folder-paper folder-paper-file">
          <span className="folder-paper-label">Archivo</span>
          <strong>{child.fileName}</strong>
          <small>{child.sizeLabel ?? 'Adjunto'}</small>
        </div>
      );
    }

    if (child.type === 'page') {
      return (
        <div className="folder-paper folder-paper-page">
          <span className="folder-paper-label">Web</span>
          <strong>{title}</strong>
          <small>{child.url.replace(/^https?:\/\//, '').slice(0, 18)}</small>
        </div>
      );
    }

    return (
      <div className="folder-paper folder-paper-generic">
        <span className="folder-paper-label">Carpeta</span>
        <strong>{title}</strong>
      </div>
    );
  };

  const renderFolderSummary = (item: FolderCanvasItem) => {
    const children = items.filter((entry) => item.childIds.includes(entry.id)).slice(0, 3);

    return (
      <div className="folder-compact">
        <div className="folder-layer folder-layer-back" dangerouslySetInnerHTML={{ __html: folderBackSvg }} />
        <div className="folder-layer folder-layer-front" dangerouslySetInnerHTML={{ __html: folderFrontSvg }} />
        {children.length > 0 && (
          <div className="folder-compact-papers">
            {children.map((child, index) => (
              <div
                key={child.id}
                className="folder-compact-paper"
                style={{ transform: `translate(${index * 8}px, ${index * 7}px)` }}
              >
                <span>{child.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderFolderExpanded = (item: FolderCanvasItem) => {
    const children = items.filter((entry) => item.childIds.includes(entry.id)).slice(0, 4);

    return (
      <div className="folder-scene">
        <div className="folder-layer folder-layer-back" dangerouslySetInnerHTML={{ __html: folderBackSvg }} />
        <div className="folder-layer folder-layer-front" dangerouslySetInnerHTML={{ __html: folderFrontSvg }} />

        <div className="folder-content">
          {children.length === 0 && <div className="folder-empty-state">Vacía</div>}
          {children.map((child, index) => (
            <div
              key={child.id}
              className="folder-paper-wrapper"
              style={{
                transform: `translate(${index * 12}px, ${index * 11}px) rotate(${index % 2 === 0 ? -3 : 3}deg)`,
              }}
            >
              {renderFolderPreviewCard(child)}
            </div>
          ))}
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
      return renderFolderExpanded(item);
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
    (item) => item.type !== 'group' && !items.some((entry) => entry.type === 'folder' && entry.childIds.includes(item.id)),
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
          {visibleItems.map((item) => (
              <div
                key={item.id}
                data-item-id={item.id}
                className={`canvas-item ${selectedIds.includes(item.id) ? 'selected' : ''} ${isContainerItem(item) ? 'canvas-container' : ''} ${item.type === 'folder' ? 'folder-item' : ''}`}
                style={{
                  left: item.x,
                  top: item.y,
                  width: item.width,
                  height: item.height,
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
                    event.stopPropagation();
                    updateSelection([item.id]);
                    return;
                  }

                  startItemDrag(event, item.id);
                }}
                onClick={(event) => {
                  const parentGroup = items.find(
                    (entry): entry is GroupCanvasItem => entry.type === 'group' && entry.childIds.includes(item.id),
                  );
                  if (parentGroup) {
                    event.stopPropagation();
                    toggleGroup(parentGroup.id);
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
                  if (isContainerItem(item)) {
                    event.preventDefault();
                    event.stopPropagation();
                    toggleContainer(item.id);
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
            ))}
        </div>
      </div>
    </div>
  );
};

export default Canvas;
