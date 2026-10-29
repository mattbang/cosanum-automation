/** Omit an absent capability; an empty Authorization value can mask the recovery cookie. */
export function roomHeaders(token:string,credential:string):Record<string,string> {
 return { ...(token ? {Authorization:'Bearer '+token} : {}), ...(credential ? {'X-Google-ID-Token':credential}:{}), 'Content-Type':'application/json' };
}
