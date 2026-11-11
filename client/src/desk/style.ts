// Estilo da vista "Escritório simples" (client/src/desk/desk.ts), injetado só quando ela abre.
export const CSS = `
body.desk-mode { overflow: auto; background: #1b1c24; }
body.desk-mode #world { display: none; }
.desk-app { min-height: 100vh; color: #e8e6f0; font: 13px/1.45 system-ui, 'Segoe UI', sans-serif; display: flex; flex-direction: column; }
.desk-app .pc { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 10px 18px; padding: 10px 16px; background: #23242f; border-bottom: 1px solid #343647; }
.desk-app .title { display: flex; flex-direction: column; min-width: 110px; }
.desk-app .title strong { font-size: 15px; letter-spacing: .02em; }
.desk-app .title .host { color: #8d8fa3; font-size: 11.5px; }
.desk-app .meter { min-width: 150px; flex: 1; max-width: 260px; }
.desk-app .meter[hidden] { display: none; }
.desk-app .mtop { display: flex; justify-content: space-between; gap: 8px; color: #a7a9bb; font-size: 12px; }
.desk-app .mtop b { color: #f1f0f7; font-weight: 600; }
.desk-app .track { display: block; height: 7px; background: #33354a; border-radius: 6px; overflow: hidden; margin-top: 3px; }
.desk-app .track i { display: block; height: 100%; width: 0; background: #59c27b; border-radius: 6px; transition: width .5s; }
.desk-app .track i.mid { background: #e6b450; }
.desk-app .track i.hi { background: #e5675e; }
.desk-app .plan { display: flex; gap: 12px; }
.desk-app .plan .acc { display: flex; flex-direction: column; gap: 3px; min-width: 120px; }
.desk-app .prow { display: grid; grid-template-columns: 34px 1fr 36px; align-items: center; gap: 6px; font-size: 11.5px; color: #a7a9bb; }
.desk-app .prow .track { margin: 0; }
.desk-app .prow b { color: #f1f0f7; text-align: right; }
.desk-app .full { margin-left: auto; color: #b9bbcc; text-decoration: none; border: 1px solid #3c3e52; border-radius: 8px; padding: 5px 10px; font-size: 12px; white-space: nowrap; }
.desk-app .full:hover { background: #2e3040; color: #fff; }
.desk-app .counts { display: flex; gap: 8px; padding: 12px 16px 0; }
.desk-app .chip { background: #262838; border: 1px solid #343647; border-radius: 99px; padding: 3px 10px; color: #a7a9bb; }
.desk-app .chip b { color: #f1f0f7; }
.desk-app .chip.working b { color: #59c27b; }
.desk-app .chip.waiting { border-color: #7a5a24; background: #3a2e1a; color: #f3d39a; }
.desk-app .chip.waiting b { color: #ffd27a; }
.desk-app .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 14px; padding: 14px 16px 24px; }
.desk-app .empty { color: #8d8fa3; text-align: center; padding: 60px 20px; font-size: 14px; }
.desk-app .empty[hidden] { display: none; }
.desk-app .desk { display: flex; gap: 12px; background: #23242f; border: 1px solid #343647; border-radius: 14px; padding: 10px; overflow: hidden; }
.desk-app .desk[data-status="waiting"] { border-color: #a47a2c; box-shadow: 0 0 0 1px #a47a2c55, 0 0 18px #e6b45022; }
.desk-app .desk[data-status="working"] { border-color: #2f5e3e; }
.desk-app .desk[data-status="idle"] .scene { filter: saturate(.75) brightness(.9); }
.desk-app .desk.sub { background: #20212b; }
.desk-app .scene { flex: none; image-rendering: pixelated; border-radius: 10px; background: #2b2d3b; }
.desk-app .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.desk-app .head { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.desk-app .name { font-weight: 700; font-size: 14.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desk-app .status { flex: none; font-size: 11.5px; padding: 1px 8px; border-radius: 99px; background: #33354a; color: #c9cbdb; }
.desk-app .desk[data-status="working"] .status { background: #234430; color: #9fe3b3; }
.desk-app .desk[data-status="waiting"] .status { background: #4a3818; color: #ffd27a; }
.desk-app .desk[data-status="shell"] .status { background: #23364d; color: #9cc6f2; }
.desk-app .project { color: #8d8fa3; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.desk-app .activity { color: #d6d5e2; min-height: 38px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.desk-app .bars { display: flex; flex-direction: column; gap: 5px; margin-top: auto; }
.desk-app .bar-row { display: grid; grid-template-columns: 54px minmax(60px, 1fr) 58px; align-items: center; gap: 8px; font-size: 12px; color: #a7a9bb; }
.desk-app .bar-row .track { margin: 0; }
.desk-app .bar-row b { color: #f1f0f7; text-align: right; font-variant-numeric: tabular-nums; }
.desk-app .desk.shared .bar-row b { color: #8d8fa3; }
.desk-app .meta { color: #8d8fa3; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-top: 2px; }
@media (max-width: 520px) {
  .desk-app .grid { grid-template-columns: 1fr; padding: 10px; }
  .desk-app .scene { width: 96px !important; height: 108px !important; }
}
`;
