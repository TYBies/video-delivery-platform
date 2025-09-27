import { HybridStorage } from '@/lib/hybrid-storage';
import { metadataCache } from '@/lib/metadata-cache';
import { MetadataManager } from '@/lib/metadata';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { NextRequest, NextResponse } from 'next/server';
import type { VideoMetadata } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;

  if (!videoId) {
    return NextResponse.json(
      { error: 'Video ID is required' },
      { status: 400 }
    );
  }

  try {
    if (isS3Enabled()) {
      const cfg = loadS3Config();
      const client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: cfg.bucket,
            Key: `videos/${videoId}/metadata.json`,
          })
        );
        const text = await (
          res.Body as unknown as { transformToString: () => Promise<string> }
        ).transformToString();
        return NextResponse.json(JSON.parse(text));
      } catch {
        return NextResponse.json(
          { error: `Video ${videoId} not found` },
          { status: 404 }
        );
      }
    } else {
      const metadataManager = new MetadataManager();
      const metadata = await metadataManager.loadMetadata(videoId);

      if (metadata) {
        return NextResponse.json(metadata);
      } else {
        return NextResponse.json(
          { error: `Video ${videoId} not found` },
          { status: 404 }
        );
      }
    }
  } catch (error) {
    console.error(`Error fetching video ${videoId}:`, error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to fetch video', details: errorMessage },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;

  if (!videoId) {
    return NextResponse.json(
      { error: 'Video ID is required' },
      { status: 400 }
    );
  }

  try {
    if (isS3Enabled()) {
      const cfg = loadS3Config();
      const client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });

      // First, get the metadata to find the actual file path
      let videoFileKey = null;
      const metaKey = `videos/${videoId}/metadata.json`;

      try {
        const metaRes = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: metaKey })
        );
        const metaText = await (
          metaRes.Body as unknown as {
            transformToString: () => Promise<string>;
          }
        ).transformToString();
        const metadata = JSON.parse(metaText);

        // Use the r2Path from metadata if available, otherwise construct likely path
        if (metadata.r2Path) {
          videoFileKey = metadata.r2Path;
          console.log(`Found video file path from metadata: ${videoFileKey}`);
        } else {
          // Fallback: construct path using original filename
          videoFileKey = `videos/${videoId}/${metadata.filename || 'video.mov'}`;
          console.log(`Constructed video file path: ${videoFileKey}`);
        }
      } catch (metaError) {
        console.error(`Could not load metadata for ${videoId}:`, metaError);
        // If metadata doesn't exist, try to find the file by scanning
        // This handles cases where metadata might be missing but file exists
        const exts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'];
        for (const ext of exts) {
          const testKey = `videos/${videoId}/video${ext}`;
          try {
            await client.send(
              new GetObjectCommand({ Bucket: cfg.bucket, Key: testKey })
            );
            videoFileKey = testKey;
            console.log(`Found video file by scanning: ${videoFileKey}`);
            break;
          } catch {}
        }
      }

      // First, verify that objects actually exist before attempting deletion
      const keysToDelete = new Set<string>();
      const videoPrefix = `videos/${videoId}/`;

      try {
        const listedObjects = await client.send(
          new ListObjectsV2Command({
            Bucket: cfg.bucket,
            Prefix: videoPrefix,
          })
        );

        // Only add keys that actually exist in the bucket
        if (listedObjects.Contents && listedObjects.Contents.length > 0) {
          listedObjects.Contents.forEach((obj) => {
            if (obj.Key) {
              keysToDelete.add(obj.Key);
            }
          });
        }
      } catch (listError) {
        console.error(
          `Failed to list objects for prefix ${videoPrefix}:`,
          listError
        );
        return NextResponse.json(
          {
            success: false,
            error: `Failed to check if video exists in cloud storage`,
            details:
              listError instanceof Error
                ? listError.message
                : String(listError),
          },
          { status: 500 }
        );
      }

      // If no objects found, video doesn't exist
      if (keysToDelete.size === 0) {
        console.warn(
          `❌ No objects found for video ${videoId} - video does not exist`
        );
        // Invalidate cache since video doesn't exist on backend
        metadataCache.invalidateVideo(videoId);
        return NextResponse.json(
          {
            success: false,
            error: `Video ${videoId} not found in cloud storage`,
          },
          { status: 404 }
        );
      }

      // Delete the objects that actually exist
      const keysArray = Array.from(keysToDelete);
      const chunkSize = 1000; // S3 DeleteObjects limit
      let totalDeleted = 0;

      for (let i = 0; i < keysArray.length; i += chunkSize) {
        const chunk = keysArray.slice(i, i + chunkSize);
        try {
          const deleteResult = await client.send(
            new DeleteObjectsCommand({
              Bucket: cfg.bucket,
              Delete: {
                Objects: chunk.map((key) => ({ Key: key })),
                Quiet: false, // Get detailed results
              },
            })
          );

          const deletedCount = deleteResult.Deleted?.length || 0;
          totalDeleted += deletedCount;
          console.log(
            `✅ Successfully deleted ${deletedCount} object(s) for video ${videoId}: ${chunk.join(', ')}`
          );

          // Log any errors that occurred during deletion
          if (deleteResult.Errors && deleteResult.Errors.length > 0) {
            deleteResult.Errors.forEach((error) => {
              console.error(
                `❌ Failed to delete ${error.Key}: ${error.Message}`
              );
            });
          }
        } catch (deleteError) {
          console.error(
            `❌ Failed to delete objects ${chunk.join(', ')}:`,
            deleteError
          );
          return NextResponse.json(
            {
              success: false,
              error: `Failed to delete video files from cloud storage`,
              details:
                deleteError instanceof Error
                  ? deleteError.message
                  : String(deleteError),
            },
            { status: 500 }
          );
        }
      }

      console.log(
        `✅ Successfully deleted ${totalDeleted} object(s) for video ${videoId}`
      );

      // Update index - remove video from the index
      let indexUpdateFailed = false;
      try {
        const idxKey = 'metadata/videos-index.json';
        const res = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: idxKey })
        );
        const text = await (
          res.Body as unknown as { transformToString: () => Promise<string> }
        ).transformToString();
        type CloudVideoMetadata = Omit<VideoMetadata, 'uploadDate'> & {
          uploadDate: string;
        };
        const idx = JSON.parse(text) as { videos?: CloudVideoMetadata[] };
        const originalCount = idx.videos ? idx.videos.length : 0;
        idx.videos = (idx.videos || []).filter((v) => v.id !== videoId);
        const newCount = idx.videos.length;
        await client.send(
          new PutObjectCommand({
            Bucket: cfg.bucket,
            Key: idxKey,
            Body: JSON.stringify(idx, null, 2),
            ContentType: 'application/json',
          })
        );
        console.log(
          `✅ Updated index: removed ${originalCount - newCount} video(s)`
        );
      } catch (indexError) {
        console.error(`⚠️ Failed to update video index:`, indexError);
        indexUpdateFailed = true;
      }

      // Invalidate cache after successful deletion
      metadataCache.invalidateVideo(videoId);

      return NextResponse.json({
        success: true,
        message: `Video ${videoId} deleted successfully`,
        warning: indexUpdateFailed
          ? 'Video files deleted but index update failed'
          : undefined,
      });
    } else {
      // Cloud-only mode
      const hybridStorage = new HybridStorage();
      const result = await hybridStorage.deleteVideo(videoId);

      if (result.success) {
        return NextResponse.json({
          success: true,
          message: `Video ${videoId} deleted successfully from cloud storage`,
        });
      } else {
        // Invalidate cache if video was not found
        if (result.error?.includes('not found')) {
          metadataCache.invalidateVideo(videoId);
        }
        return NextResponse.json(
          {
            success: false,
            error: result.error || `Failed to delete video ${videoId}`,
            details: 'Video may not exist in cloud storage',
          },
          { status: result.error?.includes('not found') ? 404 : 500 }
        );
      }
    }
  } catch (error) {
    console.error(`Error deleting video ${videoId}:`, error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to delete video', details: errorMessage },
      { status: 500 }
    );
  }
}
