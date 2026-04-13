/**
 * Status update emitted by a {@link LocationSource} to signal connection
 * health and fix quality. The {@link LocationManager} uses these signals
 * to make source promotion and fallback decisions.
 */
export interface StatusEvent {
  /** Whether the source has an active connection or a valid fix. */
  connected: boolean;
  /**
   * Normalized quality score between 0 (unusable) and 1 (best available).
   * Derived from accuracy, HDOP, or protocol-specific quality indicators.
   */
  quality: number;
}
