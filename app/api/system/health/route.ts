import { NextRequest, NextResponse } from 'next/server';
import { StartupService } from '@/lib/startup-service';

export async function GET(request: NextRequest) {
  try {
    const startupService = new StartupService();
    const health = await startupService.getSystemHealth();

    return NextResponse.json({
      success: true,
      health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('System health check failed:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Health check failed',
        health: {
          activeUploads: 0,
          orphanedFiles: 0,
          lastOrphanScan: null,
          systemStatus: 'error',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}