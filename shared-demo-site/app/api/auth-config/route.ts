import { env } from 'cloudflare:workers';
export const runtime = 'edge';
export function GET() {
  return Response.json({ googleClientId: env.GOOGLE_CLIENT_ID || null }, { headers: { 'Cache-Control': 'no-store' } });
}
