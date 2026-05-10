#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const ORDERS_URL = "https://www.costco.com/myaccount/#/app/4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf/ordersandpurchases";
const GRAPHQL_URL = "https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql";
const BRAVE_EXE = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";
const BRAVE_PROFILE = "C:\\temp\\brave_profile";

const SUMMARY_QUERY = `query receiptsWithCounts($startDate: String!, $endDate: String!,$documentType:String!,$documentSubType:String!) {
    receiptsWithCounts(startDate: $startDate, endDate: $endDate,documentType:$documentType,documentSubType:$documentSubType) {
    inWarehouse
    gasStation
    carWash
    gasAndCarWash
    receipts{
    warehouseName receiptType documentType transactionDateTime transactionBarcode transactionType total
    totalItemCount
    itemArray { itemNumber }
    tenderArray { tenderTypeCode tenderDescription amountTender }
    couponArray { upcnumberCoupon }
  }
}
}`;

const DETAIL_QUERY = `query receiptsWithCounts($barcode: String!,$documentType:String!) {
    receiptsWithCounts(barcode: $barcode,documentType:$documentType) {
      receipts{
        warehouseName
        receiptType
        documentType
        transactionDateTime
        transactionDate
        transactionBarcode
        total
        itemArray {
          itemNumber
          itemDescription01
          itemDescription02
          unit
          amount
          fuelUnitQuantity
          itemUnitPriceAmount
          fuelGradeDescription
        }
      }
    }
  }`;

function parseArgs() {
  const out = { port: 9222, months: 6, output: "", startDate: "", endDate: "", openBrowser: true };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--port") out.port = Number(process.argv[++i]);
    else if (arg === "--months") out.months = Number(process.argv[++i]);
    else if (arg === "--output") out.output = process.argv[++i];
    else if (arg === "--start-date") out.startDate = process.argv[++i];
    else if (arg === "--end-date") out.endDate = process.argv[++i];
    else if (arg === "--no-open-browser") out.openBrowser = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function costcoDate(date) {
  return `${date.getMonth() + 1}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function dateRange(months) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth() - months, 1);
  return { startDate: costcoDate(start), endDate: costcoDate(end) };
}

async function json(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function waitForCdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await json(`http://127.0.0.1:${port}/json/version`);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

function startBrave(port) {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${BRAVE_PROFILE}`,
    ORDERS_URL,
  ];
  spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Start-Process -FilePath '${BRAVE_EXE}' -ArgumentList ${args.map((a) => `'${a.replaceAll("'", "''")}'`).join(",")}`,
  ], { stdio: "ignore" });
}

async function getCostcoTarget(port) {
  const pages = await json(`http://127.0.0.1:${port}/json/list`);
  return pages.find((page) => page.type === "page" && /costco\.com/i.test(page.url))
    || pages.find((page) => page.type === "page");
}

