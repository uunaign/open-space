use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn capture_page(url: String) -> Result<String, String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "No se pudo resolver la raíz del proyecto".to_string())?
        .to_path_buf();

    let script_path = repo_root.join("scripts/capture-page.mjs");

    let output = Command::new("node")
        .arg(&script_path)
        .arg(&url)
        .output()
        .map_err(|error| format!("No se pudo ejecutar el capturador local: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "La captura local falló: {}",
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|error| format!("La captura devolvió salida inválida: {error}"))?;

    Ok(stdout.trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, capture_page])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
