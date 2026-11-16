import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { checkPluginManifest, sha256 } from '../../scripts/lib.mjs'
import plugin, {
  INSTRUCTIONS, buildRequest, chatgptAuthorizeUrl, checkIdToken, openrouterAuthorizeUrl, parseMatches, pickLines, pkceChallenge,
  randomToken, readCallback, readResponsesStream, replyText,
} from './main.js'

const read = (name) => readFileSync(new URL(name, import.meta.url))

test('plugin.json is one izumi runs, and pins main.js', () => {
  const manifest = checkPluginManifest(JSON.parse(read('plugin.json').toString('utf8')))
  assert.equal(manifest.id, 'watch.izumi.jump-to-moment')
  assert.equal(sha256(read(manifest.main.path)), manifest.main.sha256, 'run node scripts/pin-main.mjs official/jump-to-moment')
})

const cues = Array.from({ length: 60 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, text: i === 30 ? 'This soup tastes incredible!' : `line ${i}` }))

test('sends the windows around keyword hits, or everything when nothing matches', () => {
  assert.deepEqual(pickLines(cues, 'where he tastes the soup'), Array.from({ length: 11 }, (_, i) => 25 + i))
  assert.equal(pickLines(cues, 'the quiet bit').length, 60)
})

test('reads line numbers out of a reply and drops anything else', () => {
  assert.deepEqual(parseMatches('```json\n{"matches":[{"line":31,"reason":"he tastes it"},{"line":"x"}]}\n```'), [{ line: 31, reason: 'he tastes it' }])
  assert.deepEqual(parseMatches('no idea'), [])
  assert.deepEqual(parseMatches('{"matches": []}'), [])
})

test('PKCE: S256 challenge matches RFC 7636 appendix B, and verifiers are fresh 43-character values', async () => {
  assert.equal(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  const a = randomToken(), b = randomToken()
  assert.match(a, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(a, b)
})

test('Sign in with ChatGPT: registers first, then signs in again under the issued client id', () => {
  const common = { hostId: 'urn:uuid:1', redirectUri: 'http://127.0.0.1:50123/auth/callback', state: 's', nonce: 'n', challenge: 'c' }
  const first = new URL(chatgptAuthorizeUrl(common))
  assert.equal(first.origin + first.pathname, 'https://auth.openai.com/api/accounts/authorize')
  assert.deepEqual(Object.fromEntries(first.searchParams), {
    client_id: 'dynamic_agent_client', agent_name_hint: 'izumi', ext_agent_host_id: 'urn:uuid:1', response_type: 'code',
    redirect_uri: 'http://127.0.0.1:50123/auth/callback', scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    resource: 'https://api.openai.com/v1', state: 's', nonce: 'n', code_challenge_method: 'S256', code_challenge: 'c',
  })
  const again = new URL(chatgptAuthorizeUrl({ ...common, clientId: 'oaiapp_123', idTokenHint: 'old.id.token' })).searchParams
  assert.equal(again.get('client_id'), 'oaiapp_123')
  assert.equal(again.get('agent_name_hint'), null)
  assert.equal(again.get('id_token_hint'), 'old.id.token')
})

test('OpenRouter: PKCE authorize URL with a localhost callback', () => {
  const url = new URL(openrouterAuthorizeUrl({ redirectUri: 'http://localhost:50123/callback', state: 's', challenge: 'c' }))
  assert.equal(url.origin + url.pathname, 'https://openrouter.ai/auth')
  assert.equal(url.searchParams.get('callback_url'), 'http://localhost:50123/callback')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), 'c')
  assert.equal(url.searchParams.get('state'), 's')
})

