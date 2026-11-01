import { initPanel, watchAppointments } from "/js/app.js";
import { esc, brl, fmtDate, fmtTime, dateKey, addDays, weekday, setState, stateHTML, errorMessage, toast } from "/js/ui.js";

const ctx = await initPanel({ active: "financeiro" });
if (ctx) {
  const { supabase, shop, tz } = ctx;
  const $ = id => document.getElementById(id);
  const STATUS = { completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou" };
  const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

  function presetRange(p) {
    const today = dateKey(new Date(), tz);
    if (p === "week") { const wd = weekday(today); return [addDays(today, wd === 0 ? -6 : 1 - wd), today]; }
    if (p === "30") return [addDays(today, -29), today];
    if (p === "prev") { const first = today.slice(0, 8) + "01"; const lastPrev = addDays(first, -1); return [lastPrev.slice(0, 8) + "01", lastPrev]; }
    return [today.slice(0, 8) + "01", today];
  }
  function applyPreset() {
    const [f, t] = presetRange($("preset").value);
    if ($("preset").value !== "custom") { $("from").value = f; $("to").value = t; }
  }
  $("preset").onchange = () => { applyPreset(); if ($("preset").value !== "custom") load(); };
  ["from", "to"].forEach(id => $(id).addEventListener("change", () => { $("preset").value = "custom"; }));
  $("periodForm").onsubmit = e => { e.preventDefault(); load(); };

  async function load() {
    const from = $("from").value, to = $("to").value;
    if (!from || !to || from > to) return toast("Período inválido.", "error");
    ["history", "byService", "byPro", "monthly"].forEach(id => setState($(id), "loading"));
    const { data: f, error } = await supabase.rpc("shop_finance", { p_shop_id: shop.id, p_from: from, p_to: to });
    if (error) { ["history", "byService", "byPro", "monthly"].forEach(id => setState($(id), "error", errorMessage(error), load)); return; }
    $("cToday").textContent = brl(f.revenue_today);
    $("cWeek").textContent = brl(f.revenue_week);
    $("cMonth").textContent = brl(f.revenue_month);
    const prev = Number(f.revenue_prev_month);
    $("cMonthSub").textContent = prev > 0 ? `${Number(f.revenue_month) >= prev ? "+" : ""}${Math.round((Number(f.revenue_month) - prev) / prev * 100)}% vs. mês anterior` : "Sem comparação com mês anterior";
    $("cTicket").textContent = brl(f.period.avg_ticket);
    $("pRevenue").textContent = brl(f.period.revenue);
    $("pCount").textContent = f.period.completed;
    $("pExpected").textContent = brl(f.period.expected);
    $("pLost").textContent = `${f.period.cancelled} · ${f.period.no_show}`;

    $("history").innerHTML = f.history.length ? f.history.slice(0, 60).map(a => `<div class="payment"><div><h3>${esc(a.client_name || "Cliente")}</h3>
      <p>${esc(a.service_name || "")} · ${fmtDate(a.starts_at, tz)} ${fmtTime(a.starts_at, tz)}${a.status !== "completed" ? ` <span class="status-pill ${a.status}">${STATUS[a.status]}</span>` : ""}</p></div>
      <strong style="${a.status !== "completed" ? "text-decoration:line-through;opacity:.5" : ""}">${brl(a.price)}</strong></div>`).join("")
      : stateHTML("empty", "Nenhum atendimento finalizado no período.");
    const rank = (list, el) => { el.innerHTML = list.length ? list.map(x => `<div class="service-profit"><span>${esc(x.name)} <small style="color:#94a3b8">(${x.count})</small></span><strong>${brl(x.revenue)}</strong></div>`).join("") : stateHTML("empty", "Sem dados no período."); };
    rank(f.by_service, $("byService"));
    rank(f.by_professional, $("byPro"));

    if (f.monthly.length < 2) { $("monthly").innerHTML = stateHTML("empty", "A evolução aparece quando houver pelo menos dois meses com atendimentos concluídos."); return; }
    const max = Math.max(...f.monthly.map(m => Number(m.revenue)), 1);
    $("monthly").innerHTML = `<div class="bars" role="img" aria-label="Faturamento mensal">${f.monthly.map(m => {
      const [y, mo] = m.month.split("-");
      return `<div class="bar"><b>${brl(m.revenue).replace(",00", "")}</b><i style="height:${Math.max(2, Number(m.revenue) / max * 100)}%"></i><small>${MONTHS[+mo - 1]}/${y.slice(2)}</small></div>`;
    }).join("")}</div>`;
  }

  applyPreset();
  load();
  watchAppointments(shop.id, load, { debounceMs: 1500 });
}
