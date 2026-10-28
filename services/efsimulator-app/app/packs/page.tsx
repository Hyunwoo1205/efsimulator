import type { Metadata } from "next";
import { PacksPage } from "../components/catalog-pages";
export const metadata: Metadata = { title: "선수팩" };
export default function Page() { return <PacksPage />; }
