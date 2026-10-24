import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { CampaignReport } from "../rag/campaign-runner.js";
import type { AssistantReply, GuestDetails, GuestFacts } from "./assistant.js";
import type { Interpretation } from "./interpret.js";
import type { ChatMessage } from "./sessions.js";

// Server-rendered chat page: no client-side JavaScript, every value is HTML-escaped by `html`.

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const money = (n: number) => `$${n.toFixed(2)}`;
const ofVisits = (count: number, visits: number) => `${count} of ${visits} visit${visits === 1 ? "" : "s"}`;
const weightWords = (w: number) => (w === 0.5 ? "half" : `${Math.round(w * 100)} in 100`);

function ordersCell(f: GuestFacts): Html {
  if (f.foods.length === 0) return html`drinks &amp; sides only`;
  return html`${f.foods.map(
    (food) => html`<div>${food.group}: ${ofVisits(food.visits, f.visits)}
      <span class="muted">(${food.mains} of ${f.totalMains} mains)</span></div>`,
  )}`;
}

const understoodLine = (i: Interpretation): Html =>
  html`<p class="muted">Understood as: ${i.understood.map((u) => html`<span class="chip">${u}</span>`)}</p>`;

function guestTable(report: CampaignReport, facts: readonly GuestFacts[]): Html {
  const byId = new Map(facts.map((f) => [f.guestId, f]));
  return html`<table>
    <thead><tr><th>#</th><th>Guest</th><th>Ordered</th><th>Avg / visit</th><th>Total</th><th>Largest party</th>
      <th>At happy hour</th><th>Just drinks &amp; sides</th><th>Allergies</th><th>Rank score</th></tr></thead>
    <tbody>${report.audience.recipients.map((r, i) => {
      const f = byId.get(r.guestId);
      return html`<tr><td>${i + 1}</td><td>${r.name}<br /><span class="muted">${r.email}</span></td>
        <td>${f ? ordersCell(f) : "-"}</td><td>${f ? money(f.avgSpendPerVisitUsd) : "-"}</td>
        <td>${f ? money(f.totalSpendUsd) : "-"}</td><td>${f?.maxPartySize ?? "-"}</td>
        <td>${f ? ofVisits(f.happyHourVisits, f.visits) : "-"}</td><td>${f ? ofVisits(f.chillVisits, f.visits) : "-"}</td>
        <td>${f && f.allergies.length > 0 ? f.allergies.join(", ") : "none"}</td><td>${r.score}</td></tr>`;
    })}</tbody></table>`;
}

const excludedBlock = (report: CampaignReport): Html =>
  report.excludedForAllergy.count === 0
    ? html``
    : html`<p class="warn">Left out for allergies (${report.excludedForAllergy.count}):
        ${report.excludedForAllergy.guests.map((g) => html`<span class="chip">${g.name}: ${g.allergies.join(", ")}</span>`)}</p>`;

const traceBlock = (report: CampaignReport): Html => html`<details><summary>How the RAG got here</summary><ol>
  ${report.trace.map((t) => html`<li><b>${t.step}</b> (${t.ms} ms): ${t.detail}</li>`)}
  <li>Ranked ${weightWords(report.ranking.semanticWeight)} by how closely their history reads like your request,
    ${weightWords(1 - report.ranking.semanticWeight)} by how strongly they match it
    (${report.ranking.intentSignals.join(", ") || "no extra signal"}).</li></ol></details>`;

const draftBlock = (report: CampaignReport): Html =>
  report.draft.status === "drafted"
    ? html`<details open><summary>Email draft (DeepSeek)</summary><pre>${report.draft.copy}</pre></details>`
    : html`<details><summary>Email draft: ${report.draft.status} (${report.draft.note})</summary>
        <p class="muted">The exact prompt the RAG would send to DeepSeek (no names, contacts or allergies):</p>
        <pre>${report.draft.prompt}</pre></details>`;

function guestCard(g: GuestDetails): Html {
  const f = g.facts;
  return html`<div class="offer"><h3>${g.name}</h3>
      <p>${g.email} · ${g.phone}</p>
      <p class="${g.allergies.length > 0 ? "warn" : "muted"}">Allergies: ${g.allergies.length > 0 ? g.allergies.join(", ") : "none"}</p></div>
    <ul>
      <li>${f.visits} visit${f.visits === 1 ? "" : "s"}, last on ${g.lastVisit}</li>
      <li>Spent ${money(f.totalSpendUsd)} in total, ${money(f.avgSpendPerVisitUsd)} per visit; largest party ${f.maxPartySize}</li>
      <li>At happy hour: ${ofVisits(f.happyHourVisits, f.visits)} · Just drinks &amp; sides: ${ofVisits(f.chillVisits, f.visits)}</li>
      <li>Ordered: ${ordersCell(f)}</li>
    </ul>
    <p><b>Invoices</b> (newest first)</p>
    <table><thead><tr><th>Invoice</th><th>When</th><th>Branch</th><th>Where</th><th>Party</th><th>Ordered</th><th>Total</th></tr></thead>
      <tbody>${g.invoices.map(
        (i) => html`<tr><td>${i.id}</td><td>${i.date} ${i.time}</td><td>${i.branch}</td><td>${i.diningArea}</td>
          <td>${i.partySize}</td><td>${i.lines.map((l) => `${l.quantity}x ${l.item}`).join(", ")}</td><td>${money(i.totalUsd)}</td></tr>`,
      )}</tbody></table>`;
}

