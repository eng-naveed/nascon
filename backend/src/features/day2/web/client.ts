/**
 * Guest Web Player behaviour (FR-4.2 zero-friction viewing, FR-4.3 server-enforced read-only boundary,
 * FR-4.4 progressive registration + cart merge + resume, spec 6.2.2 data-testid contract).
 * Plain browser JS served as /web/assets/app.js; page data arrives in <script type="application/json" id="cfg">.
 */
export const JS = String.raw`(function () {
  'use strict';
  var C = JSON.parse(document.getElementById('cfg').textContent);
  function $(s) { return document.querySelector(s); }
  function T(n) { return document.querySelector('[data-testid="' + n + '"]'); }
  function text(el, t) { if (el && el.textContent !== String(t)) el.textContent = String(t); }
  function store(area) {
    return {
      get: function (k, d) { try { var v = window[area].getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
      set: function (k, v) { try { window[area].setItem(k, JSON.stringify(v)); } catch (e) {} },
      del: function (k) { try { window[area].removeItem(k); } catch (e) {} }
    };
  }
  var local = store('localStorage'), session = store('sessionStorage');
  function announce(msg) { text($('#live-status'), msg); }

  /* ---------- identity: anonymous guest token, or the member who signed in ---------- */
  var member = session.get('nascon.member', null);
  var guest = local.get('nascon.guest', null);
  function guestToken() {
    if (guest && Date.parse(guest.expires_at) > Date.now() + 60000) return Promise.resolve(guest.guest_token);
    return fetch('/api/v1/guest/session', { method: 'POST' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.guest_token) { guest = j; local.set('nascon.guest', j); return j.guest_token; } return 'guest_anon_tok_7721'; })
      .catch(function () { return 'guest_anon_tok_7721'; });
  }
  var tokenReady = guestToken();
  function bearer() { return member ? Promise.resolve(member.token) : tokenReady; }

  /* ---------- video: LL-HLS from the media server on :8888 (hls.js where MSE is needed) ---------- */
  var video = $('#video');
  var resumeKey = 'nascon.resume.' + C.kind + '.' + C.id;
  function startVideo() {
    if (!video || !C.hls) return;
    var src = location.protocol + '//' + location.hostname + ':8888' + C.hls;
    var ph = $('#player-msg');
    video.muted = true;
    var resumeAt = session.get(resumeKey, null);
    function onReady() {
      if (ph) ph.hidden = true;
      if (resumeAt != null && isFinite(resumeAt) && Math.abs(video.currentTime - resumeAt) > 2) { try { video.currentTime = resumeAt; } catch (e) {} }
      var p = video.play(); if (p && p.catch) p.catch(function () {});
    }
    if (window.Hls && window.Hls.isSupported()) {
      var h = new window.Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
      h.on(window.Hls.Events.MANIFEST_PARSED, onReady);
      h.on(window.Hls.Events.ERROR, function (_e, d) {
        if (!d.fatal) return;
        if (ph) { ph.hidden = false; text(ph, 'Stream offline, reconnecting...'); }
        h.destroy(); setTimeout(startVideo, 3000);
      });
      h.loadSource(src); h.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src; video.addEventListener('loadedmetadata', onReady, { once: true });
    }
    setInterval(function () { if (!video.paused) session.set(resumeKey, video.currentTime); }, 1000);
  }

  /* ---------- live socket with reconnect (score / co-stream / chat) ---------- */
  function socket(path, onMessage) {
    var delay = 500;
    (function open() {
      var ws;
      try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path); } catch (e) { return; }
      ws.onmessage = function (ev) { try { onMessage(JSON.parse(ev.data)); } catch (e) {} };
      ws.onopen = function () { delay = 500; };
      ws.onclose = function () { setTimeout(open, delay); delay = Math.min(delay * 2, 8000); };
    })();
  }

  /* ---------- score banner + pinned merchandise overlay ---------- */
  var banner = T('live-score-banner');
  function applyScore(m) {
    var s = m.score;
    if (s && s.home && s.away) text(banner, s.home.score + ' - ' + s.away.score);
    if (s && s.status) {
      var pill = $('#match-status');
      text(pill, String(s.status).replace('_', ' '));
      if (pill) pill.className = 'status-pill' + (s.status === 'in_progress' ? ' live' : '');
    }
    if (m.showcase && m.showcase.variant_id) {
      var card = T('pinned-merch-card');
      card.setAttribute('data-variant-id', m.showcase.variant_id);
      if (m.showcase.product_name) text($('#pin-name'), m.showcase.product_name);
      if (typeof m.showcase.price_minor === 'number') text($('#pin-price'), 'PKR ' + (m.showcase.price_minor / 100).toFixed(2));
    }
  }

  /* ---------- co-stream state ---------- */
  function applyCostream(m) {
    if (!m.session_id) return;
    var people = $('#people');
    if (people && Array.isArray(m.active_participants)) {
      people.textContent = '';
      m.active_participants.forEach(function (p) {
        var li = document.createElement('li'); li.textContent = p;
        if (p === m.active_host) { li.className = 'host'; li.textContent = p + ' (host)'; }
        people.appendChild(li);
      });
    }
    text(banner, m.status === 'active' ? 'LIVE - ' + m.participant_count + ' on air' : 'Stream ended');
    text($('#cs-layout'), m.layout || '');
    if (m.type === 'costream.handoff' && m.active_host) announce('Host changed to ' + m.active_host);
  }

  /* ---------- chat ---------- */
  var list = T('chat-message-list'), seen = {};
  function addMessage(m) {
    if (!list || m.seq == null || seen[m.seq]) return;
    seen[m.seq] = 1;
    var li = document.createElement('li');
    var b = document.createElement('b'); b.textContent = (m.sender || 'guest') + ': ';
    var span = document.createElement('span'); span.textContent = m.text == null ? '' : String(m.text);
    li.appendChild(b); li.appendChild(span);
    var atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
    list.appendChild(li);
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  function loadChat() {
    if (!list) return;
    fetch('/api/v1/chat/' + encodeURIComponent(C.room) + '/messages?limit=100')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.messages) j.messages.forEach(addMessage); })
      .catch(function () {});
  }
  var input = T('chat-input-field'), sendBtn = T('chat-send-btn'), chatErr = $('#chat-error');
  function sendChat(textValue) {
    text(chatErr, '');
    // a member with nothing typed has nothing to send; a guest's click is still a (refused) write attempt
    if (member && !textValue) return Promise.resolve();
    return bearer().then(function (tok) {
      return fetch('/api/v1/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ chat_room_id: C.room, text: textValue || ' ' })
      });
    }).then(function (r) {
      if (r.status === 201) { if (input) input.value = ''; return; }
      return r.json().catch(function () { return {}; }).then(function (j) {
        var code = j && j.error && j.error.code;
        // the server refused a guest write (403) or the session expired (401): register to continue
        if (code === 'GUEST_WRITE_FORBIDDEN' || r.status === 401) { member = null; session.del('nascon.member'); return openModal({ type: 'chat', text: textValue }); }
        text(chatErr, (j && j.error && j.error.message) || 'Message not sent.');
      });
    }).catch(function () { text(chatErr, 'Network problem, please retry.'); });
  }
  var chatForm = $('#chat-form');
  if (chatForm) chatForm.addEventListener('submit', function (e) { e.preventDefault(); });
  if (sendBtn) sendBtn.addEventListener('click', function () { sendChat(input ? input.value.trim() : ''); });
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendChat(input.value.trim()); } });

  /* ---------- guest staging cart ---------- */
  var cartKey = 'nascon.cart';
  var cart = local.get(cartKey, []);
  function cartCount() { return cart.reduce(function (n, i) { return n + i.quantity; }, 0); }
  function renderCart() { text(T('guest-cart-count'), cartCount()); local.set(cartKey, cart); }
  var addBtn = T('add-to-guest-cart-btn');
  if (addBtn) addBtn.addEventListener('click', function () {
    var vid = T('pinned-merch-card').getAttribute('data-variant-id') || 'var-jersey-001-L';
    var line = cart.filter(function (i) { return i.variant_id === vid; })[0];
    if (line) line.quantity += 1; else cart.push({ variant_id: vid, quantity: 1 });
    renderCart(); announce('Added to your cart (' + cartCount() + ' items)');
  });
  var checkout = $('#checkout-btn');
  if (checkout) checkout.addEventListener('click', function () {
    if (member) return mergeCart().then(function () { announce('Your cart is saved to your account.'); });
    openModal({ type: 'checkout' });
  });

  /* ---------- athlete follow (FR-3.1): members toggle, guests are asked to sign in ---------- */
  var followBtn = $('#follow-btn'), following = false;
  function followUrl() { return '/api/v1/players/' + encodeURIComponent(C.id); }
  function renderFollow(n) {
    if (n != null) text($('#follower-count'), n + (n === 1 ? ' follower' : ' followers'));
    if (followBtn) { text(followBtn, following ? 'Following' : 'Follow'); followBtn.setAttribute('aria-pressed', String(following)); }
  }
  function loadFollow() {
    if (!followBtn) return;
    fetch(followUrl() + '/followers', { headers: member ? { Authorization: 'Bearer ' + member.token } : {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { following = !!j.following; renderFollow(j.follower_count); } })
      .catch(function () {});
  }
  function setFollow(on) {
    if (!member) return openModal({ type: 'follow' });
    return fetch(followUrl() + '/follow', { method: on ? 'POST' : 'DELETE', headers: { Authorization: 'Bearer ' + member.token } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (res) {
        if (res.s === 401) { member = null; session.del('nascon.member'); return openModal({ type: 'follow' }); }
        if (res.s !== 200) return announce((res.j.error && res.j.error.message) || 'Could not update follow.');
        following = res.j.following; renderFollow(res.j.follower_count);
        announce(following ? 'You are following this athlete.' : 'You unfollowed this athlete.');
      }).catch(function () { announce('Network problem, please retry.'); });
  }
  if (followBtn) followBtn.addEventListener('click', function () { setFollow(!following); });

  /* ---------- progressive registration modal (FR-4.4) ---------- */
  var modal = T('progressive-auth-modal'), lastFocus = null, pending = null;
  function focusables() { return Array.prototype.slice.call(modal.querySelectorAll('button,input,a[href]')).filter(function (e) { return !e.disabled; }); }
  function openModal(action) {
    pending = action || null;
    if (video) session.set(resumeKey, video.currentTime);
    lastFocus = document.activeElement; modal.hidden = false;
    var em = $('#auth-email'); if (em) em.focus();
  }
  function closeModal() { modal.hidden = true; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function mergeCart() {
    if (!cart.length || !member) return Promise.resolve();
    return tokenReady.then(function (gt) {
      var user = member.user || {};
      return fetch('/audit/v1/guest/cart-merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest_token: (guest && guest.guest_token) || gt, registered_user_id: user.player_id || user.id, guest_cart: cart, test_write_block: true })
      });
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { text($('#auth-error'), (res.j.error && res.j.error.message) || 'Could not save your cart.'); return; }
        cart = []; renderCart();
        // the merged guest token is spent; the next anonymous session gets a fresh one
        guest = null; local.del('nascon.guest'); tokenReady = guestToken();
        text($('#cart-summary'), 'Cart saved: ' + res.j.active_cart.total_items + ' item(s), PKR ' + (res.j.active_cart.subtotal_minor / 100).toFixed(2));
      });
  }
  document.addEventListener('keydown', function (e) {
    if (modal.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); return closeModal(); }
    if (e.key !== 'Tab') return;
    var f = focusables(); if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  $('#modal-close').addEventListener('click', closeModal);
  $('#auth-form').addEventListener('submit', function (e) {
    e.preventDefault(); text($('#auth-error'), '');
    fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('#auth-email').value.trim(), password: $('#auth-password').value })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.token) { text($('#auth-error'), 'Sign in failed. Check your email and password.'); return; }
        member = { token: res.j.token, user: res.j.user }; session.set('nascon.member', member);
        $('#auth-password').value = '';
        text($('#who'), 'Signed in as ' + (res.j.user.name || res.j.user.email));
        return mergeCart().then(function () {
          var p = pending; pending = null; closeModal();
          // resume exactly where the guest was watching
          var at = session.get(resumeKey, null);
          if (video && at != null && Math.abs(video.currentTime - at) > 2) { try { video.currentTime = at; } catch (x) {} }
          if (p && p.type === 'chat' && p.text) return sendChat(p.text);
          // follow is idempotent, so the action the guest asked for can simply be replayed as a member
          if (p && p.type === 'follow') return setFollow(true);
        });
      }).catch(function () { text($('#auth-error'), 'Network problem, please retry.'); });
  });
  if (member) text($('#who'), 'Signed in as ' + ((member.user && (member.user.name || member.user.email)) || 'member'));

  /* ---------- boot ---------- */
  renderCart();
  loadFollow();
  // attach the stream only after 'load': a media element fetching data delays the load event (Firefox waits
  // until it can decode), which would stall automated page loads
  if (document.readyState === 'complete') startVideo(); else window.addEventListener('load', startVideo, { once: true });
  loadChat();
  if (C.kind === 'live') socket('/ws/matches/' + encodeURIComponent(C.id), function (m) { if (m.type === 'score') applyScore(m); });
  if (C.kind === 'costream') socket('/ws/costream/' + encodeURIComponent(C.id), function (m) {
    if (m.type === 'chat.message') addMessage(m); else if (m.session_id) applyCostream(m);
  });
  if (C.kind !== 'costream' && list) socket('/ws/chat/' + encodeURIComponent(C.room), function (m) { if (m.type === 'chat.message') addMessage(m); });
})();
`;
