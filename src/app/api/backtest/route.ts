import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import { createServerClient } from "@/lib/supabase";
import { waitUntil } from "@vercel/functions";

export async function POST(request: NextRequest) {
  const supabase = createServerClient();

  // Try to authenticate user (optional for now)
  let userId: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "");
    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id ?? null;
    }
  }

  const body = await request.json();
  const {
    strategy_id,
    code,
    name,
    description,
    selected_assets,
    parameters,
    train_start,
    train_end,
    test_start,
    test_end,
  } = body;

  if (!code || !selected_assets?.length || !train_start || !train_end || !test_start || !test_end) {
    return NextResponse.json(
      { error: "code, selected_assets, train/test dates are required" },
      { status: 400 }
    );
  }

  // Save strategy if not provided
  let strategyId = strategy_id;
  if (!strategyId) {
    const strategyRow: Record<string, unknown> = {
      name: name || "Untitled Strategy",
      description: description || "",
      code,
      parameters: parameters || {},
      selected_assets,
    };
    if (userId) strategyRow.user_id = userId;

    const { data: strategy, error: stratError } = await supabase
      .from("strategies")
      .insert(strategyRow)
      .select()
      .single();

    if (stratError) {
      return NextResponse.json({ error: stratError.message }, { status: 500 });
    }
    strategyId = strategy.id;
  }

  // Create pending backtest result
  const { data: backtest, error: btError } = await supabase
    .from("backtest_results")
    .insert({
      strategy_id: strategyId,
      status: "pending",
      train_start,
      train_end,
      test_start,
      test_end,
    })
    .select()
    .single();

  if (btError) {
    return NextResponse.json({ error: btError.message }, { status: 500 });
  }

  // Load market data from Supabase
  const marketData: Record<string, Array<Record<string, unknown>>> = {};
  for (const ticker of selected_assets) {
    const { data: rows, error: mdError } = await supabase
      .from("market_data")
      .select("date,open,high,low,close,volume")
      .eq("ticker", ticker)
      .order("date");

    if (mdError) {
      await supabase
        .from("backtest_results")
        .update({ status: "failed", error_message: `Failed to load data for ${ticker}` })
        .eq("id", backtest.id);
      return NextResponse.json({ error: mdError.message }, { status: 500 });
    }

    marketData[ticker] = rows || [];
  }

  // Update status to running
  await supabase
    .from("backtest_results")
    .update({ status: "running" })
    .eq("id", backtest.id);

  // Trigger Modal backtest in background
  const backtestPromise = triggerModalBacktest({
    backtest_id: backtest.id,
    code,
    selected_assets,
    market_data: marketData,
    train_start,
    train_end,
    test_start,
    test_end,
    parameters: parameters || {},
  }).catch((err) => {
    console.error("Modal trigger failed:", err);
  });

  // Keep serverless function alive after response is sent
  waitUntil(backtestPromise);

  return NextResponse.json({ backtest_id: backtest.id }, { status: 201 });
}

async function triggerModalBacktest(payload: {
  backtest_id: string;
  code: string;
  selected_assets: string[];
  market_data: Record<string, Array<Record<string, unknown>>>;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  parameters: Record<string, unknown>;
}) {
  const supabase = createServerClient();
  const { backtest_id, parameters, ...rest } = payload;

  try {
    // Call Modal webhook endpoint
    const modalUrl = process.env.MODAL_WEBHOOK_URL;

    if (!modalUrl) {
      // Fallback: run backtester inline (dev mode only)
      console.warn("MODAL_WEBHOOK_URL not set, running inline (dev mode)");
      await runInlineFallback(backtest_id, payload);
      return;
    }

    const response = await fetch(modalUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: rest.code,
        selected_assets: rest.selected_assets,
        market_data: rest.market_data,
        start_date: rest.test_start,
        end_date: rest.test_end,
        parameter_overrides: parameters,
      }),
    });

    const result = await response.json();

    if (result.status === "success") {
      await supabase
        .from("backtest_results")
        .update({
          status: "complete",
          sharpe_ratio: result.metrics.sharpe_ratio,
          total_pnl: result.metrics.total_pnl,
          max_drawdown: result.metrics.max_drawdown,
          win_rate: result.metrics.win_rate,
          avg_turnover: result.metrics.avg_turnover,
          equity_curve: result.equity_curve,
        })
        .eq("id", backtest_id);
    } else {
      await supabase
        .from("backtest_results")
        .update({
          status: "failed",
          error_message: result.error,
        })
        .eq("id", backtest_id);
    }
  } catch (error) {
    await supabase
      .from("backtest_results")
      .update({
        status: "failed",
        error_message: `Execution error: ${error instanceof Error ? error.message : String(error)}`,
      })
      .eq("id", backtest_id);
  }
}

