"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface BacktestResult {
  id: string;
  status: string;
  error_message: string | null;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  sharpe_ratio: number | null;
  total_pnl: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  avg_turnover: number | null;
  train_sharpe: number | null;
  train_pnl: number | null;
  optimized_params: Record<string, unknown>;
  equity_curve: Array<{ date: string; value: number }> | null;
  created_at: string;
  strategies: {
    name: string;
    description: string;
    code: string;
    selected_assets: string[];
    parameters: Record<string, unknown>;
    user_id: string;
  } | null;
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className={`text-2xl font-mono font-bold ${color || "text-white"}`}>
        {value}
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const params = useParams();
  const id = params.id as string;
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;

    let interval: NodeJS.Timeout;

    async function fetchResult() {
      try {
        const res = await fetch(`/api/backtest/${id}`);
        const data = await res.json();
        setResult(data);
        setLoading(false);

        // Keep polling if pending or running
        if (data.status === "pending" || data.status === "running") {
          interval = setInterval(async () => {
            const res2 = await fetch(`/api/backtest/${id}`);
            const data2 = await res2.json();
            setResult(data2);
            if (data2.status !== "pending" && data2.status !== "running") {
              clearInterval(interval);
            }
          }, 2000);
        }
      } catch (err) {
        console.error("Failed to fetch result:", err);
        setLoading(false);
      }
    }

    fetchResult();
    return () => clearInterval(interval);
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-gray-500">
        Loading backtest results...
      </div>
    );
  }

  if (!result) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center text-gray-500">
        Backtest not found.
      </div>
    );
  }

  const isPending =
    result.status === "pending" || result.status === "running";
  const isFailed = result.status === "failed";
  const isComplete = result.status === "complete";

  const formatPct = (val: number | null) =>
    val !== null ? `${(val * 100).toFixed(2)}%` : "—";
  const formatSharpe = (val: number | null) =>
    val !== null ? val.toFixed(2) : "—";

  // Overfitting indicator
  const hasOverfitWarning =
    result.train_sharpe !== null &&
    result.sharpe_ratio !== null &&
    result.train_sharpe > 0 &&
    result.sharpe_ratio < result.train_sharpe * 0.5;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-1">
          {result.strategies?.name || "Untitled Strategy"}
        </h1>
        {result.strategies?.description && (
          <p className="text-gray-400">{result.strategies.description}</p>
        )}
        <div className="flex items-center gap-3 mt-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isComplete
                ? "bg-green-500/20 text-green-400"
                : isFailed
                ? "bg-red-500/20 text-red-400"
                : "bg-yellow-500/20 text-yellow-400"
            }`}
          >
            {result.status}
          </span>
          <span className="text-sm text-gray-500">
            Test: {result.test_start} to {result.test_end}
          </span>
        </div>
      </div>

      {/* Pending/Running */}
      {isPending && (
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
          <div className="animate-pulse text-yellow-400 text-lg mb-2">
            Backtest is {result.status}...
          </div>
          <p className="text-gray-500 text-sm">
            Polling every 2 seconds for results.
          </p>
        </div>
      )}

      {/* Error */}
      {isFailed && result.error_message && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-6 mb-8">
          <h3 className="text-red-400 font-medium mb-2">Backtest Failed</h3>
          <pre className="text-sm text-red-300 whitespace-pre-wrap font-mono">
            {result.error_message}
          </pre>
        </div>
      )}

      {/* Results */}
      {isComplete && (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <MetricCard
              label="Sharpe Ratio"
              value={formatSharpe(result.sharpe_ratio)}
              color={
                result.sharpe_ratio && result.sharpe_ratio > 0
                  ? "text-green-400"
                  : "text-red-400"
              }
            />
            <MetricCard
              label="Total PnL"
              value={formatPct(result.total_pnl)}
              color={
                result.total_pnl && result.total_pnl > 0
                  ? "text-green-400"
                  : "text-red-400"
              }
            />
            <MetricCard
              label="Max Drawdown"
              value={formatPct(result.max_drawdown)}
              color="text-red-400"
            />
            <MetricCard
              label="Win Rate"
              value={formatPct(result.win_rate)}
              color="text-blue-400"
            />
          </div>

          {/* Overfitting Warning */}
          {hasOverfitWarning && (
            <div className="bg-yellow-950/50 border border-yellow-800 rounded-lg p-4 mb-8">
              <h3 className="text-yellow-400 font-medium mb-1">
                Overfitting Warning
              </h3>
              <p className="text-sm text-yellow-300/70">
                Test Sharpe ({formatSharpe(result.sharpe_ratio)}) is
                significantly lower than Train Sharpe (
                {formatSharpe(result.train_sharpe)}). This strategy may be
                overfit to the training period.
              </p>
            </div>
          )}

          {/* Train vs Test Comparison */}
          {result.train_sharpe !== null && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Train Period
                </div>
                <div className="flex items-baseline gap-4">
                  <div>
                    <span className="text-xs text-gray-500">Sharpe: </span>
                    <span className="font-mono text-lg text-gray-300">
                      {formatSharpe(result.train_sharpe)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">PnL: </span>
                    <span className="font-mono text-lg text-gray-300">
                      {formatPct(result.train_pnl)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
                <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                  Test Period
                </div>
                <div className="flex items-baseline gap-4">
                  <div>
                    <span className="text-xs text-gray-500">Sharpe: </span>
                    <span className="font-mono text-lg text-white">
                      {formatSharpe(result.sharpe_ratio)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500">PnL: </span>
                    <span className="font-mono text-lg text-white">
                      {formatPct(result.total_pnl)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Equity Curve */}
          {result.equity_curve && result.equity_curve.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
              <h3 className="text-sm font-medium text-gray-400 mb-4">
                Equity Curve
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={result.equity_curve}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#1f2937"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fill: "#6b7280", fontSize: 11 }}
                      tickFormatter={(val: string) =>
                        val.slice(5) // show MM-DD
                      }
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill: "#6b7280", fontSize: 11 }}
                      domain={["auto", "auto"]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#111827",
                        border: "1px solid #374151",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                      labelStyle={{ color: "#9ca3af" }}
                      formatter={(value?: number) => [
                        value !== undefined ? value.toFixed(4) : "—",
                        "Equity",
                      ]}
                    />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#6366f1"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Strategy Assets */}
          {result.strategies?.selected_assets && (
            <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 mb-8">
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
                Assets
              </div>
              <div className="flex flex-wrap gap-2">
                {result.strategies.selected_assets.map((a) => (
                  <span
                    key={a}
                    className="px-2 py-1 text-sm bg-gray-800 text-gray-300 rounded"
                  >
                    {a}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
