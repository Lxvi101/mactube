export type DownloadFormat = "video" | "audio";
export type Quality = "best" | "2160" | "1440" | "1080" | "720" | "480";
export type JobStatus =
  | "waiting"
  | "queued"
  | "downloading"
  | "paused"
  | "processing"
  | "complete"
  | "failed"
  | "cancelled";

export interface VideoInfo {
  id: string;
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  webpage_url: string;
  playlist_title: string | null;
  playlist_index: number | null;
}

export interface Job {
  id: string;
  sourceUrl: string;
  info: VideoInfo;
  format: DownloadFormat;
  quality: Quality;
  audioFormat?: string;
  cookieBrowser?: "chrome";
  status: JobStatus;
  progress: number;
  speed?: string;
  eta?: string;
  outputPath?: string;
  error?: string;
}

export interface Settings {
  output_dir: string;
  concurrent_downloads: number;
  audio_format: string;
  embed_metadata: boolean;
  embed_thumbnail: boolean;
  sponsorblock: boolean;
  launch_at_login: boolean;
}

export interface ProgressEvent {
  job_id: string;
  status: "downloading" | "processing" | "complete" | "failed" | "cancelled";
  progress: number;
  speed?: string;
  eta?: string;
  output_path?: string;
  error?: string;
}

export interface HistoryItem {
  id: string;
  video_id: string;
  title: string;
  uploader: string;
  thumbnail: string | null;
  source_url: string;
  output_path: string;
  format: string;
  quality: string;
  completed_at: number;
}

export interface DependencyStatus {
  ytdlp: boolean;
  ffmpeg: boolean;
  ytdlp_version: string | null;
}
