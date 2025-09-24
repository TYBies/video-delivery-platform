import { NextRequest, NextResponse } from 'next/server';
import { HybridStorage } from '@/lib/hybrid-storage';
import { MetadataManager } from '@/lib/metadata';
import { isS3Enabled, loadS3Config } from '@/lib/s3-config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getFileExtension, getVideoContentTypeByExt } from '@/lib/mime';

export async function GET(
  request: NextRequest,
  { params }: { params: { videoId: string } }
) {
  try {
    const { videoId } = params;

    if (!videoId) {
      return NextResponse.json(
        { error: 'Video ID is required' },
        { status: 400 }
      );
    }

    // If S3 mode, optionally redirect to presigned URL if requested
    if (isS3Enabled()) {
      const url = new URL(request.url);
      const metadataManager = new MetadataManager();
      const meta = await metadataManager
        .loadMetadata(videoId)
        .catch(() => null as any);

      if (!meta) {
        return NextResponse.json(
          { error: 'Video metadata not found' },
          { status: 404 }
        );
      }

      // Use r2Path from metadata if available, otherwise construct path
      let key = meta.r2Path;
      if (!key) {
        const ext = getFileExtension(meta.filename || 'video.mp4');
        key = `videos/${videoId}/${meta.filename || `video${ext}`}`;
      }

      if (url.searchParams.get('presigned') === '1') {
        // Redirect to presigned GET to bypass serverless for large files
        const { presignS3GetUrl } = await import('@/lib/s3-presign-get');
        const signed = presignS3GetUrl(key, 900);
        return NextResponse.redirect(signed, { status: 302 });
      }

      const cfg = loadS3Config();
      const client = new S3Client({
        region: cfg.region,
        endpoint: cfg.endpoint,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
      });

      let s3Obj;
      try {
        s3Obj = await client.send(
          new GetObjectCommand({ Bucket: cfg.bucket, Key: key })
        );
        console.log(`Successfully found video file for download at: ${key}`);
      } catch (e) {
        console.error(`Video file not found for download at: ${key}`, e);
        return NextResponse.json(
          { error: 'Video file not found' },
          { status: 404 }
        );
      }
      const headers = new Headers();
      const ext = getFileExtension(meta.filename || 'video.mp4');
      const contentType = s3Obj.ContentType || getVideoContentTypeByExt(ext);
      const size = s3Obj.ContentLength || 0;
      headers.set('Content-Type', contentType);
      if (size) headers.set('Content-Length', String(size));
      headers.set(
        'Content-Disposition',
        `attachment; filename="${meta?.filename || `video${ext}`}"`
      );

      const webStream = (s3Obj.Body as any).transformToWebStream();
      return new NextResponse(webStream, { status: 200, headers });
    }

    // Initialize storage and metadata manager (local/hybrid)
    const hybridStorage = new HybridStorage();
    const metadataManager = new MetadataManager();

    // Check if video exists and is active
    const metadata = await metadataManager.loadMetadata(videoId);

    if (!metadata) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 });
    }

    if (!metadata.isActive) {
      return NextResponse.json(
        { error: 'Video access has been disabled' },
        { status: 403 }
      );
    }

    // Get video stream from cloud storage
    const { stream, size, filename } =
      await hybridStorage.getVideoStream(videoId);

    // Set appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', getContentType(filename));
    headers.set('Content-Length', size.toString());
    headers.set(
      'Content-Disposition',
      `attachment; filename="${metadata.filename}"`
    );
    headers.set('Cache-Control', 'public, max-age=31536000'); // 1 year cache
    headers.set('X-Video-Source', 'cloud'); // Cloud-only source

    // Create readable stream for the response
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        stream.on('end', () => {
          controller.close();
        });

        stream.on('error', (error) => {
          controller.error(error);
        });
      },
    });

    return new NextResponse(readableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error('Download error:', error);

    return NextResponse.json(
      { error: 'Failed to download video' },
      { status: 500 }
    );
  }
}

function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();

  const contentTypes: Record<string, string> = {
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
  };

  return contentTypes[ext || 'mp4'] || 'video/mp4';
}
