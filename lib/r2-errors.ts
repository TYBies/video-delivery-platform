export class R2Error extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly retryable: boolean;

  constructor(
    message: string,
    code: string,
    statusCode?: number,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'R2Error';
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export class R2ErrorHandler {
  /**
   * Convert AWS SDK errors to R2Error instances
   */
  static handleError(error: unknown): R2Error {
    if (error instanceof R2Error) {
      return error;
    }

    type AwsLike = {
      code?: string;
      name?: string;
      $metadata?: { httpStatusCode?: number };
      statusCode?: number;
    };
    const message = (error as Error)?.message || 'Unknown R2 error';
    const e = (error ?? {}) as AwsLike;
    const code = e.code || e.name || 'UNKNOWN_ERROR';
    const statusCode = e.$metadata?.httpStatusCode ?? e.statusCode;

    // Determine if error is retryable
    const retryable = this.isRetryableError(code, statusCode);

    return new R2Error(message, code, statusCode, retryable);
  }

  /**
   * Check if an error is retryable
   */
  static isRetryableError(code: string, statusCode?: number): boolean {
    // Network and temporary errors that can be retried
    const retryableCodes = [
      'NetworkingError',
      'TimeoutError',
      'RequestTimeout',
      'ServiceUnavailable',
      'InternalError',
      'SlowDown',
      'ThrottlingException',
    ];

    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];

    return (
      retryableCodes.includes(code) ||
      (statusCode !== undefined && retryableStatusCodes.includes(statusCode))
    );
  }

  /**
   * Get user-friendly error message
   */
  static getUserMessage(error: R2Error): string {
    switch (error.code) {
      case 'NoSuchBucket':
        return 'Storage bucket not found. Please check your configuration.';

      case 'AccessDenied':
        return 'Access denied. Please check your credentials and permissions.';

      case 'InvalidAccessKeyId':
        return 'Invalid access key. Please check your R2 credentials.';

      case 'SignatureDoesNotMatch':
        return 'Invalid secret key. Please check your R2 credentials.';

      case 'NetworkingError':
        return 'Network connection failed. Please check your internet connection.';

      case 'ServiceUnavailable':
        return 'R2 service is temporarily unavailable. Please try again later.';

      case 'SlowDown':
        return 'Too many requests. Please wait a moment and try again.';

      default:
        return `Storage operation failed: ${error.message}`;
    }
  }
}

/**
 * Retry utility with exponential backoff
 */
export class RetryHandler {
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: R2Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = R2ErrorHandler.handleError(error);

        // Don't retry if error is not retryable or this is the last attempt
        if (!lastError.retryable || attempt === maxRetries) {
          throw lastError;
        }

        // Calculate delay with exponential backoff and jitter
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;

        console.warn(
          `R2 operation failed (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.message}. ` +
            `Retrying in ${Math.round(delay)}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError!;
  }
}
