/*
 * ==========================================================================
 * Auth0 Authentication — Authorization Code Flow with PKCE
 * ==========================================================================
 *
 * Uses chrome.identity.launchWebAuthFlow against Auth0 Universal Login.
 * No client secret — this is a public SPA client using PKCE only.
 *
 * Stored auth object shape (chrome.storage.local, key "vt_auth"):
 * {
 *   accessToken:  string,
 *   idToken:      string,
 *   expiresAt:    number (ms since epoch),
 *   user: {
 *     sub:     string,   ← stable Auth0 user ID, use this to tie data
 *     name:    string,
 *     email:   string,
 *     picture: string,
 *   }
 * }
 * ==========================================================================
 */

const AUTH0_DOMAIN = 'dev-f061rrmnizussvbh.us.auth0.com';
const AUTH0_CLIENT_ID = 'Yix3qNxNUFUvEjx31LHFtZMhJRdtHt9S';
const REDIRECT_URL = chrome.identity.getRedirectURL();
const STORAGE_KEY = 'vt_auth';

/* ---- Crypto helpers ---- */

function generateRandomString(length) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function generatePkce() {
  const verifier = generateRandomString(32);
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}

/* ---- Storage ---- */

async function getStoredAuth() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || null;
}

async function storeAuth(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

async function clearAuth() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

/* ---- JWT decode ---- */

function decodeJwtPayload(token) {
  try {
    const seg = token.split('.')[1];
    const base64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ---- Login ---- */

export async function login() {
  const { verifier, challenge } = await generatePkce();
  const state = generateRandomString(16);
  const nonce = generateRandomString(16);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH0_CLIENT_ID,
    redirect_uri: REDIRECT_URL,
    scope: 'openid profile email',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  const authUrl = `https://${AUTH0_DOMAIN}/authorize?${params.toString()}`;

  /* Open Auth0 Universal Login in a browser tab managed by Chrome */
  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (callbackUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(callbackUrl);
      }
    );
  });

  const url = new URL(responseUrl);

  /* Validate state — guards against CSRF */
  if (url.searchParams.get('state') !== state) {
    throw new Error('State mismatch — possible CSRF. Login aborted.');
  }

  /* Extract authorization code */
  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error(
      url.searchParams.get('error_description') || 'No authorization code returned'
    );
  }

  /* Exchange code for tokens — no client_secret (public SPA + PKCE) */
  const tokenResponse = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: AUTH0_CLIENT_ID,
      code,
      redirect_uri: REDIRECT_URL,
      code_verifier: verifier,
    }),
  });

  if (!tokenResponse.ok) {
    const err = await tokenResponse.json().catch(() => ({}));
    throw new Error(err.error_description || `Token exchange failed (${tokenResponse.status})`);
  }

  const tokens = await tokenResponse.json();

  /* Decode and validate id_token */
  const claims = decodeJwtPayload(tokens.id_token);
  if (!claims) {
    throw new Error('Failed to decode ID token');
  }
  if (claims.nonce !== nonce) {
    throw new Error('Nonce mismatch — possible replay. Login aborted.');
  }

  const authData = {
    accessToken: tokens.access_token,
    idToken: tokens.id_token,
    expiresAt: Date.now() + (tokens.expires_in || 86400) * 1000,
    user: {
      sub: claims.sub,
      name: claims.name || claims.nickname || '',
      email: claims.email || '',
      picture: claims.picture || '',
    },
  };

  await storeAuth(authData);
  return authData;
}

/* ---- Logout ---- */

export async function logout() {
  /* Clear local tokens first so the UI updates immediately */
  await clearAuth();

  /*
   * End the Auth0 session so the next login shows the login screen
   * instead of silently re-authenticating. Best-effort — if this
   * fails the user is still logged out locally.
   */
  const logoutUrl =
    `https://${AUTH0_DOMAIN}/v2/logout?` +
    new URLSearchParams({
      client_id: AUTH0_CLIENT_ID,
      returnTo: REDIRECT_URL,
    }).toString();

  await new Promise((resolve) => {
    chrome.identity.launchWebAuthFlow(
      { url: logoutUrl, interactive: false },
      () => {
        /* Swallow chrome.runtime.lastError — local clear already done */
        void chrome.runtime.lastError;
        resolve();
      }
    );
  });
}

/* ---- Auth state ---- */

export async function getAuthState() {
  const auth = await getStoredAuth();

  if (!auth) {
    return { isAuthenticated: false, user: null };
  }

  /* Treat expired tokens as signed-out */
  if (auth.expiresAt && Date.now() > auth.expiresAt) {
    await clearAuth();
    return { isAuthenticated: false, user: null };
  }

  return { isAuthenticated: true, user: auth.user };
}

export async function isAuthenticated() {
  const state = await getAuthState();
  return state.isAuthenticated;
}
