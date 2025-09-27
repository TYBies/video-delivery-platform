import { NextResponse } from 'next/server';
import { getBackgroundRecoveryService } from '@/lib/background-recovery-service';

export async function GET() {
  try {
    const service = getBackgroundRecoveryService();
    const status = service.getStatus();

    return NextResponse.json({
      success: true,
      status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get recovery service status:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const service = getBackgroundRecoveryService();

    console.log('Manual recovery triggered via API');
    const result = await service.forceRecoveryCheck();

    return NextResponse.json({
      success: true,
      message: 'Recovery check completed',
      result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Manual recovery failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Recovery failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
