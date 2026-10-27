import { env } from "cloudflare:workers";
import { handleCatalogRelay } from "../../../../lib/catalog-relay.mjs";

export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleCatalogRelay(request, env);
export const POST = (request: Request) => handleCatalogRelay(request, env);
export const PUT = (request: Request) => handleCatalogRelay(request, env);
export const PATCH = (request: Request) => handleCatalogRelay(request, env);
export const DELETE = (request: Request) => handleCatalogRelay(request, env);
