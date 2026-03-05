import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const UNIVERSE = [
  "SPY", "QQQ", "IWM", "DIA",
  "XLF", "XLK", "XLE", "XLV", "XLI",
  "TLT", "IEF", "HYG", "LQD",
  "GLD", "SLV", "USO",
  "VIXY",
  "BTC-USD", "ETH-USD",
  "UUP",
];

interface YahooQuote {
  date: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchYahooData(ticker: string): Promise<YahooQuote[]> {
  const now = Math.floor(Date.now() / 1000);
  const fiveYearsAgo = now - 5 * 365 * 24 * 60 * 60;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${fiveYearsAgo}&period2=${now}&interval=1d`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!res.ok) {
    throw new Error(`Yahoo Finance returned ${res.status} for ${ticker}`);
  }

  const data = await res.json();
  const result = data.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ${ticker}`);

  const timestamps: number[] = result.timestamp || [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) throw new Error(`No quote data for ${ticker}`);

  const rows: YahooQuote[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (
      quote.open[i] != null &&
      quote.high[i] != null &&
      quote.low[i] != null &&
      quote.close[i] != null
    ) {
      rows.push({
        date: timestamps[i],
        open: quote.open[i],
        high: quote.high[i],
        low: quote.low[i],
        close: quote.close[i],
        volume: quote.volume[i] ?? 0,
      });
    }
  }

  return rows;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const results: Record<string, string> = {};

  for (const ticker of UNIVERSE) {
    try {
      const quotes = await fetchYahooData(ticker);

      const rows = quotes.map((q) => ({
        ticker,
        date: formatDate(q.date),
        open: parseFloat(q.open.toFixed(4)),
        high: parseFloat(q.high.toFixed(4)),
        low: parseFloat(q.low.toFixed(4)),
        close: parseFloat(q.close.toFixed(4)),
        volume: Math.round(q.volume),
      }));

      // Upsert in batches of 500
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error } = await supabase
          .table("market_data")
          .upsert(batch, { onConflict: "ticker,date" });
        if (error) throw error;
      }

      results[ticker] = `${rows.length} rows`;
    } catch (e) {
      results[ticker] = `error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({ success: true, results });
}
