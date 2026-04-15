/* ─────────────────────────────────────────────────────────────
   Multiverse — interactive D3 force simulation
   ───────────────────────────────────────────────────────────── */

const PALETTE = [
  { core: '#a78bfa', glow: '#7c3aed' },
  { core: '#60a5fa', glow: '#2563eb' },
  { core: '#f472b6', glow: '#db2777' },
  { core: '#34d399', glow: '#059669' },
  { core: '#fbbf24', glow: '#d97706' },
  { core: '#f87171', glow: '#dc2626' },
  { core: '#818cf8', glow: '#4f46e5' },
  { core: '#38bdf8', glow: '#0284c7' },
];

const BASE_COUNT = 18;
const MIN_R = 12;
const MAX_R = 48;

/* ── Starfield ─────────────────────────────────────────────── */
const canvas = document.getElementById('starfield');
const ctx = canvas.getContext('2d');
let stars = [];

function initStars() {
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W; canvas.height = H;
  const count = Math.floor((W * H) / 3000);
  stars = Array.from({ length: count }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: Math.random() * 1.2 + 0.2,
    alpha: Math.random() * 0.6 + 0.1,
    drift: (Math.random() - 0.5) * 0.04,
    twinkle: Math.random() * Math.PI * 2,
    twinkleSpeed: Math.random() * 0.015 + 0.005,
  }));
}

function drawStars() {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  stars.forEach(s => {
    s.twinkle += s.twinkleSpeed;
    s.x += s.drift;
    if (s.x < 0) s.x = W;
    if (s.x > W) s.x = 0;
    const a = s.alpha * (0.6 + 0.4 * Math.sin(s.twinkle));
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fill();
  });
  requestAnimationFrame(drawStars);
}

initStars();
drawStars();

/* ── Universe nodes ────────────────────────────────────────── */
function makeNode(id, W, H) {
  const col = PALETTE[id % PALETTE.length];
  return {
    id,
    r: Math.random() * (MAX_R - MIN_R) + MIN_R,
    color: col,
    x: W * 0.2 + Math.random() * W * 0.6,
    y: H * 0.2 + Math.random() * H * 0.6,
    vx: 0, vy: 0,
    pulseOffset: Math.random() * Math.PI * 2,
  };
}

/* ── SVG setup ─────────────────────────────────────────────── */
const svg = d3.select('#scene');
let W = window.innerWidth, H = window.innerHeight;
svg.attr('viewBox', `0 0 ${W} ${H}`);

// Defs: glow filters
const defs = svg.append('defs');

function filterId(idx) { return `glow-${idx}`; }

PALETTE.forEach((col, idx) => {
  const f = defs.append('filter')
    .attr('id', filterId(idx))
    .attr('x', '-80%').attr('y', '-80%')
    .attr('width', '260%').attr('height', '260%');
  f.append('feGaussianBlur')
    .attr('in', 'SourceGraphic')
    .attr('stdDeviation', 10)
    .attr('result', 'blur');
  f.append('feColorMatrix')
    .attr('in', 'blur')
    .attr('type', 'matrix')
    .attr('values', `0 0 0 0 ${hex2rgb(col.glow)[0]/255}
                     0 0 0 0 ${hex2rgb(col.glow)[1]/255}
                     0 0 0 0 ${hex2rgb(col.glow)[2]/255}
                     0 0 0 1.5 0`)
    .attr('result', 'coloredBlur');
  const merge = f.append('feMerge');
  merge.append('feMergeNode').attr('in', 'coloredBlur');
  merge.append('feMergeNode').attr('in', 'SourceGraphic');
});

// Ring + node groups
const linksGroup = svg.append('g').attr('class', 'links');
const nodesGroup = svg.append('g').attr('class', 'nodes');

/* ── Data ──────────────────────────────────────────────────── */
let nodes = Array.from({ length: BASE_COUNT }, (_, i) => makeNode(i, W, H));
let nextId = BASE_COUNT;
let links = buildLinks(nodes);

function buildLinks(ns) {
  // Sparse random connections between nearby-ish nodes
  const result = [];
  ns.forEach((a, i) => {
    ns.forEach((b, j) => {
      if (j <= i) return;
      const dx = a.x - b.x, dy = a.y - b.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 250 && Math.random() < 0.25) {
        result.push({ source: a.id, target: b.id, id: `${a.id}-${b.id}` });
      }
    });
  });
  return result;
}

/* ── Force simulation ──────────────────────────────────────── */
let sim = d3.forceSimulation(nodes)
  .force('charge', d3.forceManyBody().strength(d => -d.r * 18))
  .force('center', d3.forceCenter(W / 2, H / 2).strength(0.04))
  .force('collide', d3.forceCollide(d => d.r + 20).strength(0.7))
  .force('link', d3.forceLink(links).id(d => d.id).distance(180).strength(0.08))
  .alphaDecay(0.005)
  .velocityDecay(0.4)
  .on('tick', ticked);

/* ── Render ────────────────────────────────────────────────── */
let linkSels, nodeSels, glowSels;

