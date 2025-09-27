import { NextRequest, NextResponse } from 'next/server';
import { isS3Enabled } from '@/lib/s3-config';
import { presignS3PutUrl } from '@/lib/s3-presign-put';
import crypto, { randomUUID } from 'crypto';
import { getFileExtension } from '@/lib/mime';

export async function POST(req: NextRequest) {
  try {
    if (!isS3Enabled()) {
      console.error('❌ Presigned URL request failed: S3/R2 not configured');
      return NextResponse.json(
        {
          success: false,
          error: 'Cloud storage not configured. Please contact support.',
        },
        { status: 503 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const filename = String(body.filename || 'video.mp4');

    if (!filename) {
      return NextResponse.json(
        {
          success: false,
          error: 'Filename is required',
        },
        { status: 400 }
      );
    }

    const videoId =
      typeof randomUUID === 'function'
        ? randomUUID()
        : crypto.randomBytes(16).toString('hex');
    const ext = getFileExtension(filename);
    const key = `videos/${videoId}/video${ext}`;

    console.log(`🔗 Generating presigned URL for video ${videoId}: ${key}`);
    const url = presignS3PutUrl(key, 900); // 15 minutes

    return NextResponse.json({
      success: true,
      url,
      key,
      videoId,
      expiresIn: 900,
      warning:
        'Upload must complete within 15 minutes and be registered via /api/video/register',
    });
  } catch (error) {
    console.error('❌ Presigned URL generation failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to generate upload URL',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
