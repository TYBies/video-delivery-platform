import crypto from 'crypto'
import { loadS3Config } from './s3-config'

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function hexHmac(key: Buffer | string, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex')
}

export function presignS3GetUrl(key: string, expiresSeconds = 900): string {
  const cfg = loadS3Config()
  const now = new Date()
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '')
  const hhmmss = now.toISOString().slice(11, 19).replace(/:/g, '')
  const amzDate = `${yyyymmdd}T${hhmmss}Z`
  const credential = `${cfg.accessKeyId}/${yyyymmdd}/${cfg.region}/s3/aws4_request`

  const host = new URL(cfg.endpoint).host
  const canonicalUri = `/${cfg.bucket}/${key}`
  const signedHeaders = 'host'

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': encodeURIComponent(credential),
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': signedHeaders
  }

  // Canonical request
  const canonicalQuery = Object.entries(query)
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&')
  const canonicalHeaders = `host:${host}\n`
  const payloadHash = 'UNSIGNED-PAYLOAD'
  const canonicalRequest = `GET\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`

  const algorithm = 'AWS4-HMAC-SHA256'
  const scope = `${yyyymmdd}/${cfg.region}/s3/aws4_request`
  const stringToSign = `${algorithm}\n${amzDate}\n${scope}\n${crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')}`

  const dateKey = hmac('AWS4' + cfg.secretAccessKey, yyyymmdd)
  const dateRegionKey = hmac(dateKey, cfg.region)
  const dateRegionServiceKey = hmac(dateRegionKey, 's3')
  const signingKey = hmac(dateRegionServiceKey, 'aws4_request')
  const signature = hexHmac(signingKey, stringToSign)

  const base = `${cfg.endpoint.replace(/\/$/, '')}/${cfg.bucket}/${encodeURI(key)}`
  return `${base}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

