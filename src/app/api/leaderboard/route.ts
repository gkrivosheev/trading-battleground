import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(request.url);

  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const assetClass = searchParams.get("asset_class");
  const offset = (page - 1) * limit;

  const query = supabase
    .from("backtest_results")
    .select(
      `
      id,
      sharpe_ratio,
      total_pnl,
      max_drawdown,
      win_rate,
      train_sharpe,
      created_at,
      strategies (
        name,
        selected_assets,
        user_id
      )
    `
    )
    .eq("status", "complete")
    .not("sharpe_ratio", "is", null)
    .order("sharpe_ratio", { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter by asset class if specified (post-filter since we need to join with assets)
  let filteredData = data || [];
  if (assetClass) {
    // Load asset class mapping
    const { data: assets } = await supabase
      .from("assets")
      .select("ticker, asset_class")
      .eq("asset_class", assetClass);

    const classTickerSet = new Set(
      (assets || []).map((a: { ticker: string }) => a.ticker)
    );

    filteredData = filteredData.filter((row) => {
      const strat = row.strategies as unknown as { selected_assets?: string[] } | null;
      const selectedAssets = strat?.selected_assets || [];
      return selectedAssets.some((t: string) => classTickerSet.has(t));
    });
  }

  return NextResponse.json({
    data: filteredData,
    page,
    limit,
    total: count,
  });
}
