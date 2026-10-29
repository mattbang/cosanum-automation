const validToken = (value: string) => /^[a-f0-9-]{72}$/.test(value);
export function roomToken(request: Request, id: string): string {
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
  if (bearer) return validToken(bearer) ? bearer : '';
  const name = 'cosanum_room_' + id;
  const cookie = (request.headers.get('Cookie') || '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='));
  const value = cookie?.slice(name.length + 1) || '';
  return validToken(value) ? value : '';
}
export function roomCookie(request: Request, id: string, token: string): string {
  if (!validToken(token) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid room access');
  return `cosanum_room_${id}=${token}; Path=/api/rooms/${id}; HttpOnly; SameSite=Strict; Max-Age=259200${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
