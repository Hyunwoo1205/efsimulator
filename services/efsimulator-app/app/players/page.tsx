import type { Metadata } from "next";
import { PlayersPage } from "../components/catalog-pages";
export const metadata: Metadata = { title: "선수 카드" };
export default function Page() { return <PlayersPage />; }
