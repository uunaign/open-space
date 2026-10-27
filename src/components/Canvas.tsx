import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { FolderOpen, Maximize, Minimize } from 'lucide-react';
import folderFrontSvg from '../assets/Carpeta_delantera.svg?raw';
import folderBackSvg from '../assets/Carpeta_trasera.svg?raw';
import { LayerBar } from './LayerBar';
import './Canvas.css';

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const DEFAULT_PAGE_HEIGHT = 520;
const DEFAULT_FOLDER_COLOR = '#30D9FF';
const FOLDER_COLORS = [
  { value: DEFAULT_FOLDER_COLOR, label: 'Cian pastel' },
  { value: '#F3BFCB', label: 'Rosa' },
  { value: '#F8D2A6', label: 'Melocotón' },
  { value: '#F1E4A4', label: 'Amarillo' },
  { value: '#BFE0C7', label: 'Menta' },
  { value: '#BFD8F0', label: 'Azul' },
  { value: '#D3C4E8', label: 'Lavanda' },
  { value: '#D8DADF', label: 'Gris' },
];

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
    .replace(/~~(.+?)~~/g, '<del>$1</del>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
};

const renderMarkdownText = (value: string) => {
  const lines = value.split(/\n/);
  const html: string[] = [];
  let listItems: string[] = [];
  let orderedItems: string[] = [];
  let firstContentLine = true;

  const flushList = () => {
    if (listItems.length === 0) {
      if (orderedItems.length > 0) {
        html.push(`<ol>${orderedItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ol>`);
        orderedItems = [];
      }
      return;
    }

    html.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ul>`);
    listItems = [];
    if (orderedItems.length > 0) {
      html.push(`<ol>${orderedItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ol>`);
      orderedItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      html.push('<br />');
      continue;
    }

    // Keep an empty heading trigger visible while editing so Backspace does not
    // turn the marker into a heading's literal text or move the caret before it.
    if (/^\s{0,3}#{1,3}[ \t]+$/.test(rawLine)) {
      flushList();
      html.push(`<p>${escapeHtml(rawLine)}</p>`);
      continue;
    }

    if (firstContentLine) {
      firstContentLine = false;
      if (!/^#{1,3}\s+/.test(trimmed)) {
        flushList();
        html.push(`<h1>${formatInlineMarkdown(trimmed)}</h1>`);
        continue;
      }
    }

    if (/^#{1,3}\s+/.test(trimmed)) {
      flushList();
      const level = trimmed.match(/^#+/)?.[0].length ?? 1;
      const content = trimmed.replace(/^#{1,3}\s+/, '');
      html.push(`<h${level}>${formatInlineMarkdown(content)}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (orderedItems.length > 0) flushList();
      listItems.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      if (listItems.length > 0) flushList();
      orderedItems.push(trimmed.replace(/^\d+\.\s+/, ''));
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushList();
      html.push(`<blockquote><p>${formatInlineMarkdown(trimmed.replace(/^>\s?/, ''))}</p></blockquote>`);
      continue;
    }

    flushList();
    html.push(`<p>${formatInlineMarkdown(trimmed)}</p>`);
  }

  flushList();
  return html.join('');
};

const markdownInlineFromNode = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u00a0/g, ' ');
  if (!(node instanceof HTMLElement)) return '';

  const content = Array.from(node.childNodes, markdownInlineFromNode).join('');
  switch (node.tagName) {
    case 'BR': return '\n';
    case 'STRONG':
    case 'B': return `**${content}**`;
    case 'EM':
    case 'I': return `*${content}*`;
    case 'CODE': return `\`${content}\``;
    case 'DEL': return `~~${content}~~`;
    case 'A': return `[${content}](${(node as HTMLAnchorElement).href})`;
    default: return content;
  }
};

const markdownFromEditor = (editor: HTMLElement) => {
  const blocks = Array.from(editor.children);
  if (blocks.length === 0) return markdownInlineFromNode(editor).trim();

  return blocks.map((block) => {
    const content = Array.from(block.childNodes, markdownInlineFromNode).join('').trimEnd();
    switch (block.tagName) {
      case 'H1': return `# ${content}`;
      case 'H2': return `## ${content}`;
      case 'H3': return `### ${content}`;
      case 'UL': return Array.from(block.children).map((item) => `- ${markdownInlineFromNode(item).trim()}`).join('\n');
      case 'OL': return Array.from(block.children).map((item, index) => `${index + 1}. ${markdownInlineFromNode(item).trim()}`).join('\n');
      case 'BLOCKQUOTE': return markdownInlineFromNode(block).split('\n').map((line) => `> ${line}`).join('\n');
      case 'P':
      case 'DIV': return content;
      default: return markdownInlineFromNode(block).trimEnd();
    }
  }).join('\n');
};

const getEditorText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement) && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
  if (node instanceof HTMLElement && node.tagName === 'BR') return '\n';
  const children = Array.from(node.childNodes);
  if (node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')) {
    return children.map(getEditorText).join('\n');
  }
  return children.map(getEditorText).join('');
};

const restoreEditorCaret = (editor: HTMLElement, offset: number) => {
  const selection = window.getSelection();
  if (!selection) return;
  let remaining = offset;
  const placeWithin = (root: Node, localOffset: number) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (node) => node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && node.tagName === 'BR')
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP,
    });
    let node = walker.nextNode();
    let localRemaining = localOffset;
    let target: Node = root;
    let targetOffset = 0;
    while (node) {
      const isBreak = node instanceof HTMLElement && node.tagName === 'BR';
      const length = isBreak ? 1 : node.textContent?.length ?? 0;
      if (localRemaining <= length) {
        if (isBreak && node.parentNode) {
          target = node.parentNode;
          targetOffset = Array.prototype.indexOf.call(node.parentNode.childNodes, node) + (localRemaining > 0 ? 1 : 0);
        } else {
          target = node;
          targetOffset = localRemaining;
        }
        break;
      }
      localRemaining -= length;
      node = walker.nextNode();
    }
    if (node === null) {
      target = root;
      targetOffset = root.childNodes.length;
    }
    const range = document.createRange();
    const maxOffset = target.nodeType === Node.TEXT_NODE ? target.textContent?.length ?? 0 : target.childNodes.length;
    range.setStart(target, Math.min(targetOffset, maxOffset));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const blocks = Array.from(editor.children);
  if (!blocks.length) {
    placeWithin(editor, remaining);
    return;
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const length = getEditorText(block).length;
    if (remaining <= length) {
      placeWithin(block, remaining);
      return;
    }
    remaining -= length;
    if (index < blocks.length - 1) remaining -= 1;
  }
  placeWithin(blocks[blocks.length - 1], getEditorText(blocks[blocks.length - 1]).length);
};

export interface PanState {
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
  stackOriginalWidth?: number;
  stackOriginalHeight?: number;
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
  sourceUrl?: string;
  embedUrl?: string;
  fileKind?: 'social' | 'document';
  htmlContent?: string;
  imageRatio?: number;
  imageFrameInset?: number;
}

interface PageCanvasItem extends BaseCanvasItem {
  type: 'page';
  url: string;
  captureUrl?: string;
  captureWidth?: number;
  captureHeight?: number;
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
  color?: string;
}

export type CanvasItem = NoteCanvasItem | FileCanvasItem | PageCanvasItem | GroupCanvasItem | FolderCanvasItem;

export interface CanvasSnapshot {
  version: number;
  savedAt: string;
  pan: PanState;
  zoom: number;
  canvasBackground: string;
  canvasGridEnabled: boolean;
  items: CanvasItem[];
}

interface CanvasProps {
  canvasId: string;
  canvasTitle: string;
  onRenameCanvas: (title: string) => Promise<void>;
  initialSnapshot?: CanvasSnapshot;
  onSave: (snapshot: CanvasSnapshot) => Promise<void>;
}

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
const getUrlHost = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};
const getPageImageWidth = (item: PageCanvasItem) => item.width * (item.scale || 1);
const getPageImageHeight = (item: PageCanvasItem) => item.captureWidth && item.captureHeight
  ? getPageImageWidth(item) * item.captureHeight / item.captureWidth
  : Math.max(item.height, item.visibleHeight);
const isContainerItem = (item: CanvasItem) => item.type === 'group' || item.type === 'folder';

const getMimeType = (file: File) => {
  if (file.type) return file.type;
  const extension = file.name.toLowerCase().split('.').pop();
  const types: Record<string, string> = {
    pdf: 'application/pdf', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
    html: 'text/html', htm: 'text/html', json: 'application/json', xml: 'application/xml',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/x-m4v', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4',
  };
  return (extension && types[extension]) || 'application/octet-stream';
};

