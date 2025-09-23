import { NextRequest, NextResponse } from 'next/server'
import { isS3Enabled } from '@/lib/s3-config'
import { presignS3PutUrl } from '@/lib/s3-presign-put'
import crypto from 'crypto'
import { getFileExtension } from '@/lib/mime'

export async function POST(req: NextRequest) {
  if (!isS3Enabled()) return NextResponse.json({ error: 'S3 not configured' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const filename = String(body.filename || 'video.mp4')
  const videoId = (crypto as any).randomUUID ? (crypto as any).randomUUID() : Math.random().toString(16).slice(2)
  const ext = getFileExtension(filename)
  const key = `videos/${videoId}/video${ext}`
  const url = presignS3PutUrl(key, 900)
  return NextResponse.json({ url, key, videoId })
}

