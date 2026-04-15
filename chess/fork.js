'use strict';

/* ─────────────────────────────────────────────────────────────────
   ForkBoard — a self-contained mini chess game spawned from any
   position. Each fork gets its own Stockfish worker, board, and
   universe panel showing its own top-3 sub-lines.
   ───────────────────────────────────────────────────────────────── */

const FORK_PALETTE = [
  { border: '#7c3aed', glow: 'rgba(124,58,237,0.25)', label: '#a78bfa', darkSq: '#4c1d96' },
  { border: '#2563eb', glow: 'rgba(37,99,235,0.25)',  label: '#60a5fa', darkSq: '#1e3a8a' },
  { border: '#db2777', glow: 'rgba(219,39,119,0.25)', label: '#f472b6', darkSq: '#831843' },
  { border: '#059669', glow: 'rgba(5,150,105,0.25)',  label: '#34d399', darkSq: '#064e3b' },
  { border: '#d97706', glow: 'rgba(217,119,6,0.25)',  label: '#fbbf24', darkSq: '#78350f' },
  { border: '#dc2626', glow: 'rgba(220,38,38,0.25)',  label: '#f87171', darkSq: '#7f1d1d' },
];

let _forkSeq = 0;

class ForkBoard {
  /* opts: { fen, moveNum, playerSide, label, onClose, onFork } */
  constructor(opts) {
    this._id         = ++_forkSeq;
    this._fen        = opts.fen;
    this._moveNum    = opts.moveNum;
    this._playerSide = opts.playerSide ?? 'w';
    this._label      = opts.label ?? `Move ${opts.moveNum}`;
    this._onClose    = opts.onClose   ?? (() => {});
    this._onFork     = opts.onFork    ?? (() => {});
    this._onPromote  = opts.onPromote ?? (() => {});
    this._palette    = FORK_PALETTE[this._id % FORK_PALETTE.length];
    this._game       = new Chess(this._fen);
    this._board      = null;
    this._universePanel = null;   // created after element is in DOM
    this._thinking   = false;

    this._selectedSq  = null;
    this._justDropped = false;
    this._overlay     = null;
    this._engine = new StockfishEngine(() => this._onEngineReady());
    this._el = this._buildDOM();
  }

  get element() { return this._el; }
  get id()      { return this._id; }

  /* ── FX helpers ───────────────────────────────────────────── */
  _isFxOn(id) { return document.getElementById(`fx-${id}`)?.checked ?? true; }

  /* ── DOM ──────────────────────────────────────────────────── */
  _buildDOM() {
    const el = document.createElement('div');
    el.className  = 'fork-card';
    el.dataset.id = this._id;
    el.style.setProperty('--fork-border', this._palette.border);
    el.style.setProperty('--fork-glow',   this._palette.glow);
    el.style.setProperty('--fork-label',  this._palette.label);
    el.style.setProperty('--sq-dark',     this._palette.darkSq);

    el.innerHTML = `
      <div class="fork-card-header">
        <span class="fork-origin">↳ ${this._label}</span>
        <div class="fork-actions">
          <button class="fork-btn fork-btn-fork"    title="Fork this position">⑂</button>
          <button class="fork-btn fork-btn-promote" title="Promote to main">↑</button>
          <button class="fork-btn fork-btn-close"   title="Close">×</button>
        </div>
      </div>
      <div class="fork-board-wrap">
        <div id="fork-board-${this._id}" class="fork-board-el"></div>
      </div>
      <div class="fork-universes">
        <div class="fork-universe-header">Universes</div>
        <div id="fork-ulist-${this._id}" class="fork-universe-list"></div>
      </div>
      <div class="fork-footer">
        <span class="fork-status">Loading engine…</span>
        <span class="fork-side">${this._playerSide === 'w' ? '◇ White' : '◆ Black'}</span>
      </div>
    `;

    el.querySelector('.fork-btn-close').addEventListener('click', () => {
      this._destroy();
      this._onClose(this._id);
    });
    el.querySelector('.fork-btn-promote').addEventListener('click', () => {
      this._onPromote(this._id);
    });
    el.querySelector('.fork-btn-fork').addEventListener('click', () => {
      this._onFork({
        fen:        this._game.fen(),
        moveNum:    this._moveNum + this._game.history().length,
        playerSide: this._playerSide,
        label:      `Fork ${this._id} · Move ${this._moveNum + this._game.history().length}`,
      });
    });

    return el;
  }

