export default function Home() {
 return <main><p>efsimulator</p><h1>Catalog API</h1><p>선수 카드와 팩의 누적 데이터를 제공합니다. 현재 판매 목록과 구성 검증 상태는 별도로 관리합니다.</p><ul><li><a href="/api/v1/health">서버·데이터 상태</a></li><li><a href="/api/v1/manifest">데이터 버전</a></li><li><a href="/api/v1/cards?limit=20">선수 카드</a></li><li><a href="/api/v1/packs?limit=20">선수팩</a></li></ul><p>공식 서비스와 독립된 비공식 데이터 프로젝트입니다.</p></main>;
}
