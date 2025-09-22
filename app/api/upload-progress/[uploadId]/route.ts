import { NextRequest, NextResponse } from 'next/server';

// In-memory progress storage (in production, use Redis or database)
const uploadProgress = new Map<string, {
  bytesUploaded: number;
  totalBytes: number;
  status: 'uploading' | 'processing' | 'completed' | 'error';
  message?: string;
}>();

export async function GET(
  request: NextRequest,
  { params }: { params: { uploadId: string } }
) {
  const { uploadId } = params;
  
  const progress = uploadProgress.get(uploadId);
  
  if (!progress) {
    return NextResponse.json({
      success: false,
      error: 'Upload not found'
    }, { status: 404 });
  }
  
  const percent = Math.round((progress.bytesUploaded / progress.totalBytes) * 100);
  
  return NextResponse.json({
    success: true,
    progress: {
      bytesUploaded: progress.bytesUploaded,
      totalBytes: progress.totalBytes,
      percent,
      status: progress.status,
      message: progress.message,
      uploadedMB: Math.round(progress.bytesUploaded / 1024 / 1024),
      totalMB: Math.round(progress.totalBytes / 1024 / 1024)
    }
  });
}

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

// Helper function to clean up progress after completion
export function cleanupUploadProgress(uploadId: string) {
  setTimeout(() => {
    uploadProgress.delete(uploadId);
  }, 5 * 60 * 1000); // Clean up after 5 minutes
}