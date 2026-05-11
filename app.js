const STORAGE_KEY = "fuel-ledger-pages-v2";
const SETTINGS_KEY = "fuel-ledger-settings-v1";
const ENTRY_DRAFT_KEY = "fuel-ledger-entry-drafts-v1";
const ISSUE_URL = "https://github.com/mkoltsov/fuelio/issues/new";
const CHART_METRICS = ["spend", "price", "liters", "consumption", "odometer"];
const GALLON_TO_LITER = 3.785411784;
const MILE_TO_KM = 1.609344;
const CURRENCY_SYMBOL = "$";
const VEHICLE_MODEL_YEAR = 2009;
const VEHICLE_VALUE_REFERENCE = {
  date: "2026-05-11",
  odometer: 118468,
  expectedAnnualMiles: 12000,
  annualDepreciation: 160,
  privateLow: 4000,
  privateHigh: 5200,
  tradeLow: 1700,
  tradeHigh: 3075,
  instantOfferLow: 1300,
  instantOfferHigh: 3000,
  mileageCreditCap: 900,
  mileageCreditPerMile: 0.012,
};

const state = {
  fuel: [],
  maintenance: [],
  reminders: [],
  schedule: [],
  chartMetric: "consumption",
};

const el = (id) => document.getElementById(id);

