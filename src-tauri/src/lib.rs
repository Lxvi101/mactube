use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex as StdMutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_notification::NotificationExt;
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    sync::{Mutex, Semaphore},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    output_dir: String,
    concurrent_downloads: usize,
    audio_format: String,
    embed_metadata: bool,
    embed_thumbnail: bool,
    sponsorblock: bool,
    launch_at_login: bool,
}

impl Default for Settings {
    fn default() -> Self {
        let downloads = dirs::download_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("MacTube");
        Self {
            output_dir: downloads.to_string_lossy().into(),
            concurrent_downloads: 2,
            audio_format: "original".into(),
            embed_metadata: true,
            embed_thumbnail: true,
            sponsorblock: false,
            launch_at_login: false,
        }
    }
}

#[derive(Default)]
struct AppState {
    cancelled: Arc<Mutex<HashSet<String>>>,
    processes: Arc<StdMutex<HashMap<String, u32>>>,
    tray_jobs: Arc<StdMutex<HashMap<String, TrayJob>>>,
    history_lock: Arc<StdMutex<()>>,
}

#[derive(Clone)]
struct TrayJob {
    title: String,
    status: String,
    progress: f64,
}

#[derive(Debug, Clone, Deserialize)]
struct DownloadRequest {
    job_id: String,
    video_id: String,
    url: String,
    title: String,
    uploader: String,
    thumbnail: Option<String>,
    format: String,
    quality: String,
    audio_format: Option<String>,
    playlist_title: Option<String>,
    playlist_index: Option<u64>,
    cookie_browser: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ProgressEvent {
    job_id: String,
    status: String,
    progress: f64,
    speed: Option<String>,
    eta: Option<String>,
    output_path: Option<String>,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct VideoInfo {
    id: String,
    title: String,
    uploader: String,
    duration: Option<f64>,
    thumbnail: Option<String>,
    webpage_url: String,
    playlist_title: Option<String>,
    playlist_index: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryItem {
    id: String,
    video_id: String,
    title: String,
    uploader: String,
    thumbnail: Option<String>,
    source_url: String,
    output_path: String,
    format: String,
    quality: String,
    completed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
struct DependencyStatus {
    ytdlp: bool,
    ffmpeg: bool,
    ytdlp_version: Option<String>,
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("settings.json"))
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("history.json"))
}

fn load_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn load_history_file(app: &AppHandle) -> Vec<HistoryItem> {
    history_path(app)
        .ok()
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn save_history_file(app: &AppHandle, history: &[HistoryItem]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(history).map_err(|e| e.to_string())?;
    let path = history_path(app)?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, json).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(app: AppHandle) -> Settings {
    load_settings(&app)
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())?;
    if settings.launch_at_login {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn choose_output_folder() -> Option<String> {
    rfd::AsyncFileDialog::new()
        .set_title("Choose where to save downloads")
        .pick_folder()
        .await
        .map(|folder| folder.path().to_string_lossy().into_owned())
}

#[tauri::command]
fn get_history(app: AppHandle, state: State<'_, AppState>) -> Vec<HistoryItem> {
    let _guard = state.history_lock.lock().expect("history lock");
    load_history_file(&app)
}

#[tauri::command]
fn clear_history(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _guard = state.history_lock.lock().expect("history lock");
    save_history_file(&app, &[])
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("That downloaded file has been moved or deleted.".into());
    }
    #[cfg(target_os = "macos")]
    let status = std::process::Command::new("open")
        .args(["-R", &path])
        .status();
    #[cfg(target_os = "windows")]
    let status = std::process::Command::new("explorer")
        .arg(format!("/select,{path}"))
        .status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = std::process::Command::new("xdg-open")
        .arg(Path::new(&path).parent().unwrap_or_else(|| Path::new(".")))
        .status();
    match status {
        Ok(result) if result.success() => Ok(()),
        Ok(_) => Err("Could not open the file location.".into()),
        Err(error) => Err(error.to_string()),
    }
}

fn ytdlp_binary() -> String {
    std::env::var("MACTUBE_YTDLP").unwrap_or_else(|_| "yt-dlp".into())
}

fn ytdlp_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "yt-dlp is not installed. Install it with Homebrew: brew install yt-dlp ffmpeg".into()
    } else {
        error.to_string()
    }
}

#[tauri::command]
async fn check_dependencies() -> DependencyStatus {
    let ytdlp = Command::new(ytdlp_binary()).arg("--version").output().await;
    let ffmpeg = Command::new("ffmpeg").arg("-version").output().await;
    DependencyStatus {
        ytdlp: ytdlp.as_ref().is_ok_and(|output| output.status.success()),
        ffmpeg: ffmpeg.as_ref().is_ok_and(|output| output.status.success()),
        ytdlp_version: ytdlp.ok().and_then(|output| {
            output
                .status
                .success()
                .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        }),
    }
}

#[tauri::command]
fn get_initial_deep_links(app: AppHandle) -> Vec<String> {
    app.deep_link()
        .get_current()
        .ok()
        .flatten()
        .unwrap_or_default()
        .into_iter()
        .map(|url| url.to_string())
        .collect()
}

#[tauri::command]
async fn fetch_metadata(
    url: String,
    cookie_browser: Option<String>,
) -> Result<Vec<VideoInfo>, String> {
    let mut args = vec![
        "--dump-single-json".to_string(),
        "--flat-playlist".to_string(),
        "--no-warnings".to_string(),
    ];
    if cookie_browser.as_deref() == Some("chrome") {
        args.extend(["--cookies-from-browser".into(), "chrome".into()]);
    }
    args.extend(["--".into(), url.clone()]);
    let output = Command::new(ytdlp_binary())
        .args(args)
        .output()
        .await
        .map_err(ytdlp_error)?;
    if !output.status.success() {
        return Err(last_error(&output.stderr));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let is_playlist = value
        .get("entries")
        .and_then(|entry| entry.as_array())
        .is_some();
    let playlist_title = is_playlist
        .then(|| {
            value
                .get("title")
                .and_then(|title| title.as_str())
                .map(String::from)
        })
        .flatten();
    let values: Vec<&serde_json::Value> = value
        .get("entries")
        .and_then(|entry| entry.as_array())
        .map(|entries| entries.iter().collect())
        .unwrap_or_else(|| vec![&value]);
    Ok(values
        .into_iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let id = item.get("id")?.as_str()?.to_string();
            let webpage_url = item
                .get("webpage_url")
                .or_else(|| item.get("url"))
                .and_then(|item_url| item_url.as_str())
                .map(|item_url| {
                    if item_url.starts_with("http") {
                        item_url.to_string()
                    } else {
                        format!("https://www.youtube.com/watch?v={item_url}")
                    }
                })
                .unwrap_or_else(|| url.clone());
            Some(VideoInfo {
                id,
                title: item
                    .get("title")
                    .and_then(|title| title.as_str())
                    .unwrap_or("Untitled video")
                    .into(),
                uploader: item
                    .get("uploader")
                    .or_else(|| item.get("channel"))
                    .and_then(|uploader| uploader.as_str())
                    .unwrap_or("")
                    .into(),
                duration: item.get("duration").and_then(|duration| duration.as_f64()),
                thumbnail: item
                    .get("thumbnail")
                    .and_then(|thumbnail| thumbnail.as_str())
                    .map(String::from),
                webpage_url,
                playlist_title: playlist_title.clone(),
                playlist_index: is_playlist.then_some((index + 1) as u64),
            })
        })
        .collect())
}

