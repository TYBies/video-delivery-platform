import { StartupService } from './startup-service';

let isInitialized = false;

/**
 * Initialize the application with recovery services
 * This should be called when the app starts
 */
export async function initializeApp(): Promise<void> {
  if (isInitialized) {
    return;
  }

  try {
    console.log('🚀 Initializing video upload application...');
    
    const startupService = new StartupService();
    await startupService.runStartupTasks();
    
    isInitialized = true;
    console.log('✅ Application initialized successfully');
  } catch (error) {
    console.error('❌ Application initialization failed:', error);
    // Don't throw - let the app continue to run even if initialization fails
  }
}

/**
 * Check if the app has been initialized
 */
export function isAppInitialized(): boolean {
  return isInitialized;
}

/**
 * Force re-initialization (useful for testing or manual recovery)
 */
export async function reinitializeApp(): Promise<void> {
  isInitialized = false;
  await initializeApp();
}