import { NextRequest, NextResponse } from 'next/server'
import { isS3Enabled } from '@/lib/s3-config'
import { presignS3Post } from '@/lib/s3-presign-post'
import crypto from 'crypto'

function extOf(filename: string): string {
  const m = filename.toLowerCase().match(/\.[^.]+$/)
  return m ? m[0] : '.mp4'
}

export async function POST(req: NextRequest) {
  if (!isS3Enabled()) {
    return NextResponse.json({ error: 'S3 is not configured' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const filename = String(body.filename || 'video.mp4')
  const contentType = String(body.contentType || 'video/mp4')
  const contentLength = Number(body.contentLength || 0)

  const videoId = crypto.randomBytes(16).toString('hex')
  const keyPrefix = `videos/${videoId}/`
  const key = `${keyPrefix}video${extOf(filename)}`

  const { url, fields } = presignS3Post({
    key,
    contentType,
    maxSizeBytes: Math.max(contentLength, 25 * 1024 * 1024 * 1024) // allow up to 25GB by default
  })

  return NextResponse.json({ url, fields, videoId, key })
}