fn shorten(value: &str, max: usize) -> String {
    let mut chars = value.chars();
    let shortened: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{shortened}…")
    } else {
        shortened
    }
}

fn update_tray(app: &AppHandle) {
    let state = app.state::<AppState>();
    let jobs = state.tray_jobs.lock().expect("tray job lock").clone();
    let active: Vec<_> = jobs
        .values()
        .filter(|job| {
            matches!(
                job.status.as_str(),
                "queued" | "downloading" | "processing" | "paused"
            )
        })
        .collect();
    let running: Vec<_> = active.iter().filter(|job| job.status != "paused").collect();
    let average = if active.is_empty() {
        0
    } else {
        (active.iter().map(|job| job.progress).sum::<f64>() / active.len() as f64).round() as u32
    };
    if let Some(tray) = app.tray_by_id("mactube") {
        let title = if active.is_empty() {
            None
        } else if running.is_empty() {
            Some(format!("Ⅱ {} · {}%", active.len(), average))
        } else {
            Some(format!("↓ {} · {}%", active.len(), average))
        };
        let _ = tray.set_title(title);
        let _ = tray.set_tooltip(Some(if active.is_empty() {
            "MacTube · Ready".to_string()
        } else {
            format!("MacTube · {} active · {}% overall", active.len(), average)
        }));
        if let Ok(menu) = Menu::new(app) {
            let summary = if active.is_empty() {
                "Ready for downloads".to_string()
            } else {
                format!("{} active · {}% overall", active.len(), average)
            };
            append_menu_item(app, &menu, "download-summary", summary, false);
            for (index, job) in active.iter().take(5).enumerate() {
                let filled = (job.progress / 10.0).round().clamp(0.0, 10.0) as usize;
                let bar = format!("{}{}", "●".repeat(filled), "○".repeat(10 - filled));
                let state = if job.status == "paused" { "Ⅱ" } else { "" };
                append_menu_item(
                    app,
                    &menu,
                    format!("progress-{index}"),
                    format!(
                        "{state} {bar} {:>3.0}%  {}",
                        job.progress,
                        shorten(&job.title, 30)
                    ),
                    false,
                );
            }
            if active.len() > 5 {
                append_menu_item(
                    app,
                    &menu,
                    "more-downloads",
                    format!("And {} more…", active.len() - 5),
                    false,
                );
            }
            if let Ok(separator) = PredefinedMenuItem::separator(app) {
                let _ = menu.append(&separator);
            }
            append_menu_item(app, &menu, "show", "Open MacTube", true);
            append_menu_item(app, &menu, "quit", "Quit MacTube", true);
            let _ = tray.set_menu(Some(menu));
        }
    }
}

