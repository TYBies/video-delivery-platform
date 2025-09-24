import { NextResponse } from 'next/server';
import { VideoProcessor } from '@/lib/video-processor';

export async function GET() {
  try {
    const isAvailable = await VideoProcessor.checkFFmpegAvailable();

    return NextResponse.json({
      success: true,
      ffmpegAvailable: isAvailable,
      message: isAvailable
        ? 'FFmpeg is available for video compression'
        : 'FFmpeg not found. Install FFmpeg to enable video compression.',
    });
  } catch (error) {
    console.error('FFmpeg status check error:', error);

    return NextResponse.json(
      {
        success: false,
        ffmpegAvailable: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to check FFmpeg status',
      },
      { status: 500 }
    );
  }
}
