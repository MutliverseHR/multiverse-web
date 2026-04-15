/* ─────────────────────────────────────────────────────────────────
   Multiverse Chess — app.js
   chess.js 0.10.x + chessboard.js 1.0.0 + Stockfish 10 Web Worker
   ───────────────────────────────────────────────────────────────── */

'use strict';

/* ── Difficulty presets ─────────────────────────────────────────── */
const DIFFICULTY = {
  easy:   { skillLevel: 2,  depth: 5,  moveTime: null },
  medium: { skillLevel: 8,  depth: 10, moveTime: null },
  hard:   { skillLevel: 18, depth: 15, moveTime: null },
  expert: { skillLevel: 20, depth: null, moveTime: 3000 },
};

/* ── Piece image theme ──────────────────────────────────────────── */
const PIECE_THEME =
  'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/img/chesspieces/wikipedia/{piece}.png';

/* ════════════════════════════════════════════════════════════════
   StockfishEngine — thin UCI wrapper around the Web Worker
   ════════════════════════════════════════════════════════════════ */
class StockfishEngine {
  constructor(onReady) {
    this._ready = false;
    this._onReady = onReady;
    this._onBestMove = null;
    this._worker = new Worker('stockfish-worker.js');
    this._worker.onmessage = (e) => this._handle(e.data);
    this._worker.onerror   = (e) => console.error('Stockfish worker error:', e);
    this._send('uci');
  }

  _send(cmd) { this._worker.postMessage(cmd); }

  _handle(line) {
    if (line === 'uciok') {
      this._send('isready');
      return;
    }
    if (line === 'readyok') {
      this._ready = true;
      this._onReady?.();
      return;
    }
    if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      this._onBestMove?.(parts[1]); // e.g. "e2e4"
    }
  }

  setSkillLevel(level) {
    this._send(`setoption name Skill Level value ${level}`);
  }

  // Call before each new game
  newGame() {
    this._send('ucinewgame');
    this._send('isready');
  }

  // Ask engine for best move given a FEN.
  // preset: one of the DIFFICULTY objects
  getBestMove(fen, preset, callback) {
    this._onBestMove = callback;
    this._send(`position fen ${fen}`);
    if (preset.moveTime) {
      this._send(`go movetime ${preset.moveTime}`);
    } else {
      this._send(`go depth ${preset.depth}`);
    }
  }

  stop() { this._send('stop'); }

  get ready() { return this._ready; }
}

/* ════════════════════════════════════════════════════════════════
   ChessGame — main controller
   ════════════════════════════════════════════════════════════════ */
class ChessGame {
  constructor() {
    this._game       = new Chess();  // chess.js instance
    this._board      = null;         // chessboard.js instance
    this._playerSide = 'w';          // 'w' | 'b'
    this._thinking   = false;
    this._lastFrom   = null;
    this._lastTo     = null;

    // DOM refs
    this._elStatus   = document.getElementById('status');
    this._elHistory  = document.getElementById('history');
    this._elThinking = document.getElementById('thinking');

    // Engine
    this._engine = new StockfishEngine(() => this._onEngineReady());

    // UI events
    document.getElementById('btn-new').addEventListener('click', () => this._newGame());
  }

  /* ── Engine ready ─────────────────────────────────────────── */
  _onEngineReady() {
    this._setStatus('Ready — your move.', 'active');
    this._newGame();
  }

  /* ── New game ─────────────────────────────────────────────── */
  _newGame() {
    if (this._thinking) this._engine.stop();

    this._game = new Chess();
    this._thinking = false;
    this._lastFrom = null;
    this._lastTo   = null;

    const side = document.getElementById('side').value;
    this._playerSide = side === 'white' ? 'w' : 'b';

    const preset = DIFFICULTY[document.getElementById('difficulty').value];
    this._engine.setSkillLevel(preset.skillLevel);
    this._engine.newGame();

    this._clearHighlights();
    this._renderHistory();
    this._setThinking(false);

    if (this._board) {
      this._board.destroy();
    }

    this._board = Chessboard('board', {
      position:    'start',
      draggable:   true,
      orientation: this._playerSide === 'w' ? 'white' : 'black',
      pieceTheme:  PIECE_THEME,
      onDragStart: (src, piece) => this._onDragStart(src, piece),
      onDrop:      (src, tgt)   => this._onDrop(src, tgt),
      onSnapEnd:   ()           => this._board.position(this._game.fen()),
    });

    // If engine plays first (player chose black)
    if (this._playerSide === 'b') {
      this._setStatus('Engine is thinking…');
      this._engineMove();
    } else {
      this._setStatus('Your move.', 'active');
    }
  }

