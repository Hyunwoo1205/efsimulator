import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "efsimulator · 선수팩 아카이브",
  description: "검증된 선수팩과 선수 카드, 판매 중인 명단과 종료된 기록을 살펴보세요.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
