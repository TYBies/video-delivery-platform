import fs from 'fs/promises';
import path from 'path';
import { VideoMetadata } from '../types';

export class MetadataManager {
  private storagePath: string;
  private indexPath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.STORAGE_PATH || './uploads';
    this.indexPath = path.join(this.storagePath, 'metadata', 'videos-index.json');
  }

  /**
   * Save video metadata to individual file and update index
   */
  async saveMetadata(metadata: VideoMetadata): Promise<void> {
    // Save individual metadata file
    const metadataDir = path.join(this.storagePath, 'videos', metadata.id);
    const metadataFile = path.join(metadataDir, 'metadata.json');
    // Ensure directory exists
    await fs.mkdir(metadataDir, { recursive: true });

    await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));

    // Update index
    await this.updateIndex(metadata);
  }

  /**
   * Load video metadata by ID
   */
  async loadMetadata(videoId: string): Promise<VideoMetadata | null> {
    try {
      const metadataFile = path.join(this.storagePath, 'videos', videoId, 'metadata.json');
      const data = await fs.readFile(metadataFile, 'utf-8');
      const metadata = JSON.parse(data);
      
      // Convert date string back to Date object
      metadata.uploadDate = new Date(metadata.uploadDate);
      
      return metadata;
    } catch (error) {
      console.error(`Failed to load metadata for video ${videoId}:`, error);
      return null;
    }
  }

  /**
   * Update existing metadata
   */
  async updateMetadata(videoId: string, updates: Partial<VideoMetadata>): Promise<VideoMetadata | null> {
    const existing = await this.loadMetadata(videoId);
    if (!existing) {
      throw new Error(`Video metadata not found for ID: ${videoId}`);
    }

    const updated = { ...existing, ...updates };
    await this.saveMetadata(updated);
    return updated;
  }

  /**
   * Delete video metadata
   */
  async deleteMetadata(videoId: string): Promise<boolean> {
    try {
      // Remove from index
      await this.removeFromIndex(videoId);
      
      // Delete individual metadata file
      const metadataFile = path.join(this.storagePath, 'videos', videoId, 'metadata.json');
      await fs.unlink(metadataFile);
      
      return true;
    } catch (error) {
      console.error(`Failed to delete metadata for video ${videoId}:`, error);
      return false;
    }
  }

  /**
   * Get all video metadata from index
   */
  async getAllMetadata(): Promise<VideoMetadata[]> {
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf-8');
      const index = JSON.parse(indexData);
      
      // Convert date strings back to Date objects
      return index.videos.map((video: any) => ({
        ...video,
        uploadDate: new Date(video.uploadDate)
      }));
    } catch (error) {
      // If index doesn't exist, return empty array
      return [];
    }
  }

  /**
   * Search videos by client name
   */
  async getVideosByClient(clientName: string): Promise<VideoMetadata[]> {
    const allVideos = await this.getAllMetadata();
    return allVideos.filter(video => 
      video.clientName.toLowerCase().includes(clientName.toLowerCase())
    );
  }

  /**
   * Search videos by project name
   */
  async getVideosByProject(projectName: string): Promise<VideoMetadata[]> {
    const allVideos = await this.getAllMetadata();
    return allVideos.filter(video => 
      video.projectName.toLowerCase().includes(projectName.toLowerCase())
    );
  }

  /**
   * Get videos with specific status
   */
  async getVideosByStatus(status: VideoMetadata['status']): Promise<VideoMetadata[]> {
    const allVideos = await this.getAllMetadata();
    return allVideos.filter(video => video.status === status);
  }

  /**
   * Get active videos only
   */
  async getActiveVideos(): Promise<VideoMetadata[]> {
    const allVideos = await this.getAllMetadata();
    return allVideos.filter(video => video.isActive);
  }

  /**
   * Increment download count for a video
   */
  async incrementDownloadCount(videoId: string): Promise<void> {
    const metadata = await this.loadMetadata(videoId);
    if (metadata) {
      metadata.downloadCount += 1;
      await this.saveMetadata(metadata);
    }
  }

  /**
   * Update video status (local, backed-up, cloud-only)
   */
  async updateVideoStatus(videoId: string, status: VideoMetadata['status']): Promise<void> {
    await this.updateMetadata(videoId, { status });
  }

  /**
   * Disable/enable video access
   */
  async setVideoActive(videoId: string, isActive: boolean): Promise<void> {
    await this.updateMetadata(videoId, { isActive });
  }

  /**
   * Validate metadata structure
   */
  validateMetadata(metadata: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const required = ['id', 'filename', 'clientName', 'projectName', 'uploadDate', 'fileSize'];

    for (const field of required) {
      if (!metadata[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    if (metadata.fileSize && typeof metadata.fileSize !== 'number') {
      errors.push('fileSize must be a number');
    }

    if (metadata.downloadCount && typeof metadata.downloadCount !== 'number') {
      errors.push('downloadCount must be a number');
    }

    if (metadata.status && !['local', 'backed-up', 'cloud-only'].includes(metadata.status)) {
      errors.push('status must be one of: local, backed-up, cloud-only');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Update the videos index file
   */
  private async updateIndex(metadata: VideoMetadata): Promise<void> {
    let index = { videos: [] as VideoMetadata[] };

    try {
      const indexData = await fs.readFile(this.indexPath, 'utf-8');
      index = JSON.parse(indexData);
    } catch (error) {
      // Index doesn't exist, create new one
      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
    }

    // Remove existing entry if it exists
    index.videos = index.videos.filter(video => video.id !== metadata.id);
    
    // Add new/updated entry
    index.videos.push(metadata);

    // Sort by upload date (newest first)
    index.videos.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

    await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  /**
   * Remove video from index
   */
  private async removeFromIndex(videoId: string): Promise<void> {
    try {
      const indexData = await fs.readFile(this.indexPath, 'utf-8');
      const index = JSON.parse(indexData);
      
      index.videos = index.videos.filter((video: VideoMetadata) => video.id !== videoId);
      
      await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));
    } catch (error) {
      console.error('Failed to remove from index:', error);
    }
  }

  /**
   * Rebuild index from individual metadata files
   */
  async rebuildIndex(): Promise<number> {
    const videosDir = path.join(this.storagePath, 'videos');
    let rebuiltCount = 0;

    try {
      const videoFolders = await fs.readdir(videosDir);
      const index = { videos: [] as VideoMetadata[] };

      for (const folder of videoFolders) {
        const metadataFile = path.join(videosDir, folder, 'metadata.json');
        
        try {
          const data = await fs.readFile(metadataFile, 'utf-8');
          const metadata = JSON.parse(data);
          metadata.uploadDate = new Date(metadata.uploadDate);
          
          const validation = this.validateMetadata(metadata);
          if (validation.valid) {
            index.videos.push(metadata);
            rebuiltCount++;
          } else {
            console.warn(`Invalid metadata for ${folder}:`, validation.errors);
          }
        } catch (error) {
          console.warn(`Failed to read metadata for ${folder}:`, error);
        }
      }

      // Sort by upload date (newest first)
      index.videos.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());

      await fs.mkdir(path.dirname(this.indexPath), { recursive: true });
      await fs.writeFile(this.indexPath, JSON.stringify(index, null, 2));

    } catch (error) {
      console.error('Failed to rebuild index:', error);
    }

    return rebuiltCount;
  }
}
