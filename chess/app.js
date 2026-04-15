/* ─────────────────────────────────────────────────────────────────
   Multiverse Chess — app.js
   chess.js 0.10.x + chessboard.js 1.0.0 + Stockfish 10 Web Worker
   ───────────────────────────────────────────────────────────────── */

'use strict';

/* ── Difficulty presets ─────────────────────────────────────────── */
const DIFFICULTY = {
  easy:   { skillLevel: 2,  depth: 5,  moveTime: null },
  medium: { skillLevel: 8,  depth: 10, moveTime: null },
  hard:   { skillLevel: 18, depth: 12, moveTime: null },
  expert: { skillLevel: 20, depth: null, moveTime: 3000 },
};

const PIECE_THEME = 'img/chesspieces/wikipedia/{piece}.png';

/* ════════════════════════════════════════════════════════════════
   StockfishEngine
   Modes:  idle → thinking → idle
           idle → analyzing → idle
   ════════════════════════════════════════════════════════════════ */
class StockfishEngine {
  constructor(onReady) {
    this._ready        = false;
    this._onReady      = onReady;
    this._mode         = 'idle';   // 'idle' | 'thinking' | 'analyzing'
    this._onBestMove   = null;
    this._onAnalysis   = null;
    this._analysisLines = {};

    this._worker = new Worker('stockfish-worker.js');
    this._worker.onmessage = (e) => this._handle(e.data);
    this._worker.onerror   = (e) => console.error('Stockfish worker error:', e);
    this._send('uci');
  }

  _send(cmd) { this._worker.postMessage(cmd); }

  _handle(line) {
    if (line === 'uciok')  { this._send('isready'); return; }
    if (line === 'readyok') {
      if (!this._ready) { this._ready = true; this._onReady?.(); }
      return;
    }

    // Collect MultiPV info lines during analysis
    if (this._mode === 'analyzing' && line.startsWith('info ')) {
      this._parseInfoLine(line);
    }

    if (line.startsWith('bestmove')) {
      const mv      = line.split(' ')[1];
      const wasMode = this._mode;
      this._mode    = 'idle';

      if (wasMode === 'thinking') {
        this._onBestMove?.(mv);
      } else if (wasMode === 'analyzing') {
        this._send('setoption name MultiPV value 1');
        const results = Object.entries(this._analysisLines)
          .sort(([a], [b]) => parseInt(a) - parseInt(b))
          .map(([, v]) => v);
        this._analysisLines = {};
        this._onAnalysis?.(results);
      }
    }
  }

  _parseInfoLine(line) {
    const mpv   = line.match(/multipv (\d+)/)?.[1];
    const cp    = line.match(/score cp (-?\d+)/)?.[1];
    const mate  = line.match(/score mate (-?\d+)/)?.[1];
    const pv    = line.match(/ pv (.+)/)?.[1];
    if (!mpv || !pv) return;

    this._analysisLines[mpv] = {
      score: mate != null
        ? (parseInt(mate) > 0 ? 9999 : -9999)
        : parseInt(cp ?? '0'),
      moves: pv.trim().split(' ').filter(Boolean).slice(0, 5),
    };
  }

  setSkillLevel(level) { this._send(`setoption name Skill Level value ${level}`); }
  newGame()            { this._send('ucinewgame'); }
  stop()               { this._send('stop'); }
  terminate()          { this._worker.terminate(); }
  get ready()          { return this._ready; }

  getBestMove(fen, preset, callback) {
    this._mode      = 'thinking';
    this._onBestMove = callback;
    this._send(`position fen ${fen}`);
    this._send(preset.moveTime ? `go movetime ${preset.moveTime}` : `go depth ${preset.depth}`);
  }

  // Run MultiPV-3 analysis at the same depth/movetime as the opponent
  analyze(fen, preset, callback) {
    if (this._mode !== 'idle') return;
    this._mode         = 'analyzing';
    this._onAnalysis   = callback;
    this._analysisLines = {};
    this._send('setoption name MultiPV value 3');
    this._send(`position fen ${fen}`);
    this._send(preset.moveTime ? `go movetime ${preset.moveTime}` : `go depth ${preset.depth}`);
  }
}

/* ════════════════════════════════════════════════════════════════
   ChessGame — main controller
   ════════════════════════════════════════════════════════════════ */
