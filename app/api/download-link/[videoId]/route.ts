import { NextRequest, NextResponse } from 'next/server';
import { downloadLinkManager } from '@/lib/download-link-manager';

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

    const linkData = await downloadLinkManager.getDownloadLink(videoId);

    return NextResponse.json({
      success: true,
      downloadUrl: linkData.url,
      expiresAt: linkData.expiresAt.toISOString(),
      isFromCache: linkData.isFromCache,
      accessCount: linkData.accessCount,
      cacheStats: downloadLinkManager.getCacheStats(),
    });
  } catch (error) {
    console.error('Download link generation error:', error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to generate download link',
        success: false,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
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

    downloadLinkManager.invalidateLink(videoId);

    return NextResponse.json({
      success: true,
      message: 'Download link cache invalidated',
    });
  } catch (error) {
    console.error('Download link invalidation error:', error);

    return NextResponse.json(
      {
        error: 'Failed to invalidate download link',
        success: false,
      },
      { status: 500 }
    );
  }
}
