import { initPanel, watchAppointments, notifyError } from "/js/app.js";
import { esc, brl, fmtTime, stateHTML } from "/js/ui.js";

const ctx = await initPanel({ active: "dashboard" });
if (ctx) {
  const { supabase, shop, tz, user } = ctx;
  const $ = id => document.getElementById(id);
  const STATUS = { confirmed: "Confirmado", completed: "Concluído", cancelled: "Cancelado", no_show: "Faltou" };
  const first = (user.user_metadata?.full_name || "").split(" ")[0];
  $("greeting").textContent = `Olá${first ? ", " + first : ""} 👋 Visão geral da ${shop.name}`;

  const setK = (id, v) => { const el = $(id); el.textContent = v; el.classList.remove("ui-skeleton"); };

  async function load() {
    const { data: d, error } = await supabase.rpc("shop_dashboard", { p_shop_id: shop.id });
    if (error) {
      notifyError(error, "Não foi possível carregar o dashboard.");
      $("todayRows").innerHTML = `<tr><td colspan="5">${stateHTML("error", "Não foi possível carregar os dados.", true)}</td></tr>`;
      $("todayRows").querySelector("[data-retry]").onclick = load;
      return;
    }
    setK("kToday", d.today_total);
    const diff = d.today_total - d.yesterday_total;
    $("kTodaySub").textContent = `${diff >= 0 ? "+" : ""}${diff} comparado a ontem · ${d.upcoming_count} próximos`;
    setK("kRevenue", brl(d.revenue_today));
    setK("kClients", d.clients_total);
    $("kClientsSub").textContent = `${d.clients_month} atendidos neste mês`;
    setK("kServices", d.month_completed);
    $("kTopService").textContent = d.top_service ? `${d.top_service.name} (${d.top_service.count})` : "Sem dados ainda";
    $("kTopPro").textContent = d.top_professional ? `${d.top_professional.name} (${d.top_professional.count})` : "Sem dados ainda";
    $("kLost").textContent = `${d.month_cancelled} cancelados · ${d.month_no_show} faltas`;
    $("fToday").textContent = brl(d.revenue_today);
    $("fWeek").textContent = brl(d.revenue_week);
    $("fMonth").textContent = brl(d.revenue_month);
    $("fExpected").textContent = brl(d.expected_today);

    $("todayRows").innerHTML = d.today_list.length ? d.today_list.map(a => `<tr>
        <td>${fmtTime(a.starts_at, tz)}</td><td>${esc(a.client_name || "Cliente")}</td><td>${esc(a.service_name || "")}</td>
        <td>${esc(a.professional_name || "")}</td><td><span class="status-pill ${a.status}">${STATUS[a.status]}</span></td></tr>`).join("")
      : `<tr><td colspan="5">${stateHTML("empty", "Nenhum agendamento para hoje.")}</td></tr>`;

    $("nextList").innerHTML = d.next_list.length ? d.next_list.map(a => `<a class="client" href="/agendamentos/?appointment=${a.id}" style="text-decoration:none;color:inherit">
        <div class="avatar"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg></div>
        <div><h3>${esc(a.client_name || "Cliente")}</h3><p>${new Date(a.starts_at).toLocaleDateString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" })} ${fmtTime(a.starts_at, tz)} • ${esc(a.service_name || "")}</p></div></a>`).join("")
      : stateHTML("empty", "Nenhum próximo agendamento.");
  }
  await load();
  watchAppointments(shop.id, load);
}