class ChessGame {
  constructor() {
    this._game       = new Chess();
    this._board      = null;
    this._playerSide = 'w';
    this._thinking   = false;

    this._elStatus   = document.getElementById('status');
    this._elThinking = document.getElementById('thinking');

    this._overlay       = new ChessOverlay(
      document.getElementById('board'),
      document.querySelector('.board-wrap'),
    );
    this._universePanel = new UniversePanel('universe-list');
    this._forks         = [];

    // Click / tap to move
    this._selectedSq  = null;
    this._justDropped = false;
    this._tapFired    = false;

    const boardEl = document.getElementById('board');
    let _tapSq = null, _tapPos = null;

    // touchstart/touchend: intercept taps before chessboard.js can stopPropagation
    boardEl.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      _tapSq  = e.target.closest('[data-square]')?.dataset.square ?? null;
      _tapPos = { x: t.clientX, y: t.clientY };
    }, { passive: true });

    boardEl.addEventListener('touchend', (e) => {
      if (!_tapSq) return;
      const t = e.changedTouches[0];
      const sq = _tapSq;
      const moved = Math.abs(t.clientX - _tapPos.x) > 10 ||
                    Math.abs(t.clientY - _tapPos.y) > 10;
      _tapSq = _tapPos = null;
      if (moved) return;               // drag, not tap
      this._tapFired = true;
      setTimeout(() => { this._tapFired = false; }, 400);
      this._onSquareClick(sq);
    }, { passive: true });

    // click: desktop fallback (suppressed after a touch tap)
    boardEl.addEventListener('click', (e) => {
      if (this._tapFired)    { return; }
      if (this._justDropped) { this._justDropped = false; return; }
      const sq = e.target.closest('[data-square]')?.dataset.square;
      if (sq) this._onSquareClick(sq);
    });

    this._engine = new StockfishEngine(() => this._onEngineReady());
    document.getElementById('btn-new').addEventListener('click',  () => this._newGame());
    document.getElementById('btn-fork').addEventListener('click', () => this._spawnFork({
      fen:        this._game.fen(),
      moveNum:    this._game.history().length,
      playerSide: this._playerSide,
      label:      `Move ${this._game.history().length}`,
    }));
  }

  /* ── Helpers ──────────────────────────────────────────────── */
  _isFxOn(id) { return document.getElementById(`fx-${id}`)?.checked ?? true; }

  /* ── Engine ready ─────────────────────────────────────────── */
  _onEngineReady() {
    this._setStatus('Ready — your move.', 'active');
    this._newGame();
  }

  /* ── New game (opts: { fen, playerSide } for promote) ────── */
  _newGame(opts = {}) {
    if (this._thinking) this._engine.stop();

    const fen = opts.fen ?? null;
    this._game       = fen ? new Chess(fen) : new Chess();
    this._thinking   = false;
    this._playerSide = opts.playerSide
      ?? (document.getElementById('side').value === 'white' ? 'w' : 'b');

    const preset = DIFFICULTY[document.getElementById('difficulty').value];
    this._engine.setSkillLevel(preset.skillLevel);
    this._engine.newGame();

    document.getElementById('btn-fork').disabled = false;
    this._clearHighlights();
    this._clearSelected();
    this._setThinking(false);
    this._overlay.clearHalos();
    this._universePanel.clear();

    if (this._board) this._board.destroy();

    this._board = Chessboard('board', {
      position:    fen ?? 'start',
      draggable:   true,
      orientation: this._playerSide === 'w' ? 'white' : 'black',
      pieceTheme:  PIECE_THEME,

      onDragStart: (src, piece) => this._onDragStart(src, piece),
      onDrop:      (src, tgt)   => this._onDrop(src, tgt),
      onSnapEnd:   ()           => this._board.position(this._game.fen()),

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

    // Reposition the D3 overlay to sit on the freshly-rendered board
    requestAnimationFrame(() => this._overlay.reposition());

    if (this._game.turn() !== this._playerSide) {
      this._setStatus('Engine is thinking…');
      this._engineMove();
    } else {
      const inCheck = this._game.in_check();
      this._setStatus(inCheck ? 'Check! Your move.' : 'Your move.', inCheck ? 'check' : 'active');

      // When promoted from a fork the engine already moved there — run analysis now
      if (fen && this._isFxOn('universes')) {
        const fenNow       = this._game.fen();
        const moveCountNow = this._game.history().length;
        this._engine.analyze(fenNow, preset, (lines) => {
          if (!this._isFxOn('universes')) return;
          this._universePanel.update(lines, fenNow, (_, univMoves) => {
            if (!univMoves?.length) return;
            const tmp = new Chess(fenNow);
            const mv  = tmp.move({
              from:      univMoves[0].slice(0, 2),
              to:        univMoves[0].slice(2, 4),
              promotion: univMoves[0][4] || 'q',
            });
            if (!mv) return;
            this._spawnFork({
              fen:        tmp.fen(),
              moveNum:    moveCountNow + 1,
              playerSide: this._playerSide,
              label:      `${mv.san} · Move ${moveCountNow + 1}`,
            });
          });
        });
      }
    }
  }

  /* ── Drag callbacks ───────────────────────────────────────── */
  _onDragStart(src, piece) {
    if (this._game.game_over()) return false;
    if (this._thinking) return false;
    if (this._playerSide === 'w' && piece.search(/^b/) !== -1) return false;
    if (this._playerSide === 'b' && piece.search(/^w/) !== -1) return false;
    if (this._game.turn() !== this._playerSide) return false;
    return true;
  }

  _onDrop(src, tgt) {
    if (src === tgt) return 'snapback';
    this._justDropped = true;   // suppress the click event that fires after a drag
    this._clearSelected();
    this._overlay.clearHalos();
    this._clearHighlights();

    const move = this._game.move({ from: src, to: tgt, promotion: 'q' });
    if (!move) return 'snapback';

    // Wormhole on player capture
    if (move.captured && this._isFxOn('wormhole')) {
      this._overlay.fireWormhole(src, tgt);
    }

    this._highlightMove(src, tgt);
    this._universePanel.clear();

    if (this._game.game_over()) { this._handleGameOver(); return; }

    this._setStatus('Engine is thinking…');
    this._setThinking(true);
    setTimeout(() => this._engineMove(), 50);
  }

  /* ── Click / tap to move ─────────────────────────────────── */
  _onSquareClick(sq) {
    if (this._game.game_over() || this._thinking) return;
    if (this._game.turn() !== this._playerSide) return;

    const piece = this._game.get(sq);

    // Tap same square → deselect
    if (this._selectedSq === sq) {
      this._clearSelected();
      this._overlay.clearHalos();
      return;
    }

    if (this._selectedSq) {
      const from = this._selectedSq;
      this._clearSelected();
      this._overlay.clearHalos();

      const move = this._game.move({ from, to: sq, promotion: 'q' });
      if (move) {
        if (move.captured && this._isFxOn('wormhole')) this._overlay.fireWormhole(from, sq);
        this._clearHighlights();
        this._highlightMove(from, sq);
        this._board.position(this._game.fen());
        this._universePanel.clear();
        if (this._game.game_over()) { this._handleGameOver(); return; }
        this._setStatus('Engine is thinking…');
        this._setThinking(true);
        setTimeout(() => this._engineMove(), 50);
        return;
      }
      // Invalid destination — fall through to re-select if it's a friendly piece
    }

    // Select a friendly piece
    if (piece && piece.color === this._playerSide) {
      this._selectedSq = sq;
      $(`[data-square="${sq}"]`).addClass('highlight-selected');
      if (this._isFxOn('halos')) {
        const moves = this._game.moves({ square: sq, verbose: true });
        if (moves.length) this._overlay.showHalos(moves);
      }
    }
  }

  _clearSelected() {
    this._selectedSq = null;
    $('.highlight-selected').removeClass('highlight-selected');
  }

  /* ── Engine move ──────────────────────────────────────────── */
  _engineMove() {
    const preset = DIFFICULTY[document.getElementById('difficulty').value];
    this._engine.getBestMove(this._game.fen(), preset, (uciMove) => {
      this._setThinking(false);
      if (!uciMove || uciMove === '(none)') return;

      const from  = uciMove.slice(0, 2);
      const to    = uciMove.slice(2, 4);
      const promo = uciMove[4] || undefined;

      this._clearHighlights();
      const move = this._game.move({ from, to, promotion: promo || 'q' });
      if (!move) return;

      // Wormhole on engine capture
      if (move.captured && this._isFxOn('wormhole')) {
        this._overlay.fireWormhole(from, to);
      }

      this._board.position(this._game.fen());
      this._highlightMove(from, to);

      if (this._game.game_over()) { this._handleGameOver(); return; }

      const inCheck = this._game.in_check();
      this._setStatus(inCheck ? 'Check! Your move.' : 'Your move.', inCheck ? 'check' : 'active');

      // Universe branches — engine is now idle, show top-3 lines for player's turn
      if (this._isFxOn('universes')) {
        const fenAtEngineMove = this._game.fen();
        const moveCountAtEngineMove = this._game.history().length;
        this._engine.analyze(fenAtEngineMove, preset, (lines) => {
          if (this._isFxOn('universes')) {
            this._universePanel.update(lines, fenAtEngineMove, (univFen, univMoves) => {
              // Fork from a universe card: apply only the FIRST move of the line
              if (!univMoves?.length) return;
              const tempGame = new Chess(fenAtEngineMove);
              const mv = tempGame.move({
                from: univMoves[0].slice(0, 2),
                to:   univMoves[0].slice(2, 4),
                promotion: univMoves[0][4] || 'q',
              });
              if (!mv) return;
              this._spawnFork({
                fen:        tempGame.fen(),
                moveNum:    moveCountAtEngineMove + 1,
                playerSide: this._playerSide,
                label:      `${mv.san} · Move ${moveCountAtEngineMove + 1}`,
              });
            });
          }
        });
      }
    });
  }

  /* ── Game over ────────────────────────────────────────────── */
  _handleGameOver() {
    let msg;
    if      (this._game.in_checkmate())          msg = `Checkmate — ${this._game.turn() === 'w' ? 'Engine' : 'You'} win${this._game.turn() === 'b' ? '' : 's'}!`;
    else if (this._game.in_stalemate())           msg = 'Stalemate — draw.';
    else if (this._game.insufficient_material())  msg = 'Draw — insufficient material.';
    else if (this._game.in_threefold_repetition()) msg = 'Draw — threefold repetition.';
    else                                           msg = 'Game over.';
    this._setStatus(msg, 'over');
    this._universePanel.clear();
    document.getElementById('btn-fork').disabled = true;
  }

  /* ── Square highlights ────────────────────────────────────── */
  _highlightMove(from, to) {
    $(`[data-square="${from}"]`).addClass('highlight-from');
    $(`[data-square="${to}"]`).addClass('highlight-to');
  }
  _clearHighlights() {
    $('.highlight-from, .highlight-to').removeClass('highlight-from highlight-to');
  }

  /* ── UI helpers ───────────────────────────────────────────── */
  _setStatus(msg, type = '') {
    this._elStatus.textContent = msg;
    this._elStatus.className   = ['fork-status', type].filter(Boolean).join(' ');
  }
  _setThinking(on) {
    this._thinking = on;
    this._elThinking.classList.toggle('active', on);
  }

  /* ── Forking ──────────────────────────────────────────────── */
  _spawnFork(opts) {
    if (this._forks.length >= 6) {
      this._setStatus('Max 6 parallel universes open at once.', '');
      setTimeout(() => {
        const check = this._game.in_check();
        this._setStatus(check ? 'Check! Your move.' : 'Your move.', check ? 'check' : 'active');
      }, 2000);
      return;
    }

    const fork = new ForkBoard({
      ...opts,
      onClose:   (id) => { this._forks = this._forks.filter(f => f.id !== id); },
      onFork:    (subOpts) => this._spawnFork(subOpts),
      onPromote: (id) => this._promoteToMain(id),
    });

    this._forks.push(fork);
    const container = document.getElementById('forks-container');
    container.appendChild(fork.element);
    // Trigger enter animation
    requestAnimationFrame(() => fork.element.classList.add('fork-visible'));
  }

  /* ── Promote fork to main universe ───────────────────────── */
  _promoteToMain(id) {
    const fork = this._forks.find(f => f.id === id);
    if (!fork) return;

    const fen        = fork._game.fen();
    const playerSide = fork._playerSide;

    // Tear down every fork instantly (including the promoted one)
    this._forks.forEach(f => f.silentDestroy());
    this._forks = [];

    // Reinitialise main board from the promoted position
    this._newGame({ fen, playerSide });
  }
}

window.addEventListener('DOMContentLoaded', () => new ChessGame());
