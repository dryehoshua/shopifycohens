import db from "../db.server";

export const loader = async () => {
  try {
    const [, latestOrderWatchdog] = await Promise.all([
      db.$queryRaw`SELECT 1`,
      db.salesSyncRun.findFirst({
        where: { source: "ORDER_WATCHDOG" },
        orderBy: { startedAt: "desc" },
        select: {
          status: true,
          startedAt: true,
          completedAt: true,
          ordersSeen: true,
          ordersImported: true,
          errorMessage: true,
        },
      }),
    ]);
    return Response.json(
      {
        status: "ok",
        orderSyncWatchdog: latestOrderWatchdog
          ? {
              ...latestOrderWatchdog,
              startedAt: latestOrderWatchdog.startedAt.toISOString(),
              completedAt:
                latestOrderWatchdog.completedAt?.toISOString() ?? null,
            }
          : null,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { status: "unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
};
