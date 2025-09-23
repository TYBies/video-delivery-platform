import { 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand, 
  HeadObjectCommand,
  ListObjectsV2Command 
} from '@aws-sdk/client-s3';
import { R2Client } from './r2-client';
import { R2ErrorHandler, RetryHandler } from './r2-errors';
import { VideoMetadata } from '../types';
import fs from 'fs/promises';
import { Readable } from 'stream';
import { getFileExtension, getVideoContentTypeByExt } from './mime'

export class R2Storage {
  private r2Client: R2Client;
  private bucket: string;

  constructor(r2Client?: R2Client) {
    this.r2Client = r2Client || new R2Client();
    this.bucket = this.r2Client.getBucket();
  }

  /**
   * Upload video file to R2 storage
   */
  async uploadVideo(
    videoId: string, 
    fileBuffer: Buffer, 
    metadata: VideoMetadata
  ): Promise<{ success: boolean; r2Path?: string; error?: string }> {
    try {
      const r2Path = `videos/${videoId}/video${getFileExtension(metadata.filename)}`;
      
      const uploadResult = await RetryHandler.withRetry(async () => {
        const command = new PutObjectCommand({
          Bucket: this.bucket,
          Key: r2Path,
          Body: fileBuffer,
          ContentType: getVideoContentTypeByExt(getFileExtension(metadata.filename)),
          Metadata: {
            'original-filename': metadata.filename,
            'client-name': metadata.clientName,
            'project-name': metadata.projectName,
            'upload-date': metadata.uploadDate.toISOString(),
            'file-size': metadata.fileSize.toString(),
            'checksum-md5': metadata.checksumMD5 || ''
          }
        });

        return await this.r2Client.getClient().send(command);
      });

      return {
        success: true,
        r2Path
      };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * Upload video from local file path
   */
  async uploadVideoFromFile(
    videoId: string, 
    localFilePath: string, 
    metadata: VideoMetadata
  ): Promise<{ success: boolean; r2Path?: string; error?: string }> {
    try {
      const fileBuffer = await fs.readFile(localFilePath);
      return await this.uploadVideo(videoId, fileBuffer, metadata);
    } catch (error) {
      return {
        success: false,
        error: `Failed to read local file: ${error}`
      };
    }
  }

  /**
   * Download video from R2 storage
   */
  async downloadVideo(videoId: string): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
    try {
      // Try different possible file extensions
      const extensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      let videoBuffer: Buffer | undefined;

      for (const ext of extensions) {
        try {
          const r2Path = `videos/${videoId}/video${ext}`;
          
          const result = await RetryHandler.withRetry(async () => {
            const command = new GetObjectCommand({
              Bucket: this.bucket,
              Key: r2Path
            });

            return await this.r2Client.getClient().send(command);
          });

          if (result.Body) {
            videoBuffer = Buffer.from(await result.Body.transformToByteArray());
            break;
          }
        } catch (error) {
          // Continue trying other extensions
          continue;
        }
      }

      if (!videoBuffer) {
        return {
          success: false,
          error: 'Video not found in R2 storage'
        };
      }

      return {
        success: true,
        buffer: videoBuffer
      };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * Get video stream from R2 (for efficient serving)
   */
  async getVideoStream(videoId: string): Promise<{ 
    success: boolean; 
    stream?: Readable; 
    contentLength?: number;
    contentType?: string;
    error?: string 
  }> {
    try {
      // Try different possible file extensions
      const extensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

      for (const ext of extensions) {
        try {
          const r2Path = `videos/${videoId}/video${ext}`;
          
          const result = await RetryHandler.withRetry(async () => {
            const command = new GetObjectCommand({
              Bucket: this.bucket,
              Key: r2Path
            });

            return await this.r2Client.getClient().send(command);
          });

          if (result.Body) {
            return {
              success: true,
              stream: result.Body as Readable,
              contentLength: result.ContentLength,
              contentType: result.ContentType || getVideoContentTypeByExt(ext)
            };
          }
        } catch (error) {
          // Continue trying other extensions
          continue;
        }
      }

      return {
        success: false,
        error: 'Video not found in R2 storage'
      };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * Check if video exists in R2 storage
   */
  async videoExists(videoId: string): Promise<{ exists: boolean; r2Path?: string; error?: string }> {
    try {
      const extensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];

      for (const ext of extensions) {
        try {
          const r2Path = `videos/${videoId}/video${ext}`;
          
          await RetryHandler.withRetry(async () => {
            const command = new HeadObjectCommand({
              Bucket: this.bucket,
              Key: r2Path
            });

            return await this.r2Client.getClient().send(command);
          });

          return {
            exists: true,
            r2Path
          };
        } catch (error) {
          // Continue trying other extensions
          continue;
        }
      }

      return { exists: false };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        exists: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * Delete video from R2 storage
   */
  async deleteVideo(videoId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const extensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
      let deletedAny = false;

      for (const ext of extensions) {
        try {
          const r2Path = `videos/${videoId}/video${ext}`;
          
          await RetryHandler.withRetry(async () => {
            const command = new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: r2Path
            });

            return await this.r2Client.getClient().send(command);
          });

          deletedAny = true;
        } catch (error) {
          // Continue trying other extensions
          continue;
        }
      }

      return {
        success: deletedAny
      };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * List all videos in R2 storage
   */
  async listVideos(prefix: string = 'videos/'): Promise<{ 
    success: boolean; 
    videos?: Array<{ key: string; size: number; lastModified: Date }>; 
    error?: string 
  }> {
    try {
      const result = await RetryHandler.withRetry(async () => {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix
        });

        return await this.r2Client.getClient().send(command);
      });

      const videos = (result.Contents || []).map(obj => ({
        key: obj.Key!,
        size: obj.Size || 0,
        lastModified: obj.LastModified || new Date()
      }));

      return {
        success: true,
        videos
      };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * Get R2 storage usage statistics
   */
  async getStorageStats(): Promise<{ 
    success: boolean; 
    totalSize?: number; 
    videoCount?: number; 
    error?: string 
  }> {
    try {
      const listResult = await this.listVideos();
      
      if (!listResult.success || !listResult.videos) {
        return {
          success: false,
          error: listResult.error || 'Failed to list videos'
        };
      }

      const totalSize = listResult.videos.reduce((sum, video) => sum + video.size, 0);
      const videoCount = listResult.videos.length;

      return {
        success: true,
        totalSize,
        videoCount
      };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

  /**
   * Test R2 connection and permissions
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      // Test by listing objects (requires read permission)
      const listResult = await this.listVideos();
      
      if (!listResult.success) {
        return {
          success: false,
          error: listResult.error || 'Failed to connect to R2'
        };
      }

      return { success: true };
    } catch (error) {
      const r2Error = R2ErrorHandler.handleError(error);
      return {
        success: false,
        error: R2ErrorHandler.getUserMessage(r2Error)
      };
    }
  }

}
