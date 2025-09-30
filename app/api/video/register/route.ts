import { NextRequest, NextResponse } from 'next/server';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { VideoMetadata } from '@/types';

function s3(): { client: S3Client; bucket: string } {
  const cfg = loadS3Config();
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
  return { client, bucket: cfg.bucket };
}

type CloudVideoMetadata = Omit<VideoMetadata, 'uploadDate'> & {
  uploadDate: string;
};

async function getIndex(
  client: S3Client,
  bucket: string
): Promise<{ videos: CloudVideoMetadata[] }> {
  try {
    const key = 'metadata/videos-index.json';
    const res = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key })
    );
    const text = await (
      res.Body as unknown as { transformToString: () => Promise<string> }
    ).transformToString();
    return JSON.parse(text) as { videos: CloudVideoMetadata[] };
  } catch {
    return { videos: [] };
  }
}

export async function POST(req: NextRequest) {
  if (!isS3Enabled()) {
    return NextResponse.json(
      { success: false, error: 'S3 not configured' },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body)
    return NextResponse.json(
      { success: false, error: 'Invalid JSON' },
      { status: 400 }
    );

  const { videoId, clientName, projectName, filename, fileSize, key } = body;
  if (
    !videoId ||
    !clientName ||
    !projectName ||
    !filename ||
    !fileSize ||
    !key
  ) {
    return NextResponse.json(
      { success: false, error: 'Missing fields' },
      { status: 400 }
    );
  }

  const { client, bucket } = s3();

  // CRITICAL: Verify the video file actually exists in cloud storage before registering
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    console.log(`✅ Verified video file exists in cloud storage: ${key}`);
  } catch (error) {
    console.error(`❌ Video file verification failed for ${key}:`, error);
    return NextResponse.json(
      {
        success: false,
        error: 'Video file not found in cloud storage. Upload may have failed.',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 404 }
    );
  }

  // Generate permanent download link
  const origin =
    process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
  const permanentDownloadUrl = `${origin}/api/direct-download/${videoId}`;

  const metadata = {
    id: videoId,
    filename,
    clientName,
    projectName,
    uploadDate: new Date().toISOString(),
    fileSize,
    downloadCount: 0,
    status: 'cloud-only',
    r2Path: key,
    downloadUrl: permanentDownloadUrl,
    isActive: true,
  };

  try {
    // Save per-video metadata
    const metaKey = `videos/${videoId}/metadata.json`;
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: metaKey,
        Body: JSON.stringify(metadata, null, 2),
        ContentType: 'application/json',
      })
    );

    // Update index
    const index = await getIndex(client, bucket);
    index.videos = (index.videos || []).filter((v) => v.id !== videoId);
    index.videos.push(metadata as CloudVideoMetadata);
    // Sort by uploadDate desc
    index.videos.sort(
      (a, b) =>
        new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime()
    );

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: 'metadata/videos-index.json',
        Body: JSON.stringify(index, null, 2),
        ContentType: 'application/json',
      })
    );

    console.log(`✅ Successfully registered video ${videoId} in cloud storage`);

    // Invalidate cache to ensure the new video shows up immediately
    const { metadataCache } = await import('@/lib/metadata-cache');
    metadataCache.invalidateVideoList();
    console.log('🔄 Invalidated video list cache after registration');

    return NextResponse.json({ success: true, metadata });
  } catch (error) {
    console.error(`❌ Failed to save metadata for video ${videoId}:`, error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save video metadata to cloud storage',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
