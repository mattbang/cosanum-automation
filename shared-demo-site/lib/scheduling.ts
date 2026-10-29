const zone='Europe/Zurich';
function zurichStart(date:string,hour:number) {
 const offset = new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'longOffset'}).formatToParts(new Date(date+'T12:00:00Z')).find(p=>p.type==='timeZoneName')?.value || 'GMT+01:00';
 const match=offset.match(/GMT([+-])(\d{2}):(\d{2})/); const minutes=match ? (match[1]==='-'?-1:1)*(Number(match[2])*60+Number(match[3])) : 0;
 return new Date(Date.parse(date+'T00:00:00Z')+(hour*60-minutes)*60000).toISOString();
}
export function demoWeekSchedule(now=new Date()) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 const cursor=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);
 const days: {date:string;label:string;slots:{start:string;label:string;danielBusy:boolean;matthewBusy:boolean}[]}[]=[];
 while(days.length<5) {
  cursor.setUTCDate(cursor.getUTCDate()+1); if([0,6].includes(cursor.getUTCDay())) continue;
  const date=cursor.toISOString().slice(0,10), day=days.length;
  days.push({date,label:new Intl.DateTimeFormat('de-CH',{timeZone:'UTC',weekday:'short',day:'2-digit',month:'2-digit'}).format(cursor),slots:[9,11,13].map((hour,index)=>({start:zurichStart(date,hour),label:`${hour}:00–${hour+1}:00`,danielBusy:(day+index)%4===1,matthewBusy:(day+index)%4===2}))});
 }
 return {days,offers:days.flatMap(day=>day.slots.filter(slot=>!slot.danielBusy&&!slot.matthewBusy).map(slot=>slot.start)).slice(0,3)};
}
