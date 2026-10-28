import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatorPage } from "../components/catalog-pages";
export const metadata: Metadata = { title: "선수팩 시뮬레이터" };
export default function Page() { return <Suspense fallback={<section className="state-panel" role="status"><h1>시뮬레이터를 불러오고 있어요.</h1></section>}><SimulatorPage /></Suspense>; }
