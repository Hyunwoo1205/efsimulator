import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"efsimulator Catalog API",description:"선수 카드·팩 누적 데이터 API"};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ko"><body>{children}</body></html>;}
