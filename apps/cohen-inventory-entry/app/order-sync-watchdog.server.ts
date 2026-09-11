import db from "./db.server";
import { syncRecentSalesOrdersFromAdmin } from "./sales-sync.server";
import { unauthenticated } from "./shopify.server";

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_INITIAL_LOOKBACK_MINUTES = 7 * 24 * 60;
const DEFAULT_OVERLAP_MINUTES = 2;

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let watchdogRunning = false;

function integerSetting(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const configured = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(configured)) return fallback;
  return Math.max(minimum, Math.min(configured, maximum));
}

export async function runOrderSyncWatchdogOnce() {
  if (watchdogRunning) {
    return { skipped: true, reason: "RUN_ALREADY_IN_PROGRESS", shops: [] };
  }

  watchdogRunning = true;
  try {
    const intervalMs = integerSetting(
      "ORDER_SYNC_WATCHDOG_INTERVAL_MS",
      DEFAULT_INTERVAL_MS,
      15_000,
      15 * 60_000,
    );
    const initialLookbackMinutes = integerSetting(
      "ORDER_SYNC_INITIAL_LOOKBACK_MINUTES",
      DEFAULT_INITIAL_LOOKBACK_MINUTES,
      2,
      90 * 24 * 60,
    );
    const overlapMinutes = integerSetting(
      "ORDER_SYNC_OVERLAP_MINUTES",
      DEFAULT_OVERLAP_MINUTES,
      0,
      60,
    );
    const sessions = await db.session.findMany({
      where: { isOnline: false },
      select: { shop: true },
      distinct: ["shop"],
      orderBy: { shop: "asc" },
    });
    const shops: Array<{
      shop: string;
      ok: boolean;
      ordersSeen?: number;
      ordersImported?: number;
      error?: string;
    }> = [];

    for (const session of sessions) {
      const shop = session.shop.trim().toLowerCase();
      try {
        const { admin } = await unauthenticated.admin(shop);
        const result = await syncRecentSalesOrdersFromAdmin({
          admin,
          sourceShop: shop,
          overlapMinutes,
          initialLookbackMinutes,
        });
        shops.push({
          shop,
          ok: true,
          ordersSeen: result.ordersSeen,
          ordersImported: result.ordersImported,
        });
      } catch (error) {
        shops.push({
          shop,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const failedShops = shops.filter((shop) => !shop.ok);
    if (failedShops.length > 0) {
      console.error("Order sync watchdog completed with failures", {
        intervalMs,
        shops: failedShops,
      });
    } else {
      console.info("Order sync watchdog completed", {
        intervalMs,
        shops,
      });
    }

    return { skipped: false, shops };
  } finally {
    watchdogRunning = false;
  }
}

export function startOrderSyncWatchdog() {
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.ORDER_SYNC_WATCHDOG_ENABLED === "false" ||
    watchdogTimer
  ) {
    return;
  }

  const intervalMs = integerSetting(
    "ORDER_SYNC_WATCHDOG_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
    15_000,
    15 * 60_000,
  );
  const run = () => {
    void runOrderSyncWatchdogOnce().catch((error) => {
      console.error(
        "Order sync watchdog failed",
        error instanceof Error ? error.message : error,
      );
    });
  };

  const initialTimer = setTimeout(run, Math.min(5_000, intervalMs));
  initialTimer.unref();
  watchdogTimer = setInterval(run, intervalMs);
  watchdogTimer.unref();
}