  /* ── Drag callbacks ───────────────────────────────────────── */
  _onDragStart(src, piece) {
    if (this._game.game_over()) return false;
    if (this._thinking) return false;
    // Only allow the human's pieces
    if (this._playerSide === 'w' && piece.search(/^b/) !== -1) return false;
    if (this._playerSide === 'b' && piece.search(/^w/) !== -1) return false;
    if (this._game.turn() !== this._playerSide) return false;
    return true;
  }

  _onDrop(src, tgt) {
    if (src === tgt) return 'snapback';

    this._clearHighlights();

    const move = this._game.move({
      from: src,
      to:   tgt,
      promotion: 'q', // auto-queen; full promotion UI is a future enhancement
    });

    if (!move) return 'snapback';

    this._highlightMove(src, tgt);
    this._renderHistory();

    if (this._game.game_over()) {
      this._handleGameOver();
      return;
    }

    this._setStatus('Engine is thinking…');
    this._setThinking(true);
    // Give the board a tick to finish snapping before engine responds
    setTimeout(() => this._engineMove(), 50);
  }

  /* ── Engine move ──────────────────────────────────────────── */
  _engineMove() {
    const preset = DIFFICULTY[document.getElementById('difficulty').value];
    this._engine.getBestMove(this._game.fen(), preset, (uciMove) => {
      this._setThinking(false);
      if (!uciMove || uciMove === '(none)') return;

      const from  = uciMove.slice(0, 2);
      const to    = uciMove.slice(2, 4);
      const promo = uciMove.slice(4) || undefined;

      this._clearHighlights();
      const move = this._game.move({ from, to, promotion: promo || 'q' });
      if (!move) return;

      this._board.position(this._game.fen());
      this._highlightMove(from, to);
      this._renderHistory();

      if (this._game.game_over()) {
        this._handleGameOver();
        return;
      }

      const statusMsg = this._game.in_check() ? 'Check! Your move.' : 'Your move.';
      this._setStatus(statusMsg, this._game.in_check() ? 'check' : 'active');
    });
  }

  /* ── Game over ────────────────────────────────────────────── */
  _handleGameOver() {
    let msg;
    if (this._game.in_checkmate()) {
      const winner = this._game.turn() === 'w' ? 'Engine' : 'You';
      msg = `Checkmate — ${winner} win${winner === 'You' ? '' : 's'}!`;
    } else if (this._game.in_stalemate()) {
      msg = 'Stalemate — draw.';
    } else if (this._game.insufficient_material()) {
      msg = 'Draw — insufficient material.';
    } else if (this._game.in_threefold_repetition()) {
      msg = 'Draw — threefold repetition.';
    } else {
      msg = 'Game over.';
    }
    this._setStatus(msg, 'over');
  }

  /* ── Square highlights ────────────────────────────────────── */
  _highlightMove(from, to) {
    this._lastFrom = from;
    this._lastTo   = to;
    $(`[data-square="${from}"]`).addClass('highlight-from');
    $(`[data-square="${to}"]`).addClass('highlight-to');
  }

  _clearHighlights() {
    $('.highlight-from, .highlight-to').removeClass('highlight-from highlight-to');
  }

  /* ── Move history ─────────────────────────────────────────── */
  _renderHistory() {
    const hist = this._game.history();
    const pairs = [];
    for (let i = 0; i < hist.length; i += 2) {
      pairs.push({ n: Math.floor(i / 2) + 1, w: hist[i], b: hist[i + 1] || '' });
    }

    this._elHistory.innerHTML = pairs.map((p, idx) => {
      const latest = idx === pairs.length - 1 ? 'latest' : '';
      return `<li class="${latest}">
        <span class="move-num">${p.n}.</span>
        <span class="move-w">${p.w}</span>
        <span class="move-b">${p.b}</span>
      </li>`;
    }).join('');

    // Scroll to bottom
    this._elHistory.scrollTop = this._elHistory.scrollHeight;
  }

  /* ── Helpers ──────────────────────────────────────────────── */
  _setStatus(msg, type = '') {
    this._elStatus.textContent = msg;
    this._elStatus.className   = `status-bar ${type}`.trim();
  }

  _setThinking(on) {
    this._thinking = on;
    this._elThinking.classList.toggle('active', on);
  }
}

/* ── Boot ───────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  new ChessGame();
});
