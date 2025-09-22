
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
      const metaKey = `videos/${videoId}/metadata.json`
      // Try deleting common extensions; ignore errors
      const exts = ['.mp4', '.mov', '.avi', '.mkv', '.webm']
      for (const ext of exts) {
        try { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: `videos/${videoId}/video${ext}` })) } catch {}
      }
      try { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: metaKey })) } catch {}
      // Update index
      try {
        const idxKey = 'metadata/videos-index.json'
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: idxKey }))
        const text = await (res.Body as any).transformToString()
        const idx = JSON.parse(text)
        idx.videos = (idx.videos || []).filter((v: any) => v.id !== videoId)
        await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: idxKey }))
        await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: idxKey, Body: JSON.stringify(idx, null, 2), ContentType: 'application/json' }))
      } catch {}
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
