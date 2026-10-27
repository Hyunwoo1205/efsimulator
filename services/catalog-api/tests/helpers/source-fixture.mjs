import { collectCycle } from '../../scripts/lifecycle/collect-cycle.mjs';
import { mappingDigest } from '../../scripts/lifecycle/rules.mjs';

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const document = body => `<html><head></head><body>${body}</body></html>`;
const flight = value => `<script>self.__next_f.push(${JSON.stringify([1, `a:${JSON.stringify(value)}\n`])})</script>`;
export const fixtureApproval = mappings => ({ schemaVersion: 1, reviews: mappings.map(mapping => ({
  saleId: mapping.saleId, mappingSha256: mappingDigest(mapping), reviewId: `fixture-${mapping.saleId}`,
  authority: 'synthetic_test_fixture', evidenceRefs: ['Synthetic fixture: not a real source review'],
})) });

/** Construct reproducible HTML evidence for tests only. Does not contact a website. */
export async function sourceFixture({ rawPlayers = [], rawPacks = [], candidates = [], officialObservation, now, rulesIdentity } = {}) {
  const mappings = candidates.map(candidate => ({ saleId: candidate.saleId, officialTitle: candidate.officialTitle,
    packSlug: candidate.packSlug, newPlayersSection: `Fixture ${candidate.saleId}`,
    expectedEndsAt: candidate.endsAt, expectedTotalPlayerCount: candidate.totalPlayerCount,
    expectedSpecialCount: candidate.expectedSpecialCount, memberIds: candidate.memberIds,
    matchEvidence: { fixture: 'Explicit synthetic source relation', input: candidate.evidence ?? {} },
    ...(candidate.countCorrection ? { countCorrection: { ...candidate.countCorrection, effectiveCount: candidate.expectedSpecialCount } } : {}),
  }));
  const mappingsDocument = { schemaVersion: 1, mappings };
  const rows = officialObservation?.rows ?? [];
  const officialHtml = document(`<dl class="probability"><dt>선수 영입 확률</dt><dd>${rows.map(row => `<div class="probability_data"><p class="data_title">${escape(row.title)}</p><p>종료 일시(UTC)：${new Date(row.endsAt).toISOString().replace('T', ' ').slice(0, 19)}</p><p>처음 영입할 때의 선수 수：${row.totalPlayerCount}</p><p>처음 영입할 때의 영입 확률：0.6667%</p></div>`).join('')}<div class="probability_ntc_msg">주의 사항</div></dd></dl>`);
  const allPlayers = new Map([...rawPlayers, ...candidates.flatMap(candidate => candidate.rawPlayers ?? [])].map(player => [player.id, player]));
  const allPacks = new Map([...rawPacks, ...candidates.map(candidate => candidate.rawPack).filter(Boolean)].map(pack => [pack.slug, pack]));
  const efhubHtml = document(`<h1>New Players</h1>${mappings.map(mapping => `<section><h2><a href="/packs/${escape(mapping.packSlug)}">${escape(mapping.newPlayersSection)}</a></h2><div>${mapping.memberIds.map(id => `<a href="/players/${escape(id)}"><p>${escape(allPlayers.get(id)?.name ?? `Missing ${id}`)}</p></a>`).join('')}</div></section>`).join('')}${flight([...allPlayers.values()].map(player => ({ player })).concat([...allPacks.values()].map(pack => ({ pack }))))}`);
  const fetchHtml = async url => {
    if (url === 'https://efootball-web.konami.net/probability_kr.php') {
      if (officialObservation?.status !== 'ok') throw Object.assign(new Error('Synthetic official source failure'), { code: 'source_fetch_failed' });
      return { source_url: url, observed_at: officialObservation.observedAt ?? now, status: 200, html: officialHtml };
    }
    if (url === 'https://efhub.com/new-players') return { source_url: url, observed_at: now, status: 200, html: efhubHtml };
    throw new Error(`Synthetic source has no detail: ${url}`);
  };
  const source = await collectCycle({ mappings, mappingsDocument, rawPlayers, rawPacks, now: () => new Date(now), rulesIdentity, fetchHtml });
  return { ...source, approval: fixtureApproval(mappings), mappingsDocument };
}
