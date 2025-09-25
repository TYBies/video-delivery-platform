import { presignS3GetUrl } from './s3-presign-get';
import { metadataCache } from './metadata-cache';
import { MetadataManager } from './metadata';
import { getFileExtension } from './mime';

interface CachedDownloadLink {
  url: string;
  expiresAt: Date;
  generatedAt: Date;
  videoId: string;
  accessCount: number;
}

class DownloadLinkManager {
  private cache = new Map<string, CachedDownloadLink>();
  private readonly EXPIRY_HOURS = 23; // 23 hours to be safe (B2 allows 24h max)
  private readonly CACHE_KEY_PREFIX = 'download_link_';

  /**
   * Get or generate a cached download link for a video
   */
  async getDownloadLink(videoId: string): Promise<{
    url: string;
    expiresAt: Date;
    isFromCache: boolean;
    accessCount: number;
  }> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${videoId}`;

    // Check memory cache first
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > new Date()) {
      cached.accessCount++;
      return {
        url: cached.url,
        expiresAt: cached.expiresAt,
        isFromCache: true,
        accessCount: cached.accessCount,
      };
    }

    // Check metadata cache for persisted link
    const persistedLink = metadataCache.get(
      cacheKey
    ) as CachedDownloadLink | null;
    if (persistedLink && new Date(persistedLink.expiresAt) > new Date()) {
      // Restore to memory cache
      this.cache.set(cacheKey, {
        ...persistedLink,
        expiresAt: new Date(persistedLink.expiresAt),
        generatedAt: new Date(persistedLink.generatedAt),
        accessCount: persistedLink.accessCount + 1,
      });

      return {
        url: persistedLink.url,
        expiresAt: new Date(persistedLink.expiresAt),
        isFromCache: true,
        accessCount: persistedLink.accessCount + 1,
      };
    }

    // Generate new presigned URL
    const metadataManager = new MetadataManager();
    const metadata = await metadataManager.loadMetadata(videoId);

    if (!metadata) {
      throw new Error('Video not found');
    }

    // Construct the S3 key path
    let key = metadata.r2Path;
    if (!key) {
      const ext = getFileExtension(metadata.filename || 'video.mp4');
      key = `videos/${videoId}/${metadata.filename || `video${ext}`}`;
    }

    // Generate presigned URL (valid for 23 hours)
    const expirySeconds = this.EXPIRY_HOURS * 60 * 60;
    const url = presignS3GetUrl(key, expirySeconds);

    const expiresAt = new Date(Date.now() + this.EXPIRY_HOURS * 60 * 60 * 1000);
    const cachedLink: CachedDownloadLink = {
      url,
      expiresAt,
      generatedAt: new Date(),
      videoId,
      accessCount: 1,
    };

    // Store in both memory and metadata cache for persistence
    this.cache.set(cacheKey, cachedLink);
    metadataCache.set(cacheKey, cachedLink, this.EXPIRY_HOURS * 60 * 60 * 1000);

    console.log(
      `Generated new download link for video ${videoId}, expires at ${expiresAt.toISOString()}`
    );

    return {
      url,
      expiresAt,
      isFromCache: false,
      accessCount: 1,
    };
  }

  /**
   * Invalidate cached download link for a video
   */
  invalidateLink(videoId: string): void {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${videoId}`;
    this.cache.delete(cacheKey);
    // Use the generic get/set pattern to remove from metadata cache
    metadataCache.set(cacheKey, null, 0); // Set with 0 TTL to effectively delete
    console.log(`Invalidated download link cache for video ${videoId}`);
  }

  /**
   * Get download link statistics
   */
  getLinkStats(videoId: string): {
    exists: boolean;
    expiresAt?: Date;
    accessCount?: number;
    generatedAt?: Date;
  } {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${videoId}`;
    const cached =
      this.cache.get(cacheKey) ||
      (metadataCache.get(cacheKey) as CachedDownloadLink | null);

    if (!cached) {
      return { exists: false };
    }

    return {
      exists: true,
      expiresAt: new Date(cached.expiresAt),
      accessCount: cached.accessCount,
      generatedAt: new Date(cached.generatedAt),
    };
  }

  /**
   * Clean up expired links from cache
   */
  cleanupExpiredLinks(): number {
    const now = new Date();
    let cleaned = 0;

    // Use Array.from to avoid iterator issues with for...of
    const entries = Array.from(this.cache.entries());
    for (const [key, cached] of entries) {
      if (cached.expiresAt <= now) {
        this.cache.delete(key);
        metadataCache.set(key, null, 0); // Set with 0 TTL to effectively delete
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} expired download links`);
    }

    return cleaned;
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    totalCached: number;
    totalAccesses: number;
    averageAccessCount: number;
  } {
    const totalCached = this.cache.size;
    const totalAccesses = Array.from(this.cache.values()).reduce(
      (sum, cached) => sum + cached.accessCount,
      0
    );
    const averageAccessCount =
      totalCached > 0 ? totalAccesses / totalCached : 0;

    return {
      totalCached,
      totalAccesses,
      averageAccessCount: Math.round(averageAccessCount * 100) / 100,
    };
  }
}

// Export singleton instance
export const downloadLinkManager = new DownloadLinkManager();