function renderReply(reply: AssistantReply): Html {
  if (reply.kind === "help") {
    return html`<p>I can find guests, design campaigns, or show everything about a guest you name. Try one of these:</p>
      <ul>${reply.examples.map((e) => html`<li>${e}</li>`)}</ul>`;
  }
  if (reply.kind === "guest") return html`${reply.guests.map(guestCard)}`;
  if (reply.kind === "list") {
    const n = reply.report.audience.count;
    return html`${understoodLine(reply.interpretation)}
      <p><b>${n === 0 ? "Nobody matches." : `${n} guest(s) match:`}</b></p>
      ${n > 0 ? guestTable(reply.report, reply.facts) : html``}${traceBlock(reply.report)}`;
  }
  if (!reply.proposal || !reply.report) {
    return html`${understoodLine(reply.interpretation)}<p><b>Nobody matches that request</b>, so there is no campaign to plan.</p>`;
  }
  const { proposal: p, report } = reply;
  return html`${understoodLine(reply.interpretation)}
    <div class="offer"><h3>${p.title}</h3>
      <p class="price">${money(p.priceUsd)} <s>${money(p.menuPriceUsd)}</s> <span class="save">save ${money(p.savingUsd)}</span></p>
      <p>${p.bundle.map((l) => `${l.quantity}x ${l.item}`).join(" + ")}</p>
      <p class="muted">${p.timing}, dine-in · bundle for ${p.partySize}</p></div>
    <p><b>Why this offer</b></p><ul>${p.evidence.map((e) => html`<li>${e}</li>`)}</ul>
    ${excludedBlock(report)}
    <p><b>Invite these ${report.audience.count} guest(s)</b>, best fit first:</p>
    ${report.audience.count > 0 ? guestTable(report, reply.facts) : html`<p>Everyone who matched is allergic to this bundle.</p>`}
    ${draftBlock(report)}${traceBlock(report)}`;
}

function renderMessage(message: ChatMessage, isLast: boolean): Html {
  const anchor = isLast ? "latest" : "";
  if (message.role === "user") return html`<div class="msg user" id="${anchor}"><p>${message.text}</p></div>`;
  if (message.role === "error") return html`<div class="msg error" id="${anchor}"><p>${message.text}</p></div>`;
  return html`<div class="msg bot" id="${anchor}">${renderReply(message.reply)}</div>`;
}

const exampleButton = (prompt: string): Html =>
  html`<form method="post" action="/chat"><input type="hidden" name="prompt" value="${prompt}" /><button class="chip">${prompt}</button></form>`;

const STYLES = html`<style>
  :root { --bg:#f6f5f2; --panel:#fff; --text:#1d1d1b; --muted:#6b6a66; --accent:#9a3412; --user:#fde8d7; --line:#e4e1da; --warn:#fff4e5; }
  @media (prefers-color-scheme: dark) { :root { --bg:#161513; --panel:#201f1c; --text:#ece9e2; --muted:#a39f96; --accent:#fb923c; --user:#3a2a1d; --line:#34322d; --warn:#3a2f1c; } }
  * { box-sizing:border-box } body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif }
  header { padding:12px 16px; border-bottom:1px solid var(--line); background:var(--panel); display:flex; justify-content:space-between; align-items:center }
  header h1 { font-size:16px; margin:0 } main { max-width:1000px; margin:0 auto; padding:16px 16px 140px }
  .msg { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin:12px 0; overflow-x:auto }
  .msg.user { background:var(--user); margin-left:20%; } .msg.error { background:var(--warn) }
  .muted { color:var(--muted); font-size:13px } .warn { background:var(--warn); padding:8px; border-radius:8px }
  .chip { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:2px 10px; margin:2px; background:var(--panel); color:var(--text); font-size:13px; cursor:pointer }
  .offer { border:2px solid var(--accent); border-radius:12px; padding:8px 16px } .offer h3 { margin:4px 0; color:var(--accent) }
  .price { font-size:22px; font-weight:700; margin:4px 0 } .price s { font-size:15px; color:var(--muted) } .save { font-size:14px; color:var(--accent) }
  table { border-collapse:collapse; width:100%; font-size:13px } th, td { border-bottom:1px solid var(--line); padding:6px; text-align:left; vertical-align:top }
  pre { white-space:pre-wrap; background:var(--bg); padding:8px; border-radius:8px; font-size:12px }
  form { display:inline } .composer { position:fixed; bottom:0; left:0; right:0; background:var(--panel); border-top:1px solid var(--line); padding:12px 16px }
  .composer form { display:flex; gap:8px; max-width:1000px; margin:0 auto }
  .composer input { flex:1; padding:10px 12px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--text); font-size:15px }
  button.send { padding:10px 18px; border-radius:10px; border:0; background:var(--accent); color:#fff; font-weight:600; cursor:pointer }
  .examples { max-width:1000px; margin:6px auto 0 }
</style>`;

export function renderChatPage(messages: readonly ChatMessage[], examples: readonly string[], banner?: string): Html {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" /><title>ResortOS Campaign Chat</title>${STYLES}</head>
    <body><header><div><h1>ResortOS · Campaign RAG chat</h1>${banner ? html`<span class="muted">${banner}</span>` : ""}</div>
      <form method="post" action="/chat/reset"><button class="chip">New chat</button></form></header>
    <main>${
      messages.length === 0
        ? html`<div class="msg bot"><p>Hi! Ask me who your guests are, or ask me to design a campaign. I read the invoices,
            find the right guests, never offer anyone a dish they're allergic to, and price offers from the menu.</p></div>`
        : messages.map((m, i) => renderMessage(m, i === messages.length - 1))
    }</main>
    <div class="composer"><form method="post" action="/chat">
      <input name="prompt" maxlength="500" required autofocus placeholder="e.g. create a marketing campaign for non seafood fans" />
      <button class="send">Send</button></form>
      <div class="examples">${examples.map(exampleButton)}</div></div>
    </body></html>`;
}