fn append_menu_item(
    app: &AppHandle,
    menu: &Menu<tauri::Wry>,
    id: impl Into<tauri::menu::MenuId>,
    text: impl AsRef<str>,
    enabled: bool,
) {
    if let Ok(item) = MenuItem::with_id(app, id, text.as_ref(), enabled, None::<&str>) {
        let _ = menu.append(&item);
    }
}

fn tray_icon() -> Image<'static> {
    let size = 18usize;
    let mut rgba = vec![0u8; size * size * 4];
    let mut mark = |x: usize, y: usize| {
        let offset = (y * size + x) * 4;
        rgba[offset..offset + 4].copy_from_slice(&[0, 0, 0, 255]);
    };
    for y in 2..12 {
        for x in 8..11 {
            mark(x, y);
        }
    }
    for step in 0..5 {
        for x in (5 + step)..=(13 - step) {
            mark(x, 10 + step);
        }
    }
    Image::new_owned(rgba, size as u32, size as u32)
}

fn emit_progress(app: &AppHandle, event: ProgressEvent) {
    let should_update_tray = {
        let state = app.state::<AppState>();
        let mut jobs = state.tray_jobs.lock().expect("tray job lock");
        let previous = jobs.get(&event.job_id).cloned();
        if let Some(job) = jobs.get_mut(&event.job_id) {
            job.status = event.status.clone();
            job.progress = event.progress;
        }
        if matches!(event.status.as_str(), "complete" | "cancelled" | "failed") {
            jobs.remove(&event.job_id);
        }
        previous.is_none_or(|previous| {
            previous.status != event.status
                || (previous.progress / 5.0).floor() != (event.progress / 5.0).floor()
        })
    };
    if should_update_tray {
        update_tray(app);
    }
    let _ = app.emit("download-progress", event);
}

fn progress_event(job_id: &str, status: &str, progress: f64) -> ProgressEvent {
    ProgressEvent {
        job_id: job_id.into(),
        status: status.into(),
        progress,
        speed: None,
        eta: None,
        output_path: None,
        error: None,
    }
}

fn format_selector(quality: &str) -> String {
    if quality == "best" {
        "bv*+ba/b".into()
    } else {
        format!("bv*[height<={quality}]+ba/b[height<={quality}]")
    }
}

fn safe_component(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            character if character.is_control() => '_',
            character => character,
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.');
    if cleaned.is_empty() {
        "Playlist".into()
    } else {
        shorten(cleaned, 120)
    }
}

