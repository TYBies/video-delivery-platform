import fs from 'fs/promises';
import path from 'path';

export class DirectoryManager {
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.STORAGE_PATH || './uploads';
  }

  /**
   * Initialize all required directories
   */
  async initializeDirectories(): Promise<void> {
    const directories = [
      path.join(this.storagePath, 'videos'),
      path.join(this.storagePath, 'temp'),
      path.join(this.storagePath, 'metadata')
    ];

    for (const dir of directories) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Ensure directory exists, create if not
   */
  async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * Get directory size recursively
   */
  async getDirectorySize(dirPath: string): Promise<number> {
    let totalSize = 0;

    try {
      const items = await fs.readdir(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          totalSize += await this.getDirectorySize(itemPath);
        } else {
          totalSize += stats.size;
        }
      }
    } catch (error) {
      console.error(`Error calculating directory size for ${dirPath}:`, error);
    }

    return totalSize;
  }

  /**
   * List all video directories
   */
  async listVideoDirectories(): Promise<string[]> {
    const videosDir = path.join(this.storagePath, 'videos');
    
    try {
      const items = await fs.readdir(videosDir);
      const directories = [];
      
      for (const item of items) {
        const itemPath = path.join(videosDir, item);
        const stats = await fs.stat(itemPath);
        
        if (stats.isDirectory()) {
          directories.push(item);
        }
      }
      
      return directories;
    } catch (error) {
      console.error('Error listing video directories:', error);
      return [];
    }
  }

  /**
   * Check available disk space
   */
  async getAvailableSpace(): Promise<number | null> {
    try {
      const stats = await fs.statfs(this.storagePath);
      return stats.bavail * stats.bsize;
    } catch (error) {
      console.error('Error checking available space:', error);
      return null;
    }
  }

  /**
   * Validate storage path is writable
   */
  async validateStoragePath(): Promise<{ valid: boolean; error?: string }> {
    try {
      // Check if directory exists
      await fs.access(this.storagePath);
      
      // Test write permissions
      const testFile = path.join(this.storagePath, '.write-test');
      await fs.writeFile(testFile, 'test');
      await fs.unlink(testFile);
      
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Storage path ${this.storagePath} is not writable: ${error}`
      };
    }
  }
}