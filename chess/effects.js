'use strict';

/* ─────────────────────────────────────────────────────────────────
   ChessOverlay — D3 SVG layer sitting on top of the chessboard
   Handles: Quantum Halos + Wormhole Captures
   ───────────────────────────────────────────────────────────────── */

const BOARD_LIGHT = '#e8e0f4';   // light square colour
const BOARD_DARK  = '#5b3fa0';   // dark square colour

const HALO = {
  capture: { dot: '#f59e0b', glow: '#fbbf24' },
  check:   { dot: '#ef4444', glow: '#f87171' },
};

// Returns the contrasting board colour for a given square name
function haloNormalColor(sqName) {
  const file = sqName.charCodeAt(0) - 97;   // a=0 … h=7
  const rank = parseInt(sqName[1]) - 1;     // 1=0 … 8=7
  const isLight = (file + rank) % 2 === 1;
  return isLight
    ? { dot: BOARD_DARK,  glow: BOARD_DARK  }
    : { dot: BOARD_LIGHT, glow: BOARD_LIGHT };
}

const WORM_COLORS = ['#a78bfa', '#818cf8', '#60a5fa', '#f472b6', '#34d399', '#fbbf24'];

class ChessOverlay {
  constructor(boardEl, wrapEl) {
    this._boardEl = boardEl;
    this._wrapEl  = wrapEl;
    this._halosG  = null;
    this._wormG   = null;
    this._svg     = null;
    this._init();
    this._resizeFn = () => this._position();
    window.addEventListener('resize', this._resizeFn);
  }

  destroy() {
    window.removeEventListener('resize', this._resizeFn);
    this._svg?.remove();
  }

  _init() {
    // Unique filter ID so multiple overlays don't collide
    this._filterId = `halo-glow-${Math.random().toString(36).slice(2, 8)}`;

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgEl.classList.add('d3-overlay');
    this._wrapEl.appendChild(svgEl);
    this._svg = d3.select(svgEl);

    // Glow filter for halos
    const defs = this._svg.append('defs');
    const f = defs.append('filter').attr('id', this._filterId)
      .attr('x', '-60%').attr('y', '-60%').attr('width', '220%').attr('height', '220%');
    f.append('feGaussianBlur')
      .attr('in', 'SourceGraphic').attr('stdDeviation', '6').attr('result', 'blur');
    const merge = f.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    this._halosG = this._svg.append('g');
    this._wormG  = this._svg.append('g');

    this._position();
  }

  _position() {
    const boardEl = this._boardEl;
    const wrapEl  = this._wrapEl;
    if (!boardEl || !wrapEl) return;
    const br = boardEl.getBoundingClientRect();
    const wr = wrapEl.getBoundingClientRect();
    this._svg
      .style('position', 'absolute')
      .style('top',  `${br.top  - wr.top}px`)
      .style('left', `${br.left - wr.left}px`)
      .style('pointer-events', 'none')
      .style('z-index', '10')
      .attr('width',  br.width)
      .attr('height', br.height);
  }

  // Returns {cx, cy, size} for a square name, relative to the board element
  _sq(name) {
    const el = this._boardEl.querySelector(`[data-square="${name}"]`);
    if (!el) return null;
    const br = this._boardEl.getBoundingClientRect();
    const sr = el.getBoundingClientRect();
    return {
      cx: sr.left - br.left + sr.width  / 2,
      cy: sr.top  - br.top  + sr.height / 2,
      size: sr.width,
    };
  }

