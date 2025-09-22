import { execSync } from 'child_process';

export interface DiskSpaceInfo {
  total: number;
  used: number;
  available: number;
  percentUsed: number;
}

export class DiskSpaceManager {
  /**
   * Get disk space information for the current directory
   */
  static getDiskSpace(): DiskSpaceInfo {
    try {
      // Use df command to get disk space info
      const output = execSync('df -k .', { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      const dataLine = lines[1].split(/\s+/);
      
      const total = parseInt(dataLine[1]) * 1024; // Convert from KB to bytes
      const used = parseInt(dataLine[2]) * 1024;
      const available = parseInt(dataLine[3]) * 1024;
      const percentUsed = Math.round((used / total) * 100);

      return {
        total,
        used,
        available,
        percentUsed
      };
    } catch (error) {
      console.error('Error getting disk space:', error);
      // Return default values if command fails
      return {
        total: 0,
        used: 0,
        available: 0,
        percentUsed: 0
      };
    }
  }

  /**
   * Check if there's enough space for a file upload
   */
  static hasEnoughSpace(fileSize: number, bufferPercent: number = 10): boolean {
    const diskSpace = this.getDiskSpace();
    const requiredSpace = fileSize * (1 + bufferPercent / 100); // Add buffer
    
    return diskSpace.available > requiredSpace;
  }

  /**
   * Get human-readable disk space info
   */
  static getReadableDiskSpace(): {
    total: string;
    used: string;
    available: string;
    percentUsed: number;
  } {
    const space = this.getDiskSpace();
    
    return {
      total: this.formatBytes(space.total),
      used: this.formatBytes(space.used),
      available: this.formatBytes(space.available),
      percentUsed: space.percentUsed
    };
  }

  /**
   * Format bytes to human readable format
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get warning message if disk space is low
   */
  static getDiskSpaceWarning(): string | null {
    const space = this.getDiskSpace();
    
    if (space.percentUsed > 90) {
      return `Warning: Disk space is critically low (${space.percentUsed}% used). Only ${this.formatBytes(space.available)} remaining.`;
    } else if (space.percentUsed > 80) {
      return `Warning: Disk space is getting low (${space.percentUsed}% used). ${this.formatBytes(space.available)} remaining.`;
    }
    
    return null;
  }
}