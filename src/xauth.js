'use strict';
const crypto = require('crypto');

const X_AUTH_URL = 'https://x.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_ME_URL = 'https://api.twitter.com/2/users/me?user.fields=profile_image_url,name';

function b64url(buf) {
  return buf.toString('base64url');
}

function genPkce() {
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function genState() {
  return b64url(crypto.randomBytes(24));
}

function buildAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'users.read tweet.read',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${X_AUTH_URL}?${params.toString()}`;
}

async function exchangeCode({ clientId, clientSecret, code, redirectUri, codeVerifier }) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });
  const res = await fetch(X_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`X token exchange failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data; // { access_token, refresh_token, expires_in, scope, token_type }
}

async function fetchProfile(accessToken) {
  const res = await fetch(X_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.data) {
    throw new Error(`X profile fetch failed: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.data; // { id, username, name, profile_image_url }
}

module.exports = { genPkce, genState, buildAuthorizeUrl, exchangeCode, fetchProfile };
