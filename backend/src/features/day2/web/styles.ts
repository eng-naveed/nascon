/** Guest Web Player styles: WCAG 2.1 AA (contrast >= 4.5:1, 48x48 targets, visible focus, reduced motion). */
export const CSS = `
:root{--bg:#0A0F1E;--fg:#F5F7FF;--muted:#B8C0E0;--card:#141B34;--line:#3A4670;--accent:#C8FF3D;--on-accent:#0A0F1E;--err:#FF9DA8}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
header,footer{padding:12px 16px;border-bottom:1px solid var(--line)}
footer{border-top:1px solid var(--line);border-bottom:0;color:var(--muted);margin-top:24px}
.brand{font-weight:800;color:var(--accent);letter-spacing:.04em}
main{max-width:1000px;margin:0 auto;padding:16px;display:grid;gap:16px}
h1{font-size:1.5rem;margin:0}h2{font-size:1.125rem;margin:0 0 8px}
a{color:var(--accent);display:inline-flex;align-items:center;min-height:48px;min-width:48px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.muted{color:var(--muted)}
.grid{display:grid;gap:16px}
@media(min-width:800px){.grid.two{grid-template-columns:2fr 1fr}}
.player{position:relative;background:#000;border-radius:12px;overflow:hidden;aspect-ratio:16/9;min-height:180px;border:1px solid var(--line)}
.player video{width:100%;height:100%;display:block;background:#000}
.placeholder{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:16px;color:var(--fg);background:linear-gradient(135deg,#141B34,#0A0F1E);pointer-events:none}
.placeholder[hidden]{display:none}
.score{font-size:2.5rem;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums}
.teams{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
button,input{font:inherit;min-height:48px;min-width:48px;border-radius:8px}
button{background:var(--accent);color:var(--on-accent);border:2px solid var(--accent);padding:0 16px;font-weight:700;cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border-color:var(--fg)}
input{background:#0A0F1E;color:var(--fg);border:2px solid var(--line);padding:0 12px;width:100%}
label{display:block;margin:8px 0 4px;font-weight:600}
:focus-visible{outline:3px solid #FFFFFF;outline-offset:2px;box-shadow:0 0 0 5px #000}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.chat-log{list-style:none;margin:0;padding:8px;height:260px;overflow-y:auto;background:#0A0F1E;border:1px solid var(--line);border-radius:8px}
.chat-log li{padding:4px 0;border-bottom:1px solid #1E2748;overflow-wrap:anywhere}
.chat-log b{color:var(--accent)}
.chatform{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-top:8px}
.chatform label{grid-column:1/-1;margin:0}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}
.modal-bg[hidden],[hidden]{display:none!important}
.dialog{background:var(--card);border:2px solid var(--accent);border-radius:12px;padding:20px;width:100%;max-width:420px;max-height:100%;overflow:auto}
.err{color:var(--err)}
#cart-status,#auth-error{min-height:1.5em}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
.status-pill{display:inline-block;padding:2px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);font-size:.875rem;text-transform:capitalize}
.status-pill.live{color:var(--on-accent);background:var(--accent);border-color:var(--accent);font-weight:700}
.pin{display:grid;gap:8px}
.pin .price{font-size:1.25rem;font-weight:800}
.cart{display:flex;gap:8px;align-items:center}
.cart-badge{display:inline-flex;min-width:32px;justify-content:center;padding:0 8px;border-radius:999px;background:var(--fg);color:var(--bg);font-weight:800}
.people{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:8px}
.people li{padding:4px 10px;border:1px solid var(--line);border-radius:999px}
.people li.host{border-color:var(--accent);color:var(--accent)}
dl.facts{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0}
dl.facts dt{color:var(--muted)}dl.facts dd{margin:0}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:8px 0;border-bottom:1px solid var(--line)}
.skip{position:absolute;left:-999px}.skip:focus{left:16px;top:8px;z-index:99;background:var(--card);padding:8px}
`;
