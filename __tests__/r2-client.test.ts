import { R2Client } from '../lib/r2-client';
import { EnvironmentValidator } from '../lib/env-config';
import { R2ErrorHandler } from '../lib/r2-errors';

const TEST_ACCOUNT_ID = 'a1b2c3d4e5f678901234567890123456'; // 32 hex chars

describe('R2Client', () => {
  describe('Configuration', () => {
    it('should validate correct R2 configuration', () => {
      const config = {
        accountId: TEST_ACCOUNT_ID,
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
        bucket: 'test-bucket'
      };

      const client = new R2Client(config);
      const validation = client.validateConfig();

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should reject invalid account ID format', () => {
      const config = {
        accountId: 'invalid-account-id',
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
        bucket: 'test-bucket'
      };

      const client = new R2Client(config);
      const validation = client.validateConfig();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Account ID should be 32 hexadecimal characters');
    });

    it('should reject invalid bucket name', () => {
      const config = {
        accountId: 'a1b2c3d4e5f6789012345678901234567890abcd',
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
        bucket: 'Invalid-Bucket-Name'
      };

      const client = new R2Client(config);
      const validation = client.validateConfig();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Bucket name must be 3-63 characters, lowercase letters, numbers, and hyphens only');
    });

    it('should identify missing required fields', () => {
      const config = {
        accountId: '',
        accessKey: '',
        secretKey: 'test-secret-key',
        bucket: 'test-bucket'
      };

      const client = new R2Client(config);
      const validation = client.validateConfig();

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('Account ID is required');
      expect(validation.errors).toContain('Access Key is required');
    });
  });

  describe('URL Generation', () => {
    let client: R2Client;

    beforeAll(() => {
      const config = {
        accountId: TEST_ACCOUNT_ID,
        accessKey: 'test-access-key',
        secretKey: 'test-secret-key',
        bucket: 'test-bucket'
      };
      client = new R2Client(config);
    });

    it('should generate correct endpoint URL', () => {
      const endpointUrl = client.getEndpointUrl();
      expect(endpointUrl).toBe(`https://${TEST_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    });

    it('should generate correct public URL', () => {
      const publicUrl = client.getPublicUrl('videos/test-video.mp4');
      expect(publicUrl).toBe(`https://pub-${TEST_ACCOUNT_ID}.r2.dev/videos/test-video.mp4`);
    });
  });

  describe('Environment Loading', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      jest.resetModules();
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it('should throw error when required environment variables are missing', () => {
      delete process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_R2_ACCESS_KEY;
      delete process.env.CLOUDFLARE_R2_SECRET_KEY;
      delete process.env.CLOUDFLARE_R2_BUCKET;

      expect(() => new R2Client()).toThrow('Missing required environment variables');
    });
  });
});

describe('EnvironmentValidator', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('R2 Configuration Detection', () => {
    it('should detect when R2 is configured', () => {
      process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_R2_ACCESS_KEY = 'test-key';
      process.env.CLOUDFLARE_R2_SECRET_KEY = 'test-secret';
      process.env.CLOUDFLARE_R2_BUCKET = 'test-bucket';

      expect(EnvironmentValidator.isR2Configured()).toBe(true);
    });

    it('should detect when R2 is not configured', () => {
      delete process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      delete process.env.CLOUDFLARE_R2_ACCESS_KEY;
      delete process.env.CLOUDFLARE_R2_SECRET_KEY;
      delete process.env.CLOUDFLARE_R2_BUCKET;

      expect(EnvironmentValidator.isR2Configured()).toBe(false);
    });
  });

  describe('Production Validation', () => {
    it('should pass validation with all required variables', () => {
      process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'test-account';
      process.env.CLOUDFLARE_R2_ACCESS_KEY = 'test-key';
      process.env.CLOUDFLARE_R2_SECRET_KEY = 'test-secret';
      process.env.CLOUDFLARE_R2_BUCKET = 'test-bucket';
      process.env.ADMIN_PASSWORD = 'secure-password';
      process.env.NEXTAUTH_SECRET = 'auth-secret';

      const validation = EnvironmentValidator.validateProduction();
      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation with missing variables', () => {
      delete process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      delete process.env.ADMIN_PASSWORD;

      const validation = EnvironmentValidator.validateProduction();
      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain('CLOUDFLARE_R2_ACCOUNT_ID is required');
      expect(validation.errors).toContain('ADMIN_PASSWORD is required');
    });
  });

  describe('Development Validation', () => {
    it('should pass with warnings when optional variables are missing', () => {
      delete process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      delete process.env.ADMIN_PASSWORD;

      const validation = EnvironmentValidator.validateDevelopment();
      expect(validation.valid).toBe(true);
      expect(validation.warnings.length).toBeGreaterThan(0);
    });
  });
});

describe('R2ErrorHandler', () => {
  describe('Error Classification', () => {
    it('should identify retryable errors', () => {
      expect(R2ErrorHandler.isRetryableError('NetworkingError')).toBe(true);
      expect(R2ErrorHandler.isRetryableError('ServiceUnavailable')).toBe(true);
      expect(R2ErrorHandler.isRetryableError('Unknown', 503)).toBe(true);
    });

    it('should identify non-retryable errors', () => {
      expect(R2ErrorHandler.isRetryableError('AccessDenied')).toBe(false);
      expect(R2ErrorHandler.isRetryableError('NoSuchBucket')).toBe(false);
      expect(R2ErrorHandler.isRetryableError('Unknown', 404)).toBe(false);
    });
  });

  describe('User Messages', () => {
    it('should provide user-friendly error messages', () => {
      const accessError = R2ErrorHandler.handleError({ code: 'AccessDenied', message: 'Access denied' });
      const userMessage = R2ErrorHandler.getUserMessage(accessError);
      
      expect(userMessage).toContain('Access denied');
      expect(userMessage).toContain('credentials');
    });
  });
});