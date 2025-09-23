import { handleS3Error } from '@/lib/s3-config';

describe('S3 Error Handling', () => {
  describe('handleS3Error', () => {
    it('should handle bandwidth limit exceeded errors', () => {
      const error = {
        Code: 'AccessDenied',
        message: 'Cannot download file, download bandwidth or transaction (Class B) cap exceeded.',
        $metadata: { httpStatusCode: 403 }
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Daily bandwidth or transaction limit reached');
      expect(result.userFriendly).toContain('Daily cloud storage limit reached');
      expect(result.userFriendly).toContain('midnight GMT');
      expect(result.isRateLimited).toBe(true);
    });

    it('should handle transaction cap exceeded errors', () => {
      const error = {
        Code: 'AccessDenied',
        message: 'Transaction cap exceeded for today',
        $metadata: { httpStatusCode: 403 }
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Daily transaction cap exceeded');
      expect(result.userFriendly).toContain('Daily cloud storage transaction limit reached');
      expect(result.userFriendly).toContain('midnight GMT');
      expect(result.isRateLimited).toBe(true);
    });

    it('should handle general access denied errors', () => {
      const error = {
        Code: 'AccessDenied',
        message: 'Access denied to resource',
        $metadata: { httpStatusCode: 403 }
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Access denied to cloud storage');
      expect(result.userFriendly).toContain('daily limits that reset at midnight GMT or configuration issues');
      expect(result.isRateLimited).toBe(true);
    });

    it('should handle 404 not found errors', () => {
      const error = {
        Code: 'NoSuchKey',
        message: 'The specified key does not exist',
        $metadata: { httpStatusCode: 404 }
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Resource not found in cloud storage');
      expect(result.userFriendly).toBe('The requested file was not found in cloud storage.');
      expect(result.isRateLimited).toBe(false);
    });

    it('should handle server errors (5xx)', () => {
      const error = {
        Code: 'InternalError',
        message: 'Internal server error',
        $metadata: { httpStatusCode: 500 }
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Cloud storage server error');
      expect(result.userFriendly).toContain('technical difficulties');
      expect(result.isRateLimited).toBe(false);
    });

    it('should handle unknown errors gracefully', () => {
      const error = {
        message: 'Some unknown error occurred'
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Some unknown error occurred');
      expect(result.userFriendly).toBe('Cloud storage is temporarily unavailable. Please try again later.');
      expect(result.isRateLimited).toBe(false);
    });

    it('should handle errors without message', () => {
      const error = {
        Code: 'SomeError'
      };

      const result = handleS3Error(error);

      expect(result.message).toBe('Unknown cloud storage error');
      expect(result.userFriendly).toBe('Cloud storage is temporarily unavailable. Please try again later.');
      expect(result.isRateLimited).toBe(false);
    });

    it('should detect different variations of bandwidth error messages', () => {
      const variations = [
        'Cannot download file, download bandwidth or transaction (Class B) cap exceeded',
        'bandwidth or transaction cap exceeded',
        'Download bandwidth cap exceeded'
      ];

      variations.forEach(message => {
        const error = {
          Code: 'AccessDenied',
          message
        };

        const result = handleS3Error(error);
        expect(result.isRateLimited).toBe(true);
        expect(result.userFriendly).toContain('midnight GMT');
      });
    });
  });

  describe('Error Message Quality', () => {
    it('should provide user-friendly messages for all error types', () => {
      const errorTypes = [
        { Code: 'AccessDenied', message: 'bandwidth exceeded' },
        { Code: 'AccessDenied', message: 'cap exceeded' },
        { Code: 'NoSuchKey', message: 'not found' },
        { Code: 'InternalError', $metadata: { httpStatusCode: 500 } }
      ];

      errorTypes.forEach(error => {
        const result = handleS3Error(error);

        // All user-friendly messages should be non-technical
        expect(result.userFriendly).not.toContain('Code');
        expect(result.userFriendly).not.toContain('HTTP');
        expect(result.userFriendly).not.toContain('$metadata');

        // Should provide actionable guidance
        expect(result.userFriendly.length).toBeGreaterThan(20);

        // Should not be the same as technical message
        expect(result.userFriendly).not.toBe(result.message);
      });
    });

    it('should indicate when limits will reset', () => {
      const rateLimitedErrors = [
        { Code: 'AccessDenied', message: 'bandwidth exceeded' },
        { Code: 'AccessDenied', message: 'cap exceeded' },
        { Code: 'AccessDenied', $metadata: { httpStatusCode: 403 } }
      ];

      rateLimitedErrors.forEach(error => {
        const result = handleS3Error(error);
        if (result.isRateLimited) {
          expect(result.userFriendly).toContain('midnight GMT');
        }
      });
    });
  });
});