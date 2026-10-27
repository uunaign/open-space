import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { FileText, MoreHorizontal, Plus, FolderSearch, Pencil, Copy, Trash2, X } from 'lucide-react';
import { Canvas, CanvasSnapshot } from './components/Canvas';
import { ToolBar } from './components/ToolBar';
import { TopMenuBar } from './components/TopMenuBar';
import logo from './assets/logo_openspace.png';
import './App.css';

interface CanvasDocument {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  snapshot?: CanvasSnapshot;
}

const DATABASE_NAME = 'open-space-local';
const DATABASE_VERSION = 1;
const DOCUMENTS_STORE = 'canvases';

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacenamiento local.'));
    request.onblocked = () => reject(new Error('El almacenamiento local está bloqueado por otra ventana.'));
  });

const withDocumentsStore = async <T,>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const database = await openDatabase();

  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(DOCUMENTS_STORE, mode);
    const request = createRequest(transaction.objectStore(DOCUMENTS_STORE));
    let result: T;
    let hasResult = false;

    request.onsuccess = () => {
      result = request.result;
      hasResult = true;
    };
    request.onerror = () => reject(request.error ?? new Error('No se pudo acceder a los canvases guardados.'));
    transaction.oncomplete = () => {
      database.close();
      if (hasResult) {
        resolve(result);
      } else {
        reject(new Error('El almacenamiento local no devolvió ningún resultado.'));
      }
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error('Falló la operación de almacenamiento local.'));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error('Se canceló la operación de almacenamiento local.'));
    };
  });
};

const listDocuments = () =>
  withDocumentsStore('readonly', (store) => store.getAll() as IDBRequest<CanvasDocument[]>);

const putDocument = (document: CanvasDocument) =>
  withDocumentsStore('readwrite', (store) => store.put(document));
