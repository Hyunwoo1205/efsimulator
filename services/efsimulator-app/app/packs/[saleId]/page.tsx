import { decodeRouteId } from "../../../lib/route-id.mjs";
import type { Metadata } from "next";
import { PackDetailPage } from "../../components/catalog-pages";
export const metadata: Metadata = { title: "선수팩 상세" };
export default async function Page({ params }: { params: Promise<{ saleId: string }> }) { const { saleId } = await params; return <PackDetailPage saleId={decodeRouteId(saleId)} />; }
