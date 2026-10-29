declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEMO_CREATOR_CODE?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_TRAINER_EMAIL?: string;
    GOOGLE_PARTICIPANT_EMAIL?: string;
  }
}
