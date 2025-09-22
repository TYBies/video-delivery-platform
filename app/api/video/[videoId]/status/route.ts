import { NextRequest, NextResponse } from 'next/server';
import { MetadataManager } from '@/lib/metadata';
import fs from 'fs/promises';
import path from 'path';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;
    
    const metadataManager = new MetadataManager();
    const metadata = await metadataManager.loadMetadata(videoId);
    
    if (!metadata) {
      return NextResponse.json(
        { success: false, error: 'Video not found' },
        { status: 404 }
      );
    }

    // Check if compression is still running
    const videoDir = path.dirname(metadata.localPath || '');
    const compressedPath = path.join(videoDir, 'compressed.mov');
    
    let compressionStatus = metadata.compression?.status || 'disabled';
    
    // If metadata says processing, double-check by looking for temp file
    if (compressionStatus === 'processing') {
      try {
        await fs.access(compressedPath);
        // Temp file exists, still processing
      } catch {
        // Temp file doesn't exist, might be completed or failed
        // Keep the status from metadata
      }
    }

    return NextResponse.json({
      success: true,
      videoId: metadata.id,
      status: {
        upload: 'completed',
        compression: compressionStatus,
        available: true
      },
      metadata: {
        filename: metadata.filename,
        clientName: metadata.clientName,
        projectName: metadata.projectName,
        fileSize: metadata.fileSize,
        uploadDate: metadata.uploadDate,
        downloadUrl: metadata.downloadUrl
      },
      compression: metadata.compression ? {
        enabled: metadata.compression.enabled,
        status: metadata.compression.status,
        originalSize: metadata.compression.originalSize,
        compressedSize: metadata.compression.compressedSize,
        compressionRatio: metadata.compression.compressionRatio,
        quality: metadata.compression.quality,
        startTime: metadata.compression.startTime,
        completedTime: metadata.compression.completedTime,
      } : null
    });
    
  } catch (error) {
    console.error('Failed to get video status:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get video status'
      },
      { status: 500 }
    );
  }
}