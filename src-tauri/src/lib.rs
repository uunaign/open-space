use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

fn normalize_node_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.as_os_str().to_string_lossy();
        if let Some(unc_path) = value.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{unc_path}"));
        }
        if let Some(dos_path) = value.strip_prefix(r"\\?\") {
            return PathBuf::from(dos_path);
        }
    }

    path.to_path_buf()
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn capture_page(app: tauri::AppHandle, url: String) -> Result<String, String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("La URL debe comenzar por http:// o https://".to_string());
    }

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "No se pudo resolver la raíz del proyecto".to_string())?
        .to_path_buf();

    let bundled_script = app
        .path()
        .resolve("capture/scripts/capture-page.mjs", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_file());
    let script_path = normalize_node_path(
        &bundled_script.unwrap_or_else(|| repo_root.join("scripts/capture-page.mjs")),
    );
    if !script_path.is_file() {
        return Err("No se encuentra el motor de captura de páginas en la instalación.".to_string());
    }
    let working_directory = script_path
        .parent()
        .and_then(|path| path.parent())
        .unwrap_or(&repo_root);
    let working_directory = normalize_node_path(working_directory);

    let output = Command::new("node")
        .current_dir(&working_directory)
        .arg(&script_path)
        .arg(url)
        .output()
        .map_err(|error| format!("No se pudo ejecutar el capturador local: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let details = stderr.trim();
        if details.is_empty() {
            return Err(format!("El capturador terminó con el código {}.", output.status));
        }
        return Err(format!(
            "La captura local falló: {details}"
        ));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("La captura devolvió salida inválida: {error}"))?;

    let image = stdout.trim();
    if image.is_empty() {
        return Err("Chromium terminó sin devolver una imagen.".to_string());
    }

    Ok(image.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, capture_page])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
