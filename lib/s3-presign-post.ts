import crypto from 'crypto'
import { loadS3Config } from './s3-config'

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function hexHmac(key: Buffer | string, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

export function presignS3Post({ key, contentType, maxSizeBytes, expiresSeconds = 3600 }: {
  key: string
  contentType: string
  maxSizeBytes: number
  expiresSeconds?: number
}) {
  const cfg = loadS3Config()
  const now = new Date()
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '')
  const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, '')
  const amzDate = `${yyyymmdd}T${hhmmss}Z`
  const credential = `${cfg.accessKeyId}/${yyyymmdd}/${cfg.region}/s3/aws4_request`

  const policy = {
    expiration: new Date(now.getTime() + expiresSeconds * 1000).toISOString(),
    conditions: [
      { bucket: cfg.bucket },
      { key },
      { 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
      { 'x-amz-credential': credential },
      { 'x-amz-date': amzDate },
      ['content-length-range', 0, maxSizeBytes],
      ['starts-with', '$Content-Type', contentType || '']
    ]
  }

  const policyBase64 = Buffer.from(JSON.stringify(policy)).toString('base64')

  const dateKey = hmac('AWS4' + cfg.secretAccessKey, yyyymmdd)
  const dateRegionKey = hmac(dateKey, cfg.region)
  const dateRegionServiceKey = hmac(dateRegionKey, 's3')
  const signingKey = hmac(dateRegionServiceKey, 'aws4_request')
  const signature = hexHmac(signingKey, policyBase64)

  const url = `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}`

  const fields: Record<string, string> = {
    key,
    'Content-Type': contentType,
    'x-amz-algorithm': 'AWS4-HMAC-SHA256',
    'x-amz-credential': credential,
    'x-amz-date': amzDate,
    Policy: policyBase64,
    'x-amz-signature': signature
  }

  return { url, fields }
}

export function objectUrlForKey(key: string): string {
  const cfg = loadS3Config()
  return `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${encodeURI(key)}`
}
