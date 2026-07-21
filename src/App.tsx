import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  ExternalLink,
  Folder,
  Gauge,
  Headphones,
  History as HistoryIcon,
  Link2,
  ListVideo,
  LoaderCircle,
  Music2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Trash2,
  Video,
  X,
} from "lucide-react";
import type {
  DependencyStatus,
  DownloadErrorKind,
  DownloadFormat,
  HistoryItem,
  Job,
  ProgressEvent,
  Quality,
  Settings,
  VideoInfo,
} from "./types";
import { parseRanges, recoverJobs } from "./queue";
import appIcon from "../assets/app-icon.svg";

const QUEUE_KEY = "mactube.queue.v2";
const isTauri = () => "__TAURI_INTERNALS__" in window;
const DEFAULT_SETTINGS: Settings = {
  output_dir: "~/Downloads/MacTube",
  concurrent_downloads: 2,
  audio_format: "original",
  embed_metadata: true,
  embed_thumbnail: true,
  sponsorblock: false,
  launch_at_login: false,
};

type SaveState = "idle" | "saving" | "saved" | "failed";
type View = "queue" | "history";
interface PlaylistDraft {
  info: VideoInfo;
  selected: boolean;
  format: DownloadFormat;
  quality: Quality;
  audioFormat: string;
}
interface PlaylistState {
  title: string;
  items: PlaylistDraft[];
  cookieBrowser?: "chrome";
}
interface AppMessage {
  kind: "error" | "info" | "success";
  text: string;
  code?: DownloadErrorKind;
  retry?: { url: string; format: DownloadFormat };
}

function normalizedError(error: unknown): {
  kind: DownloadErrorKind;
  message: string;
} {
  if (error && typeof error === "object") {
    const candidate = error as { kind?: unknown; message?: unknown };
    if (
      typeof candidate.kind === "string" &&
      typeof candidate.message === "string"
    ) {
      return {
        kind: candidate.kind as DownloadErrorKind,
        message: candidate.message,
      };
    }
  }
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as { kind?: string; message?: string };
      if (parsed.kind && parsed.message) {
        return {
          kind: parsed.kind as DownloadErrorKind,
          message: parsed.message,
        };
      }
    } catch {}
  }
  return { kind: "other", message: String(error).replace(/^Error:\s*/, "") };
}

function secondsToTime(seconds: number | null) {
  if (!seconds) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch {
    return "video";
  }
}

function demoInfo(url: string): VideoInfo[] {
  return [
    {
      id: crypto.randomUUID(),
      title: "A beautifully made video",
      uploader: hostLabel(url),
      duration: 754,
      thumbnail: null,
      webpage_url: url,
      playlist_title: null,
      playlist_index: null,
    },
  ];
}

const qualityLabel = (quality: Quality) =>
  ({
    best: "Best available",
    2160: "4K · Ultra HD",
    1440: "1440p · Crisp",
    1080: "1080p · Recommended",
    720: "720p · Smaller",
    480: "480p · Compact",
  })[quality];
const audioLabel = (format: string) =>
  ({
    original: "Original · Full quality",
    mp3: "MP3 · Universal",
    m4a: "M4A · Apple",
    opus: "Opus · Efficient",
    flac: "FLAC · Lossless",
  })[format] || format.toUpperCase();

