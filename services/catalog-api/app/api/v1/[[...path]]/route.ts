import { env } from "cloudflare:workers";
import { handleCatalogRequest } from "../../../../lib/catalog-api.mjs";

export const dynamic = "force-dynamic";
const handle = (request: Request) => handleCatalogRequest(request, env);
export { handle as GET, handle as HEAD, handle as OPTIONS, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