function parseCSV(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const n = text[i + 1];
    if (inQuotes) {
      if (c === '"' && n === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const headers = (rows.shift() || []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => String(v).trim()))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function toCSV(rows, headers) {
  const escape = (value) => {
    const s = String(value ?? "");
    return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((row) => headers.map((h) => escape(row[h])).join(","))].join("\n");
}

function number(value) {
  const n = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function money(value) {
  return `${CURRENCY_SYMBOL}${number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function signedMoney(value) {
  const n = number(value);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${money(Math.abs(n))}`;
}

function moneyEstimate(value) {
  return `${CURRENCY_SYMBOL}${Math.round(number(value)).toLocaleString()}`;
}

function moneyRange(low, high) {
  const lo = Math.round(number(low));
  const hi = Math.round(number(high));
  if (!lo && !hi) return "$0";
  if (lo === hi || !hi) return moneyEstimate(lo || hi);
  return `${moneyEstimate(lo)}-${moneyEstimate(hi)}`;
}

function litersFromGallons(value) {
  return number(value) * GALLON_TO_LITER;
}

function kmFromMiles(value) {
  return number(value) * MILE_TO_KM;
}

function formatLiters(value) {
  return `${number(value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} L`;
}

function formatFuelVolume(gallonsValue) {
  return formatLiters(litersFromGallons(gallonsValue));
}

function formatOdometer(value) {
  const n = number(value);
  return n ? `${Math.round(n).toLocaleString()} mi` : "";
}

function formatKm(value) {
  return `${number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} km`;
}

function formatConsumption(value) {
  const n = number(value);
  return n ? `${n.toFixed(1)} L/100 km` : "";
}

function formatPricePerLiter(value) {
  return number(value) ? `${money(value)}/L` : "";
}

function formatDays(value) {
  const n = number(value);
  return n ? `${n.toFixed(1)} days` : "";
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function safeDate(value) {
  const date = new Date(`${dateOnly(value)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(start, end) {
  const a = safeDate(start);
  const b = safeDate(end);
  return a && b ? (b - a) / 86400000 : 0;
}

function yearsBetween(start, end) {
  return daysBetween(start, end) / 365.25;
}

function formatMonth(value) {
  const date = safeDate(`${value}-01`);
  return date ? date.toLocaleDateString(undefined, { month: "short", year: "2-digit" }) : value;
}

function chartTooltip() {
  let tooltip = el("chartTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "chartTooltip";
    tooltip.className = "chartTooltip";
    tooltip.setAttribute("role", "status");
    document.body.append(tooltip);
  }
  return tooltip;
}

function hideChartTooltip() {
  const tooltip = el("chartTooltip");
  if (tooltip) tooltip.classList.remove("visible");
}

function tooltipHtml(point) {
  const lines = point.lines || [];
  return [
    `<strong>${point.title || ""}</strong>`,
    ...lines.map((line) => `<span>${line}</span>`),
  ].join("");
}

function positionChartTooltip(event, tooltip) {
  const gap = 14;
  const rect = tooltip.getBoundingClientRect();
  let left = event.clientX + gap;
  let top = event.clientY + gap;
  if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - gap;
  if (top + rect.height > window.innerHeight - 8) top = event.clientY - rect.height - gap;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top = `${Math.max(8, top)}px`;
}

function hitChartPoint(point, x, y) {
  if (point.type === "rect") {
    return x >= point.x && x <= point.x + point.w && y >= point.y && y <= point.y + point.h;
  }
  const radius = point.radius || 9;
  return Math.hypot(x - point.x, y - point.y) <= radius;
}

function nearestChartPoint(points, x, y) {
  const hits = points.filter((point) => hitChartPoint(point, x, y));
  if (!hits.length) return null;
  return hits.sort((a, b) => {
    const ax = a.type === "rect" ? a.x + a.w / 2 : a.x;
    const ay = a.type === "rect" ? a.y + a.h / 2 : a.y;
    const bx = b.type === "rect" ? b.x + b.w / 2 : b.x;
    const by = b.type === "rect" ? b.y + b.h / 2 : b.y;
    return Math.hypot(x - ax, y - ay) - Math.hypot(x - bx, y - by);
  })[0];
}

function bindChartTooltip(canvas) {
  if (canvas.dataset.tooltipBound === "1") return;
  canvas.dataset.tooltipBound = "1";
  canvas.addEventListener("mousemove", (event) => {
    const points = canvas.__chartPoints || [];
    if (!points.length) {
      hideChartTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const point = nearestChartPoint(points, event.clientX - rect.left, event.clientY - rect.top);
    if (!point) {
      hideChartTooltip();
      canvas.style.cursor = "";
      return;
    }
    const tooltip = chartTooltip();
    tooltip.innerHTML = tooltipHtml(point);
    tooltip.classList.add("visible");
    positionChartTooltip(event, tooltip);
    canvas.style.cursor = "crosshair";
  });
  canvas.addEventListener("mouseleave", () => {
    hideChartTooltip();
    canvas.style.cursor = "";
  });
}

function registerChartPoints(canvas, points) {
  if (!canvas) return;
  canvas.__chartPoints = points || [];
  bindChartTooltip(canvas);
}

function pricePerLiterFor(record) {
  const litersValue = litersFromGallons(record.gallons);
  return litersValue ? number(record.cost) / litersValue : 0;
}

function isCostcoFuel(record) {
  return /costco/i.test(`${record.source || ""} ${record.tags || ""} ${record.notes || ""}`);
}

function fuelWithEconomy() {
  const rows = state.fuel
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((record) => ({ record, odometer: number(record.odometer), gallons: number(record.gallons), liters: litersFromGallons(record.gallons), consumption: 0, km: 0 }));
  let previous = null;
  for (const row of rows) {
    const full = row.record.partial_fuelup !== "1" && row.record.missed_fuelup !== "1";
    const valid = row.odometer > 0 && row.gallons > 0 && full;
    if (valid && previous && row.odometer > previous.odometer) {
      row.km = kmFromMiles(row.odometer - previous.odometer);
      row.consumption = row.km ? (row.liters / row.km) * 100 : 0;
    }
    if (valid) previous = row;
  }
  return rows;
}

function consumptionForRecord(record, economyRows = fuelWithEconomy()) {
  const row = economyRows.find((entry) => entry.record === record);
  return row && row.consumption ? row.consumption : 0;
}

function normalizeFuel(record) {
  return {
    date: record.date || record.fuelup_date || "",
    odometer: record.odometer || "",
    gallons: record.gallons || "",
    cost: record.cost || (number(record.gallons) * number(record.price)).toFixed(2),
    notes: record.notes || "",
    tags: record.tags || "",
    partial_fuelup: record.partial_fuelup || "0",
    missed_fuelup: record.missed_fuelup || "0",
    source: record.source || "",
    fuelio_unique_id: record.fuelio_unique_id || "",
  };
}

function normalizeSchedule(row) {
  return {
    ...row,
    first_due_miles: Math.round(number(row.first_due_miles)),
    repeat_miles: Math.round(number(row.repeat_miles)),
    cost_low: number(row.cost_low),
    cost_high: number(row.cost_high),
    billable: String(row.billable) === "1",
  };
}

function updateStorageStatus(message) {
  document.querySelectorAll(".entryStatus").forEach((node) => {
    node.textContent = message;
  });
}

function writeLocalStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    updateStorageStatus("Browser storage is blocked");
    return false;
  }
}

function readJSONStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applySettings(data) {
  if (!data || typeof data !== "object") return;
  if (CHART_METRICS.includes(data.chartMetric)) state.chartMetric = data.chartMetric;
}

function saveSettings() {
  const saved = writeLocalStorage(SETTINGS_KEY, JSON.stringify({ chartMetric: state.chartMetric }));
  return saved;
}

function loadSavedSettings() {
  const data = readJSONStorage(SETTINGS_KEY);
  applySettings(data);
  return Boolean(data);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function save() {
  return true;
}

function loadSaved() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Published data should still load even when browser storage is unavailable.
  }
  return false;
}

async function loadSeedData() {
  const fetchFirst = async (paths) => {
    for (const path of paths) {
      const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
      if (response.ok) return response.text();
    }
    throw new Error(`Missing data file: ${paths.join(" or ")}`);
  };
  const [fuelText, maintenanceText, remindersText, scheduleText] = await Promise.all([
    fetchFirst(["data/fuel.csv"]),
    fetch(`data/maintenance.csv?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text()).catch(() => "date,odometer,service,category,cost,vendor,notes\n"),
    fetch(`data/reminders.csv?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text()).catch(() => "title,category,due_date,due_odometer,interval_days,interval_miles,notes\n"),
    fetch(`data/maintenance_schedule.csv?v=${Date.now()}`, { cache: "no-store" }).then((r) => r.text()).catch(() => "procedure,action,first_due_miles,repeat_miles,condition,cost_low,cost_high,cost_note,billable\n"),
  ]);
  state.fuel = parseCSV(fuelText).map(normalizeFuel);
  state.maintenance = parseCSV(maintenanceText);
  state.reminders = parseCSV(remindersText);
  state.schedule = parseCSV(scheduleText).map(normalizeSchedule);
}

function metrics() {
  const fuel = state.fuel.filter((r) => number(r.gallons) || number(r.cost));
  const totalCost = fuel.reduce((sum, r) => sum + number(r.cost), 0);
  const totalGallons = fuel.reduce((sum, r) => sum + number(r.gallons), 0);
  const totalLiters = litersFromGallons(totalGallons);
  const prices = fuel.map(pricePerLiterFor).filter(Boolean);
  const economy = fuelWithEconomy().filter((r) => r.consumption > 0);
  const economyKm = economy.reduce((sum, r) => sum + r.km, 0);
  const economyLiters = economy.reduce((sum, r) => sum + r.liters, 0);
  const sortedDates = fuel.map((r) => dateOnly(r.date)).filter(Boolean).sort();
  const latest = fuel.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const latestOdometer = fuel
    .filter((r) => number(r.odometer) > 0)
    .sort((a, b) => number(b.odometer) - number(a.odometer))[0];
  const missingOdometer = fuel.filter((r) => !number(r.odometer)).length;
  return {
    count: fuel.length,
    totalCost,
    totalGallons,
    totalLiters,
    averagePrice: totalLiters ? totalCost / totalLiters : 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    avgConsumption: economyKm ? (economyLiters / economyKm) * 100 : 0,
    economyCount: economy.length,
    economyKm,
    missingOdometer,
    start: sortedDates[0] || "",
    end: sortedDates.at(-1) || "",
    latest,
    latestOdometer,
  };
}

function maintenanceMetrics() {
  const rows = state.maintenance.filter((r) => number(r.cost));
  const totalCost = rows.reduce((sum, r) => sum + number(r.cost), 0);
  const latest = rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return {
    count: rows.length,
    totalCost,
    latest,
  };
}

function currentOdometer() {
  return number(metrics().latestOdometer?.odometer);
}

function occurrenceMiles(row, odometer, lookBehind = 5000, lookAhead = 10000) {
  const first = number(row.first_due_miles);
  const repeat = number(row.repeat_miles);
  if (!first || !odometer) return [];
  const min = Math.max(0, odometer - lookBehind);
  const max = odometer + lookAhead;
  if (!repeat) return first >= min && first <= max ? [first] : [];
  let due = first;
  if (min > first) {
    due = first + Math.floor((min - first) / repeat) * repeat;
  }
  while (due < min) due += repeat;
  const miles = [];
  while (due <= max) {
    miles.push(due);
    due += repeat;
  }
  return miles;
}

function scheduleStatus(dueMiles, odometer) {
  const delta = Math.round(dueMiles - odometer);
  if (delta <= 0) return { label: "Verify", detail: `${Math.abs(delta).toLocaleString()} mi past` };
  if (delta <= 2000) return { label: "Approaching", detail: `${delta.toLocaleString()} mi left` };
  return { label: "Upcoming", detail: `${delta.toLocaleString()} mi left` };
}

function scheduleOccurrences({ standardOnly = true, lookBehind = 5000, lookAhead = 10000 } = {}) {
  const odometer = currentOdometer();
  const rows = standardOnly ? state.schedule.filter((row) => row.condition === "Standard") : state.schedule;
  return rows.flatMap((row) => occurrenceMiles(row, odometer, lookBehind, lookAhead).map((dueMiles) => ({
    row,
    dueMiles,
    status: scheduleStatus(dueMiles, odometer),
  }))).sort((a, b) => a.dueMiles - b.dueMiles || a.row.procedure.localeCompare(b.row.procedure));
}

function scheduleGroups() {
  const groups = new Map();
  for (const item of scheduleOccurrences({ standardOnly: true })) {
    if (!groups.has(item.dueMiles)) groups.set(item.dueMiles, []);
    groups.get(item.dueMiles).push(item);
  }
  return [...groups.entries()].map(([dueMiles, items]) => {
    const billable = items.filter((item) => item.row.billable);
    return {
      dueMiles,
      items,
      status: items[0]?.status || { label: "Upcoming", detail: "" },
      costLow: billable.reduce((sum, item) => sum + number(item.row.cost_low), 0),
      costHigh: billable.reduce((sum, item) => sum + number(item.row.cost_high), 0),
    };
  }).sort((a, b) => a.dueMiles - b.dueMiles);
}

function nextScheduleGroup() {
  const odometer = currentOdometer();
  return scheduleGroups().find((group) => group.dueMiles >= odometer) || scheduleGroups()[0];
}

function scheduleCostLabel(row) {
  const range = moneyRange(row.cost_low, row.cost_high);
  if (row.billable) return range;
  return number(row.cost_high) ? `${range} if separate` : "Usually bundled";
}

function monthlyData() {
  const buckets = new Map();
  const economyByRecord = new Map(fuelWithEconomy().map((row) => [row.record, row]));
  for (const record of state.fuel) {
    const month = dateOnly(record.date).slice(0, 7);
    if (!month) continue;
    if (!buckets.has(month)) buckets.set(month, { month, spend: 0, liters: 0, count: 0, economyKm: 0, economyLiters: 0, odometer: 0 });
    const bucket = buckets.get(month);
    bucket.spend += number(record.cost);
    bucket.liters += litersFromGallons(record.gallons);
    bucket.count += 1;
    bucket.odometer = Math.max(bucket.odometer, number(record.odometer));
    const economy = economyByRecord.get(record);
    if (economy && economy.consumption) {
      bucket.economyKm += economy.km;
      bucket.economyLiters += economy.liters;
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((b) => ({
      ...b,
      price: b.liters ? b.spend / b.liters : 0,
      consumption: b.economyKm ? (b.economyLiters / b.economyKm) * 100 : 0,
    }));
}

function fuelRecords() {
  return state.fuel
    .filter((r) => number(r.gallons) || number(r.cost))
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function sourceBreakdown() {
  const groups = new Map();
  for (const record of fuelRecords()) {
    const name = record.source || "Unknown";
    if (!groups.has(name)) groups.set(name, { name, count: 0, spend: 0, liters: 0 });
    const group = groups.get(name);
    group.count += 1;
    group.spend += number(record.cost);
    group.liters += litersFromGallons(record.gallons);
  }
  return [...groups.values()].sort((a, b) => b.spend - a.spend);
}

function weightedPrice(rows) {
  const liters = rows.reduce((sum, row) => sum + litersFromGallons(row.gallons), 0);
  const spend = rows.reduce((sum, row) => sum + number(row.cost), 0);
  return liters ? spend / liters : 0;
}

function benchmarkPriceFor(record, competitorRows) {
  const date = safeDate(record.date);
  const windows = [45, 90, 180];
  if (date) {
    for (const days of windows) {
      const nearby = competitorRows.filter((row) => {
        const other = safeDate(row.date);
        return other && Math.abs(other - date) / 86400000 <= days;
      });
      const price = weightedPrice(nearby);
      if (price) return price;
    }
  }
  return weightedPrice(competitorRows);
}

function costcoSavingsStats() {
  const fuel = fuelRecords().filter((record) => pricePerLiterFor(record) > 0);
  const costcoRows = fuel.filter(isCostcoFuel);
  const competitorRows = fuel.filter((record) => !isCostcoFuel(record));
  const monthly = new Map();
  let totalSavings = 0;
  let netSavings = 0;
  let benchmarkSpend = 0;
  let actualSpend = 0;
  let savingsBenchmarkSpend = 0;
  let savingsActualSpend = 0;
  let savingsLiters = 0;
  let savingsCount = 0;
  let liters = 0;
  for (const record of costcoRows) {
    const actualPrice = pricePerLiterFor(record);
    const benchmarkPrice = benchmarkPriceFor(record, competitorRows);
    const volume = litersFromGallons(record.gallons);
    const benchmark = benchmarkPrice * volume;
    const actual = actualPrice * volume;
    const savings = Math.max(0, benchmark - actual);
    const month = dateOnly(record.date).slice(0, 7);
    if (!monthly.has(month)) monthly.set(month, { month, savings: 0, actualSpend: 0, benchmarkSpend: 0, liters: 0, count: 0 });
    const bucket = monthly.get(month);
    bucket.savings += savings;
    bucket.actualSpend += actual;
    bucket.benchmarkSpend += benchmark;
    bucket.liters += volume;
    bucket.count += 1;
    netSavings += benchmark - actual;
    totalSavings += savings;
    if (savings > 0) {
      savingsBenchmarkSpend += benchmark;
      savingsActualSpend += actual;
      savingsLiters += volume;
      savingsCount += 1;
    }
    benchmarkSpend += benchmark;
    actualSpend += actual;
    liters += volume;
  }
  return {
    count: costcoRows.length,
    liters,
    actualSpend,
    benchmarkSpend,
    totalSavings,
    netSavings,
    savingsCount,
    averageCostcoPrice: liters ? actualSpend / liters : 0,
    averageBenchmarkPrice: liters ? benchmarkSpend / liters : 0,
    savingsCostcoPrice: savingsLiters ? savingsActualSpend / savingsLiters : 0,
    savingsBenchmarkPrice: savingsLiters ? savingsBenchmarkSpend / savingsLiters : 0,
    monthly: [...monthly.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

function vehicleAgeYears(dateValue = new Date().toISOString().slice(0, 10)) {
  const date = safeDate(dateValue) || new Date();
  return Math.max(0, (date.getFullYear() - VEHICLE_MODEL_YEAR) + date.getMonth() / 12 + date.getDate() / 365.25);
}

function vehicleValueEstimate(odometerValue = currentOdometer(), dateValue = new Date().toISOString().slice(0, 10)) {
  const odometer = number(odometerValue) || currentOdometer() || VEHICLE_VALUE_REFERENCE.odometer;
  const age = vehicleAgeYears(dateValue);
  const expectedMiles = age * VEHICLE_VALUE_REFERENCE.expectedAnnualMiles;
  const mileageDelta = expectedMiles - odometer;
  const mileageCredit = clamp(
    mileageDelta * VEHICLE_VALUE_REFERENCE.mileageCreditPerMile,
    -VEHICLE_VALUE_REFERENCE.mileageCreditCap,
    VEHICLE_VALUE_REFERENCE.mileageCreditCap,
  );
  const yearsFromReference = yearsBetween(VEHICLE_VALUE_REFERENCE.date, dateValue);
  const timeAdjustment = -yearsFromReference * VEHICLE_VALUE_REFERENCE.annualDepreciation;
  const privateLow = VEHICLE_VALUE_REFERENCE.privateLow + timeAdjustment + mileageCredit * 0.45;
  const privateHigh = VEHICLE_VALUE_REFERENCE.privateHigh + timeAdjustment + mileageCredit * 0.9;
  const tradeLow = VEHICLE_VALUE_REFERENCE.tradeLow + timeAdjustment * 0.5 + mileageCredit * 0.2;
  const tradeHigh = VEHICLE_VALUE_REFERENCE.tradeHigh + timeAdjustment * 0.6 + mileageCredit * 0.35;
  return {
    age,
    odometer,
    expectedMiles,
    mileageDelta,
    privateLow: Math.max(1000, privateLow),
    privateHigh: Math.max(privateLow + 500, privateHigh),
    tradeLow: Math.max(750, tradeLow),
    tradeHigh: Math.max(tradeLow + 500, tradeHigh),
    instantOfferLow: VEHICLE_VALUE_REFERENCE.instantOfferLow,
    instantOfferHigh: VEHICLE_VALUE_REFERENCE.instantOfferHigh,
  };
}

function statsDetails() {
  const m = metrics();
  const fuel = fuelRecords();
  const economyRows = fuelWithEconomy().filter((r) => r.consumption > 0);
  const economyCost = economyRows.reduce((sum, row) => sum + number(row.record.cost), 0);
  const dated = fuel.filter((r) => safeDate(r.date));
  const cadences = [];
  for (let i = 1; i < dated.length; i += 1) {
    const gap = daysBetween(dated[i - 1].date, dated[i].date);
    if (gap > 0 && gap < 120) cadences.push(gap);
  }
  const averageCadence = cadences.length ? cadences.reduce((sum, gap) => sum + gap, 0) / cadences.length : 0;
  const bestEconomy = economyRows.reduce((best, row) => (!best || row.consumption < best.consumption ? row : best), null);
  const worstEconomy = economyRows.reduce((worst, row) => (!worst || row.consumption > worst.consumption ? row : worst), null);
  const priced = fuel
    .map((record) => ({ record, price: pricePerLiterFor(record) }))
    .filter((row) => row.price > 0);
  const cheapest = priced.reduce((best, row) => (!best || row.price < best.price ? row : best), null);
  const priciest = priced.reduce((worst, row) => (!worst || row.price > worst.price ? row : worst), null);
  const firstDate = dated[0]?.date || "";
  const lastDate = dated.at(-1)?.date || "";
  const activeDays = Math.max(1, daysBetween(firstDate, lastDate));
  return {
    ...m,
    averageFillLiters: m.count ? m.totalLiters / m.count : 0,
    averageFillCost: m.count ? m.totalCost / m.count : 0,
    averageCadence,
    activeDays,
    dailyFuelCost: m.totalCost / activeDays,
    costPer100Km: m.economyKm ? (economyCost / m.economyKm) * 100 : 0,
    bestEconomy,
    worstEconomy,
    cheapest,
    priciest,
  };
}

function renderMetrics() {
  const m = metrics();
  const maintenance = maintenanceMetrics();
  el("datasetStatus").textContent = `${m.count} fill-ups in public CSV`;
  el("dateRange").textContent = m.start && m.end ? `${m.start} to ${m.end}` : "No records loaded";
  const defs = [
    ["Latest odometer", formatOdometer(m.latestOdometer?.odometer) || "n/a", dateOnly(m.latestOdometer?.date) || "No reading"],
    ["Avg consumption", formatConsumption(m.avgConsumption) || "n/a", `${m.economyCount} odometer intervals`],
    ["Fuel spend", money(m.totalCost), "Receipt totals"],
    ["Maintenance", money(maintenance.totalCost), `${maintenance.count} records`],
    ["Total cost", money(m.totalCost + maintenance.totalCost), "Fuel plus maintenance"],
    ["Fuel bought", formatLiters(m.totalLiters), "Converted from gallons"],
  ];
  el("metricsGrid").innerHTML = defs
    .map(([label, value, hint]) => `<article class="metric"><div class="metricLabel">${label}</div><div class="metricValue">${value}</div><div class="metricHint">${hint}</div></article>`)
    .join("");
}

function drawChart() {
  const canvas = el("trendChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  ctx.scale(ratio, ratio);
  const width = rect.width;
  const height = rect.height;
  const data = monthlyData();
  ctx.clearRect(0, 0, width, height);
  const metric = state.chartMetric;
  const titleMap = { spend: "Monthly Fuel Spend", price: "Monthly Fuel Price", liters: "Monthly Fuel Volume", consumption: "Monthly Consumption", odometer: "Monthly Odometer" };
  const subtitleMap = { spend: "receipt totals", price: "weighted average per liter", liters: "liters purchased", consumption: "liters per 100 km", odometer: "latest reading each month" };
  el("chartTitle").textContent = titleMap[metric];
  el("chartSubtitle").textContent = subtitleMap[metric];
  if (!data.length) {
    registerChartPoints(canvas, []);
    return;
  }
  const values = data.map((d) => d[metric]);
  const plottedValues = metric === "odometer" ? values.filter(Boolean) : values;
  const max = Math.max(...plottedValues, 1);
  const min = metric === "odometer" && plottedValues.length ? Math.min(...plottedValues) : 0;
  const span = Math.max(max - min, 1);
  const pad = { left: 46, right: 12, top: 18, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  ctx.strokeStyle = "#2d3742";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (plotH * i) / 4;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();
  const barGap = 4;
  const barW = Math.max(8, plotW / data.length - barGap);
  const points = [];
  data.forEach((d, index) => {
    const value = d[metric];
    if (metric === "odometer" && !value) return;
    const x = pad.left + (plotW * index) / data.length + barGap / 2;
    const h = ((value - min) / span) * plotH;
    const y = pad.top + plotH - h;
    ctx.fillStyle = metric === "price" ? "#e3a04f" : metric === "liters" || metric === "consumption" ? "#36b37e" : metric === "odometer" ? "#8f7cf4" : "#4aa3ff";
    ctx.fillRect(x, y, barW, h);
    const valueLabel = metric === "spend" ? money(value)
      : metric === "price" ? formatPricePerLiter(value)
        : metric === "liters" ? formatLiters(value)
          : metric === "consumption" ? formatConsumption(value)
            : formatOdometer(value);
    points.push({
      type: "rect",
      x,
      y: Math.min(y, height - pad.bottom - 3),
      w: barW,
      h: Math.max(6, h),
      title: formatMonth(d.month),
      lines: [titleMap[metric], valueLabel],
    });
    if (index % Math.ceil(data.length / 8) === 0) {
      ctx.fillStyle = "#cbd4df";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(d.month.slice(2), x + barW / 2, height - 12);
    }
  });
  ctx.fillStyle = "#cbd4df";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = max - (span * i) / 4;
    const label = metric === "spend" || metric === "price" ? money(value) : metric === "consumption" ? value.toFixed(1) : Math.round(value).toLocaleString();
    ctx.fillText(label, pad.left - 8, pad.top + (plotH * i) / 4 + 4);
  }
  registerChartPoints(canvas, points);
}

function setupStatCanvas(id) {
  const canvas = el(id);
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.font = "12px sans-serif";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  return { canvas, ctx, width: rect.width, height: rect.height };
}

function drawEmptyChart(chart, message) {
  const { ctx, width, height } = chart;
  ctx.fillStyle = "#8f9aa7";
  ctx.textAlign = "center";
  ctx.fillText(message, width / 2, height / 2);
}

function chartX(index, count, pad, width) {
  if (count <= 1) return pad.left;
  return pad.left + ((width - pad.left - pad.right) * index) / (count - 1);
}

function chartY(value, min, max, pad, height) {
  const span = Math.max(max - min, 1);
  return pad.top + (height - pad.top - pad.bottom) * (1 - (value - min) / span);
}

function drawChartGrid(ctx, width, height, pad) {
  ctx.strokeStyle = "#2d3742";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + ((height - pad.top - pad.bottom) * i) / 4;
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
  }
  ctx.stroke();
}

function drawAxisLabels(ctx, rows, values, min, max, pad, width, height, formatY, labelForRow) {
  ctx.fillStyle = "#cbd4df";
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i += 1) {
    const value = max - ((max - min) * i) / 4;
    ctx.fillText(formatY(value), pad.left - 8, pad.top + ((height - pad.top - pad.bottom) * i) / 4 + 4);
  }
  const step = Math.max(1, Math.ceil(rows.length / 6));
  ctx.textAlign = "center";
  rows.forEach((row, index) => {
    if (index % step && index !== rows.length - 1) return;
    ctx.fillText(labelForRow(row), chartX(index, rows.length, pad, width), height - 12);
  });
}

function drawLineAreaChart(id, rows, options) {
  const chart = setupStatCanvas(id);
  if (!chart) return;
  const { ctx, width, height } = chart;
  const data = rows
    .map((row) => ({ row, value: number(options.value(row)) }))
    .filter((row) => row.value > 0);
  if (!data.length) {
    drawEmptyChart(chart, "No chart data");
    registerChartPoints(chart.canvas, []);
    return;
  }
  const pad = { left: options.leftPad || 54, right: 14, top: 18, bottom: 34 };
  const values = data.map((row) => row.value);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const min = options.includeZero ? 0 : Math.max(0, rawMin - (rawMax - rawMin || rawMax) * 0.14);
  const max = rawMax + (rawMax - min || rawMax) * 0.12;
  drawChartGrid(ctx, width, height, pad);
  drawAxisLabels(ctx, data.map((d) => d.row), values, min, max, pad, width, height, options.formatY, options.label);

  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, options.fill);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.beginPath();
  data.forEach((point, index) => {
    const x = chartX(index, data.length, pad, width);
    const y = chartY(point.value, min, max, pad, height);
    if (!index) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineTo(chartX(data.length - 1, data.length, pad, width), height - pad.bottom);
  ctx.lineTo(chartX(0, data.length, pad, width), height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  data.forEach((point, index) => {
    const x = chartX(index, data.length, pad, width);
    const y = chartY(point.value, min, max, pad, height);
    if (!index) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = options.color;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  if (data.length < 90) {
    ctx.fillStyle = options.point || options.color;
    data.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(chartX(index, data.length, pad, width), chartY(point.value, min, max, pad, height), 2.6, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  if (options.average) {
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    const y = chartY(average, min, max, pad, height);
    ctx.strokeStyle = "#ffbf2f";
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffdf8a";
    ctx.textAlign = "left";
    ctx.fillText(`avg ${options.formatY(average)}`, pad.left + 8, y - 6);
  }
  registerChartPoints(chart.canvas, data.map((point, index) => ({
    x: chartX(index, data.length, pad, width),
    y: chartY(point.value, min, max, pad, height),
    radius: 12,
    title: options.tooltipTitle ? options.tooltipTitle(point.row) : options.label(point.row),
    lines: options.tooltipLines ? options.tooltipLines(point.row, point.value) : [options.formatY(point.value)],
  })));
}

function drawMonthlyCostChart() {
  const chart = setupStatCanvas("statCostChart");
  if (!chart) return;
  const { ctx, width, height } = chart;
  const data = monthlyData().slice(-18);
  if (!data.length) {
    drawEmptyChart(chart, "No monthly data");
    registerChartPoints(chart.canvas, []);
    return;
  }
  const pad = { left: 54, right: 18, top: 18, bottom: 34 };
  const maxSpend = Math.max(...data.map((d) => d.spend), 1);
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  drawChartGrid(ctx, width, height, pad);
  drawAxisLabels(ctx, data, data.map((d) => d.spend), 0, maxSpend * 1.18, pad, width, height, moneyEstimate, (row) => row.month.slice(2));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const barW = Math.max(7, plotW / data.length - 5);
  const points = [];
  data.forEach((row, index) => {
    const x = pad.left + (plotW * index) / data.length + 2.5;
    const h = (row.spend / (maxSpend * 1.18)) * plotH;
    const y = pad.top + plotH - h;
    const gradient = ctx.createLinearGradient(0, y, 0, height - pad.bottom);
    gradient.addColorStop(0, "#4aa3ff");
    gradient.addColorStop(1, "#25618f");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, barW, h);
    points.push({
      type: "rect",
      x,
      y,
      w: barW,
      h: Math.max(6, h),
      title: formatMonth(row.month),
      lines: [`Spend: ${money(row.spend)}`, `Liters: ${formatLiters(row.liters)}`],
    });
  });
  ctx.beginPath();
  data.forEach((row, index) => {
    const x = pad.left + (plotW * index) / data.length + barW / 2 + 2.5;
    const y = pad.top + plotH * (1 - row.count / maxCount);
    if (!index) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#ffbf2f";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffdf8a";
  data.forEach((row, index) => {
    const x = pad.left + (plotW * index) / data.length + barW / 2 + 2.5;
    const y = pad.top + plotH * (1 - row.count / maxCount);
    ctx.beginPath();
    ctx.arc(x, y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    points.push({
      x,
      y,
      radius: 12,
      title: formatMonth(row.month),
      lines: [`Fill-ups: ${row.count}`, `Spend: ${money(row.spend)}`],
    });
  });
  ctx.textAlign = "left";
  ctx.fillText("bars: spend", pad.left + 4, pad.top + 10);
  ctx.fillStyle = "#ffdf8a";
  ctx.fillText("line: fill-ups", pad.left + 96, pad.top + 10);
  registerChartPoints(chart.canvas, points);
}

function drawDashboardMonthlyCostChart() {
  const chart = setupStatCanvas("dashboardMonthlyCostChart");
  if (!chart) return;
  const { ctx, width, height } = chart;
  const monthly = monthlyData().slice(-12);
  if (!monthly.length) {
    drawEmptyChart(chart, "No monthly cost data");
    registerChartPoints(chart.canvas, []);
    return;
  }
  const savingsByMonth = new Map(costcoSavingsStats().monthly.map((row) => [row.month, row.savings]));
  const pad = { left: 54, right: 18, top: 18, bottom: 34 };
  const maxSpend = Math.max(...monthly.map((row) => row.spend), 1);
  const maxSavings = Math.max(...monthly.map((row) => savingsByMonth.get(row.month) || 0), 1);
  const scaleMax = Math.max(maxSpend, maxSavings) * 1.18;
  drawChartGrid(ctx, width, height, pad);
  drawAxisLabels(ctx, monthly, monthly.map((row) => row.spend), 0, scaleMax, pad, width, height, moneyEstimate, (row) => row.month.slice(2));
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const barW = Math.max(8, plotW / monthly.length - 8);
  const points = [];
  monthly.forEach((row, index) => {
    const x = pad.left + (plotW * index) / monthly.length + 4;
    const spendHeight = (row.spend / scaleMax) * plotH;
    const spendY = pad.top + plotH - spendHeight;
    ctx.fillStyle = "#4aa3ff";
    ctx.fillRect(x, spendY, barW, spendHeight);
    points.push({
      type: "rect",
      x,
      y: spendY,
      w: barW,
      h: Math.max(6, spendHeight),
      title: formatMonth(row.month),
      lines: [`Fuel cost: ${money(row.spend)}`, `Fill-ups: ${row.count}`, `Liters: ${formatLiters(row.liters)}`],
    });
    const savings = savingsByMonth.get(row.month) || 0;
    if (savings) {
      const savingsHeight = Math.max(3, (savings / scaleMax) * plotH);
      const savingsY = spendY - savingsHeight - 3;
      ctx.fillStyle = "#36b37e";
      ctx.fillRect(x, savingsY, barW, savingsHeight);
      points.push({
        type: "rect",
        x,
        y: savingsY,
        w: barW,
        h: Math.max(8, savingsHeight),
        title: formatMonth(row.month),
        lines: [`Estimated Costco savings: ${money(savings)}`],
      });
    }
  });
  ctx.fillStyle = "#cbd4df";
  ctx.textAlign = "left";
  ctx.fillText("blue: paid fuel cost", pad.left + 4, pad.top + 10);
  ctx.fillStyle = "#a6f2c9";
  ctx.fillText("green: estimated Costco savings", pad.left + 138, pad.top + 10);
  registerChartPoints(chart.canvas, points);
}

function drawVehicleValueChart() {
  const chart = setupStatCanvas("vehicleValueChart");
  if (!chart) return;
  const { ctx, width, height } = chart;
  const data = fuelRecords()
    .filter((row) => number(row.odometer) > 0 && safeDate(row.date))
    .map((row) => ({ row, estimate: vehicleValueEstimate(row.odometer, row.date) }));
  if (!data.length) {
    drawEmptyChart(chart, "No odometer history");
    registerChartPoints(chart.canvas, []);
    return;
  }
  const pad = { left: 58, right: 18, top: 18, bottom: 34 };
  const lows = data.map((point) => point.estimate.tradeLow);
  const highs = data.map((point) => point.estimate.privateHigh);
  const min = Math.max(0, Math.min(...lows) * 0.82);
  const max = Math.max(...highs) * 1.12;
  drawChartGrid(ctx, width, height, pad);
  drawAxisLabels(ctx, data.map((point) => point.row), highs, min, max, pad, width, height, moneyEstimate, (row) => dateOnly(row.date).slice(2, 7));

  ctx.beginPath();
  data.forEach((point, index) => {
    const x = chartX(index, data.length, pad, width);
    const y = chartY(point.estimate.privateHigh, min, max, pad, height);
    if (!index) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  [...data].reverse().forEach((point, reverseIndex) => {
    const index = data.length - 1 - reverseIndex;
    ctx.lineTo(chartX(index, data.length, pad, width), chartY(point.estimate.privateLow, min, max, pad, height));
  });
  ctx.closePath();
  const privateFill = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  privateFill.addColorStop(0, "rgba(54, 179, 126, 0.32)");
  privateFill.addColorStop(1, "rgba(54, 179, 126, 0.04)");
  ctx.fillStyle = privateFill;
  ctx.fill();

  ctx.beginPath();
  data.forEach((point, index) => {
    const value = (point.estimate.privateLow + point.estimate.privateHigh) / 2;
    const x = chartX(index, data.length, pad, width);
    const y = chartY(value, min, max, pad, height);
    if (!index) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#36b37e";
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.beginPath();
  data.forEach((point, index) => {
    const value = (point.estimate.tradeLow + point.estimate.tradeHigh) / 2;
    const x = chartX(index, data.length, pad, width);
    const y = chartY(value, min, max, pad, height);
    if (!index) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#e3a04f";
  ctx.lineWidth = 2;
  ctx.stroke();

  const latest = data.at(-1).estimate;
  ctx.fillStyle = "#a6f2c9";
  ctx.textAlign = "left";
  ctx.fillText(`private ${moneyRange(latest.privateLow, latest.privateHigh)}`, pad.left + 4, pad.top + 10);
  ctx.fillStyle = "#ffdf8a";
  ctx.fillText(`trade ${moneyRange(latest.tradeLow, latest.tradeHigh)}`, pad.left + 154, pad.top + 10);
  const points = data.flatMap((point, index) => {
    const x = chartX(index, data.length, pad, width);
    const privateMid = (point.estimate.privateLow + point.estimate.privateHigh) / 2;
    const tradeMid = (point.estimate.tradeLow + point.estimate.tradeHigh) / 2;
    return [
      {
        x,
        y: chartY(privateMid, min, max, pad, height),
        radius: 12,
        title: dateOnly(point.row.date),
        lines: [
          `Private value: ${moneyRange(point.estimate.privateLow, point.estimate.privateHigh)}`,
          `Odometer: ${formatOdometer(point.row.odometer)}`,
        ],
      },
      {
        x,
        y: chartY(tradeMid, min, max, pad, height),
        radius: 12,
        title: dateOnly(point.row.date),
        lines: [
          `Trade value: ${moneyRange(point.estimate.tradeLow, point.estimate.tradeHigh)}`,
          `Odometer: ${formatOdometer(point.row.odometer)}`,
        ],
      },
    ];
  });
  registerChartPoints(chart.canvas, points);
}

function drawStatsCharts() {
  drawLineAreaChart("statConsumptionChart", fuelWithEconomy(), {
    value: (row) => row.consumption,
    label: (row) => dateOnly(row.record.date).slice(2, 7),
    formatY: (value) => value.toFixed(1),
    color: "#36b37e",
    fill: "rgba(54, 179, 126, 0.28)",
    average: true,
    tooltipTitle: (row) => dateOnly(row.record.date),
    tooltipLines: (row, value) => [
      `Consumption: ${formatConsumption(value)}`,
      `Distance: ${formatKm(row.km)}`,
      `Fuel: ${formatLiters(row.liters)}`,
    ],
  });
  drawMonthlyCostChart();
  drawLineAreaChart("statPriceChart", monthlyData(), {
    value: (row) => row.price,
    label: (row) => row.month.slice(2),
    formatY: (value) => `$${value.toFixed(2)}`,
    color: "#e3a04f",
    fill: "rgba(227, 160, 79, 0.28)",
    average: true,
    tooltipTitle: (row) => formatMonth(row.month),
    tooltipLines: (row, value) => [
      `Price: ${formatPricePerLiter(value)}`,
      `Spend: ${money(row.spend)}`,
      `Liters: ${formatLiters(row.liters)}`,
    ],
  });
  drawLineAreaChart("statOdometerChart", fuelRecords().filter((row) => number(row.odometer) > 0), {
    value: (row) => row.odometer,
    label: (row) => dateOnly(row.date).slice(2, 7),
    formatY: (value) => Math.round(value).toLocaleString(),
    color: "#8f7cf4",
    fill: "rgba(143, 124, 244, 0.26)",
    leftPad: 70,
    tooltipTitle: (row) => dateOnly(row.date),
    tooltipLines: (row, value) => [
      `Odometer: ${formatOdometer(value)}`,
      `Fuel cost: ${money(row.cost)}`,
    ],
  });
  drawVehicleValueChart();
}

function renderRecent() {
  const recent = state.fuel.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10);
  const economyRows = fuelWithEconomy();
  el("recentCount").textContent = `${recent.length} shown`;
  el("recentFuelRows").innerHTML = recent
    .map((r) => `<tr><td>${dateOnly(r.date)}</td><td class="numeric">${formatOdometer(r.odometer) || "—"}</td><td class="numeric">${formatFuelVolume(r.gallons)}</td><td class="numeric">${money(pricePerLiterFor(r))}/L</td><td class="numeric">${formatConsumption(consumptionForRecord(r, economyRows)) || "—"}</td><td class="numeric">${money(r.cost)}</td></tr>`)
    .join("");
}

function renderQuality() {
  const m = metrics();
  const maintenance = maintenanceMetrics();
  const economyRows = fuelWithEconomy().filter((r) => r.consumption > 0);
  const latestInterval = economyRows.at(-1);
  const nextService = nextScheduleGroup();
  const missingRecent = state.fuel
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter((r) => !number(r.odometer))
    .slice(0, 4)
    .map((r) => dateOnly(r.date));
  el("qualityList").innerHTML = [
    ["Last interval", latestInterval ? formatConsumption(latestInterval.consumption) : "n/a", latestInterval ? `${formatKm(latestInterval.km)} since previous fill-up` : "Need odometer readings"],
    ["Next service", nextService ? formatOdometer(nextService.dueMiles) : "n/a", nextService ? `${nextService.status.detail} · est ${moneyRange(nextService.costLow, nextService.costHigh)}` : "Maintenance schedule not loaded"],
    ["Latest maintenance", maintenance.latest?.service || "n/a", maintenance.latest ? `${dateOnly(maintenance.latest.date)} · ${money(maintenance.latest.cost)}` : "No maintenance costs in Fuelio backup"],
    ["Missing odometer", String(m.missingOdometer), missingRecent.length ? missingRecent.join(", ") : "Recent rows are complete"],
    ["Fresh data", dateOnly(m.latest?.date) || "n/a", "Loaded from data/fuel.csv on each visit"],
  ].map(([label, value, hint]) => `<div class="insightRow"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`).join("");
}

function renderDashboardMonthlyCost() {
  const node = el("dashboardMonthlyCost");
  if (!node) return;
  const monthly = monthlyData();
  const latest = monthly.at(-1);
  const recentSix = monthly.slice(-6);
  const recentThree = monthly.slice(-3);
  const sixSpend = recentSix.reduce((sum, row) => sum + row.spend, 0);
  const threeAverage = recentThree.length ? recentThree.reduce((sum, row) => sum + row.spend, 0) / recentThree.length : 0;
  const costco = costcoSavingsStats();
  const latestSavings = costco.monthly.find((row) => row.month === latest?.month)?.savings || 0;
  const defs = [
    ["This month", latest ? money(latest.spend) : "n/a", latest ? `${latest.count} fill-ups · ${formatLiters(latest.liters)}` : "No records"],
    ["3-month avg", threeAverage ? money(threeAverage) : "n/a", "Fuel spend per month"],
    ["Last 6 months", recentSix.length ? money(sixSpend) : "n/a", `${recentSix.length} months in view`],
    ["Costco saved", money(costco.totalSavings), latestSavings ? `${money(latestSavings)} this month` : `${costco.savingsCount} cheaper benchmark fills`],
  ];
  node.innerHTML = defs
    .map(([label, value, hint]) => `<article class="dashboardCostItem"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");
}

function renderStats() {
  const kpis = el("statsKpis");
  if (!kpis) return;
  const s = statsDetails();
  const monthly = monthlyData();
  const latestMonth = monthly.at(-1);
  const costco = costcoSavingsStats();
  const vehicle = vehicleValueEstimate();
  const defs = [
    ["Fill-ups", s.count.toLocaleString(), s.start && s.end ? `${s.start} to ${s.end}` : "No records"],
    ["Fuel spend", money(s.totalCost), `${money(s.averageFillCost)} average fill-up`],
    ["Fuel bought", formatLiters(s.totalLiters), `${formatLiters(s.averageFillLiters)} average fill`],
    ["Distance tracked", formatKm(s.economyKm), `${s.economyCount} economy intervals`],
    ["Avg consumption", formatConsumption(s.avgConsumption) || "n/a", "Weighted by tracked distance"],
    ["Cost / 100 km", s.costPer100Km ? money(s.costPer100Km) : "n/a", "Fuel cost over measured intervals"],
    ["Avg price", formatPricePerLiter(s.averagePrice) || "n/a", `${formatPricePerLiter(s.minPrice) || "n/a"} to ${formatPricePerLiter(s.maxPrice) || "n/a"}`],
    ["Fill-up cadence", formatDays(s.averageCadence) || "n/a", `${money(s.dailyFuelCost)} per active day`],
    ["Costco savings", money(costco.totalSavings), `${formatPricePerLiter(costco.savingsCostcoPrice) || "n/a"} vs ${formatPricePerLiter(costco.savingsBenchmarkPrice) || "n/a"} on cheaper comparisons`],
    ["Vehicle value", moneyRange(vehicle.privateLow, vehicle.privateHigh), `${vehicle.age.toFixed(1)} years · ${formatOdometer(vehicle.odometer)}`],
  ];
  kpis.innerHTML = defs
    .map(([label, value, hint]) => `<article class="statKpi"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");

  const mileageDelta = Math.round(vehicle.mileageDelta);
  const vehicleDefs = [
    ["Private-party estimate", moneyRange(vehicle.privateLow, vehicle.privateHigh), "Mileage-adjusted KBB planning range"],
    ["Dealer/trade estimate", moneyRange(vehicle.tradeLow, vehicle.tradeHigh), `CarMax instant-offer anchor ${moneyRange(vehicle.instantOfferLow, vehicle.instantOfferHigh)}`],
    ["Age", `${vehicle.age.toFixed(1)} years`, `${VEHICLE_MODEL_YEAR} Toyota Matrix`],
    ["Mileage vs age", `${Math.abs(mileageDelta).toLocaleString()} mi ${mileageDelta >= 0 ? "under" : "over"}`, `${Math.round(vehicle.expectedMiles).toLocaleString()} mi at 12k/yr baseline`],
  ];
  el("vehicleValueKpis").innerHTML = vehicleDefs
    .map(([label, value, hint]) => `<article class="vehicleValueItem"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");

  const highlightDefs = [
    ["Best consumption", s.bestEconomy ? formatConsumption(s.bestEconomy.consumption) : "n/a", s.bestEconomy ? `${dateOnly(s.bestEconomy.record.date)} · ${formatKm(s.bestEconomy.km)}` : "Need odometer intervals"],
    ["Highest consumption", s.worstEconomy ? formatConsumption(s.worstEconomy.consumption) : "n/a", s.worstEconomy ? `${dateOnly(s.worstEconomy.record.date)} · ${formatKm(s.worstEconomy.km)}` : "Need odometer intervals"],
    ["Cheapest fuel", s.cheapest ? formatPricePerLiter(s.cheapest.price) : "n/a", s.cheapest ? `${dateOnly(s.cheapest.record.date)} · ${money(s.cheapest.record.cost)}` : "No priced fill-ups"],
    ["Highest fuel price", s.priciest ? formatPricePerLiter(s.priciest.price) : "n/a", s.priciest ? `${dateOnly(s.priciest.record.date)} · ${money(s.priciest.record.cost)}` : "No priced fill-ups"],
    ["Latest month", latestMonth ? money(latestMonth.spend) : "n/a", latestMonth ? `${latestMonth.count} fill-ups · ${formatLiters(latestMonth.liters)}` : "No monthly data"],
    ["Costco net delta", signedMoney(costco.netSavings), "Against every nearby non-Costco benchmark"],
  ];
  el("statHighlights").innerHTML = highlightDefs
    .map(([label, value, hint]) => `<div class="statHighlight"><span>${label}</span><strong>${value}</strong><small>${hint}</small></div>`)
    .join("");

  const sources = sourceBreakdown();
  const totalSpend = sources.reduce((sum, source) => sum + source.spend, 0);
  el("sourceMix").innerHTML = sources.length ? sources.map((source) => {
    const pct = totalSpend ? (source.spend / totalSpend) * 100 : 0;
    return `
      <div class="sourceBar">
        <div class="sourceBarHeader"><strong>${source.name}</strong><span>${pct.toFixed(0)}%</span></div>
        <div class="sourceTrack"><span class="sourceFill" style="width: ${Math.max(3, pct).toFixed(1)}%"></span></div>
        <div class="sourceBarMeta"><span>${source.count} fill-ups</span><span>${money(source.spend)} · ${formatLiters(source.liters)}</span></div>
      </div>
    `;
  }).join("") : `<div class="empty">No source data</div>`;

  const recentMonths = monthly.slice(-12).reverse();
  el("monthlyScoreboardHint").textContent = `${recentMonths.length} latest months`;
  el("monthlyStatsRows").innerHTML = recentMonths.length ? recentMonths.map((row) => `
    <tr>
      <td>${formatMonth(row.month)}</td>
      <td class="numeric">${row.count}</td>
      <td class="numeric">${formatLiters(row.liters)}</td>
      <td class="numeric">${money(row.spend)}</td>
      <td class="numeric">${formatPricePerLiter(row.price) || "—"}</td>
      <td class="numeric">${formatConsumption(row.consumption) || "—"}</td>
      <td class="numeric">${formatOdometer(row.odometer) || "—"}</td>
    </tr>
  `).join("") : `<tr><td class="empty" colspan="7">No monthly data</td></tr>`;
}

function renderFuelTable() {
  const query = el("fuelSearch").value.trim().toLowerCase();
  const rows = state.fuel
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .filter((r) => !query || `${r.date} ${r.notes} ${r.tags} ${r.source}`.toLowerCase().includes(query));
  const tbody = el("fuelRows");
  tbody.innerHTML = "";
  const economyRows = fuelWithEconomy();
  for (const r of rows) {
    const tr = document.createElement("tr");
    const cells = [
      [dateOnly(r.date), ""],
      [formatOdometer(r.odometer) || "—", "numeric"],
      [formatFuelVolume(r.gallons), "numeric"],
      [money(r.cost), "numeric"],
      [`${money(pricePerLiterFor(r))}/L`, "numeric"],
      [formatConsumption(consumptionForRecord(r, economyRows)) || "—", "numeric"],
      [r.source || "", ""],
      [r.notes || "", ""],
    ];
    for (const [value, className] of cells) {
      const td = document.createElement("td");
      if (className) td.className = className;
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function renderMaintenance() {
  const tbody = el("maintenanceRows");
  tbody.innerHTML = "";
  if (!state.maintenance.length) {
    tbody.innerHTML = `<tr><td class="empty" colspan="7">No maintenance records</td></tr>`;
    return;
  }
  const rows = state.maintenance.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const r of rows) {
    const tr = document.createElement("tr");
    const cells = [
      [dateOnly(r.date), ""],
      [formatOdometer(r.odometer) || "—", "numeric"],
      [r.service || "", ""],
      [r.category || "", ""],
      [money(r.cost), "numeric"],
      [r.vendor || "", ""],
      [r.notes || "", ""],
    ];
    for (const [value, className] of cells) {
      const td = document.createElement("td");
      if (className) td.className = className;
      td.textContent = value;
      tr.append(td);
    }
    tbody.append(tr);
  }
}

function renderSchedule() {
  const summary = el("scheduleSummary");
  const scheduleRows = el("scheduleRows");
  const procedureCostRows = el("procedureCostRows");
  if (!summary || !scheduleRows || !procedureCostRows) return;
  const groups = scheduleGroups();
  const occurrences = scheduleOccurrences({ standardOnly: true });
  if (!state.schedule.length || !currentOdometer()) {
    summary.innerHTML = `<div class="empty">No maintenance schedule or odometer loaded</div>`;
    scheduleRows.innerHTML = `<tr><td class="empty" colspan="6">No upcoming maintenance can be calculated yet.</td></tr>`;
    procedureCostRows.innerHTML = `<tr><td class="empty" colspan="7">No procedure cost data loaded.</td></tr>`;
    return;
  }
  summary.innerHTML = groups.slice(0, 4).map((group) => `
    <article class="scheduleCard">
      <div class="scheduleCardTop">
        <strong>${formatOdometer(group.dueMiles)}</strong>
        <span class="statusPill ${group.status.label.toLowerCase()}">${group.status.label}</span>
      </div>
      <p>${group.status.detail}</p>
      <div class="scheduleCardCost">${moneyRange(group.costLow, group.costHigh)}</div>
      <small>${group.items.length} scheduled procedures; inspections are usually bundled.</small>
    </article>
  `).join("");
  scheduleRows.innerHTML = occurrences.map((item) => `
    <tr>
      <td>${formatOdometer(item.dueMiles)}</td>
      <td><span class="statusPill ${item.status.label.toLowerCase()}">${item.status.label}</span><small class="tableHint">${item.status.detail}</small></td>
      <td>${item.row.procedure}</td>
      <td>${item.row.condition}</td>
      <td class="numeric">${scheduleCostLabel(item.row)}</td>
      <td>${item.row.cost_note || ""}</td>
    </tr>
  `).join("");
  procedureCostRows.innerHTML = state.schedule
    .slice()
    .sort((a, b) => (a.condition === "Standard" ? 0 : 1) - (b.condition === "Standard" ? 0 : 1) || a.first_due_miles - b.first_due_miles || a.procedure.localeCompare(b.procedure))
    .map((row) => `
      <tr>
        <td>${row.action}</td>
        <td>${row.procedure}</td>
        <td>${row.condition}</td>
        <td class="numeric">${formatOdometer(row.first_due_miles)}</td>
        <td class="numeric">${row.repeat_miles ? `${row.repeat_miles.toLocaleString()} mi` : "one time"}</td>
        <td class="numeric">${scheduleCostLabel(row)}</td>
        <td>${row.cost_note || ""}</td>
      </tr>
    `).join("");
}

function syncChartControls() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("active", button.dataset.chart === state.chartMetric);
  });
}

function renderAll() {
  syncChartControls();
  renderMetrics();
  drawChart();
  renderRecent();
  renderQuality();
  renderDashboardMonthlyCost();
  drawDashboardMonthlyCostChart();
  renderStats();
  drawStatsCharts();
  renderFuelTable();
  renderMaintenance();
  renderSchedule();
}

function download(name, text, type = "text/csv") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function formValue(id) {
  return el(id).value.trim();
}

function setFormValue(id, value) {
  const node = el(id);
  if (node) node.value = value || "";
}

function draftState() {
  return readJSONStorage(ENTRY_DRAFT_KEY) || {};
}

function fillupPayload() {
  return {
    kind: "fillup",
    entry: {
      date: formValue("fillupDate"),
      odometer: Math.round(number(formValue("fillupOdometer"))),
      gallons: number(formValue("fillupGallons")),
      cost: number(formValue("fillupCost")),
      notes: formValue("fillupNotes"),
    },
    source: "github-pages",
    updated_at: new Date().toISOString(),
  };
}

function maintenancePayload() {
  return {
    kind: "maintenance",
    entry: {
      date: formValue("maintenanceDate"),
      odometer: Math.round(number(formValue("maintenanceOdometer"))),
      service: formValue("maintenanceService"),
      category: formValue("maintenanceCategory"),
      cost: number(formValue("maintenanceCost")),
      vendor: formValue("maintenanceVendor"),
      notes: formValue("maintenanceNotes"),
    },
    source: "github-pages",
    updated_at: new Date().toISOString(),
  };
}

function isValidFillup(payload) {
  return Boolean(payload.entry.date && payload.entry.odometer > 0 && payload.entry.gallons > 0 && payload.entry.cost >= 0);
}

function isValidMaintenance(payload) {
  return Boolean(payload.entry.date && payload.entry.service && payload.entry.cost > 0);
}

function issueHref(payload) {
  const body = [
    "Update the fuel ledger from the GitHub Pages entry form.",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
  const params = new URLSearchParams({
    title: `[fuel-ledger-entry] ${payload.kind} ${payload.entry.date || todayISO()}`,
    body,
  });
  return `${ISSUE_URL}?${params.toString()}`;
}

function setIssueLink(linkId, statusId, payload, valid, validMessage, invalidMessage) {
  const link = el(linkId);
  const status = el(statusId);
  link.href = valid ? issueHref(payload) : "#";
  link.setAttribute("aria-disabled", valid ? "false" : "true");
  link.classList.toggle("disabled", !valid);
  status.textContent = valid ? validMessage : invalidMessage;
}

function updateEntryLinks() {
  const fillup = fillupPayload();
  const maintenance = maintenancePayload();
  setIssueLink("saveFillup", "fillupStatus", fillup, isValidFillup(fillup), "Draft saved here; open GitHub to commit this fill-up.", "Date, odometer, gallons, and total cost are required.");
  setIssueLink("saveMaintenance", "maintenanceStatus", maintenance, isValidMaintenance(maintenance), "Draft saved here; open GitHub to commit this cost.", "Date, service, and cost are required.");
}

function saveEntryDrafts() {
  writeLocalStorage(ENTRY_DRAFT_KEY, JSON.stringify({
    fillup: fillupPayload().entry,
    maintenance: maintenancePayload().entry,
    updated_at: new Date().toISOString(),
  }));
  updateEntryLinks();
}

function loadEntryDrafts() {
  const drafts = draftState();
  const fillup = drafts.fillup || {};
  const maintenance = drafts.maintenance || {};
  setFormValue("fillupDate", fillup.date || todayISO());
  setFormValue("fillupOdometer", fillup.odometer);
  setFormValue("fillupGallons", fillup.gallons || (fillup.liters ? (number(fillup.liters) / GALLON_TO_LITER).toFixed(3) : ""));
  setFormValue("fillupCost", fillup.cost);
  setFormValue("fillupNotes", fillup.notes);
  setFormValue("maintenanceDate", maintenance.date || todayISO());
  setFormValue("maintenanceOdometer", maintenance.odometer);
  setFormValue("maintenanceService", maintenance.service);
  setFormValue("maintenanceCategory", maintenance.category || "Service");
  setFormValue("maintenanceCost", maintenance.cost);
  setFormValue("maintenanceVendor", maintenance.vendor);
  setFormValue("maintenanceNotes", maintenance.notes);
  updateEntryLinks();
}

function bindEntryForms() {
  document.querySelectorAll("[data-entry-field]").forEach((node) => {
    node.addEventListener("input", saveEntryDrafts);
    node.addEventListener("change", saveEntryDrafts);
  });
  ["saveFillup", "saveMaintenance"].forEach((id) => {
    el(id).addEventListener("click", (event) => {
      if (el(id).getAttribute("aria-disabled") === "true") event.preventDefault();
    });
  });
  loadEntryDrafts();
}

function bindEvents() {
  document.querySelectorAll(".navItem").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".navItem,.view").forEach((node) => node.classList.remove("active"));
      button.classList.add("active");
      el(button.dataset.view).classList.add("active");
      drawChart();
      drawDashboardMonthlyCostChart();
      drawStatsCharts();
    });
  });
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".segment").forEach((b) => b.classList.remove("active"));
      button.classList.add("active");
      state.chartMetric = button.dataset.chart;
      saveSettings();
      drawChart();
      drawDashboardMonthlyCostChart();
      drawStatsCharts();
    });
  });
  el("fuelSearch").addEventListener("input", renderFuelTable);
  el("exportFuel").addEventListener("click", () => {
    download("fuel.csv", toCSV(state.fuel, ["date", "odometer", "gallons", "cost", "notes", "tags", "partial_fuelup", "missed_fuelup", "source", "fuelio_unique_id"]));
  });
  el("exportBackup").addEventListener("click", () => {
    download("fuel-ledger-backup.json", JSON.stringify(state, null, 2), "application/json");
  });
  el("resetData").addEventListener("click", async () => {
    localStorage.removeItem(STORAGE_KEY);
    await loadSeedData();
    renderAll();
  });
  el("importFuel").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.fuel = parseCSV(await file.text()).map(normalizeFuel);
    save();
    renderAll();
    event.target.value = "";
  });
  bindEntryForms();
  window.addEventListener("resize", () => {
    drawChart();
    drawDashboardMonthlyCostChart();
    drawStatsCharts();
  });
}

async function init() {
  const loaded = loadSaved();
  loadSavedSettings();
  if (!loaded) await loadSeedData();
  bindEvents();
  renderAll();
}

init().catch((error) => {
  el("datasetStatus").textContent = `Failed to load data: ${error.message}`;
});
