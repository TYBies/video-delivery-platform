import { NextRequest, NextResponse } from 'next/server'
import { isS3Enabled, loadS3Config } from '@/lib/s3-config'
import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'

export async function POST(req: NextRequest) {
  if (!isS3Enabled()) {
    return NextResponse.json({ success: false, error: 'Cloud storage not configured' }, { status: 400 })
  }

  const cfg = loadS3Config()
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
  })

  const id = Math.random().toString(36).slice(2)
  const key = `selftest/${id}.txt`
  const body = `self-test ${new Date().toISOString()}`

  const result: any = { bucket: cfg.bucket, endpoint: cfg.endpoint, region: cfg.region, key }

  try {
    await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: 'text/plain' }))
    result.put = true
  } catch (e: any) {
    result.put = false
    result.putError = String(e.message || e)
    return NextResponse.json({ success: false, ...result }, { status: 500 })
  }

  try {
    await client.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
    result.head = true
  } catch (e: any) {
    result.head = false
    result.headError = String(e.message || e)
  }

  try {
    const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
    const text = await (res.Body as any).transformToString()
    result.get = (text === body)
  } catch (e: any) {
    result.get = false
    result.getError = String(e.message || e)
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    result.deleted = true
  } catch (e: any) {
    result.deleted = false
    result.deleteError = String(e.message || e)
  }

  const success = !!(result.put && result.head && result.get && result.deleted)
  return NextResponse.json({ success, ...result })
}

