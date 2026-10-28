import type { Metadata } from "next";
import "./globals.css";
import { CatalogProvider } from "./components/catalog-data";
import { SiteShell } from "./components/catalog-ui";

export const metadata: Metadata = {
  title: { default: "eFsimulator · 선수팩과 선수 카드", template: "%s · eFsimulator" },
  description: "eFootball 선수팩과 선수 카드를 탐색하고 팩의 구성을 확인하세요. 선수팩 조회와 시뮬레이터를 한곳에서 만납니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body><CatalogProvider><SiteShell>{children}</SiteShell></CatalogProvider></body></html>;
}