const extractDocxText = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  let endRecord = -1;
  for (let offset = Math.max(0, view.byteLength - 65_557); offset <= view.byteLength - 22; offset += 1) {
    if (view.getUint32(offset, true) === 0x06054b50) endRecord = offset;
  }
  if (endRecord < 0) return '';
  const entries = view.getUint16(endRecord + 10, true);
  let cursor = view.getUint32(endRecord + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entries && cursor + 46 <= view.byteLength; index += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, cursor + 46, nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;
    if (name !== 'word/document.xml') continue;
    const dataOffset = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const compressed = new Uint8Array(buffer, dataOffset, compressedSize);
    let bytes: Uint8Array;
    if (method === 0) bytes = compressed;
    else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else return '';
    const xml = new DOMParser().parseFromString(decoder.decode(bytes), 'application/xml');
    return Array.from(xml.getElementsByTagName('w:p')).map((paragraph) =>
      Array.from(paragraph.getElementsByTagName('w:t')).map((node) => node.textContent ?? '').join(''),
    ).join('\n');
  }
  return '';
};
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

const getGroupStackChild = (item: CanvasItem): CanvasItem => {
  const originalWidth = item.stackOriginalWidth ?? item.width;
  const originalHeight = item.stackOriginalHeight ?? item.height;
  const scale = Math.min(1, 180 / originalWidth, 120 / originalHeight);
  return {
    ...item,
    width: originalWidth * scale,
    height: originalHeight * scale,
    stackOriginalWidth: scale < 1 ? originalWidth : undefined,
    stackOriginalHeight: scale < 1 ? originalHeight : undefined,
  };
};

const restoreGroupStackChild = (item: CanvasItem): CanvasItem => ({
  ...item,
  width: item.stackOriginalWidth ?? item.width,
  height: item.stackOriginalHeight ?? item.height,
  stackOriginalWidth: undefined,
  stackOriginalHeight: undefined,
});

const getFolderChildPosition = (
  folder: FolderCanvasItem,
  index: number,
  childCount: number,
  expanded = folder.expanded,
) => {
  const columns = childCount >= 4 ? 4 : 3;
  const row = Math.floor(index / columns);
  const column = index % columns;
  const itemsInRow = Math.min(columns, childCount - row * columns);

  return {
    x: folder.x + folder.width / 2 - 75 + (column - (itemsInRow - 1) / 2) * 166,
    y: expanded ? folder.y - 124 - row * 116 : folder.y + folder.height / 2 - 48,
  };
};

const repositionContainerChildren = (items: CanvasItem[]) => {
  const positions = new Map<string, { x: number; y: number }>();
  const childUpdates = new Map<string, CanvasItem>();

  items.forEach((container) => {
    if (!isContainerItem(container)) {
      return;
    }

    const children = items.filter((item) => container.childIds.includes(item.id));
    const groupChildren = container.type === 'group'
      ? container.expanded ? children.map(restoreGroupStackChild) : children.map(getGroupStackChild)
      : children;
    const childPositions =
      container.type === 'folder'
        ? new Map(
            groupChildren.map((child, index) => [
              child.id,
              getFolderChildPosition(container, index, groupChildren.length),
            ]),
          )
        : container.expanded
          ? getGroupExpandedPositions(container, groupChildren)
          : getGroupCollapsedPositions(container, groupChildren);

    childPositions.forEach((position, childId) => positions.set(childId, position));
    groupChildren.forEach((child) => {
      childUpdates.set(child.id, child);
    });
  });

  return items.map((item) => {
    const position = positions.get(item.id);
    const childUpdate = childUpdates.get(item.id);
    return position ? { ...item, ...(childUpdate ?? {}), ...position } : item;
  });
};