async function runInlineFallback(
  backtestId: string,
  payload: {
    backtest_id: string;
    code: string;
    selected_assets: string[];
    market_data: Record<string, Array<Record<string, unknown>>>;
    train_start: string;
    train_end: string;
    test_start: string;
    test_end: string;
    parameters: Record<string, unknown>;
  }
) {
  // Dev-only fallback: call a Python subprocess
  const supabase = createServerClient();

  try {
    const input = JSON.stringify({
      code: payload.code,
      selected_assets: payload.selected_assets,
      market_data: payload.market_data,
      start_date: payload.test_start,
      end_date: payload.test_end,
      parameter_overrides: payload.parameters,
    });

    const result = execSync(
      `echo '${input.replace(/'/g, "'\\''")}' | python3 -c "
import sys, json, pandas as pd
sys.path.insert(0, '.')
from core.backtester import run_backtest
payload = json.load(sys.stdin)
md = {}
for t, rows in payload['market_data'].items():
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'])
    for c in ['open','high','low','close']: df[c] = df[c].astype(float)
    df['volume'] = df['volume'].astype(int)
    md[t] = df
r = run_backtest(payload['code'], payload['selected_assets'], md, payload['start_date'], payload['end_date'], payload.get('parameter_overrides', {}))
print(json.dumps(r, default=str))
"`,
      { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
    ).toString();

    const parsed = JSON.parse(result.trim());

    if (parsed.status === "success") {
      // Also run on train set for overfitting detection
      const trainInput = JSON.stringify({
        code: payload.code,
        selected_assets: payload.selected_assets,
        market_data: payload.market_data,
        start_date: payload.train_start,
        end_date: payload.train_end,
        parameter_overrides: payload.parameters,
      });

      let trainSharpe = null;
      let trainPnl = null;
      try {
        const trainResult = execSync(
          `echo '${trainInput.replace(/'/g, "'\\''")}' | python3 -c "
import sys, json, pandas as pd
sys.path.insert(0, '.')
from core.backtester import run_backtest
payload = json.load(sys.stdin)
md = {}
for t, rows in payload['market_data'].items():
    df = pd.DataFrame(rows)
    df['date'] = pd.to_datetime(df['date'])
    for c in ['open','high','low','close']: df[c] = df[c].astype(float)
    df['volume'] = df['volume'].astype(int)
    md[t] = df
r = run_backtest(payload['code'], payload['selected_assets'], md, payload['start_date'], payload['end_date'], payload.get('parameter_overrides', {}))
print(json.dumps(r, default=str))
"`,
          { maxBuffer: 50 * 1024 * 1024, timeout: 300000 }
        ).toString();
        const trainParsed = JSON.parse(trainResult.trim());
        if (trainParsed.status === "success") {
          trainSharpe = trainParsed.metrics.sharpe_ratio;
          trainPnl = trainParsed.metrics.total_pnl;
        }
      } catch {
        // Train run failed, leave as null
      }

      await supabase
        .from("backtest_results")
        .update({
          status: "complete",
          sharpe_ratio: parsed.metrics.sharpe_ratio,
          total_pnl: parsed.metrics.total_pnl,
          max_drawdown: parsed.metrics.max_drawdown,
          win_rate: parsed.metrics.win_rate,
          avg_turnover: parsed.metrics.avg_turnover,
          equity_curve: parsed.equity_curve,
          train_sharpe: trainSharpe,
          train_pnl: trainPnl,
        })
        .eq("id", backtestId);
    } else {
      await supabase
        .from("backtest_results")
        .update({
          status: "failed",
          error_message: parsed.error,
        })
        .eq("id", backtestId);
    }
  } catch (error) {
    await supabase
      .from("backtest_results")
      .update({
        status: "failed",
        error_message: `Inline execution error: ${error instanceof Error ? error.message : String(error)}`,
      })
      .eq("id", backtestId);
  }
}
