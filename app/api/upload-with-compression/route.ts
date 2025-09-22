import { NextRequest, NextResponse } from 'next/server';
import { EnhancedUploadHandler } from '@/lib/enhanced-upload-handler';
import { VideoProcessor, CompressionOptions } from '@/lib/video-processor';
import { DirectoryManager } from '@/lib/directory';
import { DiskSpaceManager } from '@/lib/disk-space';
import { initializeApp } from '@/lib/app-initializer';
import path from 'path';

export async function POST(request: NextRequest) {
  console.log('Upload with compression API called');
  
  // Ensure app is initialized with recovery services
  await initializeApp();
  
  try {
    // Get headers
    const contentLength = parseInt(request.headers.get('content-length') || '0');
    const filename = request.headers.get('x-filename') || 'video.mp4';
    const clientName = request.headers.get('x-client-name') || '';
    const projectName = request.headers.get('x-project-name') || '';
    const enableCompression = request.headers.get('x-enable-compression') === 'true';
    const compressionQuality = (request.headers.get('x-compression-quality') || 'high') as 'professional' | 'high' | 'medium' | 'web';
    
    console.log(`Upload: ${filename} (${Math.round(contentLength / 1024 / 1024)} MB)`);
    console.log(`Compression: ${enableCompression ? `enabled (${compressionQuality})` : 'disabled'}`);
    
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
    
    // Check available disk space (need extra space for compression)
    const requiredSpace = enableCompression ? contentLength * 2 : contentLength;
    if (!DiskSpaceManager.hasEnoughSpace(requiredSpace)) {
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
    
    // Handle upload with automatic recovery
    const uploadHandler = new EnhancedUploadHandler();
    let metadata = await uploadHandler.handleUploadWithRecovery(
      request,
      clientName,
      projectName,
      filename,
      contentLength
    );
    
    console.log('Upload completed:', metadata.id);

    // Initialize compression metadata if compression is enabled
    if (enableCompression) {
      const { MetadataManager } = await import('@/lib/metadata');
      const metadataManager = new MetadataManager();
      
      metadata = await metadataManager.updateMetadata(metadata.id, {
        compression: {
          enabled: true,
          status: 'processing',
          originalSize: metadata.fileSize,
          quality: compressionQuality,
          startTime: new Date(),
        }
      }) || metadata;
    }
    
    // Return download link immediately, handle compression in background
    const response = {
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
      },
      compression: {
        enabled: enableCompression,
        status: enableCompression ? 'processing' : 'disabled',
        quality: enableCompression ? compressionQuality : undefined
      }
    };

    // Start compression in background if requested
    if (enableCompression && metadata.localPath) {
      console.log('Starting background video compression...');
      
      // Don't await - let compression run in background
      setImmediate(async () => {
        try {
          const compressionOptions: CompressionOptions = {
            quality: compressionQuality,
            preset: compressionQuality === 'professional' ? 'slow' : 'medium',
            audioBitrate: compressionQuality === 'professional' ? '320k' : 
                         compressionQuality === 'high' ? '256k' : 
                         compressionQuality === 'medium' ? '192k' : '128k'
          };
          
          const videoDir = path.dirname(metadata.localPath!);
          const ext = path.extname(metadata.localPath!);
          const compressedPath = path.join(videoDir, `compressed${ext}`);
          
          console.log(`Background compression started for ${metadata.id}`);
          const compressionResult = await VideoProcessor.compressVideo(
            metadata.localPath!,
            compressedPath,
            compressionOptions
          );
          
          if (compressionResult.success) {
            // Replace original with compressed version
            const fs = await import('fs/promises');
            await fs.unlink(metadata.localPath!); // Delete original
            await fs.rename(compressedPath, metadata.localPath!); // Rename compressed to original name
            
            // Update metadata with compression results
            const { MetadataManager } = await import('@/lib/metadata');
            const metadataManager = new MetadataManager();
            
            await metadataManager.updateMetadata(metadata.id, {
              fileSize: compressionResult.compressedSize,
              compression: {
                enabled: true,
                status: 'completed',
                originalSize: compressionResult.originalSize,
                compressedSize: compressionResult.compressedSize,
                compressionRatio: compressionResult.compressionRatio,
                quality: compressionQuality,
                startTime: metadata.compression?.startTime || new Date(),
                completedTime: new Date(),
              }
            });
            
            console.log(`Background compression completed for ${metadata.id}: ${compressionResult.compressionRatio.toFixed(1)}% size reduction (${Math.round(compressionResult.originalSize / 1024 / 1024)} MB → ${Math.round(compressionResult.compressedSize / 1024 / 1024)} MB)`);
          } else {
            // Update metadata to show compression failed
            const { MetadataManager } = await import('@/lib/metadata');
            const metadataManager = new MetadataManager();
            
            await metadataManager.updateMetadata(metadata.id, {
              compression: {
                enabled: true,
                status: 'failed',
                originalSize: metadata.fileSize,
                quality: compressionQuality,
                startTime: metadata.compression?.startTime || new Date(),
                completedTime: new Date(),
              }
            });
            
            console.warn(`Background compression failed for ${metadata.id}:`, compressionResult.error);
          }
        } catch (error) {
          console.error(`Background compression error for ${metadata.id}:`, error);
        }
      });
    }
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('Upload with compression error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Upload failed' 
      },
      { status: 500 }
    );
  }
}