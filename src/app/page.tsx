"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase";

interface LeaderboardEntry {
  id: string;
  sharpe_ratio: number;
  total_pnl: number;
  max_drawdown: number;
  win_rate: number;
  train_sharpe: number | null;
  created_at: string;
  strategies: {
    name: string;
    selected_assets: string[];
    user_id: string;
  } | null;
}

const ASSET_CLASSES = [
  { value: "", label: "All" },
  { value: "etf", label: "ETFs" },
  { value: "crypto", label: "Crypto" },
  { value: "fx", label: "FX" },
];

const PAGE_SIZE = 20;

export default function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [assetClass, setAssetClass] = useState("");

  useEffect(() => {
    async function fetchLeaderboard() {
      setLoading(true);
      try {
        const supabase = getSupabase();
        const offset = (page - 1) * PAGE_SIZE;

        const query = supabase
          .from("backtest_results")
          .select(`
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
          `)
          .eq("status", "complete")
          .not("sharpe_ratio", "is", null)
          .order("sharpe_ratio", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        const { data, error } = await query;

        if (error) {
          console.error("Supabase error:", error);
          setEntries([]);
          return;
        }

        let filtered = (data || []) as unknown as LeaderboardEntry[];

        // Client-side asset class filter
        if (assetClass) {
          const { data: assets } = await supabase
            .from("assets")
            .select("ticker")
            .eq("asset_class", assetClass);

          const tickers = new Set((assets || []).map((a: { ticker: string }) => a.ticker));
          filtered = filtered.filter((row) => {
            const selected = row.strategies?.selected_assets || [];
            return selected.some((t) => tickers.has(t));
          });
        }

        setEntries(filtered);
      } catch (err) {
        console.error("Failed to fetch leaderboard:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchLeaderboard();
  }, [page, assetClass]);

  const formatPct = (val: number) => `${(val * 100).toFixed(2)}%`;
  const formatSharpe = (val: number) => val.toFixed(2);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Leaderboard</h1>
        <p className="text-gray-400">
          Top trading strategies ranked by out-of-sample Sharpe ratio
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6">
        {ASSET_CLASSES.map((ac) => (
          <button
            key={ac.value}
            onClick={() => {
              setAssetClass(ac.value);
              setPage(1);
            }}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              assetClass === ac.value
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
            }`}
          >
            {ac.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800 text-left">
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Rank
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Strategy
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Assets
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                  Test Sharpe
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                  PnL
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                  Max DD
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                  Win Rate
                </th>
                <th className="px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider text-right">
                  Submitted
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {loading ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-gray-500"
                  >
                    Loading...
                  </td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-12 text-center text-gray-500"
                  >
                    No strategies yet. Be the first to{" "}
                    <Link
                      href="/submit"
                      className="text-indigo-400 hover:underline"
                    >
                      submit one
                    </Link>
                    !
                  </td>
                </tr>
              ) : (
                entries.map((entry, idx) => {
                  const rank = (page - 1) * 20 + idx + 1;
                  return (
                    <Link
                      key={entry.id}
                      href={`/results/${entry.id}`}
                      className="table-row hover:bg-gray-800/50 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            rank === 1
                              ? "bg-yellow-500/20 text-yellow-400"
                              : rank === 2
                              ? "bg-gray-400/20 text-gray-300"
                              : rank === 3
                              ? "bg-amber-600/20 text-amber-500"
                              : "bg-gray-800 text-gray-500"
                          }`}
                        >
                          {rank}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        {entry.strategies?.name || "Unnamed"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(entry.strategies?.selected_assets || [])
                            .slice(0, 3)
                            .map((a) => (
                              <span
                                key={a}
                                className="inline-block px-1.5 py-0.5 text-xs bg-gray-800 text-gray-400 rounded"
                              >
                                {a}
                              </span>
                            ))}
                          {(entry.strategies?.selected_assets || []).length >
                            3 && (
                            <span className="text-xs text-gray-500">
                              +
                              {(entry.strategies?.selected_assets || []).length -
                                3}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono text-sm ${
                            entry.sharpe_ratio > 0
                              ? "text-green-400"
                              : entry.sharpe_ratio < 0
                              ? "text-red-400"
                              : "text-gray-400"
                          }`}
                        >
                          {formatSharpe(entry.sharpe_ratio)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={`font-mono text-sm ${
                            entry.total_pnl > 0
                              ? "text-green-400"
                              : entry.total_pnl < 0
                              ? "text-red-400"
                              : "text-gray-400"
                          }`}
                        >
                          {formatPct(entry.total_pnl)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-red-400">
                          {formatPct(entry.max_drawdown)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-sm text-gray-300">
                          {formatPct(entry.win_rate)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm text-gray-500">
                          {new Date(entry.created_at).toLocaleDateString()}
                        </span>
                      </td>
                    </Link>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-center gap-4 mt-6">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="px-4 py-2 text-sm bg-gray-800 text-gray-400 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Previous
        </button>
        <span className="text-sm text-gray-500">Page {page}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={entries.length < 20}
          className="px-4 py-2 text-sm bg-gray-800 text-gray-400 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Next
        </button>
      </div>
    </div>
  );
}