  /* ── Quantum Halos ─────────────────────────────────────────── */
  showHalos(moves) {
    this.clearHalos();

    moves.forEach(move => {
      const pos = this._sq(move.to);
      if (!pos) return;

      const isCapture = move.flags.includes('c') || move.flags.includes('e');
      const isCheck   = move.san && move.san.includes('+');
      const col = isCheck ? HALO.check : isCapture ? HALO.capture : haloNormalColor(move.to);

      if (isCapture && !isCheck) {
        // Spinning dashed ring around the target piece
        const r0 = pos.size * 0.43;
        const ring = this._halosG.append('circle')
          .attr('cx', pos.cx).attr('cy', pos.cy)
          .attr('r', r0 + 6)
          .attr('fill', 'none')
          .attr('stroke', col.glow)
          .attr('stroke-width', 2.5)
          .attr('stroke-dasharray', '5 3')
          .attr('filter', `url(#${this._filterId})`)
          .attr('opacity', 0);

        ring.transition().duration(200).attr('opacity', 0.9).attr('r', r0);

        let angle = 0;
        const spin = d3.timer(() => {
          if (!ring.node()?.parentNode) { spin.stop(); return; }
          angle += 1.8;
          ring.attr('transform', `rotate(${angle},${pos.cx},${pos.cy})`);
        });
        ring.node().__spin = spin;

      } else {
        // Glowing dot for normal / check moves
        const r = pos.size * (isCheck ? 0.22 : 0.2);

        // outer glow
        this._halosG.append('circle')
          .attr('cx', pos.cx).attr('cy', pos.cy).attr('r', 0)
          .attr('fill', col.glow).attr('opacity', 0)
          .attr('filter', `url(#${this._filterId})`)
          .transition().duration(220).ease(d3.easeBackOut.overshoot(1.5))
          .attr('r', r * 3.2).attr('opacity', 0.55);

        // solid dot
        this._halosG.append('circle')
          .attr('cx', pos.cx).attr('cy', pos.cy).attr('r', 0)
          .attr('fill', col.dot).attr('opacity', 0)
          .transition().duration(220).ease(d3.easeBackOut.overshoot(1.5))
          .attr('r', r).attr('opacity', 1);
      }
    });
  }

  clearHalos() {
    this._halosG.selectAll('circle').each(function() {
      this.__spin?.stop();
    });
    this._halosG.selectAll('*').interrupt()
      .transition().duration(100).attr('opacity', 0).remove();
  }

  /* ── Wormhole Capture ──────────────────────────────────────── */
  fireWormhole(fromSq, toSq) {
    const from = this._sq(fromSq);
    const to   = this._sq(toSq);
    if (!from || !to) return;

    const N = 60;
    const particles = d3.range(N).map(i => ({
      i,
      // stagger: particle i starts when t = -i/N * 0.85
      t:      -(i / N) * 0.85,
      speed:  0.018 + Math.random() * 0.01,
      perp:   (Math.random() - 0.5) * from.size * 0.85,
      size:   1.5 + Math.random() * 2.5,
      color:  WORM_COLORS[i % WORM_COLORS.length],
    }));

    const circles = this._wormG.selectAll('.wh')
      .data(particles, d => d.i)
      .enter().append('circle')
      .attr('class', 'wh')
      .attr('cx', from.cx).attr('cy', from.cy)
      .attr('r', 0).attr('opacity', 0);

    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    const nx = -dy / len;   // unit perpendicular
    const ny =  dx / len;

    const nodes = circles.nodes();

    const timer = d3.timer(() => {
      let living = false;

      particles.forEach((p, idx) => {
        p.t = Math.min(p.t + p.speed, 1);
        if (p.t <= 0) return;
        living = true;

        const t    = p.t;
        const ease = d3.easeCubicIn(t);
        // arc perpendicular to travel direction, peaks at mid-journey
        const arc  = Math.sin(t * Math.PI) * p.perp;
        const x    = from.cx + dx * ease + nx * arc;
        const y    = from.cy + dy * ease + ny * arc;
        const op   = t < 0.65 ? 0.88 : Math.max(0, (1 - t) / 0.35 * 0.88);
        const r    = p.size * (t < 0.78 ? 1 : Math.max(0, (1 - t) / 0.22));

        d3.select(nodes[idx])
          .attr('cx', x).attr('cy', y)
          .attr('r',  Math.max(0, r))
          .attr('opacity', Math.max(0, op))
          .attr('fill', p.color);
      });

      if (!living) {
        timer.stop();
        this._wormG.selectAll('.wh').remove();
      }
    });
  }

  reposition() { this._position(); }
}
