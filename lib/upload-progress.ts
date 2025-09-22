// In-memory progress storage (in production, use Redis or database)
const uploadProgress = new Map<string, {
  bytesUploaded: number;
  totalBytes: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  message?: string;
}>();

// Helper function to update progress (used by upload handlers)
export function updateUploadProgress(
  uploadId: string,
  bytesUploaded: number,
  totalBytes: number,
  status: 'uploading' | 'processing' | 'completed' | 'error',
  message?: string
) {
  uploadProgress.set(uploadId, {
    bytesUploaded,
    totalBytes,
    status,
    message
  });
}

// Helper function to get progress
export function getUploadProgress(uploadId: string) {
  return uploadProgress.get(uploadId);
}

// Helper function to clean up progress after completion
export function cleanupUploadProgress(uploadId: string) {
  setTimeout(() => {
    uploadProgress.delete(uploadId);
  }, 5 * 60 * 1000); // Clean up after 5 minutes
}