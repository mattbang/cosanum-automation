import { sourceCsv, sourceRows } from '../../../../lib/sources';
export async function GET(_request:Request, context:{params:Promise<{kind:string}>}) {
 const {kind}=await context.params; const rows=sourceRows(kind);
 if(!rows) return Response.json({error:'Quelle nicht gefunden.'},{status:404});
 return new Response(sourceCsv(rows),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="cosanum-demo-${kind}.csv"`,'Cache-Control':'no-store'}});
}