fn output_template(request: &DownloadRequest, settings: &Settings) -> String {
    let base = PathBuf::from(&settings.output_dir);
    let directory = request
        .playlist_title
        .as_deref()
        .map(safe_component)
        .map(|playlist| base.join(playlist))
        .unwrap_or(base);
    let prefix = request
        .playlist_index
        .map(|index| format!("{index:03} - "))
        .unwrap_or_default();
    directory
        .join(format!("{prefix}%(title)s [%(id)s].%(ext)s"))
        .to_string_lossy()
        .into_owned()
}

fn last_error(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Download failed")
        .trim()
        .to_string()
}

#[cfg(unix)]
fn signal_process_group(pid: u32, signal: i32) {
    unsafe { libc::kill(-(pid as i32), signal) };
}

#[cfg(not(unix))]
fn signal_process_group(_pid: u32, _signal: i32) {}

fn remove_process(app: &AppHandle, job_id: &str) {
    app.state::<AppState>()
        .processes
        .lock()
        .expect("process lock")
        .remove(job_id);
}

fn record_history(app: &AppHandle, request: &DownloadRequest, output_path: &str) {
    let state = app.state::<AppState>();
    let _guard = state.history_lock.lock().expect("history lock");
    let mut history = load_history_file(app);
    history.retain(|item| item.output_path != output_path);
    history.insert(
        0,
        HistoryItem {
            id: uuid::Uuid::new_v4().to_string(),
            video_id: request.video_id.clone(),
            title: request.title.clone(),
            uploader: request.uploader.clone(),
            thumbnail: request.thumbnail.clone(),
            source_url: request.url.clone(),
            output_path: output_path.into(),
            format: request.format.clone(),
            quality: if request.format == "audio" {
                request
                    .audio_format
                    .clone()
                    .unwrap_or_else(|| "original".into())
            } else {
                request.quality.clone()
            },
            completed_at: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        },
    );
    history.truncate(500);
    let _ = save_history_file(app, &history);
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

async fn run_download(
    app: AppHandle,
    request: DownloadRequest,
    settings: Settings,
    cancelled: Arc<Mutex<HashSet<String>>>,
) {
    if cancelled.lock().await.remove(&request.job_id) {
        return;
    }
    let template = output_template(&request, &settings);
    if let Some(parent) = Path::new(&template).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut args = vec![
        "--newline".to_string(),
        "--continue".to_string(),
        "--windows-filenames".to_string(),
        "--progress-template".to_string(),
        "download:MACTUBE|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s"
            .to_string(),
        "--print".to_string(),
        "after_move:MACTUBE_DONE|%(filepath)s".to_string(),
        "-o".to_string(),
        template,
    ];
    if request.format == "audio" {
        let audio_format = request
            .audio_format
            .as_deref()
            .unwrap_or(&settings.audio_format);
        args.extend([
            "-x".into(),
            "--audio-format".into(),
            if audio_format == "original" {
                "best".into()
            } else {
                audio_format.into()
            },
            "--audio-quality".into(),
            "0".into(),
        ]);
    } else {
        args.extend([
            "-f".into(),
            format_selector(&request.quality),
            "--merge-output-format".into(),
            "mp4".into(),
            "--remux-video".into(),
            "mp4".into(),
        ]);
    }
    if settings.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if settings.embed_thumbnail {
        args.push("--embed-thumbnail".into());
    }
    if settings.sponsorblock {
        args.extend([
            "--sponsorblock-remove".into(),
            "sponsor,selfpromo,interaction".into(),
        ]);
    }
    if request.cookie_browser.as_deref() == Some("chrome") {
        args.extend(["--cookies-from-browser".into(), "chrome".into()]);
    }
    args.extend(["--no-playlist".into(), "--".into(), request.url.clone()]);

    let mut command = Command::new(ytdlp_binary());
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.as_std_mut().process_group(0);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let mut event = progress_event(&request.job_id, "failed", 0.0);
            event.error = Some(ytdlp_error(error));
            emit_progress(&app, event);
            notify(&app, "Download couldn’t start", &request.title);
            return;
        }
    };
    if let Some(pid) = child.id() {
        app.state::<AppState>()
            .processes
            .lock()
            .expect("process lock")
            .insert(request.job_id.clone(), pid);
    }
    emit_progress(&app, progress_event(&request.job_id, "downloading", 0.0));

    let stdout = child.stdout.take().expect("yt-dlp stdout");
    let stderr = child.stderr.take().expect("yt-dlp stderr");
    let stderr_tail = Arc::new(Mutex::new(VecDeque::<String>::with_capacity(20)));
    let stderr_capture = stderr_tail.clone();
    let stderr_app = app.clone();
    let stderr_job_id = request.job_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        let mut processing_sent = false;
        while let Ok(Some(line)) = lines.next_line().await {
            if !processing_sent
                && [
                    "[ExtractAudio]",
                    "[Merger]",
                    "[Metadata]",
                    "[EmbedThumbnail]",
                    "[VideoRemuxer]",
                ]
                .iter()
                .any(|marker| line.contains(marker))
            {
                processing_sent = true;
                let paused = stderr_app
                    .state::<AppState>()
                    .tray_jobs
                    .lock()
                    .expect("tray lock")
                    .get(&stderr_job_id)
                    .is_some_and(|job| job.status == "paused");
                if !paused {
                    emit_progress(
                        &stderr_app,
                        progress_event(&stderr_job_id, "processing", 99.0),
                    );
                }
            }
            let mut tail = stderr_capture.lock().await;
            if tail.len() == 20 {
                tail.pop_front();
            }
            tail.push_back(line);
        }
    });
    let mut lines = BufReader::new(stdout).lines();
    let mut output_path = None;
    loop {
        if cancelled.lock().await.remove(&request.job_id) {
            if let Some(pid) = child.id() {
                #[cfg(unix)]
                signal_process_group(pid, libc::SIGTERM);
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            remove_process(&app, &request.job_id);
            emit_progress(&app, progress_event(&request.job_id, "cancelled", 0.0));
            return;
        }
        match tokio::time::timeout(std::time::Duration::from_millis(150), lines.next_line()).await {
            Ok(Ok(Some(line))) if line.starts_with("MACTUBE|") => {
                let parts: Vec<_> = line.split('|').collect();
                let progress = parts
                    .get(1)
                    .map(|part| part.trim().trim_end_matches('%').parse().unwrap_or(0.0))
                    .unwrap_or(0.0);
                let mut event = progress_event(&request.job_id, "downloading", progress);
                event.speed = parts
                    .get(2)
                    .map(|part| part.trim().to_string())
                    .filter(|value| !value.is_empty());
                event.eta = parts
                    .get(3)
                    .map(|part| part.trim().to_string())
                    .filter(|value| !value.is_empty());
                emit_progress(&app, event);
            }
            Ok(Ok(Some(line))) if line.starts_with("MACTUBE_DONE|") => {
                output_path = Some(line[13..].to_string());
                emit_progress(&app, progress_event(&request.job_id, "processing", 99.0));
            }
            Ok(Ok(Some(_))) | Err(_) => {}
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                remove_process(&app, &request.job_id);
                let mut event = progress_event(&request.job_id, "failed", 0.0);
                event.error = Some(error.to_string());
                emit_progress(&app, event);
                notify(&app, "Download failed", &request.title);
                return;
            }
        }
    }
    let result = child.wait().await;
    let _ = stderr_task.await;
    remove_process(&app, &request.job_id);
    match result {
        Ok(status) if status.success() => {
            let path = output_path.unwrap_or_default();
            if !path.is_empty() {
                record_history(&app, &request, &path);
            }
            let mut event = progress_event(&request.job_id, "complete", 100.0);
            event.output_path = (!path.is_empty()).then_some(path);
            emit_progress(&app, event);
            notify(&app, "Download complete", &request.title);
        }
        Ok(_) => {
            let error = stderr_tail
                .lock()
                .await
                .iter()
                .rev()
                .find(|line| !line.trim().is_empty())
                .cloned()
                .unwrap_or_else(|| "Download failed".into());
            let mut event = progress_event(&request.job_id, "failed", 0.0);
            event.error = Some(error);
            emit_progress(&app, event);
            notify(&app, "Download failed", &request.title);
        }
        Err(error) => {
            let mut event = progress_event(&request.job_id, "failed", 0.0);
            event.error = Some(error.to_string());
            emit_progress(&app, event);
            notify(&app, "Download failed", &request.title);
        }
    }
}