  /* ── Engine ready ─────────────────────────────────────────── */
  _onEngineReady() {
    // The element is in the DOM by now — safe to create UniversePanel and overlay
    this._universePanel = new UniversePanel(`fork-ulist-${this._id}`);

    const boardEl = this._el.querySelector(`#fork-board-${this._id}`);
    const wrapEl  = this._el.querySelector('.fork-board-wrap');
    this._overlay = new ChessOverlay(boardEl, wrapEl);

    this._board = Chessboard(`fork-board-${this._id}`, {
      position:    this._fen,
      draggable:   true,
      orientation: this._playerSide === 'w' ? 'white' : 'black',
      pieceTheme:  'img/chesspieces/wikipedia/{piece}.png',
      onDragStart: (src, piece) => this._onDragStart(src, piece),
      onDrop:      (src, tgt)   => this._onDrop(src, tgt),
      onSnapEnd:   ()           => this._board?.position(this._game.fen()),
      onMouseoverSquare: (sq, piece) => {
        if (!this._isFxOn('halos')) return;
        if (!piece || this._thinking || this._game.turn() !== this._playerSide) return;
        if (piece[0] !== this._playerSide) return;
        const moves = this._game.moves({ square: sq, verbose: true });
        if (moves.length) this._overlay.showHalos(moves);
      },
      onMouseoutSquare: () => {
        if (this._isFxOn('halos')) this._overlay.clearHalos();
      },
    });

    requestAnimationFrame(() => this._overlay.reposition());

    // Click / tap to move
    const forkBoardEl = this._el.querySelector(`#fork-board-${this._id}`);
    let _tapSq = null, _tapPos = null, _tapFired = false;

    forkBoardEl.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      _tapSq  = e.target.closest('[data-square]')?.dataset.square ?? null;
      _tapPos = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    forkBoardEl.addEventListener('touchend', (e) => {
      if (!_tapSq) return;
      const t = e.changedTouches[0];
      const sq = _tapSq;
      const moved = Math.abs(t.clientX - _tapPos.x) > 10 ||
                    Math.abs(t.clientY - _tapPos.y) > 10;
      _tapSq = _tapPos = null;
      if (moved) return;
      _tapFired = true;
      setTimeout(() => { _tapFired = false; }, 400);
      this._onSquareClick(sq);
    }, { passive: true });

    forkBoardEl.addEventListener('click', (e) => {
      if (_tapFired) { return; }
      if (this._justDropped) { this._justDropped = false; return; }
      const sq = e.target.closest('[data-square]')?.dataset.square;
      if (sq) this._onSquareClick(sq);
    });

    if (this._game.turn() !== this._playerSide) {
      this._setStatus('Engine is thinking…');
      this._thinking = true;
      this._engineMove();
    } else {
      this._setStatus('Your move.');
    }
  }

  /* ── Drag ─────────────────────────────────────────────────── */
  _onDragStart(src, piece) {
    if (this._game.game_over() || this._thinking) return false;
    if (piece[0] !== this._playerSide)            return false;
    if (this._game.turn() !== this._playerSide)   return false;
    return true;
  }

  _onDrop(src, tgt) {
    if (src === tgt) return 'snapback';
    this._justDropped = true;
    this._clearSelected();
    this._overlay?.clearHalos();
    const move = this._game.move({ from: src, to: tgt, promotion: 'q' });
    if (!move) return 'snapback';
    if (move.captured && this._isFxOn('wormhole')) this._overlay?.fireWormhole(src, tgt);
    this._universePanel?.clear();
    if (this._game.game_over()) { this._handleGameOver(); return; }
    this._thinking = true;
    this._setStatus('Engine is thinking…');
    setTimeout(() => this._engineMove(), 60);
  }

