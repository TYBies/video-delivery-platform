import fs from 'fs/promises';
import path from 'path';
import { OrphanFile, OrphanRegistry, VideoMetadata } from '../types';
import { MetadataManager } from './metadata';
import crypto from 'crypto';

export class OrphanRecoveryService {
  private storagePath: string;
  private recoveryPath: string;
  private metadataManager: MetadataManager;
  private readonly validExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];

  constructor(storagePath?: string) {
    this.storagePath = storagePath || process.env.STORAGE_PATH || './uploads';
    this.recoveryPath = path.join(this.storagePath, 'recovery');
    this.metadataManager = new MetadataManager(storagePath);
  }

  /**
   * Initialize recovery directory
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.recoveryPath, { recursive: true });
  }

  /**
   * Scan for orphaned video files
   */
  async scanForOrphans(): Promise<OrphanFile[]> {
    const orphans: OrphanFile[] = [];
    const videosDir = path.join(this.storagePath, 'videos');

    try {
      const videoFolders = await fs.readdir(videosDir);

      for (const folder of videoFolders) {
        // Skip .gitkeep and other hidden files
        if (folder.startsWith('.')) {
          continue;
        }

        const videoDir = path.join(videosDir, folder);
        
        // Check if it's actually a directory
        try {
          const stats = await fs.stat(videoDir);
          if (!stats.isDirectory()) {
            continue;
          }
        } catch {
          continue;
        }

        const metadataFile = path.join(videoDir, 'metadata.json');

        try {
          // Check if metadata exists
          await fs.access(metadataFile);
          // Metadata exists, not an orphan
          continue;
        } catch {
          // No metadata file, check for video files
          try {
            const files = await fs.readdir(videoDir);
            const videoFiles = files.filter(file => 
              /\.(mp4|mov|avi|mkv|webm|m4v)$/i.test(file)
            );

            for (const videoFile of videoFiles) {
              const videoPath = path.join(videoDir, videoFile);
              const stats = await fs.stat(videoPath);

              orphans.push({
                path: videoPath,
                size: stats.size,
                createdDate: stats.birthtime,
                videoId: folder,
              });
            }
          } catch (error) {
            console.warn(`Failed to scan directory ${folder}:`, error);
          }
        }
      }

      console.log(`Found ${orphans.length} orphaned video files`);
      return orphans;
    } catch (error) {
      console.error('Failed to scan for orphans:', error);
      return [];
    }
  }

  /**
   * Recover an orphaned file by reconstructing metadata
   */
  async recoverOrphan(orphan: OrphanFile): Promise<VideoMetadata | null> {
    try {
      console.log(`Attempting to recover orphan: ${orphan.path}`);

      // Validate the file first
      const isValid = await this.validateOrphanFile(orphan);
      if (!isValid) {
        console.warn(`Orphan file validation failed: ${orphan.path}`);
        await this.updateOrphanRegistry(orphan.videoId, 'invalid');
        return null;
      }

      // Reconstruct metadata
      const metadata = await this.reconstructMetadata(orphan);
      if (!metadata) {
        console.warn(`Failed to reconstruct metadata for: ${orphan.path}`);
        await this.updateOrphanRegistry(orphan.videoId, 'failed');
        return null;
      }

      // Save the reconstructed metadata
      await this.metadataManager.saveMetadata(metadata);
      
      console.log(`Successfully recovered orphan: ${orphan.videoId}`);
      await this.updateOrphanRegistry(orphan.videoId, 'recovered', metadata);
      
      return metadata;
    } catch (error) {
      console.error(`Failed to recover orphan ${orphan.videoId}:`, error);
      await this.updateOrphanRegistry(orphan.videoId, 'failed');
      return null;
    }
  }

  /**
   * Reconstruct metadata from orphaned file
   */
  async reconstructMetadata(orphan: OrphanFile): Promise<VideoMetadata | null> {
    try {
      // Extract information from file path and properties
      const filename = path.basename(orphan.path);
      const stats = await fs.stat(orphan.path);
      
      // Try to extract client and project names from directory structure or filename
      // This is a best-effort approach - in production you might want more sophisticated parsing
      let clientName = 'recovered';
      let projectName = 'recovered';
      
      // Check if there are any clues in the filename
      const filenameParts = filename.split(/[-_\s]/);
      if (filenameParts.length >= 2) {
        clientName = filenameParts[0] || 'recovered';
        projectName = filenameParts[1] || 'recovered';
      }

      // Calculate MD5 checksum for integrity
      const checksumMD5 = await this.calculateFileChecksum(orphan.path);

      const metadata: VideoMetadata = {
        id: orphan.videoId,
        filename: filename,
        clientName: clientName,
        projectName: projectName,
        uploadDate: orphan.createdDate,
        fileSize: orphan.size,
        downloadCount: 0,
        status: 'local',
        localPath: orphan.path,
        downloadUrl: `/download/${orphan.videoId}`,
        isActive: true,
        checksumMD5: checksumMD5,
      };

      return metadata;
    } catch (error) {
      console.error(`Failed to reconstruct metadata for ${orphan.path}:`, error);
      return null;
    }
  }

  /**
   * Validate orphaned file
   */
  async validateOrphanFile(orphan: OrphanFile): Promise<boolean> {
    try {
      // Check if file exists and is readable
      await fs.access(orphan.path, fs.constants.R_OK);
      
      // Check file size is reasonable (not empty, not too small)
      const stats = await fs.stat(orphan.path);
      // Accept small test fixtures but reject trivially small files
      if (stats.size < 16) {
        return false;
      }

      // Check file extension
      const ext = path.extname(orphan.path).toLowerCase();
      if (!this.validExtensions.includes(ext)) {
        return false;
      }

      return true;
    } catch (error) {
      console.error(`Failed to validate orphan file ${orphan.path}:`, error);
      return false;
    }
  }

  /**
   * Clean up invalid orphaned files
   */
  async cleanupInvalidOrphans(): Promise<number> {
    const orphans = await this.scanForOrphans();
    let cleanedCount = 0;

    // Handle invalid video candidates from scan
    for (const orphan of orphans) {
      const isValid = await this.validateOrphanFile(orphan);
      if (!isValid) {
        cleanedCount += await this.moveToCleanup(orphan).then(() => 1).catch(() => 0);
      }
    }

    // Additionally, handle non-video files in orphan directories
    const videosDir = path.join(this.storagePath, 'videos');
    try {
      const dirs = await fs.readdir(videosDir);
      for (const folder of dirs) {
        if (folder.startsWith('.')) continue;
        const videoDir = path.join(videosDir, folder);
        let stats;
        try { stats = await fs.stat(videoDir); } catch { continue; }
        if (!stats.isDirectory()) continue;

        const metadataFile = path.join(videoDir, 'metadata.json');
        try { await fs.access(metadataFile); continue; } catch {}

        const files = await fs.readdir(videoDir);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (!this.validExtensions.includes(ext)) {
            const fp = path.join(videoDir, file);
            let st; try { st = await fs.stat(fp); } catch { continue; }
            const orphan: OrphanFile = { path: fp, size: st.size, createdDate: st.birthtime, videoId: folder };
            cleanedCount += await this.moveToCleanup(orphan).then(() => 1).catch(() => 0);
          }
        }
      }
    } catch (e) {
      console.error('Failed to scan for orphans:', e);
    }

    return cleanedCount;
  }

  /**
   * Calculate MD5 checksum of a file
   */
  private async calculateFileChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = require('fs').createReadStream(filePath);

      stream.on('data', (data: Buffer) => {
        hash.update(data);
      });

      stream.on('end', () => {
        resolve(hash.digest('hex'));
      });

      stream.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  private async moveToCleanup(orphan: OrphanFile): Promise<void> {
    // Move invalid file to a cleanup directory instead of deleting
    const cleanupDir = path.join(this.recoveryPath, 'invalid');
    await fs.mkdir(cleanupDir, { recursive: true });
    const cleanupPath = path.join(cleanupDir, `${orphan.videoId}_${path.basename(orphan.path)}`);
    await fs.rename(orphan.path, cleanupPath);
    try {
      await fs.rmdir(path.dirname(orphan.path));
    } catch {}
    console.log(`Moved invalid orphan to cleanup: ${orphan.path}`);
  }

  /**
   * Update orphan registry
   */
  private async updateOrphanRegistry(
    videoId: string, 
    status: 'pending' | 'recovered' | 'failed' | 'invalid',
    metadata?: VideoMetadata
  ): Promise<void> {
    await this.initialize();
    
    const registryPath = path.join(this.recoveryPath, 'orphans.json');
    let registry: OrphanRegistry;

    try {
      const data = await fs.readFile(registryPath, 'utf-8');
      registry = JSON.parse(data);
    } catch {
      registry = {
        lastScan: new Date(),
        orphans: {},
      };
    }

    if (!registry.orphans[videoId]) {
      registry.orphans[videoId] = {
        discoveredDate: new Date(),
        filePath: '',
        fileSize: 0,
        recoveryAttempts: 0,
        recoveryStatus: 'pending',
      };
    }

    registry.orphans[videoId].recoveryStatus = status;
    registry.orphans[videoId].recoveryAttempts += 1;
    registry.orphans[videoId].lastRecoveryAttempt = new Date();
    
    if (metadata) {
      registry.orphans[videoId].reconstructedMetadata = metadata;
    }

    await fs.writeFile(registryPath, JSON.stringify(registry, null, 2));
  }

  /**
   * Get orphan registry
   */
  async getOrphanRegistry(): Promise<OrphanRegistry> {
    const registryPath = path.join(this.recoveryPath, 'orphans.json');
    
    try {
      const data = await fs.readFile(registryPath, 'utf-8');
      const registry = JSON.parse(data);
      
      // Convert date strings back to Date objects
      registry.lastScan = new Date(registry.lastScan);
      Object.keys(registry.orphans).forEach(videoId => {
        registry.orphans[videoId].discoveredDate = new Date(registry.orphans[videoId].discoveredDate);
        if (registry.orphans[videoId].lastRecoveryAttempt) {
          registry.orphans[videoId].lastRecoveryAttempt = new Date(registry.orphans[videoId].lastRecoveryAttempt);
        }
      });
      
      return registry;
    } catch {
      return {
        lastScan: new Date(),
        orphans: {},
      };
    }
  }

  /**
   * Recover all orphaned files
   */
  async recoverAllOrphans(): Promise<{ recovered: number; failed: number }> {
    const orphans = await this.scanForOrphans();
    let recovered = 0;
    let failed = 0;

    console.log(`Starting recovery of ${orphans.length} orphaned files`);

    for (const orphan of orphans) {
      const result = await this.recoverOrphan(orphan);
      if (result) {
        recovered++;
      } else {
        failed++;
      }
    }

    // Count non-video files in orphan dirs as failed candidates
    const videosDir = path.join(this.storagePath, 'videos');
    try {
      const dirs = await fs.readdir(videosDir);
      for (const folder of dirs) {
        if (folder.startsWith('.')) continue;
        const videoDir = path.join(videosDir, folder);
        let stats; try { stats = await fs.stat(videoDir); } catch { continue; }
        if (!stats.isDirectory()) continue;
        const metadataFile = path.join(videoDir, 'metadata.json');
        try { await fs.access(metadataFile); continue; } catch {}
        const files = await fs.readdir(videoDir);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (!this.validExtensions.includes(ext)) {
            failed++;
          }
        }
      }
    } catch (e) {
      console.error('Failed to scan for orphans:', e);
    }

    console.log(`Recovery complete: ${recovered} recovered, ${failed} failed`);
    return { recovered, failed };
  }
}
