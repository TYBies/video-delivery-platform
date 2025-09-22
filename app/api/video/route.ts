
import { MetadataManager } from '@/lib/metadata';
import { NextResponse } from 'next/server';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

export async function GET() {
  try {
    if (isS3Enabled()) {
      const cfg = loadS3Config()
      const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey } })
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: 'metadata/videos-index.json' }))
        const text = await (res.Body as any).transformToString()
        const index = JSON.parse(text)
        return NextResponse.json(index.videos || [])
      } catch {
        return NextResponse.json([])
      }
    } else {
      const metadataManager = new MetadataManager();
      const videos = await metadataManager.getAllMetadata();
      return NextResponse.json(videos);
    }
  } catch (error) {
    console.error('Error fetching videos:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch videos', details: errorMessage }, { status: 500 });
  }
}