#[tauri::command]
async fn start_downloads(
    app: AppHandle,
    state: State<'_, AppState>,
    jobs: Vec<DownloadRequest>,
) -> Result<(), String> {
    let _ = app.notification().request_permission();
    let settings = load_settings(&app);
    let semaphore = Arc::new(Semaphore::new(settings.concurrent_downloads.clamp(1, 4)));
    {
        let mut tray_jobs = state.tray_jobs.lock().expect("tray job lock");
        for job in &jobs {
            tray_jobs.insert(
                job.job_id.clone(),
                TrayJob {
                    title: job.title.clone(),
                    status: "queued".into(),
                    progress: 0.0,
                },
            );
        }
    }
    update_tray(&app);
    for job in jobs {
        emit_progress(&app, progress_event(&job.job_id, "queued", 0.0));
        let app = app.clone();
        let settings = settings.clone();
        let semaphore = semaphore.clone();
        let cancelled = state.cancelled.clone();
        tauri::async_runtime::spawn(async move {
            let Ok(_permit) = semaphore.acquire().await else {
                return;
            };
            run_download(app, job, settings, cancelled).await;
        });
    }
    Ok(())
}

#[tauri::command]
async fn cancel_download(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    state.cancelled.lock().await.insert(job_id.clone());
    if let Some(pid) = state
        .processes
        .lock()
        .expect("process lock")
        .get(&job_id)
        .copied()
    {
        #[cfg(unix)]
        signal_process_group(pid, libc::SIGTERM);
    }
    emit_progress(&app, progress_event(&job_id, "cancelled", 0.0));
    Ok(())
}

