declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    CORS_ALLOWED_ORIGINS?: string;
  }
}
