/**
 * Shared video-format registry for the web app.
 *
 * Mirrors the API's accepted containers (apps/api/src/security/file_validation.py,
 * FILE_TYPES['video']). Every format here is decodable by the server's ffmpeg
 * HLS pipeline; PROGRESSIVELY_PLAYABLE lists the subset browsers can usually
 * play directly before the HLS ladder is ready.
 */

/** Bare lowercase extensions (no dot) accepted for video uploads. */
export const VIDEO_FILE_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv', 'ogv', 'mpg', 'mpeg', '3gp',
] as const

/**
 * Containers most browsers can play natively via <video> (H.264/AAC mp4
 * family, WebM, Ogg). Formats outside this list (mkv/avi/wmv/flv/mpeg/3gp)
 * become watchable once the server's HLS transcode completes — the UI shows a
 * "conversion in progress" state instead of a broken player until then.
 */
export const PROGRESSIVELY_PLAYABLE_VIDEO_EXTENSIONS = [
  'mp4', 'm4v', 'mov', 'webm', 'ogv',
] as const

/** MIME type for each extension, for the file-picker `accept` attribute. */
export const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  wmv: 'video/x-ms-wmv',
  flv: 'video/x-flv',
  ogv: 'video/ogg',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  '3gp': 'video/3gpp',
}

/** `accept` value covering every supported video container. */
export const VIDEO_ACCEPT_VALUE = VIDEO_FILE_EXTENSIONS.map(
  (ext) => `.${ext},${VIDEO_MIME_BY_EXTENSION[ext]}`
).join(',')

/** Extract the bare lowercase extension from a filename, or null. */
export function getFileExtension(name: string | null | undefined): string | null {
  if (!name || !name.includes('.')) return null
  const ext = name.split('.').pop()!.toLowerCase()
  return ext || null
}

/**
 * Whether a file is an accepted video upload. Extension-first on purpose:
 * browsers report inconsistent MIME types for less common containers (mkv
 * often arrives as application/octet-stream). The server re-validates content
 * by magic bytes, so this only routes the file picker / dropzone UX.
 */
export function isSupportedVideoFile(file: File | { name?: string; type?: string }): boolean {
  const ext = getFileExtension(file.name)
  return !!ext && (VIDEO_FILE_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Whether a stored video format can play progressively in most browsers
 * (before the HLS ladder is ready). `fileFormat` is the bare stored extension
 * (BlockFile.file_format), without the dot.
 */
export function isProgressivelyPlayableVideo(fileFormat: string | null | undefined): boolean {
  if (!fileFormat) return false
  return (PROGRESSIVELY_PLAYABLE_VIDEO_EXTENSIONS as readonly string[]).includes(
    fileFormat.toLowerCase().replace(/^\./, '')
  )
}

/**
 * Best-effort MIME for a progressive (non-HLS) source URL, so video.js gets a
 * correct source type for containers like webm/ogv/mov instead of a hardcoded
 * video/mp4. HLS masters are always application/x-mpegURL.
 */
export function guessVideoMime(url: string, isHls = false): string {
  if (isHls) return 'application/x-mpegURL'
  const ext = getFileExtension(url.split('?')[0])
  if (ext && VIDEO_MIME_BY_EXTENSION[ext]) return VIDEO_MIME_BY_EXTENSION[ext]
  return 'video/mp4'
}
