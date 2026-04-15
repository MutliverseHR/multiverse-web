'use strict';

/* ─────────────────────────────────────────────────────────────────
   UniversePanel — D3 data-join rendering top-3 Stockfish lines
   as parallel "universe" cards after each engine move.
   ───────────────────────────────────────────────────────────────── */

class UniversePanel {
  constructor(listId) {
    this._el = d3.select(`#${listId}`);
  }

  /* lines:      [{score (centipawns), moves: ['e2e4',…]}, …]
     fen:        position BEFORE the moves in each line
     onFork:     (fen, uciMoves) => void — called when fork ⑂ clicked */
  update(lines, fen, onFork) {
    if (!lines?.length) { this.clear(); return; }

    // Convert UCI → SAN for each universe, keep raw UCI for forking
    const universes = lines.map((line, i) => {
      const game = new Chess(fen);
      const sans = [];
      const ucis = (line.moves || []).slice(0, 5);
      for (const uci of ucis) {
        if (!uci || uci.length < 4) break;
        const mv = game.move({
          from:      uci.slice(0, 2),
          to:        uci.slice(2, 4),
          promotion: uci[4] || 'q',
        });
        if (!mv) break;
        sans.push(mv.san);
      }
      return { id: i + 1, score: line.score, moves: sans, ucis };
    }).filter(u => u.moves.length > 0);

    const cards = this._el.selectAll('.u-card')
      .data(universes, d => d.id);

    cards.exit().transition().duration(200).style('opacity', 0).remove();

    const enter = cards.enter().append('div')
      .attr('class', 'u-card')
      .style('opacity', 0);

    const merged = enter.merge(cards);

    merged.transition().duration(300).style('opacity', 1);

    merged.each(function(d) {
      const raw  = (d.score / 100).toFixed(2);
      const disp = d.score >= 0 ? `+${raw}` : raw;
      const cls  = d.score >  80 ? 'score-good'
                 : d.score < -80 ? 'score-bad'
                 :                 'score-eq';

      const movePills = d.moves.map((m, i) =>
        `<span class="u-move">${m}</span>` +
        (i < d.moves.length - 1 ? '<span class="u-sep">›</span>' : '')
      ).join('');

      d3.select(this).html(`
        <span class="u-id">U${d.id}</span>
        <span class="u-moves">${movePills}</span>
        <span class="u-score ${cls}">${disp}</span>
      `);

      // Entire card forks the universe
      d3.select(this).on('click', onFork ? (event) => {
        event.stopPropagation();
        onFork(fen, d.ucis);
      } : null);
    });
  }

  clear() {
    this._el.selectAll('.u-card')
      .transition().duration(200).style('opacity', 0).remove();
  }
}
