import { NextRequest } from 'next/server';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { VideoMetadata } from '../types';
import { MetadataManager } from './metadata';

// Progress tracking function (will be imported from the API route)
// let _updateProgressFn: ((uploadId: string, bytesUploaded: number, totalBytes: number, status: string, message?: string) => void) | null = null;

// export function setProgressUpdateFunction(fn: any) {
//     _updateProgressFn = fn;
// }

// Prefer crypto.randomUUID when available
function generateUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {}
  // Fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class StreamingUploadHandler {
  private storagePath: string;
  private metadataManager: MetadataManager;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.STORAGE_PATH || './uploads';
    this.metadataManager = new MetadataManager(this.storagePath);
  }

  /**
   * Handle streaming upload for large files
   */
  async handleStreamingUpload(
    request: NextRequest,
    clientName: string,
    projectName: string,
    filename: string,
    contentLength: number
    /* _uploadId?: string */
  ): Promise<VideoMetadata> {
    const videoId = generateUUID();
    const videoDir = path.join(this.storagePath, 'videos', videoId);

    // Create directory
    await mkdir(videoDir, { recursive: true });

    // Determine file extension
    const ext = path.extname(filename) || '.mp4';
    const videoFilename = `video${ext}`;
    const videoPath = path.join(videoDir, videoFilename);

    console.log(
      `Starting streaming upload for ${filename} (${Math.round(contentLength / 1024 / 1024)} MB)`
    );

    // Create write stream
    const writeStream = createWriteStream(videoPath);

    // Get request body as stream
    const reader = request.body?.getReader();
    if (!reader) {
      throw new Error('No request body available for streaming');
    }

    let totalBytesWritten = 0;
    let lastProgressLog = 0;

    try {
      while (totalBytesWritten < contentLength) {
        const { done, value } = await reader.read();

        if (done || !value) {
          break;
        }

        // Write chunk to file
        await new Promise<void>((resolve, reject) => {
          writeStream.write(value, (error: Error | null | undefined) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });

        totalBytesWritten += value.length;

        // Log progress every 100MB
        if (totalBytesWritten - lastProgressLog > 100 * 1024 * 1024) {
          const progressMB = Math.round(totalBytesWritten / 1024 / 1024);
          const totalMB = Math.round(contentLength / 1024 / 1024);
          if (contentLength > 0) {
            const percent = Math.round(
              (totalBytesWritten / contentLength) * 100
            );
            console.log(
              `Upload progress: ${progressMB}MB / ${totalMB}MB (${percent}%)`
            );
          } else {
            console.log(`Upload progress: ${progressMB}MB written`);
          }
          lastProgressLog = totalBytesWritten;
        }
      }

      // Close the write stream
      await new Promise<void>((resolve, reject) => {
        writeStream.end((error: Error | null | undefined) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });

      console.log(
        `Upload completed: ${Math.round(totalBytesWritten / 1024 / 1024)} MB written`
      );

      // Create metadata
      const metadata: VideoMetadata = {
        id: videoId,
        filename,
        clientName,
        projectName,
        uploadDate: new Date(),
        fileSize: totalBytesWritten,
        downloadCount: 0,
        status: 'local',
        localPath: videoPath,
        downloadUrl: `/download/${videoId}`,
        isActive: true,
      };

      // Save metadata
      await this.metadataManager.saveMetadata(metadata);

      return metadata;
    } catch (error) {
      // Clean up on error
      writeStream.destroy();
      console.error('Streaming upload error:', error);
      throw error;
    }
  }
}
