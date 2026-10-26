import { useCallback, useEffect, useState } from 'react';
import { FileText, Plus } from 'lucide-react';
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
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
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
