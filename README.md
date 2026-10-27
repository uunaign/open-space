# Open Space

**Un espacio visual para pensar, organizar y conectar tus ideas.**

Open Space es una aplicación de escritorio de notas espaciales. En lugar de limitarte a una lista de documentos, puedes colocar notas, archivos, páginas y grupos en un canvas libre, y organizarlo a tu manera.

Es una implementación independiente *clean-room* inspirada en el concepto de organización espacial de Spatial. No es Spatial, no utiliza su marca como producto y no está afiliada ni respaldada por Spatial ni por sus creadores.

> El proyecto está en desarrollo activo. Queremos que Open Space mejore con las ideas, el trabajo y las aportaciones de su comunidad.

## Qué puedes hacer

- Crear canvases y guardar tu trabajo localmente.
- Añadir notas con autoformato Markdown y editarlas en un espacio de escritura ampliado.
- Incorporar archivos y páginas web al canvas.
- Agrupar elementos y organizarlos en carpetas con colores.
- Reordenar capas con el ratón y controlar su posición desde el panel de capas.
- Moverte por el espacio libre y ajustar el zoom.
- Importar y exportar proyectos `.osp`.

Los canvases se guardan localmente en el dispositivo. Open Space no sincroniza los datos entre dispositivos por ahora.

## Colabora

Las contribuciones son bienvenidas: puedes informar de errores, proponer mejoras, ayudar con la interfaz o el código y compartir ideas sobre cómo debería evolucionar la aplicación.

1. Abre un *issue* para describir el problema o la propuesta. Para errores, incluye los pasos para reproducirlo y tu sistema operativo.
2. Para trabajar en un cambio, crea una rama desde la versión más reciente.
3. Mantén los cambios centrados en una mejora y explica qué problema resuelven.
4. Antes de abrir un *pull request*, ejecuta `npm run build` y describe el resultado.

Si no sabes por dónde empezar, abre un *issue* para conversar sobre la idea antes de programarla. También son útiles la documentación, las traducciones, la revisión de accesibilidad y las pruebas manuales en distintos sistemas.

## Desarrollo local

### Requisitos

- Node.js LTS y npm.
- Rust y las dependencias de compilación de Tauri para tu sistema operativo.
- En Windows: Microsoft C++ Build Tools y WebView2.

Consulta los [requisitos oficiales de Tauri 2](https://v2.tauri.app/start/prerequisites/) para instalar las dependencias correspondientes a tu plataforma.

### Ejecutar la aplicación

```bash
cd open-space
npm install
npm run tauri dev
```

Para compilar y comprobar el frontend:

```bash
npm run build
```

Para crear los instaladores de escritorio:

```bash
npm run tauri build
```

## Builds y releases en GitHub

GitHub Actions valida el build del frontend al abrir o actualizar un *pull request* hacia `main`, y en cada *push* a esa rama. Para publicar una versión, actualiza la versión de la app en `package.json`, `src-tauri/tauri.conf.json` y `src-tauri/Cargo.toml`, crea un tag que coincida con ella (por ejemplo, `v0.1.0`) y súbelo:

```bash
git tag v0.1.0
git push origin v0.1.0
```

El workflow compila instaladores para Windows x64, Linux x64, macOS Apple Silicon e Intel, y crea un borrador de Release con notas generadas. Revisa los instaladores y las notas en **GitHub → Releases** y publícalo cuando esté listo. No hace falta crear un `GITHUB_TOKEN` manual: Actions usa el token del repositorio con permiso para publicar Releases. Si la política del repositorio restringe ese permiso, habilita **Settings → Actions → General → Workflow permissions → Read and write permissions**.

La captura de páginas web requiere un navegador Chromium disponible. Si no tienes Chrome o Edge instalados, instala Chromium para Playwright:

```bash
npx playwright install chromium
```

### Tecnologías

- React y TypeScript
- Vite
- Tauri 2 y Rust
- IndexedDB para el almacenamiento local de canvases
- Playwright para capturar páginas web

## Estructura del proyecto

```text
src/                  Interfaz React, canvas y componentes
src-tauri/            Aplicación de escritorio y comandos Rust
scripts/              Herramientas auxiliares, incluida la captura web
```

## Licencia

Open Space se distribuye bajo la licencia [MIT](LICENSE). Puedes usar, modificar y redistribuir el proyecto, incluso en productos comerciales, siempre que conserves el aviso de copyright y el texto de la licencia. El software se ofrece sin garantía.

Las dependencias de terceros mantienen sus propias licencias. La licencia MIT no concede derechos sobre marcas de terceros.
