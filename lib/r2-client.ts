import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
  region?: string;
}

export class R2Client {
  private client: S3Client;
  private bucket: string;
  private config: R2Config;

  constructor(config?: R2Config) {
    this.config = config || this.loadConfigFromEnv();
    this.bucket = this.config.bucket;

    const clientConfig: S3ClientConfig = {
      region: this.config.region || 'auto',
      endpoint: `https://${this.config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
      // Force path-style addressing for R2 compatibility
      forcePathStyle: false,
    };

    this.client = new S3Client(clientConfig);
  }

  /**
   * Load R2 configuration from environment variables
   */
  private loadConfigFromEnv(): R2Config {
    const requiredEnvVars = [
      'CLOUDFLARE_R2_ACCOUNT_ID',
      'CLOUDFLARE_R2_ACCESS_KEY',
      'CLOUDFLARE_R2_SECRET_KEY',
      'CLOUDFLARE_R2_BUCKET',
    ];

    const missing = requiredEnvVars.filter((envVar) => !process.env[envVar]);
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}`
      );
    }

    return {
      accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID!,
      accessKey: process.env.CLOUDFLARE_R2_ACCESS_KEY!,
      secretKey: process.env.CLOUDFLARE_R2_SECRET_KEY!,
      bucket: process.env.CLOUDFLARE_R2_BUCKET!,
      region: process.env.CLOUDFLARE_R2_REGION || 'auto',
    };
  }

  /**
   * Get the S3 client instance
   */
  getClient(): S3Client {
    return this.client;
  }

  /**
   * Get the bucket name
   */
  getBucket(): string {
    return this.bucket;
  }

  /**
   * Get the full R2 configuration
   */
  getConfig(): R2Config {
    return { ...this.config };
  }

  /**
   * Test the R2 connection
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
      const command = new HeadBucketCommand({ Bucket: this.bucket });

      await this.client.send(command);

      return { success: true };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `R2 connection failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Validate R2 configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.config.accountId) {
      errors.push('Account ID is required');
    }

    if (!this.config.accessKey) {
      errors.push('Access Key is required');
    }

    if (!this.config.secretKey) {
      errors.push('Secret Key is required');
    }

    if (!this.config.bucket) {
      errors.push('Bucket name is required');
    }

    // Validate account ID format (should be 32 hex characters)
    if (
      this.config.accountId &&
      !/^[a-f0-9]{32}$/i.test(this.config.accountId)
    ) {
      errors.push('Account ID should be 32 hexadecimal characters');
    }

    // Validate bucket name format
    if (this.config.bucket) {
      const bucketRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
      if (
        !bucketRegex.test(this.config.bucket) ||
        this.config.bucket.length < 3 ||
        this.config.bucket.length > 63
      ) {
        errors.push(
          'Bucket name must be 3-63 characters, lowercase letters, numbers, and hyphens only'
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get R2 endpoint URL
   */
  getEndpointUrl(): string {
    return `https://${this.config.accountId}.r2.cloudflarestorage.com`;
  }

  /**
   * Get public URL for a file (if bucket is configured for public access)
   */
  getPublicUrl(key: string): string {
    return `https://pub-${this.config.accountId}.r2.dev/${key}`;
  }

  /**
   * Destroy the client connection
   */
  destroy(): void {
    this.client.destroy();
  }
}
