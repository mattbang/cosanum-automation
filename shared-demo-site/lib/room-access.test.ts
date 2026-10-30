import test from 'node:test';
import assert from 'node:assert/strict';
import { roomToken, roomCookie } from './room-access.ts';
import { roomHeaders } from './client-headers.ts';
const id = '9150cd2a-db43-4e74-b136-01d6488aafed';
const token = 'a'.repeat(72);
test('room cookie recovers access after reload, stays scoped and HttpOnly', () => {
 const request = new Request('https://example.com/api/rooms/' + id, {headers:{Cookie:`cosanum_room_${id}=${token}`}});
 assert.equal(roomToken(request,id),token);
 assert.equal(roomToken(request,crypto.randomUUID()),'');
 assert.match(roomCookie(request,id,token),/HttpOnly; SameSite=Strict; Max-Age=259200; Secure/);
 assert.match(roomCookie(request,id,token),new RegExp('Path=/api/rooms/' + id));
});
test('explicit invalid link never falls back to another role cookie', () => {
 const request = new Request('https://example.com', {headers:{Authorization:'Bearer invalid',Cookie:`cosanum_room_${id}=${token}`}});
 assert.equal(roomToken(request,id),'');
});

test('actual client reload headers do not mask the recovery cookie',()=>{const headers=roomHeaders('', 'google-id-token');headers.Cookie=`cosanum_room_${id}=${token}`;assert.equal(roomToken(new Request('https://example.com',{headers}),id),token);});