export default function App() {
  const [url, setUrl] = useState("");
  const [format, setFormat] = useState<DownloadFormat>("video");
  const [quality, setQuality] = useState<Quality>("best");
  const [jobs, setJobs] = useState<Job[]>(() =>
    recoverJobs(localStorage.getItem(QUEUE_KEY)),
  );
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [view, setView] = useState<View>("queue");
  const [playlist, setPlaylist] = useState<PlaylistState | null>(null);
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<AppMessage | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "done">(
    "all",
  );
  const [dependencies, setDependencies] = useState<DependencyStatus | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<number | null>(null);
  const saveVersion = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  const refreshHistory = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setHistory(await invoke<HistoryItem[]>("get_history"));
    } catch (error) {
      setMessage({
        kind: "error",
        text: `Couldn’t load history: ${String(error)}`,
      });
    }
  }, []);

  const enqueueInfos = useCallback(
    (
      infos: VideoInfo[],
      chosenFormat: DownloadFormat,
      chosenQuality: Quality,
      audioFormat: string,
      cookieBrowser?: "chrome",
    ) => {
      const known = new Set([
        ...jobs.map((job) => job.info.id),
        ...history.map((item) => item.video_id),
      ]);
      const fresh = infos.filter((info) => !known.has(info.id));
      const duplicates = infos.length - fresh.length;
      if (duplicates)
        setMessage({
          kind: "info",
          text: `Skipped ${duplicates} ${duplicates === 1 ? "duplicate" : "duplicates"} already queued or downloaded.`,
        });
      if (!fresh.length) return;
      const newJobs: Job[] = fresh.map((info) => ({
        id: crypto.randomUUID(),
        sourceUrl: info.webpage_url,
        info,
        format: chosenFormat,
        quality: chosenQuality,
        audioFormat,
        cookieBrowser,
        status: "waiting",
        progress: 0,
      }));
      setJobs((current) => [...current, ...newJobs]);
      setView("queue");
    },
    [jobs, history],
  );

  const inspectUrl = useCallback(
    async (
      target: string,
      chosenFormat: DownloadFormat,
      cookieBrowser?: "chrome",
    ) => {
      if (!target || fetching) return;
      setFetching(true);
      setMessage(null);
      try {
        const infos = isTauri()
          ? await invoke<VideoInfo[]>("fetch_metadata", {
              url: target,
              cookieBrowser,
            })
          : demoInfo(target);
        if (!infos.length)
          throw new Error("No downloadable videos were found at that link.");
        if (infos.length > 1) {
          setPlaylist({
            title: infos[0].playlist_title || "Playlist",
            cookieBrowser,
            items: infos.map((info) => ({
              info,
              selected: true,
              format: chosenFormat,
              quality,
              audioFormat: settings.audio_format,
            })),
          });
        } else {
          enqueueInfos(
            infos,
            chosenFormat,
            "best",
            cookieBrowser ? "original" : settings.audio_format,
            cookieBrowser,
          );
        }
        setUrl("");
      } catch (error) {
        const classified = normalizedError(error);
        setMessage({
          kind: "error",
          text: classified.message,
          code: classified.kind,
          retry:
            classified.kind === "auth_required" && !cookieBrowser
              ? { url: target, format: chosenFormat }
              : undefined,
        });
      } finally {
        setFetching(false);
      }
    },
    [fetching, quality, settings.audio_format, enqueueInfos],
  );

  const handleDeepLink = useCallback(
    async (payload: string) => {
      try {
        const incoming = new URL(payload);
        const target = incoming.searchParams.get("url");
        if (!target) return;
        const incomingFormat: DownloadFormat =
          incoming.searchParams.get("mode") === "audio" ? "audio" : "video";
        const cookieBrowser =
          incoming.searchParams.get("cookies") === "chrome"
            ? ("chrome" as const)
            : undefined;
        setFormat(incomingFormat);
        await inspectUrl(target, incomingFormat, cookieBrowser);
      } catch (error) {
        setMessage({
          kind: "error",
          text: `Couldn’t open extension link: ${String(error)}`,
        });
      }
    },
    [inspectUrl],
  );

  const deepLinkHandler = useRef(handleDeepLink);
  useEffect(() => {
    deepLinkHandler.current = handleDeepLink;
  }, [handleDeepLink]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(
        QUEUE_KEY,
        JSON.stringify(
          jobs.filter((job) => !["complete", "cancelled"].includes(job.status)),
        ),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [jobs]);

  useEffect(() => {
    if (!isTauri()) return;
    invoke<Settings>("get_settings")
      .then(setSettings)
      .catch((error) =>
        setMessage({
          kind: "error",
          text: `Preferences couldn’t load: ${String(error)}`,
        }),
      );
    invoke<DependencyStatus>("check_dependencies")
      .then(setDependencies)
      .catch(() =>
        setDependencies({ ytdlp: false, ffmpeg: false, ytdlp_version: null }),
      );
    void refreshHistory();
    const unlistenProgress = listen<ProgressEvent>(
      "download-progress",
      ({ payload }) => {
        setJobs((current) =>
          current.map((job) =>
            job.id === payload.job_id
              ? {
                  ...job,
                  status: payload.status,
                  progress: payload.progress,
                  speed: payload.speed,
                  eta: payload.eta,
                  outputPath: payload.output_path,
                  error: payload.error,
                  errorKind: payload.error_kind,
                }
              : job,
          ),
        );
        if (payload.status === "complete") void refreshHistory();
      },
    );
    const unlistenDeepLink = listen<string>("deep-link", ({ payload }) => {
      void deepLinkHandler.current(payload);
    });
    Promise.all([unlistenProgress, unlistenDeepLink])
      .then(() => invoke<string[]>("get_initial_deep_links"))
      .then((links) =>
        links.forEach((link) => void deepLinkHandler.current(link)),
      )
      .catch((error) =>
        setMessage({
          kind: "error",
          text: `Startup link couldn’t be read: ${String(error)}`,
        }),
      );
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenDeepLink.then((fn) => fn());
    };
  }, [refreshHistory]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (playlist) setPlaylist(null);
      else if (settingsOpen) setSettingsOpen(false);
      else setQualityOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [playlist, settingsOpen]);

  const addUrl = () => inspectUrl(url.trim(), format);

  const startQueue = async () => {
    const waiting = jobs.filter((job) =>
      ["waiting", "failed"].includes(job.status),
    );
    if (!waiting.length || submitting) return;
    setSubmitting(true);
    setMessage(null);
    const ids = new Set(waiting.map((job) => job.id));
    setJobs((current) =>
      current.map((job) =>
        ids.has(job.id)
          ? { ...job, status: "queued", progress: 0, error: undefined }
          : job,
      ),
    );
    if (!isTauri()) {
      waiting.forEach((job, index) =>
        window.setTimeout(() => simulate(job.id), index * 400),
      );
      setSubmitting(false);
      return;
    }
    try {
      await invoke("start_downloads", {
        jobs: waiting.map((job) => ({
          job_id: job.id,
          video_id: job.info.id,
          url: job.sourceUrl,
          title: job.info.title,
          uploader: job.info.uploader,
          thumbnail: job.info.thumbnail,
          format: job.format,
          quality: job.quality,
          audio_format: job.audioFormat,
          playlist_title: job.info.playlist_title,
          playlist_index: job.info.playlist_index,
          cookie_browser: job.cookieBrowser,
        })),
      });
    } catch (error) {
      setJobs((current) =>
        current.map((job) =>
          ids.has(job.id)
            ? { ...job, status: "waiting", error: String(error) }
            : job,
        ),
      );
      setMessage({
        kind: "error",
        text: `Queue couldn’t start: ${String(error)}`,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const simulate = (id: string) => {
    let progress = 0;
    const timer = window.setInterval(() => {
      progress += 5 + Math.random() * 7;
      setJobs((current) =>
        current.map((job) =>
          job.id === id
            ? {
                ...job,
                status: progress >= 100 ? "complete" : "downloading",
                progress: Math.min(100, progress),
                speed: "8.4 MB/s",
                eta: `${Math.max(0, Math.ceil((100 - progress) / 10))}s`,
              }
            : job,
        ),
      );
      if (progress >= 100) clearInterval(timer);
    }, 350);
  };

  const jobAction = async (
    command: "cancel_download" | "pause_download" | "resume_download",
    id: string,
  ) => {
    if (!isTauri()) {
      setJobs((current) =>
        current.map((job) =>
          job.id === id
            ? {
                ...job,
                status:
                  command === "pause_download"
                    ? "paused"
                    : command === "resume_download"
                      ? "downloading"
                      : "cancelled",
              }
            : job,
        ),
      );
      return;
    }
    try {
      await invoke(command, { jobId: id });
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    }
  };

  const chooseFolder = async () => {
    if (!isTauri()) return;
    try {
      const selected = await invoke<string | null>("choose_output_folder");
      if (selected) await saveSettings({ ...settings, output_dir: selected });
    } catch (error) {
      setMessage({
        kind: "error",
        text: `Folder couldn’t be changed: ${String(error)}`,
      });
    }
  };

  const saveSettings = async (next: Settings) => {
    setSettings(next);
    setSaveState("saving");
    const version = ++saveVersion.current;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (!isTauri()) {
      setSaveState("saved");
      return;
    }
    try {
      saveChain.current = saveChain.current
        .catch(() => {})
        .then(async () => {
          await invoke("save_settings", { settings: next });
        });
      await saveChain.current;
      if (saveVersion.current === version) {
        setSaveState("saved");
        saveTimer.current = window.setTimeout(() => setSaveState("idle"), 1400);
      }
    } catch (error) {
      if (saveVersion.current === version) setSaveState("failed");
      setMessage({
        kind: "error",
        text: `Preference wasn’t saved: ${String(error)}`,
      });
    }
  };

  const reveal = async (path: string) => {
    try {
      await invoke("reveal_in_finder", { path });
    } catch (error) {
      setMessage({ kind: "error", text: String(error) });
    }
  };

  const filteredJobs = useMemo(
    () =>
      jobs.filter(
        (job) =>
          activeFilter === "all" ||
          (activeFilter === "active"
            ? [
                "waiting",
                "queued",
                "downloading",
                "paused",
                "processing",
              ].includes(job.status)
            : job.status === "complete"),
      ),
    [jobs, activeFilter],
  );
  const active = jobs.filter((job) =>
    ["queued", "downloading", "paused", "processing"].includes(job.status),
  ).length;
  const waitingCount = jobs.filter((job) =>
    ["waiting", "failed"].includes(job.status),
  ).length;
  const completed = jobs.filter((job) => job.status === "complete").length;

  return (
    <main>
      <header className="titlebar" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <div className="brand-mark">
            <img src={appIcon} alt="" />
          </div>
          <span>MacTube</span>
        </div>
        <div className="header-actions">
          <nav className="view-tabs" aria-label="Main views">
            <button
              className={view === "queue" ? "active" : ""}
              onClick={() => setView("queue")}
            >
              Queue{jobs.length > 0 && <b>{jobs.length}</b>}
            </button>
            <button
              className={view === "history" ? "active" : ""}
              onClick={() => setView("history")}
            >
              History
            </button>
          </nav>
          <button
            className="icon-button"
            aria-label="Open preferences"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>

      {dependencies && (!dependencies.ytdlp || !dependencies.ffmpeg) && (
        <div className="dependency-banner" role="status">
          <CircleAlert size={15} />
          <span>
            <strong>One quick setup step</strong> Install{" "}
            {!dependencies.ytdlp && !dependencies.ffmpeg
              ? "yt-dlp and FFmpeg"
              : !dependencies.ytdlp
                ? "yt-dlp"
                : "FFmpeg"}{" "}
            with Homebrew before downloading.
          </span>
          <code>brew install yt-dlp ffmpeg</code>
        </div>
      )}
      {message && (
        <div
          className={`toast ${message.kind}`}
          role="status"
          aria-live="polite"
        >
          <span>{message.text}</span>
          {message.retry && (
            <button
              className="toast-action"
              onClick={() => {
                const retry = message.retry;
                setMessage(null);
                if (retry) void inspectUrl(retry.url, retry.format, "chrome");
              }}
            >
              Use Chrome sign-in
            </button>
          )}
          <button aria-label="Dismiss message" onClick={() => setMessage(null)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className={`app-content ${view}-content`}>
        {view === "queue" ? (
          <>
            <section className="hero">
              <div className="eyebrow">
                <Sparkles size={13} /> Your videos, beautifully offline
              </div>
              <h1>Save what you love.</h1>
              <p>Videos, playlists, and audio. Fast, private, and yours.</p>
              <div
                className={`url-box ${message?.kind === "error" ? "has-error" : ""}`}
              >
                <Link2 size={19} />
                <input
                  ref={inputRef}
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && addUrl()}
                  placeholder="Paste a video or playlist link…"
                  spellCheck={false}
                  autoFocus
                  aria-label="Video or playlist URL"
                />
                {url && (
                  <button
                    className="clear"
                    aria-label="Clear URL"
                    onClick={() => setUrl("")}
                  >
                    <X size={15} />
                  </button>
                )}
                <button
                  className="add-button"
                  disabled={!url.trim() || fetching}
                  onClick={addUrl}
                >
                  {fetching ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  <span>{fetching ? "Reading link…" : "Add"}</span>
                </button>
              </div>
              <div className="quick-options">
                <Segmented
                  value={format}
                  onChange={(value) => setFormat(value as DownloadFormat)}
                  items={[
                    {
                      value: "video",
                      label: "Video",
                      icon: <Video size={14} />,
                    },
                    {
                      value: "audio",
                      label: "Audio",
                      icon: <Headphones size={14} />,
                    },
                  ]}
                />
                <div className="quality-control">
                  <button
                    className="quality-trigger"
                    aria-expanded={qualityOpen}
                    onClick={() => setQualityOpen((open) => !open)}
                  >
                    <Gauge size={14} />
                    <span>
                      {format === "audio"
                        ? audioLabel(settings.audio_format)
                        : qualityLabel(quality)}
                    </span>
                    <ChevronDown size={13} />
                  </button>
                  {qualityOpen && (
                    <QualityMenu
                      format={format}
                      quality={quality}
                      audioFormat={settings.audio_format}
                      onVideo={(value) => {
                        setQuality(value);
                        setQualityOpen(false);
                      }}
                      onAudio={(value) => {
                        void saveSettings({ ...settings, audio_format: value });
                        setQualityOpen(false);
                      }}
                      onClose={() => setQualityOpen(false)}
                    />
                  )}
                </div>
                <button
                  className="folder-pill"
                  onClick={chooseFolder}
                  title={settings.output_dir}
                >
                  <Folder size={14} />
                  <span>
                    {settings.output_dir.split("/").pop() || "Downloads"}
                  </span>
                </button>
              </div>
            </section>
            <section className="queue-section">
              <div className="queue-head">
                <div>
                  <h2>Queue</h2>
                  <span>
                    {jobs.length
                      ? `${jobs.length} ${jobs.length === 1 ? "item" : "items"}`
                      : "Ready when you are"}
                  </span>
                </div>
                <div className="queue-actions">
                  {jobs.length > 0 && (
                    <div className="filters">
                      {(["all", "active", "done"] as const).map((filter) => (
                        <button
                          key={filter}
                          className={activeFilter === filter ? "active" : ""}
                          onClick={() => setActiveFilter(filter)}
                        >
                          {filter}
                        </button>
                      ))}
                    </div>
                  )}
                  {jobs.length > 0 && (
                    <button
                      className="text-button danger"
                      onClick={() =>
                        setJobs((current) =>
                          current.filter((job) =>
                            [
                              "queued",
                              "downloading",
                              "paused",
                              "processing",
                            ].includes(job.status),
                          ),
                        )
                      }
                    >
                      <Trash2 size={14} />
                      Clear inactive
                    </button>
                  )}
                </div>
              </div>
              {!jobs.length ? (
                <EmptyState onFocus={() => inputRef.current?.focus()} />
              ) : (
                <div className="job-list">
                  {filteredJobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onRemove={() =>
                        setJobs((current) =>
                          current.filter((item) => item.id !== job.id),
                        )
                      }
                      onCancel={() => void jobAction("cancel_download", job.id)}
                      onPause={() => void jobAction("pause_download", job.id)}
                      onResume={() => void jobAction("resume_download", job.id)}
                      onReveal={() =>
                        job.outputPath && void reveal(job.outputPath)
                      }
                      onRetry={() =>
                        setJobs((current) =>
                          current.map((item) =>
                            item.id === job.id
                              ? {
                                  ...item,
                                  status: "waiting",
                                  progress: 0,
                                  error: undefined,
                                  errorKind: undefined,
                                  cookieBrowser:
                                    item.errorKind === "auth_required"
                                      ? "chrome"
                                      : item.cookieBrowser,
                                  quality:
                                    item.errorKind === "no_compatible_format"
                                      ? "best"
                                      : item.quality,
                                  audioFormat:
                                    item.errorKind === "no_compatible_format"
                                      ? "original"
                                      : item.audioFormat,
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  ))}
                </div>
              )}
            </section>
            {jobs.length > 0 && (
              <footer className="action-bar">
                <div className="queue-summary">
                  <span className={active ? "pulse-dot" : "dot"} />
                  {active
                    ? `${active} active${waitingCount ? ` · ${waitingCount} waiting` : ""}`
                    : waitingCount
                      ? `${waitingCount} ready to download`
                      : `${completed} complete`}
                </div>
                <button
                  className="download-button"
                  disabled={!waitingCount || submitting || active > 0}
                  onClick={startQueue}
                >
                  {submitting ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Download size={17} />
                  )}{" "}
                  {submitting
                    ? "Starting queue…"
                    : active && waitingCount
                      ? "Waiting for current batch…"
                      : waitingCount
                        ? `Download ${waitingCount} ${waitingCount === 1 ? "item" : "items"}`
                        : "All done"}
                </button>
              </footer>
            )}
          </>
        ) : (
          <HistoryView
            history={history}
            onReveal={(path) => void reveal(path)}
            onClear={async () => {
              try {
                await invoke("clear_history");
                setHistory([]);
              } catch (error) {
                setMessage({ kind: "error", text: String(error) });
              }
            }}
          />
        )}
      </div>

      {playlist && (
        <PlaylistPreview
          state={playlist}
          onClose={() => setPlaylist(null)}
          onAdd={(items) => {
            const chosen = items.filter((item) => item.selected);
            const known = new Set([
              ...jobs.map((job) => job.info.id),
              ...history.map((item) => item.video_id),
            ]);
            const fresh = chosen.filter((item) => !known.has(item.info.id));
            if (fresh.length !== chosen.length)
              setMessage({
                kind: "info",
                text: `Skipped ${chosen.length - fresh.length} duplicate ${chosen.length - fresh.length === 1 ? "item" : "items"}.`,
              });
            setJobs((current) => [
              ...current,
              ...fresh.map((item) => ({
                id: crypto.randomUUID(),
                sourceUrl: item.info.webpage_url,
                info: item.info,
                format: item.format,
                quality: item.quality,
                audioFormat: item.audioFormat,
                cookieBrowser: playlist.cookieBrowser,
                status: "waiting" as const,
                progress: 0,
              })),
            ]);
            setPlaylist(null);
            setView("queue");
          }}
        />
      )}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          saveState={saveState}
          onChange={(next) => void saveSettings(next)}
          onChooseFolder={chooseFolder}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function Segmented({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string; icon: React.ReactNode }[];
}) {
  return (
    <div className="segmented">
      {items.map((item) => (
        <button
          key={item.value}
          className={value === item.value ? "active" : ""}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function QualityMenu({
  format,
  quality,
  audioFormat,
  onVideo,
  onAudio,
  onClose,
}: {
  format: DownloadFormat;
  quality: Quality;
  audioFormat: string;
  onVideo: (quality: Quality) => void;
  onAudio: (format: string) => void;
  onClose: () => void;
}) {
  const videoOptions = [
    {
      value: "best",
      name: "Best available",
      detail: "The finest version offered",
      badge: "Auto",
    },
    { value: "2160", name: "4K", detail: "Ultra HD · largest file" },
    { value: "1440", name: "1440p", detail: "Extra crisp on large screens" },
    {
      value: "1080",
      name: "1080p",
      detail: "Beautiful quality, sensible size",
      badge: "Best balance",
    },
    { value: "720", name: "720p", detail: "Sharp and lightweight" },
    { value: "480", name: "480p", detail: "Smallest, fastest download" },
  ];
  const audioOptions = [
    {
      value: "original",
      name: "Original",
      detail: "Best source audio, untouched",
      badge: "Full quality",
    },
    { value: "mp3", name: "MP3", detail: "Plays everywhere" },
    { value: "m4a", name: "M4A", detail: "Native on Apple devices" },
    { value: "opus", name: "Opus", detail: "Efficient, excellent sound" },
    {
      value: "flac",
      name: "FLAC",
      detail: "Lossless container · largest file",
    },
  ];
  const options = format === "video" ? videoOptions : audioOptions;
  return (
    <>
      <button
        className="menu-dismiss"
        aria-label="Close quality menu"
        onClick={onClose}
      />
      <div
        className="quality-menu"
        role="dialog"
        aria-label={format === "video" ? "Video quality" : "Audio format"}
      >
        <div className="quality-menu-head">
          <strong>
            {format === "video" ? "Video quality" : "Audio format"}
          </strong>
          <span>
            {format === "video"
              ? "Audio is included automatically"
              : "Original preserves the source without transcoding"}
          </span>
        </div>
        <div className="quality-options">
          {options.map((option) => {
            const selected =
              format === "video"
                ? quality === option.value
                : audioFormat === option.value;
            return (
              <button
                key={option.value}
                className={selected ? "selected" : ""}
                onClick={() =>
                  format === "video"
                    ? onVideo(option.value as Quality)
                    : onAudio(option.value)
                }
              >
                <i>{selected && <Check size={13} />}</i>
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.detail}</small>
                </span>
                {option.badge && <b>{option.badge}</b>}
              </button>
            );
          })}
        </div>
        {format === "video" && (
          <p>
            <Sparkles size={11} />
            If the exact quality isn’t available, MacTube picks the closest one
            below it.
          </p>
        )}
      </div>
    </>
  );
}

function EmptyState({ onFocus }: { onFocus: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-visual">
        <div className="stack-card one" />
        <div className="stack-card two" />
        <div className="stack-card front">
          <ListVideo size={25} />
          <span />
          <span />
        </div>
      </div>
      <h3>Your queue is quiet</h3>
      <p>
        Paste a link above, or add a whole playlist.
        <br />
        We’ll take care of the rest.
      </p>
      <button onClick={onFocus}>
        <Plus size={15} />
        Add your first video
      </button>
    </div>
  );
}

function JobRow({
  job,
  onRemove,
  onCancel,
  onPause,
  onResume,
  onReveal,
  onRetry,
}: {
  job: Job;
  onRemove: () => void;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onReveal: () => void;
  onRetry: () => void;
}) {
  const working = ["queued", "downloading", "paused", "processing"].includes(
    job.status,
  );
  const indeterminate =
    job.status === "queued" ||
    job.status === "processing" ||
    (job.status === "downloading" && job.progress === 0);
  return (
    <article className={`job-row ${job.status}`}>
      <div className="thumbnail">
        {job.info.thumbnail ? (
          <img src={job.info.thumbnail} alt="" loading="lazy" />
        ) : (
          <div className="thumb-placeholder">
            {job.format === "audio" ? <Music2 size={22} /> : <Play size={22} />}
          </div>
        )}
        <span className="duration">{secondsToTime(job.info.duration)}</span>
      </div>
      <div className="job-main">
        <div className="job-title-line">
          <h3 title={job.info.title}>{job.info.title}</h3>
          <span className={`status status-${job.status}`}>
            {["queued", "downloading", "processing"].includes(job.status) && (
              <LoaderCircle className="spin" size={10} />
            )}{" "}
            {job.status}
          </span>
        </div>
        <div className="job-meta">
          <span>{job.info.uploader || hostLabel(job.sourceUrl)}</span>
          <i />
          <span>
            {job.format === "audio"
              ? audioLabel(job.audioFormat || "original")
              : job.quality === "best"
                ? "Best quality"
                : `${job.quality}p`}
          </span>
          {job.cookieBrowser && (
            <>
              <i />
              <span>Chrome sign-in</span>
            </>
          )}
          {job.info.playlist_title && (
            <>
              <i />
              <span>{job.info.playlist_title}</span>
            </>
          )}
        </div>
        {working && (
          <div className="progress-row">
            <div
              className={`progress-track ${indeterminate ? "indeterminate" : ""}`}
            >
              <span
                style={
                  indeterminate ? undefined : { width: `${job.progress}%` }
                }
              />
            </div>
            <small>
              {job.status === "queued"
                ? "Waiting for a download slot…"
                : job.status === "paused"
                  ? `Paused at ${Math.round(job.progress)}%`
                  : job.status === "processing"
                    ? "Embedding artwork and metadata…"
                    : `${Math.round(job.progress)}% · ${job.speed || "Connecting…"}${job.eta ? ` · ${job.eta} left` : ""}`}
            </small>
          </div>
        )}
        {job.status === "complete" && (
          <div className="complete-line">
            <Check size={12} />
            Saved <button onClick={onReveal}>Reveal in Finder</button>
          </div>
        )}
        {job.error && (
          <div
            className={`job-error error-${job.errorKind || "other"}`}
            title={job.error}
          >
            {job.errorKind === "auth_required" && (
              <strong>Sign-in required</strong>
            )}
            {job.errorKind === "drm_protected" && (
              <strong>DRM protected</strong>
            )}
            {job.errorKind === "no_compatible_format" && (
              <strong>No compatible format</strong>
            )}
            <span>{job.error}</span>
          </div>
        )}
      </div>
      <div className="job-controls">
        {job.status === "downloading" ? (
          <>
            <button onClick={onPause} aria-label="Pause download" title="Pause">
              <Pause size={15} />
            </button>
            <button
              onClick={onCancel}
              aria-label="Cancel download"
              title="Cancel"
            >
              <X size={16} />
            </button>
          </>
        ) : job.status === "paused" ? (
          <>
            <button
              onClick={onResume}
              aria-label="Resume download"
              title="Resume"
            >
              <Play size={15} />
            </button>
            <button
              onClick={onCancel}
              aria-label="Cancel download"
              title="Cancel"
            >
              <X size={16} />
            </button>
          </>
        ) : job.status === "queued" || job.status === "processing" ? (
          <button
            onClick={onCancel}
            aria-label="Cancel download"
            title="Cancel"
          >
            <X size={17} />
          </button>
        ) : job.status === "failed" && job.errorKind === "drm_protected" ? (
          <button
            onClick={onRemove}
            aria-label="Remove from queue"
            title="Remove"
          >
            <Trash2 size={16} />
          </button>
        ) : job.status === "failed" || job.status === "cancelled" ? (
          <button onClick={onRetry} aria-label="Retry download" title="Retry">
            <RotateCcw size={16} />
          </button>
        ) : job.status === "complete" ? (
          <button
            onClick={onReveal}
            aria-label="Reveal in Finder"
            title="Reveal in Finder"
          >
            <ExternalLink size={16} />
          </button>
        ) : (
          <button
            onClick={onRemove}
            aria-label="Remove from queue"
            title="Remove"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>
    </article>
  );
}

function PlaylistPreview({
  state,
  onClose,
  onAdd,
}: {
  state: PlaylistState;
  onClose: () => void;
  onAdd: (items: PlaylistDraft[]) => void;
}) {
  const [items, setItems] = useState(state.items);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState("");
  const visible = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      `${item.info.title} ${item.info.uploader}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const selected = items.filter((item) => item.selected).length;
  const update = (index: number, patch: Partial<PlaylistDraft>) =>
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="playlist-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-title"
      >
        <div className="playlist-head">
          <div>
            <span className="eyebrow">
              <ListVideo size={12} />
              Playlist preview
            </span>
            <h2 id="playlist-title">{state.title}</h2>
            <p>
              {items.length} videos · {selected} selected
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close playlist preview"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="playlist-tools">
          <label className="playlist-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search this playlist…"
              autoFocus
            />
          </label>
          <button
            onClick={() =>
              setItems((current) =>
                current.map((item) => ({ ...item, selected: true })),
              )
            }
          >
            Select all
          </button>
          <button
            onClick={() =>
              setItems((current) =>
                current.map((item) => ({ ...item, selected: false })),
              )
            }
          >
            None
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const chosen = parseRanges(range, items.length);
              setItems((current) =>
                current.map((item, index) => ({
                  ...item,
                  selected: chosen.has(index),
                })),
              );
            }}
          >
            <input
              value={range}
              onChange={(event) => setRange(event.target.value)}
              placeholder="1-12, 18, 24-30"
              aria-label="Selection ranges"
            />
            <button>Apply range</button>
          </form>
        </div>
        <div className="playlist-bulk">
          <span>Apply to selected:</span>
          <button
            onClick={() =>
              setItems((current) =>
                current.map((item) =>
                  item.selected
                    ? { ...item, format: "video", quality: "best" }
                    : item,
                ),
              )
            }
          >
            <Video size={13} />
            Best video
          </button>
          <button
            onClick={() =>
              setItems((current) =>
                current.map((item) =>
                  item.selected
                    ? { ...item, format: "audio", audioFormat: "original" }
                    : item,
                ),
              )
            }
          >
            <Headphones size={13} />
            Original audio
          </button>
          <button
            onClick={() =>
              setItems((current) =>
                current.map((item) =>
                  item.selected
                    ? { ...item, format: "video", quality: "1080" }
                    : item,
                ),
              )
            }
          >
            1080p
          </button>
        </div>
        <div className="playlist-list">
          {visible.map(({ item, index }) => (
            <article
              className={!item.selected ? "unselected" : ""}
              key={item.info.id}
            >
              <label>
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={(event) =>
                    update(index, { selected: event.target.checked })
                  }
                />
                <span>{item.info.playlist_index}</span>
              </label>
              <div className="mini-thumb">
                {item.info.thumbnail ? (
                  <img src={item.info.thumbnail} alt="" loading="lazy" />
                ) : (
                  <Play size={14} />
                )}
              </div>
              <div className="playlist-item-title">
                <strong>{item.info.title}</strong>
                <small>
                  {item.info.uploader} · {secondsToTime(item.info.duration)}
                </small>
              </div>
              <select
                value={item.format}
                onChange={(event) =>
                  update(index, {
                    format: event.target.value as DownloadFormat,
                  })
                }
                aria-label={`Format for ${item.info.title}`}
              >
                <option value="video">Video</option>
                <option value="audio">Audio</option>
              </select>
              <select
                value={
                  item.format === "video" ? item.quality : item.audioFormat
                }
                onChange={(event) =>
                  item.format === "video"
                    ? update(index, { quality: event.target.value as Quality })
                    : update(index, { audioFormat: event.target.value })
                }
                aria-label={`Quality for ${item.info.title}`}
              >
                {item.format === "video" ? (
                  <>
                    <option value="best">Best</option>
                    <option value="2160">4K</option>
                    <option value="1440">1440p</option>
                    <option value="1080">1080p</option>
                    <option value="720">720p</option>
                    <option value="480">480p</option>
                  </>
                ) : (
                  <>
                    <option value="original">Original</option>
                    <option value="mp3">MP3</option>
                    <option value="m4a">M4A</option>
                    <option value="opus">Opus</option>
                    <option value="flac">FLAC</option>
                  </>
                )}
              </select>
            </article>
          ))}
        </div>
        <footer>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="download-button"
            disabled={!selected}
            onClick={() => onAdd(items)}
          >
            <Plus size={16} />
            Add {selected} to queue
          </button>
        </footer>
      </section>
    </div>
  );
}

function HistoryView({
  history,
  onReveal,
  onClear,
}: {
  history: HistoryItem[];
  onReveal: (path: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="history-view">
      <div className="history-head">
        <div>
          <span className="eyebrow">
            <HistoryIcon size={12} />
            Library
          </span>
          <h1>Download history</h1>
          <p>
            {history.length
              ? `${history.length} saved ${history.length === 1 ? "item" : "items"}`
              : "Everything you save will appear here."}
          </p>
        </div>
        {history.length > 0 && (
          <button className="text-button danger" onClick={onClear}>
            <Trash2 size={14} />
            Clear history
          </button>
        )}
      </div>
      {!history.length ? (
        <div className="history-empty">
          <HistoryIcon size={28} />
          <h3>No downloads yet</h3>
          <p>Your completed videos and music will be easy to find here.</p>
        </div>
      ) : (
        <div className="history-grid">
          {history.map((item) => (
            <article key={item.id}>
              <div className="history-thumb">
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt="" loading="lazy" />
                ) : item.format === "audio" ? (
                  <Music2 size={22} />
                ) : (
                  <Video size={22} />
                )}
              </div>
              <div>
                <h3 title={item.title}>{item.title}</h3>
                <p>{item.uploader || hostLabel(item.source_url)}</p>
                <small>
                  {new Date(item.completed_at * 1000).toLocaleDateString(
                    undefined,
                    { month: "short", day: "numeric", year: "numeric" },
                  )}{" "}
                  ·{" "}
                  {item.format === "audio"
                    ? audioLabel(item.quality)
                    : item.quality === "best"
                      ? "Best quality"
                      : `${item.quality}p`}
                </small>
              </div>
              <button onClick={() => onReveal(item.output_path)}>
                <Folder size={14} />
                Reveal
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsPanel({
  settings,
  saveState,
  onChange,
  onChooseFolder,
  onClose,
}: {
  settings: Settings;
  saveState: SaveState;
  onChange: (settings: Settings) => void;
  onChooseFolder: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <aside
        className="settings-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preferences-title"
      >
        <div className="sheet-head">
          <div>
            <h2 id="preferences-title">Preferences</h2>
            <p>Make MacTube yours.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Close preferences"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="setting-group">
          <label>Download location</label>
          <button className="path-picker" onClick={onChooseFolder}>
            <Folder size={17} />
            <span>{settings.output_dir}</span>
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="setting-group">
          <label>Simultaneous downloads</label>
          <div className="stepper">
            <button
              aria-label="Fewer simultaneous downloads"
              onClick={() =>
                onChange({
                  ...settings,
                  concurrent_downloads: Math.max(
                    1,
                    settings.concurrent_downloads - 1,
                  ),
                })
              }
            >
              −
            </button>
            <span>{settings.concurrent_downloads}</span>
            <button
              aria-label="More simultaneous downloads"
              onClick={() =>
                onChange({
                  ...settings,
                  concurrent_downloads: Math.min(
                    4,
                    settings.concurrent_downloads + 1,
                  ),
                })
              }
            >
              +
            </button>
          </div>
          <small>Fewer jobs use less memory and bandwidth.</small>
        </div>
        <div className="setting-group">
          <label>Audio format</label>
          <div className="format-grid">
            {["original", "mp3", "m4a", "opus", "flac"].map((value) => (
              <button
                className={settings.audio_format === value ? "active" : ""}
                onClick={() => onChange({ ...settings, audio_format: value })}
                key={value}
              >
                {value === "original" ? "ORIGINAL" : value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-group toggles">
          <Toggle
            label="Launch at login"
            detail="Stay ready in the menu bar"
            checked={settings.launch_at_login}
            onChange={(value) =>
              onChange({ ...settings, launch_at_login: value })
            }
          />
          <Toggle
            label="Embed metadata"
            detail="Title, artist, and album data"
            checked={settings.embed_metadata}
            onChange={(value) =>
              onChange({ ...settings, embed_metadata: value })
            }
          />
          <Toggle
            label="Embed thumbnail"
            detail="Add artwork to downloaded files"
            checked={settings.embed_thumbnail}
            onChange={(value) =>
              onChange({ ...settings, embed_thumbnail: value })
            }
          />
          <Toggle
            label="Skip sponsored segments"
            detail="Uses SponsorBlock when available"
            checked={settings.sponsorblock}
            onChange={(value) => onChange({ ...settings, sponsorblock: value })}
          />
        </div>
        <div className={`save-status ${saveState}`} aria-live="polite">
          {saveState === "saving" && (
            <>
              <LoaderCircle className="spin" size={12} />
              Saving…
            </>
          )}
          {saveState === "saved" && (
            <>
              <Check size={12} />
              Saved
            </>
          )}
          {saveState === "failed" && (
            <>
              <CircleAlert size={12} />
              Couldn’t save
            </>
          )}
        </div>
        <div className="sheet-foot">
          <div>
            <strong>Powered by yt-dlp</strong>
            <span>Private by design. No analytics.</span>
          </div>
          <button onClick={onClose}>Done</button>
        </div>
      </aside>
    </div>
  );
}

function Toggle({
  label,
  detail,
  checked,
  onChange,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      className="toggle-row"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      <i className={checked ? "on" : ""}>
        <b />
      </i>
    </button>
  );
}
