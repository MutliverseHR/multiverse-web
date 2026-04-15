// Loads Stockfish 10 (pure JS/asm.js — no WASM, no SharedArrayBuffer needed).
// In a Web Worker context, stockfish.js auto-wires self.onmessage ↔ UCI stdio.
importScripts('https://cdn.jsdelivr.net/npm/stockfish@10.0.2/stockfish.js');
