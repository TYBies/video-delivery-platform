export function getFileExtension(filename: string, fallback = '.mp4'): string {
  const m = filename?.toLowerCase().match(/\.[^.]+$/)
  return m ? m[0] : fallback
}

export function getVideoContentTypeByExt(ext: string): string {
  const contentTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mkv': 'video/x-matroska',
    '.webm': 'video/webm',
    '.m4v': 'video/x-m4v'
  }
  return contentTypes[ext?.toLowerCase?.() || ''] || 'video/mp4'
}

