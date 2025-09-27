import fs from 'fs/promises';
import path from 'path';
import crypto, { randomUUID } from 'crypto';
import { VideoMetadata } from '../types';

// Cryptographically-strong UUID generator (Node >=18)
function generateUUID(): string {
  return typeof randomUUID === 'function'
    ? randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

export class LocalStorage {
  private storagePath: string;
  private maxFileSize: number;
  private allowedTypes: string[];

  constructor() {
    this.storagePath = process.env.STORAGE_PATH || './uploads';
    this.maxFileSize = parseInt(process.env.UPLOAD_MAX_SIZE || '2147483648'); // 2GB default
    this.allowedTypes = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
  }

  /**
   * Validate file type and size
   */
  validateFile(
    filename: string,
    fileSize: number
  ): { valid: boolean; error?: string } {
    const ext = path.extname(filename).toLowerCase();

    if (!this.allowedTypes.includes(ext)) {
      return {
        valid: false,
        error: `File type ${ext} not allowed. Supported types: ${this.allowedTypes.join(', ')}`,
      };
    }

    if (fileSize > this.maxFileSize) {
      return {
        valid: false,
        error: `File size ${fileSize} exceeds maximum allowed size of ${this.maxFileSize} bytes`,
      };
    }

    return { valid: true };
  }

  /**
   * Create directory structure for a video
   */
  async createVideoDirectory(videoId: string): Promise<string> {
    const videoDir = path.join(this.storagePath, 'videos', videoId);
    await fs.mkdir(videoDir, { recursive: true });
    return videoDir;
  }

  /**
   * Save video file to local storage
   */
  async saveVideo(
    fileBuffer: Buffer,
    originalFilename: string,
    clientName: string,
    projectName: string
  ): Promise<VideoMetadata> {
    const videoId = generateUUID();
    const videoDir = await this.createVideoDirectory(videoId);
    const ext = path.extname(originalFilename);
    const filename = `video${ext}`;
    const filePath = path.join(videoDir, filename);

    // Validate file
    const validation = this.validateFile(originalFilename, fileBuffer.length);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Save file
    await fs.writeFile(filePath, fileBuffer);

    // Generate checksum
    const hash = crypto.createHash('md5');
    hash.update(fileBuffer);
    const checksumMD5 = hash.digest('hex');

    // Create metadata
    const metadata: VideoMetadata = {
      id: videoId,
      filename: originalFilename,
      clientName,
      projectName,
      uploadDate: new Date(),
      fileSize: fileBuffer.length,
      downloadCount: 0,
      status: 'local',
      localPath: filePath,
      downloadUrl: `/download/${videoId}`,
      isActive: true,
      checksumMD5,
    };

    return metadata;
  }

  /**
   * Read video file from local storage
   */
  async readVideo(videoId: string): Promise<Buffer> {
    const videoDir = path.join(this.storagePath, 'videos', videoId);
    const files = await fs.readdir(videoDir);
    const videoFile = files.find((file) => file.startsWith('video.'));

    if (!videoFile) {
      throw new Error(`Video file not found for ID: ${videoId}`);
    }

    const filePath = path.join(videoDir, videoFile);
    return await fs.readFile(filePath);
  }

  /**
   * Get video file stream for efficient serving
   */
  async getVideoStream(
    videoId: string
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size: number;
    filename: string;
  }> {
    const videoDir = path.join(this.storagePath, 'videos', videoId);
    const files = await fs.readdir(videoDir);
    const videoFile = files.find((file) => file.startsWith('video.'));

    if (!videoFile) {
      throw new Error(`Video file not found for ID: ${videoId}`);
    }

    const filePath = path.join(videoDir, videoFile);
    const stats = await fs.stat(filePath);

    // Create readable stream
    const { createReadStream } = await import('fs');
    const stream = createReadStream(filePath);

    return {
      stream,
      size: stats.size,
      filename: videoFile,
    };
  }

  /**
   * Delete video from local storage
   */
  async deleteVideo(videoId: string): Promise<boolean> {
    try {
      const videoDir = path.join(this.storagePath, 'videos', videoId);
      await fs.rm(videoDir, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error(`Failed to delete video ${videoId}:`, error);
      return false;
    }
  }

  /**
   * Check if video exists locally
   */
  async videoExists(videoId: string): Promise<boolean> {
    try {
      const videoDir = path.join(this.storagePath, 'videos', videoId);
      await fs.access(videoDir);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage usage statistics
   */
  async getStorageStats(): Promise<{
    totalSize: number;
    videoCount: number;
    freeSpace?: number;
  }> {
    const videosDir = path.join(this.storagePath, 'videos');
    let totalSize = 0;
    let videoCount = 0;

    try {
      const videoFolders = await fs.readdir(videosDir);

      for (const folder of videoFolders) {
        const folderPath = path.join(videosDir, folder);
        const stats = await fs.stat(folderPath);

        if (stats.isDirectory()) {
          videoCount++;
          const files = await fs.readdir(folderPath);

          for (const file of files) {
            const filePath = path.join(folderPath, file);
            const fileStats = await fs.stat(filePath);
            totalSize += fileStats.size;
          }
        }
      }
    } catch (error) {
      console.error('Error calculating storage stats:', error);
    }

    return { totalSize, videoCount };
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles(): Promise<number> {
    const tempDir = path.join(this.storagePath, 'temp');
    let cleanedCount = 0;

    try {
      const files = await fs.readdir(tempDir);
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      for (const file of files) {
        if (file === '.gitkeep') continue;

        const filePath = path.join(tempDir, file);
        const stats = await fs.stat(filePath);

        if (now - stats.mtime.getTime() > maxAge) {
          await fs.unlink(filePath);
          cleanedCount++;
        }
      }
    } catch (error) {
      console.error('Error cleaning temp files:', error);
    }

    return cleanedCount;
  }
}