const makeId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const Canvas = ({ canvasId, canvasTitle, onRenameCanvas, initialSnapshot, onSave }: CanvasProps) => {
  const [pan, setPan] = useState<PanState>(initialSnapshot?.pan ?? { x: 0, y: 0 });
  const [zoom, setZoom] = useState(initialSnapshot?.zoom ?? 1);
  const [isDragging, setIsDragging] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [items, setItems] = useState<CanvasItem[]>(initialSnapshot?.items ?? []);
  const historyRef = useRef({
    past: [] as CanvasItem[][],
    future: [] as CanvasItem[][],
    stableItems: initialSnapshot?.items ?? [],
    timer: null as number | null,
    restoring: false,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fullscreenNoteId, setFullscreenNoteId] = useState<string | null>(null);
  const [fullscreenNoteClosing, setFullscreenNoteClosing] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [pageDrafts, setPageDrafts] = useState<Record<string, string>>({});
  const [pageLoadingIds, setPageLoadingIds] = useState<Record<string, boolean>>({});
  const [pageCaptureErrors, setPageCaptureErrors] = useState<Record<string, string>>({});
  const [canvasSettingsOpen, setCanvasSettingsOpen] = useState(false);
  const [canvasTitleDraft, setCanvasTitleDraft] = useState(canvasTitle);
  const [canvasSettingsPosition, setCanvasSettingsPosition] = useState({ left: 80, top: 76 });
  const [fileSettingsOpen, setFileSettingsOpen] = useState(false);
  const [layerBarOpen, setLayerBarOpen] = useState(false);
  const [canvasBackground, setCanvasBackground] = useState(initialSnapshot?.canvasBackground ?? '#ffffff');
  const [canvasGridEnabled, setCanvasGridEnabled] = useState(initialSnapshot?.canvasGridEnabled ?? false);
  const dragStartRef = useRef<DragInteraction | null>(null);
  const fullscreenNoteEditorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectInputRef = useRef<HTMLInputElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  const centerAnimationRef = useRef<number | null>(null);
  const hasMovedItemRef = useRef(false);
  const pageCaptureAttemptedUrlsRef = useRef(new Map<string, string>());
  const containerAnimationLockRef = useRef(false);

  const publishHistoryState = (canUndo: boolean, canRedo: boolean) => {
    window.dispatchEvent(new CustomEvent('canvas-history-state', { detail: { canUndo, canRedo } }));
  };

  const undoCanvas = () => {
    const history = historyRef.current;
    if (history.timer !== null) {
      window.clearTimeout(history.timer);
      history.timer = null;
    }

    const hasPendingChange = history.stableItems !== items;
    const previousItems = hasPendingChange ? history.stableItems : history.past.pop();
    if (!previousItems) return;

    history.future.push(items);
    history.stableItems = previousItems;
    history.restoring = true;
    setItems(previousItems);
    publishHistoryState(history.past.length > 0, true);
  };

  const redoCanvas = () => {
    const history = historyRef.current;
    const nextItems = history.future.pop();
    if (!nextItems) return;

    if (history.timer !== null) {
      window.clearTimeout(history.timer);
      history.timer = null;
    }
    history.past.push(items);
    history.stableItems = nextItems;
    history.restoring = true;
    setItems(nextItems);
    publishHistoryState(true, history.future.length > 0);
  };

  useEffect(() => {
    const history = historyRef.current;
    if (history.restoring) {
      history.restoring = false;
      history.stableItems = items;
      publishHistoryState(history.past.length > 0, history.future.length > 0);
      return;
    }
    if (history.stableItems === items) return;

    if (history.timer !== null) window.clearTimeout(history.timer);
    history.future = [];
    publishHistoryState(true, false);
    history.timer = window.setTimeout(() => {
      if (history.stableItems !== items) {
        history.past.push(history.stableItems);
        if (history.past.length > 100) history.past.shift();
        history.stableItems = items;
      }
      history.timer = null;
      publishHistoryState(history.past.length > 0, history.future.length > 0);
    }, 400);
  }, [items]);

  useEffect(() => () => {
    if (historyRef.current.timer !== null) window.clearTimeout(historyRef.current.timer);
  }, []);

  useEffect(() => {
    const handleUndo = () => undoCanvas();
    const handleRedo = () => redoCanvas();
    window.addEventListener('canvas-undo', handleUndo);
    window.addEventListener('canvas-redo', handleRedo);
    return () => {
      window.removeEventListener('canvas-undo', handleUndo);
      window.removeEventListener('canvas-redo', handleRedo);
    };
  }, [items]);

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });

  const createCanvasSnapshot = (overrides: Partial<CanvasSnapshot> = {}): CanvasSnapshot => ({
    version: 1,
    savedAt: new Date().toISOString(),
    pan: panRef.current,
    zoom: zoomRef.current,
    canvasBackground,
    canvasGridEnabled,
    items,
    ...overrides,
  });

  const saveCanvasProject = () => {
    void onSave(createCanvasSnapshot()).catch((error: unknown) => {
      console.error('No se pudo guardar el canvas:', error);
      window.alert('No se pudo guardar el canvas en este dispositivo.');
    });
  };

  const exportCanvasProject = () => {
    const snapshot = createCanvasSnapshot();
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

  const commitCanvasTitle = async () => {
    const title = canvasTitleDraft.trim();
    if (!title) {
      setCanvasTitleDraft(canvasTitle);
      return;
    }
    if (title === canvasTitle) return;
    try {
      await onRenameCanvas(title);
    } catch (error) {
      console.error('No se pudo cambiar el nombre del canvas:', error);
      setCanvasTitleDraft(canvasTitle);
    }
  };

  const setCanvasMode = async (mode: 'light' | 'dark') => {
    const nextBackground = mode === 'light' ? '#ffffff' : '#202124';
    if (canvasBackground.toLowerCase() === nextBackground) return;
    setCanvasBackground(nextBackground);
    try {
      await onSave(createCanvasSnapshot({ canvasBackground: nextBackground }));
    } catch (error) {
      console.error('No se pudo cambiar el fondo del canvas:', error);
      window.alert('No se pudo guardar el fondo del canvas.');
    }
  };

  const showCanvasFileInExplorer = async () => {
    try {
      const path = await invoke<string>('reveal_canvas_file', {
        id: canvasId,
        contents: JSON.stringify(createCanvasSnapshot(), null, 2),
      });
      await revealItemInDir(path);
    } catch (error) {
      console.error('No se pudo mostrar la copia local:', error);
      window.alert('No se pudo abrir la copia local en el explorador.');
    }
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
    if (!fullscreenNoteId || !fullscreenNoteEditorRef.current) return;
    const note = items.find((item): item is NoteCanvasItem => item.id === fullscreenNoteId && item.type === 'note');
    if (!note) return;
    fullscreenNoteEditorRef.current.innerHTML = renderMarkdownText(note.text);
    fullscreenNoteEditorRef.current.focus();
    restoreEditorCaret(fullscreenNoteEditorRef.current, 0);
  }, [fullscreenNoteId]);

  useEffect(() => {
    if (!renamingFolderId) return;
    const confirmOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && target instanceof HTMLElement && target.closest('.folder-title-input')) return;
      setRenamingFolderId((current) => current === renamingFolderId ? null : current);
    };
    window.addEventListener('pointerdown', confirmOnOutsidePointer, true);
    return () => window.removeEventListener('pointerdown', confirmOnOutsidePointer, true);
  }, [renamingFolderId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isEditingText =
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const isModifierPressed = event.ctrlKey || event.metaKey;

      if (event.key === 'Escape' && fullscreenNoteId) {
        setFullscreenNoteClosing(true);
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveCanvasProject();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        projectInputRef.current?.click();
        return;
      }

      if (isEditingText) {
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoCanvas();
        else undoCanvas();
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoCanvas();
        return;
      }

      if (!isModifierPressed && event.key.toLowerCase() === 'l') {
        setLayerBarOpen((current) => !current);
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        setIsSpacePressed(true);
      }

      if (isModifierPressed && event.key.toLowerCase() === 'i') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent(event.shiftKey ? 'canvas-open-page-import' : 'canvas-open-file-import'));
        return;
      }

      if (isModifierPressed && event.key.toLowerCase() === 'g') {
        event.preventDefault();
        createGroupFromSelection();
        return;
      }

      if (isModifierPressed && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('canvas-center-view'));
        return;
      }

      if (!isModifierPressed && event.key.toLowerCase() === 'n') {
        window.dispatchEvent(new CustomEvent('canvas-create-note'));
        return;
      }

      if (!isModifierPressed && event.key.toLowerCase() === 'f') {
        window.dispatchEvent(new CustomEvent('canvas-create-folder'));
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedIds.length > 0) {
        const idsToDelete = [...selectedIds];
        setItems((current) => current.filter((item) => !idsToDelete.includes(item.id)));
        updateSelection([]);
        setEditingId(null);
      }

      if (event.key === 'Escape') {
        if (fullscreenNoteId) setFullscreenNoteClosing(true);
        setCanvasSettingsOpen(false);
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

    const createNoteAt = (x: number, y: number) => {
      const newItem: NoteCanvasItem = {
        id: makeId(),
        type: 'note',
        x,
        y,
        width: 220,
        height: 150,
        title: '',
        text: '',
      };

      setItems((current) => [...current, newItem]);
      updateSelection([newItem.id]);
      setEditingId(newItem.id);
    };

    const createNote = (event?: Event) => {
      const detail = (event as CustomEvent<{ x?: number; y?: number }> | undefined)?.detail;
      const center = getViewportCenterPosition(220, 150);
      createNoteAt(detail?.x ?? center.x, detail?.y ?? center.y);
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

    const openCanvasSettings = (event: Event) => {
      const detail = (event as CustomEvent<{ left: number; bottom: number }>).detail;
      if (detail) {
        setCanvasSettingsPosition({
          left: Math.max(12, Math.min(detail.left, window.innerWidth - 452)),
          top: detail.bottom + 8,
        });
      }
      setCanvasTitleDraft(canvasTitle);
      setCanvasSettingsOpen((open) => !open);
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

      const bounds = allVisibleItems.length > 0 ? allVisibleItems.reduce(
        (acc, item) => ({
          minX: Math.min(acc.minX, item.x),
          minY: Math.min(acc.minY, item.y),
          maxX: Math.max(acc.maxX, item.x + item.width),
          maxY: Math.max(acc.maxY, item.y + item.height),
        }),
        { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
      ) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };

      const shellRect = viewport.getBoundingClientRect();
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const contentWidth = bounds.maxX - bounds.minX;
      const contentHeight = bounds.maxY - bounds.minY;
      const fitZoom = allVisibleItems.length > 0
        ? clamp(Math.min((shellRect.width - 96) / Math.max(contentWidth, 1), (shellRect.height - 96) / Math.max(contentHeight, 1)), MIN_ZOOM, MAX_ZOOM)
        : 1;
      const nextPanX = shellRect.width / 2 - centerX * fitZoom;
      const nextPanY = shellRect.height / 2 - centerY * fitZoom;
      const startZoom = zoomRef.current;
      const startX = panRef.current.x;
      const startY = panRef.current.y;
      const startTime = performance.now();
      const duration = 650;

      const tick = (time: number) => {
        const progress = Math.min((time - startTime) / duration, 1);
        const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
        const x = startX + (nextPanX - startX) * eased;
        const y = startY + (nextPanY - startY) * eased;
        const nextZoom = startZoom + (fitZoom - startZoom) * eased;

        panRef.current = { x, y };
        zoomRef.current = nextZoom;
        setPan({ x, y });
        setZoom(nextZoom);

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
  }, [canvasBackground, canvasGridEnabled, canvasTitle, fullscreenNoteId, initialSnapshot, items, onSave, selectedId, selectedIds]);

  useEffect(() => {
    if (!canvasSettingsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.canvas-settings-popover, .top-bar-settings-btn')) return;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLInputElement && activeElement.classList.contains('canvas-settings-title-input')) {
        activeElement.blur();
      }
      setCanvasSettingsOpen(false);
    };
    window.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => window.removeEventListener('pointerdown', closeOnOutsidePointer, true);
  }, [canvasSettingsOpen]);

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

  const reorderLayers = (draggedId: string, targetId: string, placement: 'before' | 'after' = 'before') => {
    setItems((current) => {
      const topToBottom = [...current].reverse();
      const draggedIndex = topToBottom.findIndex((item) => item.id === draggedId);
      const targetIndex = topToBottom.findIndex((item) => item.id === targetId);

      if (draggedIndex === -1 || targetIndex === -1 || draggedId === targetId) {
        return current;
      }

      const [draggedItem] = topToBottom.splice(draggedIndex, 1);
      // Layer rows are displayed top to bottom, so placement follows that order.
      const adjustedTargetIndex = topToBottom.findIndex((item) => item.id === targetId);
      const insertIndex = adjustedTargetIndex + (placement === 'after' ? 1 : 0);
      topToBottom.splice(insertIndex, 0, draggedItem);
      return topToBottom.reverse();
    });
  };

  const moveSelectedLayer = (direction: 'up' | 'down') => {
    if (selectedIds.length !== 1) {
      return;
    }

    setItems((current) => {
      const topToBottom = [...current].reverse();
      const selectedIndex = topToBottom.findIndex((item) => item.id === selectedIds[0]);
      const targetIndex = selectedIndex + (direction === 'up' ? -1 : 1);

      if (selectedIndex === -1 || targetIndex < 0 || targetIndex >= topToBottom.length) {
        return current;
      }

      [topToBottom[selectedIndex], topToBottom[targetIndex]] = [
        topToBottom[targetIndex],
        topToBottom[selectedIndex],
      ];
      return topToBottom.reverse();
    });
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
      title: 'Nueva carpeta',
      childIds: [],
      expanded: false,
      color: DEFAULT_FOLDER_COLOR,
    };

    setItems((current) => [...current, newItem]);
    updateSelection([newItem.id]);
    setRenamingFolderId(newItem.id);
  };

  const createGroupFromSelection = () => {
    if (selectedIds.length === 1) {
      const selectedGroup = items.find((item): item is GroupCanvasItem => item.id === selectedIds[0] && item.type === 'group');
      if (selectedGroup) {
        toggleGroup(selectedGroup.id);
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
    const compactChildren = sorted.map(getGroupStackChild);
    const compactPositions = getGroupCollapsedPositions(compactGroup, compactChildren);

    setItems((current) => {
      const survivors = current.filter((item) => !selectedIds.includes(item.id) || isContainerItem(item));

      const stacked = compactChildren.map((item) => ({
        ...item,
        ...compactPositions.get(item.id),
      }));

      return [...survivors, ...stacked, compactGroup];
    });

    updateSelection([groupId]);
  };

  const toggleGroup = (groupId: string) => {
    toggleContainer(groupId);
  };

  const getCanvasItemElements = (): Map<string, HTMLElement> => {
    const elements = new Map<string, HTMLElement>();
    viewportRef.current?.querySelectorAll<HTMLElement>('.canvas-item[data-item-id]').forEach((element) => {
      const id = element.dataset.itemId;
      if (id) elements.set(id, element);
    });
    return elements;
  };

  const getCanvasItemRects = (): Map<string, DOMRect> => {
    const rects = new Map<string, DOMRect>();
    getCanvasItemElements().forEach((element, id) => rects.set(id, element.getBoundingClientRect()));
    return rects;
  };

  const animateBetweenRects = (
    element: HTMLElement,
    from: DOMRect,
    to: DOMRect,
    opacity: [number, number] = [1, 1],
    delay = 0,
    coordinateScale = 1,
  ) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || to.width <= 0 || to.height <= 0) {
      return Promise.resolve();
    }
    element.getAnimations().forEach((animation) => animation.cancel());
    const scale = Math.max(0.01, coordinateScale);
    const transform = `translate(${(from.left - to.left) / scale}px, ${(from.top - to.top) / scale}px) scale(${from.width / to.width}, ${from.height / to.height})`;
    const animation = element.animate(
      [
        { transformOrigin: 'top left', transform, opacity: opacity[0] },
        { transformOrigin: 'top left', transform: 'none', opacity: opacity[1] },
      ],
      { duration: 360, delay, easing: 'cubic-bezier(.2, .75, .25, 1)', fill: 'both' },
    );
    return animation.finished.then(() => animation.cancel()).catch(() => undefined);
  };

  const animateLayoutChange = (previousRects: Map<string, DOMRect>, coordinateScale = 1) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return Promise.resolve();
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        const elements = getCanvasItemElements();
        const currentRects = getCanvasItemRects();
        const animations: Promise<void>[] = [];
        previousRects.forEach((previous, id) => {
          const element = elements.get(id);
          const current = currentRects.get(id);
          if (!element || !current) return;
          if (Math.abs(previous.left - current.left) < 1 && Math.abs(previous.top - current.top) < 1 &&
              Math.abs(previous.width - current.width) < 1 && Math.abs(previous.height - current.height) < 1) return;
          animations.push(animateBetweenRects(element, previous, current, [1, 1], 0, coordinateScale));
        });
        void Promise.all(animations).then(() => resolve());
      });
    });
  };

  const getFolderStackRect = (folder: FolderCanvasItem, index: number) => {
    const element = getCanvasItemElements().get(folder.id);
    const bounds = element?.getBoundingClientRect();
    if (!bounds) return null;
    const width = bounds.width * 0.42;
    const height = bounds.height * 0.3;
    const offset = Math.min(index, 5) * 2;
    return new DOMRect(
      bounds.left + (bounds.width - width) / 2 + offset,
      bounds.top + bounds.height * 0.34 + offset,
      width,
      height,
    );
  };

  const settleFolderChildren = (folder: FolderCanvasItem) => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const elements = getCanvasItemElements();
      folder.childIds.forEach((id) => elements.get(id)?.getAnimations().forEach((animation) => animation.cancel()));
      resolve();
    });
  });

  const animateFolderChildren = async (folder: FolderCanvasItem, opening: boolean) => {
    const elements = getCanvasItemElements();
    const folderElement = elements.get(folder.id);
    const folderBounds = folderElement?.getBoundingClientRect();
    if (!folderBounds) return;
    const children = folder.childIds
      .map((id, index) => ({ element: elements.get(id), stack: getFolderStackRect(folder, index), index }))
      .filter((entry): entry is { element: HTMLElement; stack: DOMRect; index: number } => Boolean(entry.element && entry.stack));

    if (opening) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const destinationElements = getCanvasItemElements();
      const animations = children.flatMap(({ index, stack }) => {
        const element = destinationElements.get(folder.childIds[index]);
        const destination = element?.getBoundingClientRect();
        return element && destination ? [animateBetweenRects(element, stack, destination, [0.45, 1], index * 24, zoom)] : [];
      });
      await Promise.all(animations);
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const animations = children.map(({ element, stack, index }) => {
      const current = element.getBoundingClientRect();
      if (current.width <= 0 || current.height <= 0) return null;
      const coordinateScale = Math.max(0.01, zoom);
      const transform = `translate(${(stack.left - current.left) / coordinateScale}px, ${(stack.top - current.top) / coordinateScale}px) scale(${stack.width / current.width}, ${stack.height / current.height})`;
      return element.animate(
        [
          { transformOrigin: 'top left', transform: 'none', opacity: 1 },
          { transformOrigin: 'top left', transform, opacity: 0.4 },
        ],
        { duration: 360, delay: index * 18, easing: 'cubic-bezier(.2, .75, .25, 1)', fill: 'both' },
      );
    }).filter((animation): animation is Animation => animation !== null);
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
  };

  const collapseAllGroups = () => {
    if (containerAnimationLockRef.current) return;
    const expandedFolders = items.filter((item): item is FolderCanvasItem => item.type === 'folder' && item.expanded);
    const expandedContainers = items.some((item) => (item.type === 'group' || item.type === 'folder') && item.expanded);
    if (!expandedContainers) return;

    containerAnimationLockRef.current = true;
    void (async () => {
      try {
        const previousRects = getCanvasItemRects();
        await Promise.all(expandedFolders.map((folder) => animateFolderChildren(folder, false)));
        setItems((current) => repositionContainerChildren(current.map((item) =>
          (item.type === 'group' || item.type === 'folder') && item.expanded ? { ...item, expanded: false } : item,
        )));
        await Promise.all([
          animateLayoutChange(previousRects, zoom),
          ...expandedFolders.map(settleFolderChildren),
        ]);
      } finally {
        containerAnimationLockRef.current = false;
      }
    })();
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

  const importFiles = async (selectedFiles: File[], position?: { x: number; y: number }) => {
    const imported: CanvasItem[] = [];
    for (const file of selectedFiles) {
      const mimeType = getMimeType(file);
      const extension = file.name.toLowerCase().split('.').pop() ?? '';
      const isImage = mimeType.startsWith('image/');
      const isMedia = mimeType.startsWith('video/') || mimeType.startsWith('audio/');
      const isPdf = mimeType === 'application/pdf';
      const itemWidth = isImage ? 300 : isPdf ? 420 : isMedia ? 360 : 300;
      const itemHeight = isImage ? 220 : isPdf ? 540 : isMedia ? 230 : 210;
      const center = position ?? getViewportCenterPosition(itemWidth, itemHeight);
      const previewUrl = await readFileAsDataUrl(file);
      const newItem: FileCanvasItem = {
        id: makeId(), type: 'file', x: center.x, y: center.y, width: itemWidth, height: itemHeight,
        title: file.name, mimeType, fileName: file.name, previewUrl,
        sizeLabel: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      };

      if (mimeType.startsWith('text/') || ['md', 'markdown', 'json', 'xml', 'html', 'htm', 'csv', 'rtf'].includes(extension)) {
        const rawText = await file.text();
        if (extension === 'html' || extension === 'htm') newItem.htmlContent = rawText.slice(0, 200_000);
        else newItem.textContent = rawText.slice(0, 20_000);
      } else if (extension === 'docx') {
        newItem.fileKind = 'document';
        newItem.textContent = (await extractDocxText(file)).slice(0, 20_000);
      } else if (extension === 'doc') {
        newItem.fileKind = 'document';
      }
      imported.push(newItem);
    }
    if (imported.length) {
      setItems((current) => [...current, ...imported]);
      updateSelection([imported[imported.length - 1].id]);
    }
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await importFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleCanvasPaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) {
      for (const clipboardItem of Array.from(event.clipboardData.items)) {
        if (clipboardItem.kind === 'file') {
          const file = clipboardItem.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    if (files.length) {
      event.preventDefault();
      await importFiles(files);
      return;
    }

    const html = event.clipboardData.getData('text/html');
    const plainText = event.clipboardData.getData('text/plain').trim();
    const pastedUrl = plainText.match(/^https?:\/\/[^\s<>]+$/i)?.[0];
    if (pastedUrl) {
      event.preventDefault();
      let parsed: URL;
      try { parsed = new URL(pastedUrl); } catch { return; }
      const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
      const youtubeId = host === 'youtu.be' ? parsed.pathname.slice(1) :
        ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)
          ? parsed.searchParams.get('v') || parsed.pathname.match(/\/(?:shorts|embed|live)\/([^/?]+)/)?.[1]
          : null;
      const spotifyMatch = host === 'open.spotify.com' && parsed.pathname.match(/^\/(track|album|playlist|episode|show)\/([^/?]+)/);
      const vimeoId = host === 'vimeo.com' ? parsed.pathname.match(/^\/(\d+)/)?.[1] : null;
      const statusId = (host === 'x.com' || host === 'twitter.com') ? parsed.pathname.match(/\/status\/(\d+)/)?.[1] : null;
      const tiktokId = host.endsWith('tiktok.com') ? parsed.pathname.match(/\/video\/(\d+)/)?.[1] : null;
      const instagramId = (host === 'instagram.com' || host === 'instagr.am') ? parsed.pathname.match(/\/(?:p|reel|tv)\/([^/?]+)/)?.[1] : null;
      const embedUrl = youtubeId
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}`
        : spotifyMatch
          ? `https://open.spotify.com/embed/${spotifyMatch[1]}/${spotifyMatch[2]}`
          : vimeoId
            ? `https://player.vimeo.com/video/${vimeoId}`
            : statusId
              ? `https://platform.twitter.com/embed/Tweet.html?id=${statusId}&theme=light`
            : tiktokId
              ? `https://www.tiktok.com/player/v1/${tiktokId}`
              : instagramId
                ? `https://www.instagram.com/p/${instagramId}/embed/`
              : undefined;
      const isAudioEmbed = Boolean(spotifyMatch);
      const center = getViewportCenterPosition(youtubeId || vimeoId ? 420 : 360, youtubeId || vimeoId ? 260 : isAudioEmbed ? 210 : 220);
      if (youtubeId) {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 420, height: 260, title: 'YouTube',
          fileName: 'YouTube', mimeType: 'video/x-embedded', previewUrl: pastedUrl,
          embedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      if (spotifyMatch || vimeoId || tiktokId || instagramId) {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 360, height: isAudioEmbed ? 210 : 260,
          title: isAudioEmbed ? 'Spotify' : instagramId ? 'Instagram' : tiktokId ? 'TikTok' : 'Vimeo',
          fileName: isAudioEmbed ? 'Spotify' : instagramId ? 'Instagram' : tiktokId ? 'TikTok' : 'Vimeo',
          mimeType: isAudioEmbed ? 'audio/x-embedded' : 'video/x-embedded', previewUrl: pastedUrl, embedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      if (host === 'x.com' || host === 'twitter.com') {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 360, height: 180, title: 'Publicación de X',
          fileName: 'Publicación de X', mimeType: 'application/x-social-post', previewUrl: pastedUrl,
          sourceUrl: pastedUrl, fileKind: 'social', embedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      if (/\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(parsed.pathname + parsed.search)) {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 300, height: 220, title: 'Imagen', fileName: 'Imagen',
          mimeType: 'image/*', previewUrl: pastedUrl, sourceUrl: pastedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(parsed.pathname + parsed.search)) {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 360, height: 230, title: 'Vídeo', fileName: 'Vídeo',
          mimeType: 'video/mp4', previewUrl: pastedUrl, sourceUrl: pastedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      if (/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i.test(parsed.pathname + parsed.search)) {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 360, height: 150, title: 'Audio', fileName: 'Audio',
          mimeType: 'audio/mpeg', previewUrl: pastedUrl, sourceUrl: pastedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      if (/\.pdf(\?.*)?$/i.test(parsed.pathname + parsed.search)) {
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...center, width: 420, height: 540, title: parsed.hostname, fileName: 'Documento PDF',
          mimeType: 'application/pdf', previewUrl: pastedUrl, sourceUrl: pastedUrl,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      const item: PageCanvasItem = {
        id: makeId(), type: 'page', ...getViewportCenterPosition(520, DEFAULT_PAGE_HEIGHT), width: 520,
        height: DEFAULT_PAGE_HEIGHT, title: getUrlHost(pastedUrl), url: pastedUrl, scale: 1, visibleHeight: DEFAULT_PAGE_HEIGHT,
      };
      setItems((current) => [...current, item]); updateSelection([item.id]); return;
    }

    if (html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const image = doc.querySelector('img[src]');
      const src = image?.getAttribute('src');
      if (src && (src.startsWith('data:image/') || /^https?:\/\//i.test(src))) {
        event.preventDefault();
        const item: FileCanvasItem = {
          id: makeId(), type: 'file', ...getViewportCenterPosition(300, 220), width: 300, height: 220,
          title: image?.getAttribute('alt') || 'Imagen pegada', fileName: image?.getAttribute('alt') || 'Imagen pegada',
          mimeType: src.startsWith('data:image/') ? src.slice(5, src.indexOf(';')) : 'image/*', previewUrl: src,
        };
        setItems((current) => [...current, item]); updateSelection([item.id]); return;
      }
      const text = (doc.body.innerText || '').trim();
      if (text && !plainText) {
        event.preventDefault();
        createPastedTextNote(text);
      }
      return;
    }
    if (plainText) {
      event.preventDefault();
      createPastedTextNote(plainText);
    }
  };

  const createPastedTextNote = (text: string) => {
    const position = getViewportCenterPosition(320, 220);
    const note: NoteCanvasItem = { id: makeId(), type: 'note', ...position, width: 320, height: 220, title: '', text };
    setItems((current) => [...current, note]); updateSelection([note.id]);
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
    if (target.closest('a, button, textarea, input, select, iframe, video, audio, embed')) {
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
      originWidth: getPageImageWidth(item),
      originHeight: item.height,
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
          const nextWidth = clamp(baseWidth + dx / zoom, 220, 980);

          updateItem(dragStartRef.current.id, (item) => {
            if (item.type !== 'page') {
              return item;
            }

            return {
              ...item,
              width: nextWidth,
              scale: 1,
              ...(item.captureWidth && item.captureHeight
                ? (() => {
                    const maxHeight = nextWidth * item.captureHeight / item.captureWidth;
                    const visibleHeight = Math.min(item.visibleHeight || item.height, maxHeight);
                    return { height: visibleHeight, visibleHeight };
                  })()
                : {}),
            };
          });
          return;
        }

        const maxHeight = Math.max(getPageImageHeight(draggedItem), 1);
        const minHeight = Math.min(120, maxHeight);
        const nextVisibleHeight = clamp(
          (dragStartRef.current.originViewportHeight ?? draggedItem.visibleHeight) + dy / zoom,
          minHeight,
          maxHeight,
        );

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
          const ratio = item.type === 'file' && item.mimeType.startsWith('image/') && item.imageRatio
            ? item.imageRatio
            : (dragStartRef.current?.originWidth ?? item.width) / (dragStartRef.current?.originHeight ?? item.height);
          const adjustedWidth = nextWidth;
          const adjustedHeight = item.type === 'file' && item.mimeType.startsWith('image/') && item.imageRatio
            ? (adjustedWidth - 12) / ratio + 12
            : adjustedWidth / ratio;

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
    const wheelDelta = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * rect.height
        : event.deltaY;
    const nextZoom = clamp(zoomBefore * Math.exp(-wheelDelta * 0.0015), MIN_ZOOM, MAX_ZOOM);

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
    const base64 = (await invoke<string>('capture_page', { url })).trim();
    if (!base64) {
      throw new Error('El capturador devolvió una imagen vacía.');
    }

    return `data:image/jpeg;base64,${base64}`;
  };

  const handlePageCommit = async (id: string, draft?: string) => {
    const rawValue = (draft ?? pageDrafts[id] ?? '').trim();
    if (!rawValue) {
      return;
    }

    const normalized = /^https?:\/\//i.test(rawValue) ? rawValue : `https://${rawValue}`;
    pageCaptureAttemptedUrlsRef.current.set(id, normalized);
    setPageLoadingIds((current) => ({ ...current, [id]: true }));
    setPageCaptureErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });

    try {
      let captureUrl: string | null = null;
      let captureError = '';

      try {
        captureUrl = await capturePageImage(normalized);
      } catch (error) {
        captureError = error instanceof Error ? error.message : String(error);
        console.error('No se pudo generar la captura local de la página:', error);
      }

      updateItem(id, (item) => {
        const samePage = item.type === 'page' && item.url === normalized;
        return {
          ...item,
          type: 'page',
          url: normalized,
          title: 'Página web',
          captureUrl: captureUrl ?? (samePage ? item.captureUrl : undefined),
          captureWidth: samePage && item.type === 'page' ? item.captureWidth : undefined,
          captureHeight: samePage && item.type === 'page' ? item.captureHeight : undefined,
          scale: samePage && item.type === 'page' ? item.scale || 1 : 1,
          visibleHeight: samePage && item.type === 'page' ? item.visibleHeight || item.height : item.height,
        };
      });

      if (captureError) {
        setPageCaptureErrors((current) => ({ ...current, [id]: captureError.slice(0, 240) }));
      }
    } finally {
      setPageLoadingIds((current) => ({ ...current, [id]: false }));
    }
  };

  useEffect(() => {
    items.forEach((item) => {
      if (item.type !== 'page' || !item.url || item.captureUrl || pageLoadingIds[item.id]) {
        return;
      }

      if (pageCaptureAttemptedUrlsRef.current.get(item.id) === item.url) {
        return;
      }

      pageCaptureAttemptedUrlsRef.current.set(item.id, item.url);
      void handlePageCommit(item.id, item.url);
    });
  }, [handlePageCommit, items, pageLoadingIds]);
  const toggleContainer = (id: string) => {
    if (containerAnimationLockRef.current) return;
    const container = items.find(
      (item): item is GroupCanvasItem | FolderCanvasItem =>
        item.id === id && (item.type === 'group' || item.type === 'folder'),
    );
    if (!container) return;

    containerAnimationLockRef.current = true;
    void (async () => {
      try {
        if (container.type === 'folder') {
          if (container.expanded) {
            await animateFolderChildren(container, false);
            setItems((current) => repositionContainerChildren(current.map((item) =>
              item.id === id && item.type === 'folder' ? { ...item, expanded: false } : item,
            )));
            await settleFolderChildren(container);
          } else {
            const otherOpenFolders = items.filter(
              (item): item is FolderCanvasItem => item.type === 'folder' && item.expanded && item.id !== id,
            );
            await Promise.all(otherOpenFolders.map((folder) => animateFolderChildren(folder, false)));
            setItems((current) => repositionContainerChildren(current.map((item) => {
              if (item.type !== 'folder') return item;
              if (item.id === id) return { ...item, expanded: true };
              return item.expanded ? { ...item, expanded: false } : item;
            })));
            await Promise.all(otherOpenFolders.map(settleFolderChildren));
            await animateFolderChildren({ ...container, expanded: true }, true);
          }
        } else {
          const previousRects = getCanvasItemRects();
          setItems((current) => repositionContainerChildren(current.map((item) =>
            item.id === id && item.type === 'group' ? { ...item, expanded: !item.expanded } : item,
          )));
          await animateLayoutChange(previousRects, zoom);
        }
      } finally {
        containerAnimationLockRef.current = false;
      }
    })();
  };

  const renderFolderLabel = (item: FolderCanvasItem) => {
    const itemCount = items.filter((entry) => item.childIds.includes(entry.id)).length;

    return (
      <div
        className="folder-label"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          updateSelection([item.id]);
          setRenamingFolderId(item.id);
        }}
      >
        <small>{itemCount} {itemCount === 1 ? 'elemento' : 'elementos'}</small>
        {renamingFolderId === item.id ? (
          <input
            className="folder-title-input"
            aria-label="Título de la carpeta"
            value={item.title}
            placeholder="Título de la carpeta"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => updateItem(item.id, (current) => current.type === 'folder' ? { ...current, title: event.target.value } : current)}
            onBlur={() => setRenamingFolderId((current) => current === item.id ? null : current)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenamingFolderId(null);
            }}
          />
        ) : (
          <strong>{item.title || 'Carpeta'}</strong>
        )}
      </div>
    );
  };

  const renderFolderSummary = (item: FolderCanvasItem) => {

    return (
      <div className="folder-compact">
        <div className="folder-layer folder-layer-back" style={{ color: item.color ?? DEFAULT_FOLDER_COLOR }} dangerouslySetInnerHTML={{ __html: folderBackSvg }} />
        <div className="folder-layer folder-layer-front" style={{ color: item.color ?? DEFAULT_FOLDER_COLOR }} dangerouslySetInnerHTML={{ __html: folderFrontSvg }} />
        {renderFolderLabel(item)}
      </div>
    );
  };

  const renderFolderExpanded = (item: FolderCanvasItem) => {
    return (
      <div className="folder-scene">
        <div className="folder-layer folder-layer-back" style={{ color: item.color ?? DEFAULT_FOLDER_COLOR }} dangerouslySetInnerHTML={{ __html: folderBackSvg }} />
        <div className="folder-layer folder-layer-front" style={{ color: item.color ?? DEFAULT_FOLDER_COLOR }} dangerouslySetInnerHTML={{ __html: folderFrontSvg }} />
        {renderFolderLabel(item)}
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
      if (item.fileKind === 'social' && item.sourceUrl && !item.embedUrl) {
        return (
          <a className="canvas-social-card" href={item.sourceUrl} target="_blank" rel="noreferrer">
            <span className="canvas-social-mark">𝕏</span>
            <span><strong>Publicación de X</strong><small>{item.sourceUrl}</small></span>
          </a>
        );
      }

      if (item.embedUrl) {
        return <iframe title={item.title} src={item.embedUrl} className="canvas-media canvas-embed-frame" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen />;
      }

      if (item.mimeType.startsWith('image/')) {
        return (
          <div className="canvas-image-frame">
            <img
              src={item.previewUrl}
              alt={item.fileName}
              className="canvas-media canvas-media-image"
              onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (!naturalWidth || !naturalHeight || item.imageFrameInset === 12) return;
                const imageRatio = naturalWidth / naturalHeight;
                updateItem(item.id, (current) => {
                  if (current.type !== 'file' || !current.mimeType.startsWith('image/') || current.imageFrameInset === 12) return current;
                  const originalWidth = current.stackOriginalWidth ?? current.width;
                  const originalHeight = current.stackOriginalHeight ?? current.height;
                  const contentWidth = Math.min(Math.max(1, originalWidth - 12), Math.max(1, originalHeight - 12) * imageRatio);
                  const width = contentWidth + 12;
                  const height = contentWidth / imageRatio + 12;
                  const stackScale = current.stackOriginalWidth ? current.width / current.stackOriginalWidth : 1;
                  return {
                    ...current,
                    width: 12 + contentWidth * stackScale,
                    height: 12 + (height - 12) * stackScale,
                    stackOriginalWidth: current.stackOriginalWidth ? width : undefined,
                    stackOriginalHeight: current.stackOriginalHeight ? height : undefined,
                    imageRatio,
                    imageFrameInset: 12,
                  };
                });
              }}
            />
          </div>
        );
      }

      if (item.mimeType.startsWith('video/')) {
        return <video src={item.previewUrl} controls className="canvas-media" />;
      }

      if (item.mimeType.startsWith('audio/')) {
        return <audio src={item.previewUrl} controls className="canvas-media-audio" />;
      }

      if (item.htmlContent) {
        return <iframe title={item.fileName} srcDoc={item.htmlContent} sandbox="" className="canvas-media canvas-html-preview" />;
      }

      if (item.mimeType === 'application/pdf') {
        return <iframe title={item.fileName} src={item.previewUrl} className="canvas-media pdf-frame" />;
      }

      if (item.mimeType.startsWith('text/') || item.fileName.toLowerCase().endsWith('.md') || item.fileName.toLowerCase().endsWith('.markdown')) {
        const text = item.textContent ?? 'Sin contenido';
        return item.fileName.toLowerCase().match(/\.(md|markdown)$/)
          ? <article className="canvas-markdown-render" dangerouslySetInnerHTML={{ __html: renderMarkdownText(text) }} />
          : <pre className="canvas-markdown-preview">{text}</pre>;
      }

      if (item.fileKind === 'document') {
        return item.textContent
          ? <article className="canvas-document-preview"><a href={item.previewUrl} download={item.fileName}>Descargar original</a><pre>{item.textContent}</pre></article>
          : <div className="canvas-file-generic"><strong>{item.fileName}</strong><span>Documento de Word · {item.sizeLabel}</span><small>Vista previa del formato .doc no disponible</small><a href={item.previewUrl} download={item.fileName}>Descargar original</a></div>;
      }

      return (
        <div className="canvas-file-generic">
          <strong>{item.fileName}</strong>
          <span>{item.sizeLabel ?? 'Archivo adjunto'}</span>
          <a href={item.previewUrl} download={item.fileName}>Descargar archivo</a>
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
                void handlePageCommit(item.id, pageDrafts[item.id] ?? item.url);
                setEditingId(null);
              }
            }}
          />
        </div>
      );
    }

    if (!item.captureUrl && pageLoadingIds[item.id]) {
      return (
        <div className="canvas-page-state">
          <span className="canvas-page-spinner" aria-hidden="true" />
          <span>Capturando página…</span>
        </div>
      );
    }

    if (!item.captureUrl) {
      return (
        <div className="canvas-page-state">
          <span>No se pudo generar la captura</span>
          {pageCaptureErrors[item.id] && <small title={pageCaptureErrors[item.id]}>{pageCaptureErrors[item.id]}</small>}
        </div>
      );
    }

    const viewportHeight = item.visibleHeight || item.height;
    const displayWidth = getPageImageWidth(item);

    return (
      <div className="canvas-page-preview" style={{ height: viewportHeight }}>
        <img
          src={item.captureUrl}
          alt={`Captura de ${getUrlHost(item.url)}`}
          className="canvas-page-capture-image"
          draggable={false}
          style={{ width: displayWidth }}
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            if (!naturalWidth || !naturalHeight || (item.captureWidth === naturalWidth && item.captureHeight === naturalHeight)) return;
            updateItem(item.id, (current) => {
              if (current.type !== 'page' || current.captureUrl !== item.captureUrl) return current;
              const fullHeight = displayWidth * naturalHeight / naturalWidth;
              const visibleHeight = Math.min(current.visibleHeight || current.height, fullHeight);
              return {
                ...current,
                captureWidth: naturalWidth,
                captureHeight: naturalHeight,
                height: visibleHeight,
                visibleHeight,
              };
            });
          }}
        />
      </div>
    );
  };

  const visibleItems = items.filter((item) => item.type !== 'group');
  const contextMenuItem = contextMenu ? items.find((item) => item.id === contextMenu.id) : undefined;

  return (
    <div
      ref={viewportRef}
      className={`canvas-shell ${isDragging ? 'dragging' : ''}`}
      style={{ background: canvasBackground, '--canvas-bg': canvasBackground } as React.CSSProperties}
      onMouseDown={beginPan}
      onMouseMove={handleMouseMove}
      onMouseUp={(event) => stopInteraction(event)}
      onMouseLeave={() => stopInteraction()}
      onWheel={handleWheel}
      onPaste={handleCanvasPaste}
      tabIndex={0}
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
          const clickedItemId = target.closest<HTMLElement>('.canvas-item')?.dataset.itemId;
          const clickedInsideExpandedFolder = items.some(
            (item) => item.type === 'folder' && item.expanded &&
              (item.id === clickedItemId || item.childIds.includes(clickedItemId ?? '')),
          );
          const clickedItem = items.find((item) => item.id === clickedItemId);
          if (!clickedInsideExpandedFolder && clickedItem?.type !== 'folder') collapseAllGroups();
          return;
        }

        setContextMenu(null);
        collapseAllGroups();
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('.canvas-surface') || target.closest('.canvas-item')) return;

        const bounds = viewportRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const worldX = (event.clientX - bounds.left - pan.x) / zoom;
        const worldY = (event.clientY - bounds.top - pan.y) / zoom;
        window.dispatchEvent(new CustomEvent('canvas-create-note', {
          detail: { x: worldX - 110, y: worldY - 75 },
        }));
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
      />

      <input
        ref={projectInputRef}
        type="file"
        className="sr-only-input"
        onChange={handleProjectImport}
        accept=".osp,application/json"
      />

      <LayerBar
        items={items}
        selectedIds={selectedIds}
        isOpen={layerBarOpen}
        onToggle={() => setLayerBarOpen((current) => !current)}
        onSelect={(id, additive) => {
          if (!additive) {
            updateSelection([id]);
            return;
          }

          updateSelection(
            selectedIds.includes(id)
              ? selectedIds.filter((selectedId) => selectedId !== id)
              : [...selectedIds, id],
          );
        }}
        onReorder={reorderLayers}
        onToggleContainer={toggleContainer}
        onMoveSelected={moveSelectedLayer}
        onDeleteSelected={() => {
          if (selectedIds.length === 0) {
            return;
          }

          const idsToDelete = [...selectedIds];
          setItems((current) => current.filter((item) => !idsToDelete.includes(item.id)));
          updateSelection([]);
          setEditingId(null);
          setContextMenu(null);
        }}
      />

      {canvasSettingsOpen && (
        <section className="canvas-settings-popover canvas-settings-modal" style={{ left: canvasSettingsPosition.left, top: canvasSettingsPosition.top }} role="dialog" aria-modal="false" aria-labelledby="canvas-settings-title" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <header className="canvas-settings-modal-header">
              <h2 id="canvas-settings-title">Configuración</h2>
            </header>

            <div className="canvas-settings-section canvas-settings-compact-content">
              <label className="canvas-settings-name">
                <span>Nombre del archivo</span>
                <input
                  className="canvas-settings-title-input"
                  autoFocus
                  value={canvasTitleDraft}
                  maxLength={80}
                  onChange={(event) => setCanvasTitleDraft(event.target.value)}
                  onBlur={() => void commitCanvasTitle()}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
                  placeholder="Canvas sin título"
                />
              </label>
              <div className="canvas-settings-location">
                <div><span>Se guarda en</span><strong>Este dispositivo · Open Space</strong></div>
                <button type="button" title="Mostrar copia local en el explorador" aria-label="Mostrar copia local en el explorador" onClick={() => void showCanvasFileInExplorer()}><FolderOpen size={17} /></button>
              </div>
              <div className="canvas-settings-mode-row">
                <span>Fondo del canvas</span>
                <div className="canvas-settings-mode-switch" role="group" aria-label="Modo de fondo">
                  <button type="button" className={canvasBackground.toLowerCase() === '#ffffff' ? 'active' : ''} aria-pressed={canvasBackground.toLowerCase() === '#ffffff'} onClick={() => void setCanvasMode('light')}>Claro</button>
                  <button type="button" className={canvasBackground.toLowerCase() === '#202124' ? 'active' : ''} aria-pressed={canvasBackground.toLowerCase() === '#202124'} onClick={() => void setCanvasMode('dark')}>Oscuro</button>
                </div>
              </div>
            </div>
        </section>
      )}

      {fileSettingsOpen && (
        <div className="canvas-settings-panel">
          <div className="canvas-settings-header">
            <strong>Archivo</strong>
            <button type="button" onClick={() => setFileSettingsOpen(false)}>Cerrar</button>
          </div>

          <button type="button" onClick={() => { saveCanvasProject(); setFileSettingsOpen(false); }}>
            Guardar en este dispositivo
          </button>
          <button type="button" onClick={() => { exportCanvasProject(); setFileSettingsOpen(false); }}>
            Exportar copia (.osp)
          </button>
          <button type="button" onClick={() => { projectInputRef.current?.click(); setFileSettingsOpen(false); }}>
            Abrir proyecto (.osp)
          </button>
        </div>
      )}

      {contextMenu && (
        <div
          className={`canvas-context-menu ${contextMenuItem?.type === 'folder' ? 'folder-context-menu' : ''}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {contextMenuItem?.type === 'folder' && (
            <>
              <button
                type="button"
                onClick={() => {
                  setRenamingFolderId(contextMenu.id);
                  setContextMenu(null);
                }}
              >
                Cambiar título
              </button>
              <div className="folder-context-colors" role="group" aria-label="Color de carpeta">
                {FOLDER_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    className={(contextMenuItem.color ?? DEFAULT_FOLDER_COLOR) === color.value ? 'active' : ''}
                    style={{ '--swatch-color': color.value } as React.CSSProperties}
                    aria-label={color.label}
                    aria-pressed={(contextMenuItem.color ?? DEFAULT_FOLDER_COLOR) === color.value}
                    title={color.label}
                    onClick={() => {
                      updateItem(contextMenuItem.id, (item) => item.type === 'folder' ? { ...item, color: color.value } : item);
                      setContextMenu(null);
                    }}
                  >
                    <span />
                  </button>
                ))}
              </div>
            </>
          )}
          <button type="button" onClick={() => removeItem(contextMenu.id)}>
            Eliminar
          </button>
        </div>
      )}

      <div
        className="canvas-surface"
        style={{
          background: canvasBackground,
          transform: `translate(${pan.x}px, ${pan.y}px)`,
        }}
      >
        <div className="canvas-content" style={{ zoom }}>
          {visibleItems.map((item) => {
            const parentFolder = items.find(
              (entry): entry is FolderCanvasItem =>
                entry.type === 'folder' && entry.childIds.includes(item.id),
            );
            const parentGroup = items.find(
              (entry): entry is GroupCanvasItem => entry.type === 'group' && entry.childIds.includes(item.id),
            );
            const isFolderPreview = Boolean(parentFolder?.expanded);
            const isFolderCollapsedChild = Boolean(parentFolder && !parentFolder.expanded);
            const isGroupStackChild = Boolean(parentGroup && !parentGroup.expanded);

            return (
              <div
                key={item.id}
                data-item-id={item.id}
                className={`canvas-item ${selectedIds.includes(item.id) ? 'selected' : ''} ${isContainerItem(item) ? 'canvas-container' : ''} ${item.type === 'folder' ? 'folder-item' : ''} ${item.type === 'page' ? 'page-item' : ''} ${item.type === 'file' && item.mimeType.startsWith('image/') ? 'image-item' : ''} ${isFolderPreview ? 'folder-expanded-child' : ''} ${isFolderCollapsedChild ? 'folder-collapsed-child' : ''} ${isGroupStackChild ? 'group-stack-child' : ''}`}
                style={{
                  left: item.x,
                  top: item.y,
                  width: isFolderPreview ? 150 : item.type === 'page' ? getPageImageWidth(item) : item.width,
                  height: isFolderPreview ? 96 : item.type === 'page' ? item.visibleHeight || item.height : item.height,
                  zIndex: item.type === 'folder' && item.expanded ? 5 : isFolderPreview ? 4 : undefined,
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

                  if (item.type === 'folder') {
                    event.preventDefault();
                    event.stopPropagation();
                    updateSelection([item.id]);
                    setRenamingFolderId(item.id);
                    return;
                  }

                  event.preventDefault();
                  event.stopPropagation();
                  updateSelection([item.id]);
                  setEditingId(item.id);
                }}
              >
                {item.type === 'note' && !isFolderPreview && (
                  <button
                    type="button"
                    className="canvas-note-maximize"
                    aria-label="Abrir nota a pantalla completa"
                    title="Abrir nota"
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateSelection([item.id]);
                      setEditingId(null);
                      setFullscreenNoteClosing(false);
                      setFullscreenNoteId(item.id);
                    }}
                  >
                    <Maximize size={14} strokeWidth={1.7} />
                  </button>
                )}
                <div className="canvas-item-body">{renderItemContent(item)}</div>
                {item.type === 'page' ? (
                  <>
                    <div className="canvas-page-handle canvas-page-handle-right" onMouseDown={(event) => startPageResize(event, item.id, 'scale')} />
                    <div className="canvas-page-handle canvas-page-handle-bottom" onMouseDown={(event) => startPageResize(event, item.id, 'viewport')} />
                  </>
                ) : !isContainerItem(item) && !isGroupStackChild ? (
                  <div className="canvas-resize-handle" onMouseDown={(event) => startResize(event, item.id)} />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {fullscreenNoteId && (() => {
        const note = items.find((item): item is NoteCanvasItem => item.id === fullscreenNoteId && item.type === 'note');
        if (!note) return null;
        return (
          <section
            className={`note-fullscreen ${fullscreenNoteClosing ? 'is-closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Editor de nota"
            onMouseDown={(event) => event.stopPropagation()}
            onAnimationEnd={() => {
              if (fullscreenNoteClosing) {
                setFullscreenNoteId(null);
                setFullscreenNoteClosing(false);
              }
            }}
          >
            <header className="note-fullscreen-header">
              <span>Nota</span>
              <button type="button" aria-label="Cerrar nota" title="Cerrar" onClick={() => setFullscreenNoteClosing(true)}>
                <Minimize size={16} strokeWidth={1.7} />
              </button>
            </header>
            <div className="note-fullscreen-content">
              <div
                ref={fullscreenNoteEditorRef}
                className="note-fullscreen-editor"
                contentEditable
                suppressContentEditableWarning
                role="textbox"
                aria-label="Nota en Markdown"
                aria-multiline="true"
                data-placeholder="Empieza a escribir…"
                spellCheck
                onInput={(event) => {
                  const editor = event.currentTarget;
                  const selection = window.getSelection();
                  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
                  let caretOffset = 0;
                  if (range) {
                    const blocks = Array.from(editor.children);
                    const activeBlockIndex = blocks.findIndex((block) => block === range.startContainer || block.contains(range.startContainer));
                    if (activeBlockIndex >= 0) {
                      caretOffset = blocks.slice(0, activeBlockIndex).reduce((length, block) => length + getEditorText(block).length + 1, 0);
                      const beforeCaret = document.createRange();
                      beforeCaret.selectNodeContents(blocks[activeBlockIndex]);
                      beforeCaret.setEnd(range.startContainer, range.startOffset);
                      caretOffset += getEditorText(beforeCaret.cloneContents()).length;
                    } else if (range.startContainer === editor) {
                      caretOffset = blocks.slice(0, range.startOffset).reduce((length, block) => length + getEditorText(block).length + 1, 0);
                    } else {
                      const beforeCaret = range.cloneRange();
                      beforeCaret.selectNodeContents(editor);
                      beforeCaret.setEnd(range.startContainer, range.startOffset);
                      caretOffset = getEditorText(beforeCaret.cloneContents()).length;
                    }
                  }

                  const markdown = markdownFromEditor(editor);
                  updateItem(note.id, (current) => current.type === 'note' ? { ...current, text: markdown } : current);

                  const inputEvent = event.nativeEvent as InputEvent;
                  const isWhitespaceInput = inputEvent.inputType === 'insertText' && Boolean(inputEvent.data && /^\s+$/u.test(inputEvent.data));
                  const textEndsInSpace = /[ \u00a0]$/.test(editor.textContent ?? '');
                  if (isWhitespaceInput || textEndsInSpace || inputEvent.inputType === 'insertParagraph' || inputEvent.inputType === 'insertLineBreak') return;
                  const renderedHtml = renderMarkdownText(markdown);
                  const normalizeSpaces = (html: string) => html.replace(/&nbsp;|&#160;|\u00a0/gi, ' ');
                  if (normalizeSpaces(editor.innerHTML) === normalizeSpaces(renderedHtml)) return;
                  editor.innerHTML = renderedHtml;
                  const emptyHeadingTrigger = markdown.match(/(?:^|\n)(#{1,3}[ \t]+)$/);
                  restoreEditorCaret(editor, emptyHeadingTrigger ? caretOffset + emptyHeadingTrigger[1].length : caretOffset);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Tab') {
                    event.preventDefault();
                    document.execCommand('insertText', false, '  ');
                  }
                }}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('a')) event.preventDefault();
                }}
              />
            </div>
          </section>
        );
      })()}
    </div>
  );
};

export default Canvas;
