import { NextResponse } from 'next/server';
import { StartupService } from '@/lib/startup-service';

export async function POST() {
  try {
    console.log('Manual startup tasks triggered');

    const startupService = new StartupService();
    await startupService.runStartupTasks();

    const health = await startupService.getSystemHealth();

    return NextResponse.json({
      success: true,
      message: 'Startup tasks completed successfully',
      health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Startup tasks failed:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Startup tasks failed',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