function render() {
  // Links
  const linkData = linksGroup.selectAll('line').data(links, d => d.id);
  linkData.exit().remove();
  linkData.enter().append('line')
    .attr('stroke', 'rgba(255,255,255,0.06)')
    .attr('stroke-width', 1);
  linkSels = linksGroup.selectAll('line');

  // Glow circles (behind)
  const glowData = nodesGroup.selectAll('circle.glow').data(nodes, d => d.id);
  glowData.exit().remove();
  const glowEnter = glowData.enter().append('circle')
    .attr('class', 'glow')
    .attr('fill', d => d.color.glow)
    .attr('opacity', 0.25);
  glowSels = nodesGroup.selectAll('circle.glow');
  glowSels.attr('filter', d => `url(#${filterId(d.id % PALETTE.length)})`);

  // Core circles
  const nodeData = nodesGroup.selectAll('circle.core').data(nodes, d => d.id);
  nodeData.exit()
    .transition().duration(400)
    .attr('r', 0).attr('opacity', 0)
    .remove();

  const nodeEnter = nodeData.enter().append('circle')
    .attr('class', 'core')
    .attr('r', 0)
    .attr('opacity', 0)
    .call(drag(sim));

  nodeEnter.transition().duration(500)
    .attr('r', d => d.r)
    .attr('opacity', 1);

  nodeEnter
    .on('click', onNodeClick)
    .on('mouseenter', onNodeEnter)
    .on('mouseleave', onNodeLeave);

  nodeSels = nodesGroup.selectAll('circle.core');
  nodeSels
    .attr('fill', d => d.color.core)
    .attr('stroke', d => d.color.glow)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', 0.6)
    .attr('cursor', 'pointer');
}

function ticked() {
  const t = Date.now() / 1000;

  if (linkSels) {
    linkSels
      .attr('x1', d => d.source.x)
      .attr('y1', d => d.source.y)
      .attr('x2', d => d.target.x)
      .attr('y2', d => d.target.y);
  }

  if (nodeSels) {
    nodeSels
      .attr('cx', d => d.x)
      .attr('cy', d => d.y);
  }

  if (glowSels) {
    glowSels
      .attr('cx', d => d.x)
      .attr('cy', d => d.y)
      .attr('r', d => {
        const pulse = 1 + 0.12 * Math.sin(t * 1.8 + d.pulseOffset);
        return d.r * pulse * 1.6;
      });
  }
}

/* ── Interaction ───────────────────────────────────────────── */
function onNodeClick(event, d) {
  event.stopPropagation();
  // Spawn a new universe near the clicked one
  const newNode = makeNode(nextId++, W, H);
  newNode.x = d.x + (Math.random() - 0.5) * 80;
  newNode.y = d.y + (Math.random() - 0.5) * 80;
  newNode.vx = (Math.random() - 0.5) * 4;
  newNode.vy = (Math.random() - 0.5) * 4;
  nodes.push(newNode);

  // Maybe link to clicked node
  if (Math.random() < 0.7) {
    links.push({ source: d.id, target: newNode.id, id: `${d.id}-${newNode.id}` });
  }

  ripple(d.x, d.y, d.color.glow);
  refresh();
}

function onNodeEnter(event, d) {
  d3.select(this)
    .transition().duration(200)
    .attr('r', d.r * 1.25)
    .attr('stroke-opacity', 1)
    .attr('stroke-width', 2.5);
}

function onNodeLeave(event, d) {
  d3.select(this)
    .transition().duration(300)
    .attr('r', d.r)
    .attr('stroke-opacity', 0.6)
    .attr('stroke-width', 1.5);
}

// Click on background: gravitational burst
svg.on('click', function(event) {
  if (event.target !== this && event.target.tagName !== 'svg') return;
  const [mx, my] = d3.pointer(event);
  nodes.forEach(n => {
    const dx = n.x - mx, dy = n.y - my;
    const dist = Math.sqrt(dx*dx + dy*dy) || 1;
    const force = 800 / (dist + 80);
    n.vx += (dx / dist) * force * 0.12;
    n.vy += (dy / dist) * force * 0.12;
  });
  sim.alpha(0.4).restart();
  ripple(mx, my, '#7c3aed');
});

// Ripple effect
function ripple(x, y, color) {
  svg.append('circle')
    .attr('cx', x).attr('cy', y)
    .attr('r', 10)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 2)
    .attr('opacity', 0.9)
    .transition().duration(800).ease(d3.easeCubicOut)
    .attr('r', 120)
    .attr('opacity', 0)
    .remove();
}

function drag(simulation) {
  return d3.drag()
    .on('start', (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x; d.fy = d.y;
    })
    .on('drag', (event, d) => {
      d.fx = event.x; d.fy = event.y;
    })
    .on('end', (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null; d.fy = null;
    });
}

function refresh() {
  sim.nodes(nodes);
  sim.force('link').links(links);
  sim.alpha(0.35).restart();
  render();
}

// Initial render
render();

/* ── Resize ────────────────────────────────────────────────── */
window.addEventListener('resize', () => {
  W = window.innerWidth; H = window.innerHeight;
  svg.attr('viewBox', `0 0 ${W} ${H}`);
  sim.force('center', d3.forceCenter(W / 2, H / 2).strength(0.04));
  sim.alpha(0.3).restart();
  initStars();
});

/* ── Helpers ───────────────────────────────────────────────── */
function hex2rgb(hex) {
  const m = hex.replace('#', '').match(/.{2}/g);
  return m.map(x => parseInt(x, 16));
}
