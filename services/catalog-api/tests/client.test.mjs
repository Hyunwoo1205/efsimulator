import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogClient } from '../client/catalog-api-client.mjs';

test('client keeps long card IDs as strings and encodes search without credentials', async () => {
  const seen = [];
  const client = createCatalogClient({baseUrl: 'https://api.example.test', fetch: async (url, options) => {
    seen.push({url, options}); return Response.json({data: []});
  }});
  await client.card('99999999999999999999');
  await client.cards({q: 'Robert & Co', limit: 2});
  await client.players({limit: 1});
  await client.livePack('pack::round-1');
  await client.archive({limit: 5});
  assert.equal(seen[0].url.pathname, '/api/v1/cards/99999999999999999999');
  assert.equal(seen[1].url.searchParams.get('q'), 'Robert & Co');
  assert.equal(seen[0].options.credentials, 'omit');
  assert.equal(seen[2].url.pathname, '/api/v1/players');
  assert.equal(seen[3].url.pathname, '/api/v1/live/pack%3A%3Around-1');
  assert.equal(seen[4].url.pathname, '/api/v1/archive');
  assert.throws(() => createCatalogClient({baseUrl: 'https://name:secret@api.example.test'}));
  assert.throws(() => createCatalogClient({baseUrl: 'http://api.example.test'}));
  assert.throws(() => client.card(123));
});
test('client distinguishes JSON API errors from hosted sign-in HTML', async () => {
  const unavailable = createCatalogClient({baseUrl:'https://api.example.test',fetch:async()=>Response.json({error:{code:'catalog_unavailable',message:'No import'}},{status:503})});
  await assert.rejects(unavailable.cards(), {code:'catalog_unavailable',status:503});
  const signin = createCatalogClient({baseUrl:'https://api.example.test',fetch:async()=>new Response('<html>sign in</html>',{headers:{'Content-Type':'text/html'}})});
  await assert.rejects(signin.health(), {code:'invalid_api_response'});
});
