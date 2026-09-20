'use strict';
// Minimal OAuth 1.0a ("Sign in with X/Twitter") client — no external deps.
// Used as a fallback while X's OAuth 2.0 /i/oauth2/authorize endpoint has a
// known platform-side bug (Sept 2026, confirmed by multiple independent
// developer reports with verified-correct app configs).
const crypto = require('crypto');

const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const AUTHENTICATE_URL = 'https://api.twitter.com/oauth/authenticate';
const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';

function percentEncode(str) {
  return encodeURIComponent(str).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function buildSignature({ method, url, params, consumerSecret, tokenSecret }) {
  const paramString = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const baseString = [method.toUpperCase(), percentEncode(url), percentEncode(paramString)].join('&');
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret || '')}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function oauthHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret, extraParams = {} }) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...extraParams,
  };
  const signature = buildSignature({ method, url, params: oauthParams, consumerSecret, tokenSecret });
  const signed = { ...oauthParams, oauth_signature: signature };
  return (
    'OAuth ' +
    Object.keys(signed)
      .sort()
      .map((k) => `${percentEncode(k)}="${percentEncode(signed[k])}"`)
      .join(', ')
  );
}

async function requestToken({ consumerKey, consumerSecret, callbackUrl }) {
  const header = oauthHeader({
    method: 'POST',
    url: REQUEST_TOKEN_URL,
    consumerKey,
    consumerSecret,
    extraParams: { oauth_callback: callbackUrl },
  });
  const res = await fetch(REQUEST_TOKEN_URL, { method: 'POST', headers: { Authorization: header } });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth1 request_token failed: ${res.status} ${text}`);
  const params = new URLSearchParams(text);
  if (params.get('oauth_callback_confirmed') !== 'true') {
    throw new Error(`OAuth1 request_token did not confirm callback: ${text}`);
  }
  return { oauthToken: params.get('oauth_token'), oauthTokenSecret: params.get('oauth_token_secret') };
}

async function accessToken({ consumerKey, consumerSecret, oauthToken, oauthTokenSecret, verifier }) {
  const header = oauthHeader({
    method: 'POST',
    url: ACCESS_TOKEN_URL,
    consumerKey,
    consumerSecret,
    token: oauthToken,
    tokenSecret: oauthTokenSecret,
    extraParams: { oauth_verifier: verifier },
  });
  const res = await fetch(ACCESS_TOKEN_URL, { method: 'POST', headers: { Authorization: header } });
  const text = await res.text();
  if (!res.ok) throw new Error(`OAuth1 access_token failed: ${res.status} ${text}`);
  const params = new URLSearchParams(text);
  return {
    userId: params.get('user_id'),
    screenName: params.get('screen_name'),
  };
}

function authenticateUrl(oauthToken) {
  return `${AUTHENTICATE_URL}?oauth_token=${percentEncode(oauthToken)}`;
}

module.exports = { requestToken, accessToken, authenticateUrl };