const deleteDocument = (id: string) =>
  withDocumentsStore('readwrite', (store) => store.delete(id));

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `canvas-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatDate = (date: string) => {
  const value = new Date(date);
  const now = new Date();
  const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' }).format(value);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(value)) / 86_400_000);

  if (diffDays === 0) return `Hoy, ${time}`;
  if (diffDays === 1) return `Ayer, ${time}`;
  return new Intl.DateTimeFormat('es', { dateStyle: 'medium' }).format(value);
};

export function App() {
  const [documents, setDocuments] = useState<CanvasDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<CanvasDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [deleteTarget, setDeleteTarget] = useState<CanvasDocument | null>(null);
  const [renameTarget, setRenameTarget] = useState<CanvasDocument | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [skipDeleteConfirmation, setSkipDeleteConfirmation] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void listDocuments()
      .then((savedDocuments) => {
        if (isMounted) {
          setDocuments(savedDocuments.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        }
      })
      .catch((error: unknown) => {
        console.error('No se pudieron cargar los canvases locales:', error);
        if (isMounted) {
          setErrorMessage('No se pudo acceder al almacenamiento local de canvases.');
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const createCanvas = useCallback(async () => {
    const now = new Date().toISOString();
    const document: CanvasDocument = {
      id: createId(),
      title: 'Canvas sin título',
      createdAt: now,
      updatedAt: now,
    };

    try {
      await putDocument(document);
      setDocuments((current) => [document, ...current]);
      setActiveDocument(document);
      setErrorMessage('');
    } catch (error) {
      console.error('No se pudo crear un canvas local:', error);
      setErrorMessage('No se pudo crear el canvas. Comprueba el almacenamiento del dispositivo e inténtalo de nuevo.');
    }
  }, []);

  const saveCanvas = useCallback(async (snapshot: CanvasSnapshot) => {
    if (!activeDocument) {
      throw new Error('No hay ningún canvas abierto para guardar.');
    }

    const updatedDocument = {
      ...activeDocument,
      snapshot,
      updatedAt: new Date().toISOString(),
    };

    await putDocument(updatedDocument);
    setDocuments((current) =>
      [updatedDocument, ...current.filter((document) => document.id !== updatedDocument.id)]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    );
    setActiveDocument((current) => current?.id === updatedDocument.id ? updatedDocument : current);
    setErrorMessage('');
  }, [activeDocument]);

  const returnToHome = () => {
    if (activeDocument) {
      window.dispatchEvent(new CustomEvent('canvas-save'));
    }
    setActiveDocument(null);
  };

  const renameCanvas = async (document: CanvasDocument) => {
    setOpenMenuId(null);
    setRenameValue(document.title);
    setRenameTarget(document);
  };

  const commitRenameCanvas = async () => {
    if (!renameTarget) return;
    const title = renameValue.trim();
    if (!title) return;
    if (title === renameTarget.title) { setRenameTarget(null); return; }
    const document = renameTarget;
    const renamed = { ...document, title, updatedAt: new Date().toISOString() };
    try {
      await putDocument(renamed);
      setDocuments((current) => current.map((item) => item.id === document.id ? renamed : item));
      setRenameTarget(null);
    } catch { setErrorMessage('No se pudo renombrar el canvas.'); }
  };

  const duplicateCanvas = async (document: CanvasDocument) => {
    const now = new Date().toISOString();
    const duplicate = { ...document, id: createId(), title: `${document.title} (copia)`, createdAt: now, updatedAt: now };
    try {
      await putDocument(duplicate);
      setDocuments((current) => [duplicate, ...current]);
      setOpenMenuId(null);
    } catch { setErrorMessage('No se pudo duplicar el canvas.'); }
  };

  const removeCanvas = async (document: CanvasDocument) => {
    try {
      await deleteDocument(document.id);
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setOpenMenuId(null);
      await invoke('delete_canvas_file', { id: document.id });
    } catch { setErrorMessage('El canvas se eliminó de recientes, pero no se pudo borrar su archivo local.'); }
  };

  const requestDeleteCanvas = (document: CanvasDocument) => {
    setOpenMenuId(null);
    if (localStorage.getItem('open-space-skip-delete-confirmation') === 'true') {
      void removeCanvas(document);
      return;
    }
    setSkipDeleteConfirmation(false);
    setDeleteTarget(document);
  };

  const confirmDeleteCanvas = () => {
    if (!deleteTarget) return;
    if (skipDeleteConfirmation) localStorage.setItem('open-space-skip-delete-confirmation', 'true');
    const document = deleteTarget;
    setDeleteTarget(null);
    void removeCanvas(document);
  };

  const findInExplorer = async (document: CanvasDocument) => {
    try {
      const contents = JSON.stringify(document.snapshot ?? { version: 1, items: [] }, null, 2);
      const path = await invoke<string>('reveal_canvas_file', { id: document.id, contents });
      await revealItemInDir(path);
      setOpenMenuId(null);
    } catch (error) {
      console.error('No se pudo abrir el canvas en el explorador:', error);
      setErrorMessage('No se pudo mostrar el canvas en el explorador.');
    }
  };

  useEffect(() => {
    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'n') {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      ) {
        return;
      }

      event.preventDefault();
      if (activeDocument) {
        window.dispatchEvent(new CustomEvent('canvas-save'));
      }
      void createCanvas();
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [activeDocument, createCanvas]);

  useEffect(() => {
    if (!deleteTarget && !renameTarget) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setDeleteTarget(null); setRenameTarget(null); }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [deleteTarget, renameTarget]);

  if (isLoading) {
    return <main className="home-screen home-loading" aria-busy="true" />;
  }

  if (!activeDocument) {
    return (
      <main className="home-screen">
        <nav className="home-nav">
          <div className="home-brand">
            <img className="home-brand-logo" src={logo} alt="" width={26} height={26} />
            <span className="home-brand-name">Open Space</span>
          </div>
          <button className="home-nav-button" type="button" onClick={() => void createCanvas()}>
            <Plus size={15} strokeWidth={2.2} />
            <span>Nuevo canvas</span>
            <kbd>Ctrl N</kbd>
          </button>
        </nav>

        <div className="home-content">
          <header className="home-header">
            <h1>Tus canvases</h1>
            <p>Continúa donde lo dejaste o crea un canvas nuevo.</p>
          </header>

          {errorMessage && <p className="home-error" role="alert">{errorMessage}</p>}

          {documents.length === 0 ? (
            <section className="home-empty">
              <h2>Aún no hay canvases</h2>
              <p>Crea un canvas para empezar. Se guardará en este dispositivo.</p>
              <button className="home-empty-button" type="button" onClick={() => void createCanvas()}>
                Crear un canvas nuevo
              </button>
            </section>
          ) : (
            <section aria-labelledby="recent-canvases-title">
              <h2 className="section-label" id="recent-canvases-title">
                Recientes <span>{documents.length}</span>
              </h2>
              <ul className="canvas-grid">
                <li>
                  <button className="canvas-card canvas-card-new" type="button" onClick={() => void createCanvas()}>
                    <span className="canvas-thumb">
                      <Plus size={26} strokeWidth={1.4} />
                    </span>
                    <span className="canvas-meta">
                      <strong>Nuevo canvas</strong>
                      <span>En blanco</span>
                    </span>
                  </button>
                </li>
                {documents.map((document) => (
                  <li key={document.id}>
                    <div className="canvas-card-wrap" onContextMenu={(event) => { event.preventDefault(); setOpenMenuId(document.id); setMenuPosition({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 190) }); }}>
                    <button
                      className="canvas-card"
                      type="button"
                      onClick={() => {
                        setActiveDocument(document);
                        setErrorMessage('');
                      }}
                    >
                      <span className="canvas-thumb" aria-hidden="true">
                        <FileText size={22} strokeWidth={1.5} />
                      </span>
                      <span className="canvas-meta">
                        <strong>{document.title}</strong>
                        <span>{formatDate(document.updatedAt)}</span>
                      </span>
                    </button>
                    <button className="canvas-menu-trigger" type="button" aria-label={`Opciones de ${document.title}`} aria-haspopup="menu" aria-expanded={openMenuId === document.id} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const opening = openMenuId !== document.id; setOpenMenuId(opening ? document.id : null); setMenuPosition({ x: Math.min(rect.right - 205, window.innerWidth - 220), y: rect.bottom + 6 }); }}>
                      <MoreHorizontal size={18} />
                    </button>
                    {openMenuId === document.id && <div className="canvas-context-menu" style={{ left: menuPosition.x, top: menuPosition.y }} role="menu" onClick={(event) => event.stopPropagation()}>
                      <button role="menuitem" onClick={() => void findInExplorer(document)}><FolderSearch size={15} />Buscar en el explorador</button>
                      <button role="menuitem" onClick={() => void renameCanvas(document)}><Pencil size={15} />Renombrar</button>
                      <button role="menuitem" onClick={() => void duplicateCanvas(document)}><Copy size={15} />Duplicar</button>
                      <div className="menu-divider" />
                      <button className="menu-danger" role="menuitem" onClick={() => requestDeleteCanvas(document)}><Trash2 size={15} />Eliminar</button>
                    </div>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {deleteTarget && <div className="home-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
          <section className="home-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-dialog-title" aria-describedby="delete-dialog-description">
            <div className="home-dialog-icon"><Trash2 size={18} /></div>
            <button className="home-dialog-close" type="button" aria-label="Cerrar" onClick={() => setDeleteTarget(null)}><X size={17} /></button>
            <h2 id="delete-dialog-title">¿Eliminar este canvas?</h2>
            <p id="delete-dialog-description"><strong>{deleteTarget.title}</strong> se eliminará de forma permanente junto con su archivo local.</p>
            <label className="home-dialog-check"><input type="checkbox" checked={skipDeleteConfirmation} onChange={(event) => setSkipDeleteConfirmation(event.target.checked)} /><span>No volver a mostrar</span></label>
            <div className="home-dialog-actions"><button type="button" className="dialog-cancel" onClick={() => setDeleteTarget(null)}>Cancelar</button><button type="button" className="dialog-confirm" onClick={confirmDeleteCanvas}>Eliminar canvas</button></div>
          </section>
        </div>}
        {renameTarget && <div className="home-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRenameTarget(null); }}>
          <section className="home-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-dialog-title">
            <button className="home-dialog-close" type="button" aria-label="Cerrar" onClick={() => setRenameTarget(null)}><X size={17} /></button>
            <h2 id="rename-dialog-title" className="rename-dialog-title">Renombrar canvas</h2>
            <input className="home-dialog-input" autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void commitRenameCanvas(); }} maxLength={80} />
            <div className="home-dialog-actions"><button type="button" className="dialog-cancel" onClick={() => setRenameTarget(null)}>Cancelar</button><button type="button" className="dialog-confirm" onClick={() => void commitRenameCanvas()} disabled={!renameValue.trim()}>Guardar</button></div>
          </section>
        </div>}
      </main>
    );
  }

  return (
    <div className="app-shell">
      <Canvas
        key={activeDocument.id}
        initialSnapshot={activeDocument.snapshot}
        onSave={saveCanvas}
      />
      <TopMenuBar onHome={returnToHome} />
      <ToolBar />
      {errorMessage && <div className="app-error-banner" role="alert">{errorMessage}</div>}
    </div>
  );
}

export default App;
