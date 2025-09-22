import { NextRequest, NextResponse } from 'next/server';
import { StreamingUploadHandler } from '@/lib/streaming-upload';
import { DirectoryManager } from '@/lib/directory';
import { DiskSpaceManager } from '@/lib/disk-space';

export async function POST(request: NextRequest) {
  console.log('Streaming upload API called');
  
  try {
    // Get headers
    const contentLength = parseInt(request.headers.get('content-length') || '0');
    const filename = request.headers.get('x-filename') || 'video.mp4';
    const clientName = request.headers.get('x-client-name') || '';
    const projectName = request.headers.get('x-project-name') || '';
    
    console.log(`Streaming upload: ${filename} (${Math.round(contentLength / 1024 / 1024)} MB)`);
    
    // Validate required fields
    if (!clientName || !projectName) {
      return NextResponse.json(
        { success: false, error: 'Client name and project name are required' },
        { status: 400 }
      );
    }
    
    // Check file size limits
    const maxSize = 25 * 1024 * 1024 * 1024; // 25GB
    if (contentLength > maxSize) {
      const fileSizeGB = Math.round(contentLength / 1024 / 1024 / 1024 * 100) / 100;
      return NextResponse.json(
        { success: false, error: `File too large. Maximum size is 25GB, your file is ${fileSizeGB} GB` },
        { status: 413 }
      );
    }
    
    // Check available disk space
    if (!DiskSpaceManager.hasEnoughSpace(contentLength)) {
      const diskInfo = DiskSpaceManager.getReadableDiskSpace();
      const fileSizeGB = Math.round(contentLength / 1024 / 1024 / 1024 * 100) / 100;
      return NextResponse.json(
        { 
          success: false, 
          error: `Not enough disk space. File size: ${fileSizeGB} GB, Available space: ${diskInfo.available}` 
        },
        { status: 507 }
      );
    }
    
    // Initialize directory manager
    const dirManager = new DirectoryManager();
    await dirManager.initializeDirectories();
    
    // Handle streaming upload
    const uploadHandler = new StreamingUploadHandler();
    const metadata = await uploadHandler.handleStreamingUpload(
      request,
      clientName,
      projectName,
      filename,
      contentLength
    );
    
    console.log('Streaming upload completed:', metadata.id);
    
    return NextResponse.json({
      success: true,
      videoId: metadata.id,
      downloadUrl: metadata.downloadUrl,
      metadata: {
        filename: metadata.filename,
        clientName: metadata.clientName,
        projectName: metadata.projectName,
        fileSize: metadata.fileSize,
        uploadDate: metadata.uploadDate,
        status: metadata.status
      }
    });
    
  } catch (error) {
    console.error('Streaming upload error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Upload failed' 
      },
      { status: 500 }
    );
  }
}