#[tauri::command]
fn pause_download(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let pid = state
        .processes
        .lock()
        .expect("process lock")
        .get(&job_id)
        .copied()
        .ok_or_else(|| "This download has not started yet.".to_string())?;
    #[cfg(unix)]
    signal_process_group(pid, libc::SIGSTOP);
    let progress = state
        .tray_jobs
        .lock()
        .expect("tray lock")
        .get(&job_id)
        .map(|job| job.progress)
        .unwrap_or_default();
    emit_progress(&app, progress_event(&job_id, "paused", progress));
    Ok(())
}

#[tauri::command]
fn resume_download(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    let pid = state
        .processes
        .lock()
        .expect("process lock")
        .get(&job_id)
        .copied()
        .ok_or_else(|| "This download is no longer running.".to_string())?;
    #[cfg(unix)]
    signal_process_group(pid, libc::SIGCONT);
    let progress = state
        .tray_jobs
        .lock()
        .expect("tray lock")
        .get(&job_id)
        .map(|job| job.progress)
        .unwrap_or_default();
    emit_progress(&app, progress_event(&job_id, "downloading", progress));
    Ok(())
}

fn terminate_all(app: &AppHandle) {
    let state = app.state::<AppState>();
    for pid in state.processes.lock().expect("process lock").values() {
        #[cfg(unix)]
        signal_process_group(*pid, libc::SIGTERM);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _| {
            if let Some(url) = argv
                .iter()
                .find(|argument| argument.starts_with("mactube://"))
            {
                let _ = app.emit("deep-link", url.clone());
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--background"]),
        ))
        .manage(AppState::default())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Open MacTube", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit MacTube", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("mactube")
                .icon(tray_icon())
                .icon_as_template(true)
                .tooltip("MacTube · Ready")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        terminate_all(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick {
                        button: MouseButton::Left,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;
            if std::env::args().any(|argument| argument == "--background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    let _ = handle.emit("deep-link", url.to_string());
                }
                if let Some(window) = handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            choose_output_folder,
            get_history,
            clear_history,
            reveal_in_finder,
            check_dependencies,
            get_initial_deep_links,
            fetch_metadata,
            start_downloads,
            cancel_download,
            pause_download,
            resume_download
        ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building MacTube");
    app.run(|handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            terminate_all(handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_never_falls_back_above_the_requested_height() {
        assert_eq!(format_selector("720"), "bv*[height<=720]+ba/b[height<=720]");
        assert!(!format_selector("720").contains("/bv*+ba/b"));
    }

    #[test]
    fn playlist_names_cannot_escape_the_download_directory() {
        assert_eq!(safe_component("../My: Mix/2026"), "_My_ Mix_2026");
        assert_eq!(safe_component("..."), "Playlist");
    }

    #[test]
    fn errors_use_the_last_non_empty_line() {
        assert_eq!(last_error(b"warning\n\nactual failure\n"), "actual failure");
    }
}
