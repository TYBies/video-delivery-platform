export interface EnvironmentConfig {
  // Storage Configuration
  storagePath: string;
  uploadMaxSize: number;

  // R2 Configuration
  r2AccountId?: string;
  r2AccessKey?: string;
  r2SecretKey?: string;
  r2Bucket?: string;
  r2Region?: string;

  // Admin Configuration
  adminPassword?: string;

  // Next.js Configuration
  nextAuthSecret?: string;
  nextAuthUrl?: string;
}

export class EnvironmentValidator {
  /**
   * Load and validate environment configuration
   */
  static loadConfig(): EnvironmentConfig {
    return {
      // Storage Configuration
      storagePath: process.env.STORAGE_PATH || './uploads',
      uploadMaxSize: parseInt(process.env.UPLOAD_MAX_SIZE || '2147483648'), // 2GB default

      // R2 Configuration (optional for local development)
      r2AccountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID,
      r2AccessKey: process.env.CLOUDFLARE_R2_ACCESS_KEY,
      r2SecretKey: process.env.CLOUDFLARE_R2_SECRET_KEY,
      r2Bucket: process.env.CLOUDFLARE_R2_BUCKET,
      r2Region: process.env.CLOUDFLARE_R2_REGION || 'auto',

      // Admin Configuration
      adminPassword: process.env.ADMIN_PASSWORD,

      // Next.js Configuration
      nextAuthSecret: process.env.NEXTAUTH_SECRET,
      nextAuthUrl: process.env.NEXTAUTH_URL || 'http://localhost:3000',
    };
  }

  /**
   * Check if R2 configuration is available
   */
  static isR2Configured(): boolean {
    const config = this.loadConfig();
    return !!(
      config.r2AccountId &&
      config.r2AccessKey &&
      config.r2SecretKey &&
      config.r2Bucket
    );
  }

  /**
   * Validate required environment variables for production
   */
  static validateProduction(): { valid: boolean; errors: string[] } {
    const config = this.loadConfig();
    const errors: string[] = [];

    // Check R2 configuration
    if (!config.r2AccountId)
      errors.push('CLOUDFLARE_R2_ACCOUNT_ID is required');
    if (!config.r2AccessKey)
      errors.push('CLOUDFLARE_R2_ACCESS_KEY is required');
    if (!config.r2SecretKey)
      errors.push('CLOUDFLARE_R2_SECRET_KEY is required');
    if (!config.r2Bucket) errors.push('CLOUDFLARE_R2_BUCKET is required');

    // Check admin configuration
    if (!config.adminPassword) errors.push('ADMIN_PASSWORD is required');
    if (!config.nextAuthSecret) errors.push('NEXTAUTH_SECRET is required');

    // Validate upload size
    if (config.uploadMaxSize <= 0) {
      errors.push('UPLOAD_MAX_SIZE must be a positive number');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate development environment
   */
  static validateDevelopment(): { valid: boolean; warnings: string[] } {
    const config = this.loadConfig();
    const warnings: string[] = [];

    if (!this.isR2Configured()) {
      warnings.push(
        'R2 configuration not found - backup functionality will be disabled'
      );
    }

    if (!config.adminPassword) {
      warnings.push(
        'ADMIN_PASSWORD not set - using default development password'
      );
    }

    if (!config.nextAuthSecret) {
      warnings.push('NEXTAUTH_SECRET not set - using development default');
    }

    return {
      valid: true, // Development can work with warnings
      warnings,
    };
  }

  /**
   * Get configuration summary for debugging
   */
  static getConfigSummary(): {
    storagePath: string;
    uploadMaxSize: string;
    r2Configured: boolean;
    r2Bucket: string;
    adminConfigured: boolean;
    environment: string;
  } {
    const config = this.loadConfig();

    return {
      storagePath: config.storagePath,
      uploadMaxSize: `${Math.round(config.uploadMaxSize / 1024 / 1024)}MB`,
      r2Configured: this.isR2Configured(),
      r2Bucket: config.r2Bucket || 'Not configured',
      adminConfigured: !!config.adminPassword,
      environment: process.env.NODE_ENV || 'development',
    };
  }
}
