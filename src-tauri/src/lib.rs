#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    io::{BufRead, BufReader},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const CREATE_NO_WINDOW: u32 = 0x08000000;

struct Sidecar(Mutex<Option<Child>>);

fn resource_path(app: &AppHandle, relative_path: &str) -> tauri::Result<PathBuf> {
    let resource_dir = app.path().resource_dir()?;
    let direct = resource_dir.join(relative_path);
    if direct.exists() {
        return Ok(direct);
    }

    // Tauri mempertahankan `..` pada konfigurasi resource sebagai folder `_up_` saat bundling Windows.
    let bundled = resource_dir.join("_up_").join(relative_path);
    if bundled.exists() {
        return Ok(bundled);
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("resource desktop tidak ditemukan: {relative_path}"),
    )
    .into())
}

fn node_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    resource_path(app, "desktop-bin/node.exe")
}

fn start_window(app: &AppHandle) -> tauri::Result<()> {
    let runtime_dir = resource_path(app, "desktop-runtime")?;
    let mut command = Command::new(node_path(app)?);
    command
        .arg("src/server.js")
        .current_dir(runtime_dir)
        .env("HDB_DESKTOP", "1")
        .env("HDB_PORT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("stdout sidecar tidak tersedia"))?;
    let mut url = None;
    for line in BufReader::new(stdout).lines().take(100) {
        let line = line?;
        if let Some(json) = line.strip_prefix("HDB_READY ") {
            let value: serde_json::Value = serde_json::from_str(json)?;
            let port = value["port"].as_u64().unwrap_or_default();
            let pid = value["pid"].as_u64().unwrap_or_default();
            let candidate = value["url"].as_str().unwrap_or_default();
            if (1..=65_535).contains(&port)
                && pid > 0
                && candidate == format!("http://127.0.0.1:{port}")
            {
                url = Some(candidate.to_owned());
                break;
            }
        }
    }
    let url =
        url.ok_or_else(|| std::io::Error::other("sidecar tidak mengirim readiness yang valid"))?;
    let url = url
        .parse()
        .map_err(|_| std::io::Error::other("URL sidecar tidak valid"))?;
    *app.state::<Sidecar>().0.lock().expect("sidecar lock") = Some(child);
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("Hesewake Database")
        .decorations(false)
        .maximized(true)
        .inner_size(1280.0, 800.0)
        .build()?;
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .manage(Sidecar(Mutex::new(None)))
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .setup(|app| Ok(start_window(app.handle())?))
        .build(tauri::generate_context!())
        .expect("gagal membangun aplikasi Tauri")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                if let Some(mut child) = app
                    .state::<Sidecar>()
                    .0
                    .lock()
                    .expect("sidecar lock")
                    .take()
                {
                    let _ = child.kill();
                }
            }
        });
}
