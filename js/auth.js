// ============================================================
// GHD Auth — Personal Access Token (PAT) authentication manager
// ============================================================
// Sign in by providing a fine-grained PAT with read access
// to your repos. Generate one at:
//   https://github.com/settings/tokens?type=beta
// Required permissions:
//   Repository: Metadata (read), Contents (read),
//               Issues (read), Pull requests (read)
// ============================================================

window.GHD = window.GHD || {};

(function (GHD) {
  'use strict';

  const TOKEN_KEY = 'ghd_token';
  const LOGIN_KEY = 'ghd_login';
  const WRITE_KEY = 'ghd_write';
  const API_BASE = 'https://api.github.com';

  // ── Storage helpers ──────────────────────────────────────

  function _saveToken(token) {
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) {}
  }

  function _loadToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (_) { return null; }
  }

  function _clearToken() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LOGIN_KEY);
      localStorage.removeItem(WRITE_KEY);
    } catch (_) {}
  }

  function _saveWriteAccess(val) {
    try { localStorage.setItem(WRITE_KEY, val ? '1' : '0'); } catch (_) {}
  }

  function _loadWriteAccess() {
    try { return localStorage.getItem(WRITE_KEY) !== '0'; } catch (_) { return true; }
  }

  function _saveLogin(login) {
    try { localStorage.setItem(LOGIN_KEY, login); } catch (_) {}
  }

  function _loadLogin() {
    try { return localStorage.getItem(LOGIN_KEY) || null; } catch (_) { return null; }
  }

  // ── Token validation ─────────────────────────────────────

  async function _validateToken(token) {
    try {
      const response = await fetch(`${API_BASE}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json'
        }
      });
      const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
      const retryAfter = response.headers.get('Retry-After');
      const isRateLimited = rateLimitRemaining === '0' || retryAfter !== null;
      if (!response.ok) {
        return {
          login: null,
          authError: response.status === 401 || (response.status === 403 && !isRateLimited)
        };
      }
      const user = await response.json();
      if (!user.login) {
        return { login: null, authError: false };
      }

      // Detect write-capable scope for Quick Issue feature.
      // Classic PATs return X-OAuth-Scopes; fine-grained PATs do not (null header).
      const scopeHeader = response.headers.get('X-OAuth-Scopes');
      if (scopeHeader === null) {
        // Fine-grained PAT — assume write access was configured
        _saveWriteAccess(true);
      } else {
        const scopes = scopeHeader.split(',').map(s => s.trim());
        _saveWriteAccess(scopes.includes('repo') || scopes.includes('public_repo'));
      }

      return { login: user.login, authError: false };
    } catch (_) {
      return { login: null, authError: false };
    }
  }

  // ── PAT modal ────────────────────────────────────────────

  function _buildModal() {
    const overlay = document.createElement('div');
    overlay.id = 'pat-modal-overlay';
    overlay.className = 'pat-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'pat-modal-title');
    overlay.innerHTML = `
      <div class="pat-modal">
        <h2 class="pat-modal-title" id="pat-modal-title">Sign in with a Personal Access Token</h2>
        <p class="pat-modal-copy">
          Enter a fine-grained Personal Access Token with read access to your repos.
          <a class="pat-modal-link" href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">Generate one on GitHub →</a>
        </p>
        <p class="pat-modal-permissions">
          Required permissions: <strong>Metadata (read), Contents (read), Issues (read), Pull requests (read)</strong><br>
          <span class="pat-modal-scope-optional">Optional — for <strong>Quick Issue</strong>: <strong>Issues: Read &amp; write</strong> (fine-grained PAT) or <strong>repo</strong> scope (classic PAT)</span>
        </p>
        <p class="pat-modal-privacy">
          🔒 Your token is stored only in your browser's localStorage and is never sent to any server or shared with anyone.
        </p>
        <div class="pat-modal-field">
          <label for="pat-input" class="pat-modal-label">Personal Access Token</label>
          <input
            id="pat-input"
            class="pat-modal-input"
            type="password"
            placeholder="github_pat_…"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
        <p class="pat-modal-error" id="pat-modal-error" hidden></p>
        <div class="pat-modal-actions">
          <button class="auth-btn" id="pat-submit-btn" type="button">Sign in</button>
          <button class="auth-btn auth-btn--secondary" id="pat-cancel-btn" type="button">Cancel</button>
        </div>
      </div>
    `;
    return overlay;
  }

  function _showModal() {
    return new Promise(function (resolve) {
      let overlay = document.getElementById('pat-modal-overlay');
      if (!overlay) {
        overlay = _buildModal();
        document.body.appendChild(overlay);
      }
      overlay.hidden = false;

      const input = overlay.querySelector('#pat-input');
      const submitBtn = overlay.querySelector('#pat-submit-btn');
      const cancelBtn = overlay.querySelector('#pat-cancel-btn');
      const errorEl = overlay.querySelector('#pat-modal-error');

      if (input) { input.value = ''; input.focus(); }
      if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Sign in'; }

      function _showError(msg) {
        if (errorEl) { errorEl.textContent = msg; errorEl.hidden = false; }
      }

      function _cleanup() {
        overlay.hidden = true;
        submitBtn.removeEventListener('click', _onSubmit);
        cancelBtn.removeEventListener('click', _onCancel);
        if (input) input.removeEventListener('keydown', _onKeydown);
      }

      async function _onSubmit() {
        const token = input ? input.value.trim() : '';
        if (!token) { _showError('Please enter a token.'); return; }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Verifying…';
        if (errorEl) errorEl.hidden = true;

        const { login } = await _validateToken(token);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign in';

        if (!login) {
          _showError('Invalid token — check permissions and try again.');
          return;
        }

        _saveToken(token);
        _saveLogin(login);
        _cleanup();
        resolve({ login });
      }

      function _onCancel() {
        _cleanup();
        resolve(null);
      }

      function _onKeydown(e) {
        if (e.key === 'Enter') _onSubmit();
      }

      submitBtn.addEventListener('click', _onSubmit);
      cancelBtn.addEventListener('click', _onCancel);
      if (input) input.addEventListener('keydown', _onKeydown);
    });
  }

  // ── Public API ───────────────────────────────────────────

  /**
   * Show the PAT input modal. Returns a promise that resolves to
   * { login } on success, or null if the user cancelled.
   */
  function signIn() {
    return _showModal();
  }

  /** Clear the stored token and private cache. */
  function signOut() {
    _clearToken();
    const overlay = document.getElementById('pat-modal-overlay');
    if (overlay) overlay.hidden = true;
    if (GHD.Cache) GHD.Cache.clearCache();
  }

  /** Return the stored PAT, or null if not signed in. */
  function getToken() {
    return _loadToken();
  }

  /** Return true if a PAT is stored in localStorage. */
  function isAuthenticated() {
    return !!_loadToken();
  }

  /**
   * Return a promise resolving to the stored token.
   * Rejects if not authenticated.
   */
  function getValidToken() {
    const token = _loadToken();
    if (!token) return Promise.reject(new Error('Not authenticated.'));
    return _validateToken(token).then(({ login, authError }) => {
      if (login) {
        _saveLogin(login);
        return token;
      }
      if (authError) {
        _clearToken();
        if (GHD.Cache) GHD.Cache.clearCache();
        throw new Error('PAT expired or revoked. Sign in again.');
      }
      return token;
    });
  }

  /**
   * Return a session-like object for compatibility with the rest of the app.
   * Returns { login, owner } or null if not signed in.
   */
  function getSession() {
    const token = _loadToken();
    if (!token) return null;
    const login = _loadLogin();
    return { login, owner: login };
  }

  // ── Silent page-load token validation ───────────────────
  // Validates the stored token on every page load; clears it if invalid.

  const ready = (async function () {
    const token = _loadToken();
    if (!token) return;
    const { login, authError } = await _validateToken(token);
    if (authError) {
      _clearToken();
      if (GHD.Cache) GHD.Cache.clearCache();
    } else if (login) {
      _saveLogin(login);
    }
  })();

  GHD.Auth = {
    signIn,
    signOut,
    getToken,
    isAuthenticated,
    getValidToken,
    getSession,
    hasIssueWriteAccess: () => !!_loadToken() && _loadWriteAccess(),
    ready
  };
}(window.GHD));
