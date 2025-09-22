import { NextRequest, NextResponse } from 'next/server'
import { isS3Enabled, loadS3Config } from '@/lib/s3-config'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

function s3(): { client: S3Client; bucket: string } {
  const cfg = loadS3Config()
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
  })
  return { client, bucket: cfg.bucket }
}

async function getIndex(client: S3Client, bucket: string) {
  try {
    const key = 'metadata/videos-index.json'
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    const text = await (res.Body as any).transformToString()
    return JSON.parse(text)
  } catch {
    return { videos: [] as any[] }
  }
}

export async function POST(req: NextRequest) {
  if (!isS3Enabled()) {
    return NextResponse.json({ success: false, error: 'S3 not configured' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })

  const { videoId, clientName, projectName, filename, fileSize, key } = body
  if (!videoId || !clientName || !projectName || !filename || !fileSize || !key) {
    return NextResponse.json({ success: false, error: 'Missing fields' }, { status: 400 })
  }

  const { client, bucket } = s3()

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
    downloadUrl: `/download/${videoId}`,
    isActive: true
  }

  // Save per-video metadata
  const metaKey = `videos/${videoId}/metadata.json`
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: metaKey,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: 'application/json'
  }))

  // Update index
  const index = await getIndex(client, bucket)
  index.videos = (index.videos || []).filter((v: any) => v.id !== videoId)
  index.videos.push(metadata)
  // Sort by uploadDate desc
  index.videos.sort((a: any, b: any) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime())

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: 'metadata/videos-index.json',
    Body: JSON.stringify(index, null, 2),
    ContentType: 'application/json'
  }))

  return NextResponse.json({ success: true, metadata })
}