test('a sign-in redirect counts only for this attempt', () => {
  assert.equal(readCallback({ code: 'abc', state: 's' }, 's'), 'abc')
  assert.throws(() => readCallback({ code: 'abc', state: 'other' }, 's'), /isn't for this sign-in/)
  assert.throws(() => readCallback({ code: 'abc' }, 's'), /isn't for this sign-in/)
  assert.throws(() => readCallback({ error: 'access_denied', state: 's' }, 's'), /cancelled/)
  assert.throws(() => readCallback({ state: 's' }, 's'), /no code/)
})

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (claims) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`

test('the ID token must be from OpenAI, for this client and this attempt, and unexpired', () => {
  const claims = { iss: 'https://auth.openai.com', aud: ['oaiapp_1'], nonce: 'n', exp: 2_000_000_000, email: 'a@example.com' }
  assert.equal(checkIdToken(jwt(claims), { clientId: 'oaiapp_1', nonce: 'n' }).email, 'a@example.com')
  for (const bad of [{ iss: 'https://evil.test' }, { aud: 'oaiapp_2' }, { nonce: 'x' }, { exp: 1 }]) {
    assert.throws(() => checkIdToken(jwt({ ...claims, ...bad }), { clientId: 'oaiapp_1', nonce: 'n' }), /didn't match/)
  }
  assert.throws(() => checkIdToken('garbage', { clientId: 'oaiapp_1', nonce: 'n' }), /didn't match/)
})

test('the Responses request: store false, stream true, no temperature, instructions instead of a system message', () => {
  const request = buildRequest({ kind: 'chatgpt', model: 'gpt-x' }, 'Moment: "the soup"', 'token-1')
  assert.equal(request.url, 'https://api.openai.com/v1/responses')
  assert.equal(request.headers.Authorization, 'Bearer token-1')
  assert.deepEqual(request.body, { model: 'gpt-x', instructions: INSTRUCTIONS, input: [{ role: 'user', content: 'Moment: "the soup"' }], store: false, stream: true })
  assert.equal(buildRequest({ kind: 'openai', key: 'sk-1', model: 'gpt-x' }, 'q').headers.Authorization, 'Bearer sk-1')
})

test('the other APIs: Anthropic Messages, and chat completions for OpenRouter, Google and an address', () => {
  const claude = buildRequest({ kind: 'anthropic', key: 'k', model: 'claude-x' }, 'q')
  assert.equal(claude.url, 'https://api.anthropic.com/v1/messages')
  assert.deepEqual(claude.headers, { 'Content-Type': 'application/json', 'x-api-key': 'k', 'anthropic-version': '2023-06-01' })
  assert.deepEqual(claude.body, { model: 'claude-x', max_tokens: 1024, system: INSTRUCTIONS, messages: [{ role: 'user', content: 'q' }] })
  assert.equal(buildRequest({ kind: 'openrouter', key: 'k', model: 'm' }, 'q').url, 'https://openrouter.ai/api/v1/chat/completions')
  assert.equal(buildRequest({ kind: 'google', key: 'k', model: 'm' }, 'q').url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions')
  const local = buildRequest({ kind: 'custom', endpoint: 'http://localhost:11434/v1/', key: '', model: 'm' }, 'q')
  assert.equal(local.url, 'http://localhost:11434/v1/chat/completions')
  assert.equal(local.headers.Authorization, undefined)
  assert.equal(local.body.messages[0].role, 'system')
})

const sse = (...events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')

test('reads a streamed Responses answer only once it completed', () => {
  assert.equal(readResponsesStream(sse(
    { type: 'response.created', response: {} },
    { type: 'response.output_text.delta', delta: '{"matches":' },
    { type: 'response.output_text.delta', delta: '[{"line":31}]}' },
    { type: 'response.completed', response: { output: [] } },
  )), '{"matches":[{"line":31}]}')
  assert.equal(readResponsesStream(sse({ type: 'response.completed', response: { output: [{ content: [{ type: 'output_text', text: 'hi' }] }] } })), 'hi')
  assert.throws(() => readResponsesStream(sse({ type: 'response.output_text.delta', delta: '{"ma' })), /cut off/)
  assert.throws(() => readResponsesStream(sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'limit' } } })),
    (error) => error.code === 'subscription_sharing_usage_limit_exceeded')
  assert.equal(replyText('anthropic', JSON.stringify({ content: [{ type: 'text', text: '{"matches":[]}' }] })), '{"matches":[]}')
  assert.equal(replyText('openrouter', JSON.stringify({ choices: [{ message: { content: 'x' } }] })), 'x')
})

test('signs in with ChatGPT through the browser, then asks with the plan', async () => {
  const secrets = new Map(), storage = new Map(), handlers = {}, requests = []
  let account, panel, opened, seekTo
  const reply = (status, body) => ({ status, ok: status < 300, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)), json: async () => body })
  const api = {
    settings: { get: async () => ({ service: 'custom', ...Object.fromEntries(secrets) }) },
    storage: { get: async (k) => storage.get(k) ?? null, set: async (k, v) => { storage.set(k, v) }, delete: async (k) => { storage.delete(k) } },
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => { secrets.set(k, v) }, delete: async (k) => { secrets.delete(k) } },
    signin: {
      listen: async (path) => { assert.equal(path, '/auth/callback'); return { port: 50123 } },
      open: async (url) => { opened = new URL(url) },
      wait: async () => ({ code: 'code-1', state: opened.searchParams.get('state'), client_id: 'oaiapp_9', scope: 'openid chatgpt.tokens.use.direct' }),
      cancel: async () => {},
    },
    fetch: async (url, init = {}) => {
      requests.push({ url, ...init })
      if (url === 'https://auth.openai.com/api/accounts/oauth/token') {
        const id = jwt({ iss: 'https://auth.openai.com', aud: 'oaiapp_9', nonce: opened.searchParams.get('nonce'), exp: Date.now() / 1000 + 3600, email: 'viewer@example.com' })
        return reply(200, { access_token: 'at-1', refresh_token: 'rt-1', id_token: id, expires_in: 3600, scope: 'openid chatgpt.tokens.use.direct' })
      }
      if (url === 'https://api.openai.com/v1/models') return reply(200, { models: [{ slug: 'hidden', visibility: 'hide' }, { slug: 'gpt-listed', visibility: 'list' }] })
      if (url === 'https://api.openai.com/v1/responses') {
        return reply(200, sse({ type: 'response.output_text.delta', delta: '{"matches":[{"line":31,"reason":"soup"}]}' }, { type: 'response.completed', response: {} }))
      }
      throw new Error(`unexpected fetch ${url}`)
    },
    player: {
      status: async () => ({ open: true, title: 'Show', episode: 3, anilistId: 1, position: 0 }),
      subtitles: async () => ({ available: true, track: { id: 2, lang: 'en' }, cues }),
      seek: async (s) => { seekTo = s },
    },
    ui: { setPanel: async (state) => { panel = state }, setAccount: async (state) => { account = state }, notice: async () => {} },
    log: () => {},
    on: (name, handler) => { handlers[name] = handler },
  }
  await plugin.activate(api)
  assert.deepEqual(account.buttons.map((b) => b.label), ['Continue with ChatGPT', 'Sign in with OpenRouter'])

  // Not signed in and no key or address: the panel offers the sign-ins.
  await handlers.prompt({ text: 'the soup' })
  assert.deepEqual(panel.turns.at(-1).steps.at(-1).cards.map((c) => c.id), ['signin:chatgpt', 'signin:openrouter'])

  await handlers.select({ id: 'signin:chatgpt' })
  assert.equal(opened.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(opened.searchParams.get('redirect_uri'), 'http://127.0.0.1:50123/auth/callback')
  const exchange = new URLSearchParams(requests.find((r) => r.url.endsWith('/oauth/token')).body)
  assert.equal(exchange.get('grant_type'), 'authorization_code')
  assert.equal(exchange.get('client_id'), 'oaiapp_9')
  assert.equal(exchange.get('redirect_uri'), 'http://127.0.0.1:50123/auth/callback')
  assert.equal(await pkceChallenge(exchange.get('code_verifier')), opened.searchParams.get('code_challenge'))
  assert.equal(storage.get('chatgptClientId'), 'oaiapp_9')
  assert.equal(JSON.parse(secrets.get('account')).refreshToken, 'rt-1')
  assert.match(account.text, /using your ChatGPT plan/)

  // The question is asked again with the plan, and the player seeks to line 31.
  const asked = JSON.parse(requests.find((r) => r.url.endsWith('/responses')).body)
  assert.equal(asked.model, 'gpt-listed')
  assert.equal(seekTo, 300 - 2)
  // The sign-in turn makes way for the answered one.
  assert.deepEqual(panel.turns.map((turn) => turn.question), ['the soup'])
  assert.match(panel.turns.at(-1).steps.at(-1).label, /Using ChatGPT plan/)

  // Signing out revokes the refresh token and keeps the issued client id.
  requests.length = 0
  api.fetch = async (url, init = {}) => {
    requests.push({ url, ...init })
    return url.endsWith('openid-configuration') ? reply(200, { revocation_endpoint: 'https://auth.openai.com/oauth/revoke' }) : reply(200, '')
  }
  await handlers.account({ id: 'signout' })
  assert.equal(new URLSearchParams(requests.at(-1).body).get('token'), 'rt-1')
  assert.equal(secrets.has('account'), false)
  assert.equal(storage.get('chatgptClientId'), 'oaiapp_9')
  assert.equal(account.buttons[0].label, 'Continue with ChatGPT')
})

test('after invalid_grant on a new registration, authorizes again once under the issued client id', async () => {
  const secrets = new Map(), storage = new Map(), handlers = {}, opened = []
  let exchanges = 0
  const reply = (status, body) => ({ status, ok: status < 300, text: async () => JSON.stringify(body), json: async () => body })
  await plugin.activate({
    settings: { get: async () => ({}) },
    storage: { get: async (k) => storage.get(k) ?? null, set: async (k, v) => { storage.set(k, v) }, delete: async (k) => { storage.delete(k) } },
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => { secrets.set(k, v) }, delete: async (k) => { secrets.delete(k) } },
    signin: {
      listen: async () => ({ port: 50200 + opened.length }),
      open: async (url) => { opened.push(new URL(url)) },
      // A reauthorization callback may leave out client_id.
      wait: async () => ({ code: `code-${opened.length}`, state: opened.at(-1).searchParams.get('state'), ...(opened.length === 1 ? { client_id: 'oaiapp_7' } : {}) }),
      cancel: async () => {},
    },
    fetch: async (url, init) => {
      exchanges++
      if (exchanges === 1) return reply(400, { error: 'invalid_grant' })
      const fields = new URLSearchParams(init.body)
      assert.equal(fields.get('client_id'), 'oaiapp_7')
      assert.equal(fields.get('code'), 'code-2')
      const id = jwt({ iss: 'https://auth.openai.com', aud: 'oaiapp_7', nonce: opened[1].searchParams.get('nonce'), exp: Date.now() / 1000 + 3600 })
      return reply(200, { access_token: 'at', refresh_token: 'rt', id_token: id, expires_in: 3600, scope: 'chatgpt.tokens.use.direct' })
    },
    player: {}, ui: { setPanel: async () => {}, setAccount: async () => {}, notice: async () => {} }, log: () => {},
    on: (name, handler) => { handlers[name] = handler },
  })
  await handlers.account({ id: 'chatgpt' })
  assert.equal(opened.length, 2)
  assert.equal(opened[0].searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(opened[1].searchParams.get('client_id'), 'oaiapp_7')
  assert.equal(opened[1].searchParams.get('agent_name_hint'), null)
  assert.equal(JSON.parse(secrets.get('account')).refreshToken, 'rt')
})

test('a plan that cannot be shared ends with a pointer to OpenRouter or a key, not "try again"', async () => {
  const storage = new Map([['chatgptClientId', 'oaiapp_7']]), handlers = {}, opened = []
  let account
  await plugin.activate({
    settings: { get: async () => ({}) },
    storage: { get: async (k) => storage.get(k) ?? null, set: async (k, v) => { storage.set(k, v) }, delete: async () => {} },
    secrets: { get: async () => null, set: async () => {}, delete: async () => {} },
    signin: {
      listen: async () => ({ port: 50300 }),
      open: async (url) => { opened.push(new URL(url)) },
      wait: async () => ({ code: 'c', state: opened.at(-1).searchParams.get('state') }),
      cancel: async () => {},
    },
    fetch: async () => ({ status: 400, ok: false, json: async () => ({ error: 'invalid_grant' }) }),
    player: {}, ui: { setPanel: async () => {}, setAccount: async (s) => { account = s }, notice: async () => {} }, log: () => {},
    on: (name, handler) => { handlers[name] = handler },
  })
  await handlers.account({ id: 'chatgpt' })
  assert.equal(opened.length, 2)
  assert.match(account.text, /invalid_grant.*required permission is unavailable.*OpenRouter or use an API key/)
  assert.equal(account.buttons[0].label, 'Continue with ChatGPT')
})
