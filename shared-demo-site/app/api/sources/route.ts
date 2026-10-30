import { SOURCE_REGISTER } from '../../../lib/sources';
export function GET() { return Response.json({ synthetic:true, description:'Getrennte Cloud-Demoquellen. CSV-Dateien zeigen den fiktiven Ausgangsstand; aktuelle Raumänderungen bleiben im jeweiligen Fallverlauf.', sources:SOURCE_REGISTER }); }