async function openCostcoTarget(port) {
  try {
    return await json(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(ORDERS_URL)}`);
  } catch {
    const target = await getCostcoTarget(port);
    if (!target) throw new Error("No browser page is available through CDP.");
    return target;
  }
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(timer);
    if (message.error) reject(new Error(JSON.stringify(message.error)));
    else resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  const send = async (method, params = {}, timeoutMs = 30000) => {
    await ready;
    const id = ++nextId;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
    });
  };

  return { send, close: () => ws.close() };
}

async function evaluate(page, expression, timeoutMs = 60000) {
  const result = await page.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
        || result.exceptionDetails.exception?.value
        || result.exceptionDetails.text
        || "Runtime evaluation failed",
    );
  }
  return result.result.value;
}

async function waitForAccountPage(page) {
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  let status = await evaluate(page, `({ host: location.hostname, title: document.title })`);
  if (!/costco\.com$/i.test(status.host) || /signin/i.test(status.host)) {
    await page.send("Page.navigate", { url: ORDERS_URL });
  }

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    status = await evaluate(page, `({ host: location.hostname, title: document.title, text: (document.body?.innerText || "").slice(0, 200) })`);
    if (status.host === "www.costco.com" && /Orders|Purchases|Account/i.test(status.title + status.text)) return;
    if (/signin/i.test(status.host) || /Sign In/i.test(status.title + status.text)) {
      throw new Error("Costco sign-in is required in the managed Brave browser before the monitor can fetch receipts.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Timed out waiting for the Costco Orders & Purchases page.");
}

function fetchExpression(startDate, endDate) {
  return `(${async function runFetch(graphqlUrl, summaryQuery, detailQuery, startDateValue, endDateValue) {
    const graph = async (query, variables) => {
      const response = await fetch(graphqlUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "costco.service": "restOrders",
        },
        body: JSON.stringify({ query, variables }),
      });
      const text = await response.text();
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
      return { ok: response.ok, status: response.status, payload };
    };

    const summary = await graph(summaryQuery, {
      startDate: startDateValue,
      endDate: endDateValue,
      documentType: "fuel",
      documentSubType: "gas",
    });
    if (!summary.ok || summary.payload.errors) {
      return { ok: false, status: summary.status, error: "Costco receipt summary request failed" };
    }

    const receipts = summary.payload?.data?.receiptsWithCounts?.receipts || [];
    const rows = [];
    for (const receipt of receipts) {
      if (!receipt.transactionBarcode) continue;
      const detail = await graph(detailQuery, {
        barcode: receipt.transactionBarcode,
        documentType: receipt.documentType || "FuelReceipts",
      });
      if (!detail.ok || detail.payload.errors) continue;
      const detailedReceipt = detail.payload?.data?.receiptsWithCounts?.receipts?.[0];
      if (!detailedReceipt) continue;
      const fuelItem = (detailedReceipt.itemArray || []).find((item) => Number(item.fuelUnitQuantity) > 0)
        || (detailedReceipt.itemArray || [])[0];
      if (!fuelItem || !Number(fuelItem.fuelUnitQuantity)) continue;
      const gallons = Number(fuelItem.fuelUnitQuantity);
      const total = Number(detailedReceipt.total || fuelItem.amount);
      const unitPrice = Number(fuelItem.itemUnitPriceAmount || (gallons ? total / gallons : 0));
      const warehouse = detailedReceipt.warehouseName || receipt.warehouseName || "Costco";
      rows.push({
        date: String(detailedReceipt.transactionDate || detailedReceipt.transactionDateTime || "").slice(0, 10),
        odometer: "",
        gallons: gallons.toFixed(3),
        cost: total.toFixed(2),
        notes: "Costco " + warehouse + "; " + unitPrice.toFixed(3) + "/gal; Costco receipt " + detailedReceipt.transactionBarcode,
        tags: "Costco " + (fuelItem.fuelGradeDescription || fuelItem.itemDescription01 || fuelItem.itemDescription02 || "Gas").replace(/\\s+/g, ""),
        partial_fuelup: "0",
        missed_fuelup: "0",
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.notes.localeCompare(b.notes));
    return { ok: true, startDate: startDateValue, endDate: endDateValue, count: rows.length, rows };
  }})(${JSON.stringify(GRAPHQL_URL)}, ${JSON.stringify(SUMMARY_QUERY)}, ${JSON.stringify(DETAIL_QUERY)}, ${JSON.stringify(startDate)}, ${JSON.stringify(endDate)})`;
}

async function main() {
  const args = parseArgs();
  const range = dateRange(args.months);
  const startDate = args.startDate || range.startDate;
  const endDate = args.endDate || range.endDate;

  if (!(await waitForCdp(args.port, 1000))) {
    if (!args.openBrowser) throw new Error(`No CDP browser is listening on port ${args.port}.`);
    startBrave(args.port);
    if (!(await waitForCdp(args.port))) throw new Error(`Brave did not start CDP on port ${args.port}.`);
  }

  let target = await getCostcoTarget(args.port);
  if (!target || !target.webSocketDebuggerUrl) target = await openCostcoTarget(args.port);
  const page = connect(target.webSocketDebuggerUrl);
  try {
    await waitForAccountPage(page);
    const result = await evaluate(page, fetchExpression(startDate, endDate), 120000);
    if (!result.ok) throw new Error(`${result.error || "Costco fetch failed"} (HTTP ${result.status || "unknown"})`);
    const output = JSON.stringify(result, null, 2);
    if (args.output) fs.writeFileSync(args.output, `${output}\n`, "utf8");
    else console.log(output);
  } finally {
    page.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
