import { NextRequest, NextResponse } from 'next/server';
import { isS3Enabled } from '@/lib/s3-config';
import { presignS3GetUrl } from '@/lib/s3-presign-get';
import { MetadataManager } from '@/lib/metadata';
import { getFileExtension } from '@/lib/mime';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  const { videoId } = params;
  if (!videoId)
    return NextResponse.json(
      { error: 'Video ID is required' },
      { status: 400 }
    );

  if (!isS3Enabled()) {
    return NextResponse.json(
      { error: 'Cloud storage not configured' },
      { status: 400 }
    );
  }

  const metadataManager = new MetadataManager();
  const meta = await metadataManager.loadMetadata(videoId);
  const ext = getFileExtension(meta?.filename || 'video.mp4');
  const key = `videos/${videoId}/video${ext}`;
  const url = presignS3GetUrl(key, 900);
  return NextResponse.json({ url });
}
