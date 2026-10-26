export default function Home() {
 return <main><p>efsimulator</p><h1>Catalog API</h1><p>공식 확률표와 연결을 확인한 선수팩·선수의 가공 데이터를 누적합니다. 판매 중인 팩과 판매가 끝난 팩은 선수 정보를 포함해 제공합니다.</p><ul><li><a href="/api/v1/health">서버·데이터 상태</a></li><li><a href="/api/v1/manifest">데이터 버전</a></li><li><a href="/api/v1/players?limit=20">가공 선수</a></li><li><a href="/api/v1/packs?limit=20">가공 선수팩</a></li><li><a href="/api/v1/live?limit=20">판매 중인 선수팩</a></li><li><a href="/api/v1/archive?limit=20">판매 종료 아카이브</a></li></ul><p>공식 서비스와 독립된 비공식 데이터 프로젝트입니다.</p></main>;
}
