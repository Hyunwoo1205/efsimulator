import { decodeRouteId } from "../../../lib/route-id.mjs";
import type { Metadata } from "next";
import { PlayerDetailPage } from "../../components/catalog-pages";
export const metadata: Metadata = { title: "선수 상세" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <PlayerDetailPage id={decodeRouteId(id)} />; }
