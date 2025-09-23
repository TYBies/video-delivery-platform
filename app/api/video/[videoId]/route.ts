
import { HybridStorage } from '@/lib/hybrid-storage';
import { MetadataManager } from '@/lib/metadata';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config'
import { S3Client, GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;

  if (!videoId) {
    return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
  }

  try {
    if (isS3Enabled()) {
      const cfg = loadS3Config()
      const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } })
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: `videos/${videoId}/metadata.json` }))
        const text = await (res.Body as any).transformToString()
        return NextResponse.json(JSON.parse(text))
      } catch {
        return NextResponse.json({ error: `Video ${videoId} not found` }, { status: 404 })
      }
    } else {
      const metadataManager = new MetadataManager();
      const metadata = await metadataManager.loadMetadata(videoId);

      if (metadata) {
        return NextResponse.json(metadata);
      } else {
        return NextResponse.json({ error: `Video ${videoId} not found` }, { status: 404 });
      }
    }
  } catch (error) {
    console.error(`Error fetching video ${videoId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch video', details: errorMessage }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;

  if (!videoId) {
    return NextResponse.json({ error: 'Video ID is required' }, { status: 400 });
  }

  try {
    if (isS3Enabled()) {
      const cfg = loadS3Config()
      const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } })

      // First, get the metadata to find the actual file path
      let videoFileKey = null;
      const metaKey = `videos/${videoId}/metadata.json`

      try {
        const metaRes = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: metaKey }))
        const metaText = await (metaRes.Body as any).transformToString()
        const metadata = JSON.parse(metaText)

        // Use the r2Path from metadata if available, otherwise construct likely path
        if (metadata.r2Path) {
          videoFileKey = metadata.r2Path
          console.log(`Found video file path from metadata: ${videoFileKey}`)
        } else {
          // Fallback: construct path using original filename
          videoFileKey = `videos/${videoId}/${metadata.filename || 'video.mov'}`
          console.log(`Constructed video file path: ${videoFileKey}`)
        }
      } catch (metaError) {
        console.error(`Could not load metadata for ${videoId}:`, metaError)
        // If metadata doesn't exist, try to find the file by scanning
        // This handles cases where metadata might be missing but file exists
        const exts = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']
        for (const ext of exts) {
          const testKey = `videos/${videoId}/video${ext}`
          try {
            await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: testKey }))
            videoFileKey = testKey
            console.log(`Found video file by scanning: ${videoFileKey}`)
            break
          } catch {}
        }
      }

      // Delete the actual video file if we found it
      if (videoFileKey) {
        try {
          await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: videoFileKey }))
          console.log(`Successfully deleted video file: ${videoFileKey}`)
        } catch (deleteError) {
          console.error(`Failed to delete video file ${videoFileKey}:`, deleteError)
          return NextResponse.json({ error: `Failed to delete video file: ${deleteError.message}` }, { status: 500 });
        }
      } else {
        console.warn(`No video file found for ${videoId}`)
      }

      // Delete the metadata file
      try {
        await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: metaKey }))
        console.log(`Successfully deleted metadata: ${metaKey}`)
      } catch (metaDeleteError) {
        console.error(`Failed to delete metadata ${metaKey}:`, metaDeleteError)
      }

      // Update index - remove video from the index
      try {
        const idxKey = 'metadata/videos-index.json'
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: idxKey }))
        const text = await (res.Body as any).transformToString()
        const idx = JSON.parse(text)
        const originalCount = idx.videos ? idx.videos.length : 0
        idx.videos = (idx.videos || []).filter((v: any) => v.id !== videoId)
        const newCount = idx.videos.length

        await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: idxKey }))
        await client.send(new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: idxKey,
          Body: JSON.stringify(idx, null, 2),
          ContentType: 'application/json'
        }))
        console.log(`Updated index: removed ${originalCount - newCount} video(s)`)
      } catch (indexError) {
        console.error(`Failed to update index:`, indexError)
      }

      return NextResponse.json({ message: `Video ${videoId} deleted successfully` })
    } else {
      const hybridStorage = new HybridStorage();
      const result = await hybridStorage.deleteVideo(videoId);

      if (result.success) {
        return NextResponse.json({ message: `Video ${videoId} deleted successfully` });
      } else {
        return NextResponse.json({ error: `Failed to delete video ${videoId}` }, { status: 500 });
      }
    }
  } catch (error) {
    console.error(`Error deleting video ${videoId}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to delete video', details: errorMessage }, { status: 500 });
  }
}