  /* ── Engine move + sub-universe analysis ─────────────────── */
  _engineMove() {
    this._engine.getBestMove(this._game.fen(), DIFFICULTY.medium, (uci) => {
      this._thinking = false;
      if (!uci || uci === '(none)') return;
      const from = uci.slice(0, 2);
      const to   = uci.slice(2, 4);
      const move = this._game.move({ from, to, promotion: uci[4] || 'q' });
      if (!move) return;
      if (move.captured && this._isFxOn('wormhole')) this._overlay?.fireWormhole(from, to);
      this._board?.position(this._game.fen());
      if (this._game.game_over()) { this._handleGameOver(); return; }
      const check = this._game.in_check();
      this._setStatus(check ? 'Check! Your move.' : 'Your move.');

      // Run analysis and populate this fork's own universe panel
      const fenNow   = this._game.fen();
      const moveNow  = this._moveNum + this._game.history().length;
      this._engine.analyze(fenNow, DIFFICULTY.medium, (lines) => {
        this._universePanel?.update(lines, fenNow, (_, uciMoves) => {
          // Fork from first move of the sub-universe line
          if (!uciMoves?.[0]) return;
          const t  = new Chess(fenNow);
          const mv = t.move({
            from:      uciMoves[0].slice(0, 2),
            to:        uciMoves[0].slice(2, 4),
            promotion: uciMoves[0][4] || 'q',
          });
          if (!mv) return;
          this._onFork({
            fen:        t.fen(),
            moveNum:    moveNow + 1,
            playerSide: this._playerSide,
            label:      `${mv.san} · Move ${moveNow + 1}`,
          });
        });
      });
    });
  }

  /* ── Click / tap to move ─────────────────────────────────── */
  _onSquareClick(sq) {
    if (this._game.game_over() || this._thinking) return;
    if (this._game.turn() !== this._playerSide) return;

    const piece = this._game.get(sq);

    if (this._selectedSq === sq) {
      this._clearSelected();
      this._overlay?.clearHalos();
      return;
    }

    if (this._selectedSq) {
      const from = this._selectedSq;
      this._clearSelected();
      this._overlay?.clearHalos();

      const move = this._game.move({ from, to: sq, promotion: 'q' });
      if (move) {
        if (move.captured && this._isFxOn('wormhole')) this._overlay?.fireWormhole(from, sq);
        this._board?.position(this._game.fen());
        this._universePanel?.clear();
        if (this._game.game_over()) { this._handleGameOver(); return; }
        this._thinking = true;
        this._setStatus('Engine is thinking…');
        setTimeout(() => this._engineMove(), 60);
        return;
      }
    }

    if (piece && piece.color === this._playerSide) {
      this._selectedSq = sq;
      this._el.querySelector(`[data-square="${sq}"]`)?.classList.add('highlight-selected');
      if (this._isFxOn('halos')) {
        const moves = this._game.moves({ square: sq, verbose: true });
        if (moves.length) this._overlay?.showHalos(moves);
      }
    }
  }

  _clearSelected() {
    this._selectedSq = null;
    this._el.querySelectorAll('.highlight-selected')
      .forEach(el => el.classList.remove('highlight-selected'));
  }

  /* ── Game over ────────────────────────────────────────────── */
  _handleGameOver() {
    let msg = 'Draw.';
    if (this._game.in_checkmate()) {
      msg = this._game.turn() === this._playerSide ? 'You lose.' : 'You win! ✦';
    }
    this._setStatus(msg);
    this._universePanel?.clear();
    this._el.querySelector('.fork-btn-fork').disabled = true;
  }

  /* ── Restart ──────────────────────────────────────────────── */
  _restart() {
    if (this._thinking) this._engine.stop();
    this._game     = new Chess(this._fen);
    this._thinking = false;
    this._engine.newGame();
    this._board?.position(this._fen);
    this._universePanel?.clear();

    if (this._game.turn() !== this._playerSide) {
      this._setStatus('Engine is thinking…');
      this._thinking = true;
      setTimeout(() => this._engineMove(), 60);
    } else {
      this._setStatus('Your move.');
    }
  }

  /* ── Helpers ──────────────────────────────────────────────── */
  _setStatus(msg) {
    const el = this._el.querySelector('.fork-status');
    if (el) el.textContent = msg;
  }

  _destroy() {
    if (this._thinking) this._engine.stop();
    this._engine.terminate();
    this._board?.destroy();
    this._overlay?.destroy();
    this._el.classList.add('fork-exiting');
    setTimeout(() => this._el.remove(), 300);
  }

  // Instant removal without animation — used by promote
  silentDestroy() {
    if (this._thinking) this._engine.stop();
    this._engine.terminate();
    this._board?.destroy();
    this._overlay?.destroy();
    this._el.remove();
  }
}
