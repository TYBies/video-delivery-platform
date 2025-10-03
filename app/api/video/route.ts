import { MetadataManager } from '@/lib/metadata';
import { NextResponse } from 'next/server';
import { isS3Enabled, loadS3Config, handleS3Error } from '@/lib/s3-config';
import { metadataCache, rateLimiter } from '@/lib/metadata-cache';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { VideoMetadata } from '@/types';

export async function GET() {
  try {
    if (isS3Enabled()) {
      // IMPORTANT: Skip in-memory cache on Vercel since serverless functions
      // don't share memory. Each invocation might hit a different instance.
      const isVercel = !!process.env.VERCEL;

      // Check cache first to reduce B2 Class B transactions (only in local dev)
      if (!isVercel) {
        const cachedVideos = metadataCache.getVideoList();
        if (cachedVideos) {
          console.log(`Returning ${cachedVideos.length} videos from cache`);
          return NextResponse.json(cachedVideos);
        }
      }

      // Check rate limiting to prevent excessive API calls
      if (!rateLimiter.canMakeRequest('video-list')) {
        const remaining = rateLimiter.getRemainingRequests('video-list');
        return NextResponse.json(
          {
            error: 'Rate limit exceeded',
            message: `Please try again later. ${remaining} requests remaining in this minute.`,
          },
          { status: 429 }
        );
      }
      const cfg = loadS3Config();
      const client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });

      // First try to get existing metadata index
      type CloudVideoMetadata = Omit<VideoMetadata, 'uploadDate'> & {
        uploadDate: string;
      };
      let existingVideos: CloudVideoMetadata[] = [];
      try {
        const res = await client.send(
          new GetObjectCommand({
            Bucket: cfg.bucket,
            Key: 'metadata/videos-index.json',
          })
        );
        const text = await (
          res.Body as unknown as { transformToString: () => Promise<string> }
        ).transformToString();
        const index = JSON.parse(text) as { videos?: CloudVideoMetadata[] };
        existingVideos = index.videos || [];
      } catch {
        // Index doesn't exist, that's okay - we'll discover videos from bucket
      }

      // Scan entire bucket for all video files regardless of structure
      const allObjectsResult = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          MaxKeys: 1000, // Increase limit to ensure we get all objects
        })
      );

      // Also scan for root-level folders that might contain videos
      const rootFoldersResult = await client.send(
        new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: '',
          Delimiter: '/',
        })
      );

      // Find all video files regardless of their location
      const videoExtensions = ['.mov', '.mp4', '.avi', '.mkv', '.webm', '.m4v'];
      const videoFiles =
        allObjectsResult.Contents?.filter((obj) => {
          const key = obj.Key || '';
          return videoExtensions.some((ext) => key.toLowerCase().endsWith(ext));
        }) || [];

      console.log(
        `Found ${allObjectsResult.Contents?.length || 0} total objects in bucket:`
      );
      allObjectsResult.Contents?.forEach((obj) =>
        console.log(`  - ${obj.Key}`)
      );

      console.log(
        `\nFound ${rootFoldersResult.CommonPrefixes?.length || 0} root-level folders:`
      );
      rootFoldersResult.CommonPrefixes?.forEach((prefix) =>
        console.log(`  - ${prefix.Prefix}`)
      );

      // For each root-level UUID folder, scan for video files inside
      const additionalVideoFiles = [];
      for (const prefix of rootFoldersResult.CommonPrefixes || []) {
        const folderName = prefix.Prefix?.replace('/', '') || '';
        // Check if it looks like a UUID
        if (
          folderName.match(
            /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
          )
        ) {
          console.log(`Scanning UUID folder: ${folderName}`);

          // Scan this folder for video files
          const folderResult = await client.send(
            new ListObjectsV2Command({
              Bucket: cfg.bucket,
              Prefix: `${folderName}/`,
            })
          );

          const folderVideoFiles =
            folderResult.Contents?.filter((obj) => {
              const key = obj.Key || '';
              return videoExtensions.some((ext) =>
                key.toLowerCase().endsWith(ext)
              );
            }) || [];

          console.log(
            `  Found ${folderVideoFiles.length} video files in ${folderName}`
          );
          folderVideoFiles.forEach((file) => console.log(`    - ${file.Key}`));

          additionalVideoFiles.push(...folderVideoFiles);
        }
      }

      // Combine video files from direct scan and folder scans
      const allVideoFiles = [...videoFiles, ...additionalVideoFiles];

      console.log(`\nTotal video files found: ${allVideoFiles.length}`);
      allVideoFiles.forEach((file) => console.log(`  - ${file.Key}`));

      // Extract video IDs from file paths using various patterns
      const allVideoIds = new Set<string>();

      allVideoFiles.forEach((file) => {
        const key = file.Key || '';
        const pathParts = key.split('/');

        // Pattern 1: videos/uuid/filename.mp4
        if (pathParts.length >= 3 && pathParts[0] === 'videos') {
          const videoId = pathParts[1];
          if (
            videoId.match(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
            )
          ) {
            allVideoIds.add(videoId);
          }
        }

        // Pattern 2: uuid/filename.mp4 (root level folders)
        if (pathParts.length >= 2) {
          const potentialId = pathParts[0];
          if (
            potentialId.match(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
            )
          ) {
            allVideoIds.add(potentialId);
          }
        }

        // Pattern 3: filename-uuid.mp4 (filename contains UUID)
        const filename = pathParts[pathParts.length - 1];
        const uuidMatch = filename.match(
          /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
        );
        if (uuidMatch) {
          allVideoIds.add(uuidMatch[1]);
        }

        // Pattern 4: Use full file path as ID if no UUID patterns match
        // Only add this if no other patterns matched for this specific file
        let foundMatch = false;

        // Check if this file already matched any pattern
        if (pathParts.length >= 3 && pathParts[0] === 'videos') {
          const videoId = pathParts[1];
          if (
            videoId.match(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
            )
          ) {
            foundMatch = true;
          }
        }

        if (!foundMatch && pathParts.length >= 2) {
          const potentialId = pathParts[0];
          if (
            potentialId.match(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
            )
          ) {
            foundMatch = true;
          }
        }

        if (!foundMatch && uuidMatch) {
          foundMatch = true;
        }

        // If no UUID pattern matched, use a hash of the file path as ID
        if (!foundMatch) {
          // Create a unique ID based on the file path
          const pathBasedId = key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
          allVideoIds.add(pathBasedId);
        }
      });

      console.log(
        `Discovered ${allVideoIds.size} unique video IDs from ${allVideoFiles.length} video files`
      );
      console.log(`Video IDs: ${Array.from(allVideoIds).join(', ')}`);

      // Create a map of video files by their derived IDs for easy lookup
      type S3ListedObject = {
        Key?: string;
        LastModified?: Date;
        Size?: number;
      };
      const videoFileMap = new Map<string, S3ListedObject>();
      allVideoFiles.forEach((file) => {
        const key = file.Key || '';
        const pathParts = key.split('/');
        const filename = pathParts[pathParts.length - 1];

        // Determine the video ID for this file
        let videoId = '';

        // Pattern 1: videos/uuid/filename.mp4
        if (pathParts.length >= 3 && pathParts[0] === 'videos') {
          const candidateId = pathParts[1];
          if (
            candidateId.match(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
            )
          ) {
            videoId = candidateId;
          }
        }

        // Pattern 2: uuid/filename.mp4 (root level folders)
        if (!videoId && pathParts.length >= 2) {
          const potentialId = pathParts[0];
          if (
            potentialId.match(
              /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
            )
          ) {
            videoId = potentialId;
          }
        }

        // Pattern 3: filename-uuid.mp4 (filename contains UUID)
        if (!videoId) {
          const uuidMatch = filename.match(
            /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i
          );
          if (uuidMatch) {
            videoId = uuidMatch[1];
          }
        }

        // Pattern 4: Use file path as ID if no UUID found
        if (!videoId) {
          videoId = key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        }

        videoFileMap.set(videoId, file);
      });

      // For each discovered video ID, check if we have metadata or create basic metadata
      const allVideos: CloudVideoMetadata[] = [];
      for (const videoId of Array.from(allVideoIds)) {
        // Check if we already have metadata for this video
        const existingVideo = existingVideos.find((v) => v.id === videoId);

        if (existingVideo) {
          allVideos.push(existingVideo);
        } else {
          // Get video file info from our map
          const videoFile = videoFileMap.get(videoId);

          if (videoFile && videoFile.Key) {
            // Extract filename from path
            const filename = videoFile.Key.split('/').pop() || 'unknown.mov';

            // Create basic metadata for discovered video using data from ListObjectsV2Command
            const basicMetadata: CloudVideoMetadata = {
              id: videoId,
              filename: filename,
              clientName: 'Unknown Client',
              projectName: 'Discovered Video',
              uploadDate:
                videoFile.LastModified?.toISOString() ||
                new Date().toISOString(),
              fileSize: videoFile.Size || 0,
              downloadCount: 0,
              status: 'cloud-only' as const,
              r2Path: videoFile.Key,
              downloadUrl: `/api/download/${videoId}`,
              isActive: true,
            };

            allVideos.push(basicMetadata);
            console.log(
              `Discovered unregistered video: ${videoId} at ${videoFile.Key}`
            );
          } else {
            console.warn(`No video file found for ID: ${videoId}`);
          }
        }
      }

      console.log(`Returning ${allVideos.length} total videos`);

      // Convert uploadDate strings to Date objects for consistency
      const standardizedVideos: VideoMetadata[] = allVideos.map((v) => ({
        ...v,
        uploadDate: new Date(v.uploadDate),
      }));

      // Cache the results to reduce future B2 API calls (only in local dev)
      if (!isVercel) {
        metadataCache.setVideoList(standardizedVideos);
      }

      // Prevent caching on Vercel/CDN to ensure fresh data
      return NextResponse.json(standardizedVideos, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'CDN-Cache-Control': 'no-store',
          'Vercel-CDN-Cache-Control': 'no-store',
        },
      });
    } else {
      const metadataManager = new MetadataManager();
      const videos = await metadataManager.getAllMetadata();
      return NextResponse.json(videos, {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
        },
      });
    }
  } catch (error) {
    console.error('Error fetching videos:', error);

    // Handle S3/B2 specific errors with professional messages
    if (error && typeof error === 'object' && 'Code' in error) {
      const { message, userFriendly, isRateLimited } = handleS3Error(error);
      console.error(`S3 Error: ${message}`);

      return NextResponse.json(
        {
          error: userFriendly,
          technical: message,
          rateLimited: isRateLimited,
          retryAfter: isRateLimited ? 'midnight GMT' : undefined,
        },
        { status: isRateLimited ? 429 : 500 }
      );
    }

    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        error: 'Unable to fetch videos at this time. Please try again later.',
        technical: errorMessage,
      },
      { status: 500 }
    );
  }
}
