"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// Dynamically import Monaco to avoid SSR issues
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

interface Asset {
  id: number;
  ticker: string;
  name: string;
  asset_class: string;
  active: boolean;
}

const DEFAULT_CODE = `# Define your parameters here (optional — used for Optuna tuning)
parameters = {
    'fast_window': {'type': 'int',   'low': 5,  'high': 30},
    'slow_window': {'type': 'int',   'low': 20, 'high': 100},
}

def signal(market_data, state, parameters):
    """
    Called once per trading day.

    Args:
        market_data: object with attributes:
            .close      pd.DataFrame  (days_so_far x n_assets)
            .open       pd.DataFrame
            .high       pd.DataFrame
            .low        pd.DataFrame
            .volume     pd.DataFrame
            .today      str  'YYYY-MM-DD'
            .assets     list[str]
        state: dict — persist anything between bars (max 10MB, 100 keys)
        parameters: SimpleNamespace — access as parameters.my_param

    Returns:
        float in [-1.0, 1.0]
         1.0 = 100% long
         0.0 = flat
        -1.0 = 100% short
    """
    # Get SPY close prices up to today
    spy = market_data.close['SPY']

    if len(spy) < parameters.slow_window:
        return 0.0  # not enough data yet

    fast_ma = spy.rolling(parameters.fast_window).mean().iloc[-1]
    slow_ma = spy.rolling(parameters.slow_window).mean().iloc[-1]

    if fast_ma > slow_ma:
        return 1.0   # go long
    else:
        return -1.0  # go short
`;

export default function SubmitPage() {
  const router = useRouter();
  const [code, setCode] = useState(DEFAULT_CODE);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssets, setSelectedAssets] = useState<string[]>(["SPY"]);
  const [assetSearch, setAssetSearch] = useState("");
  const [trainStart, setTrainStart] = useState("2019-01-01");
  const [trainEnd, setTrainEnd] = useState("2022-12-31");
  const [testStart, setTestStart] = useState("2023-01-01");
  const [testEnd, setTestEnd] = useState("2024-12-31");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [parsedParams, setParsedParams] = useState<
    Record<string, { type: string; low: number; high: number }>
  >({});

  // Fetch available assets
  useEffect(() => {
    async function loadAssets() {
      try {
        const res = await fetch("/api/assets");
        const data = await res.json();
        setAssets(data || []);
      } catch (err) {
        console.error("Failed to load assets:", err);
      }
    }
    loadAssets();
  }, []);

  // Parse parameters from code
  const parseParamsFromCode = useCallback((codeStr: string) => {
    try {
      // Simple regex to extract the parameters dict from Python code
      const match = codeStr.match(
        new RegExp("parameters\\s*=\\s*\\{([^}]*(?:\\{[^}]*\\}[^}]*)*)\\}", "s")
      );
      if (!match) {
        setParsedParams({});
        return;
      }

      // Parse individual parameter entries
      const params: Record<
        string,
        { type: string; low: number; high: number }
      > = {};
      const paramRegex =
        /'(\w+)'\s*:\s*\{\s*'type'\s*:\s*'(\w+)'\s*,\s*'low'\s*:\s*([\d.]+)\s*,\s*'high'\s*:\s*([\d.]+)\s*\}/g;
      let m;
      while ((m = paramRegex.exec(match[0])) !== null) {
        params[m[1]] = {
          type: m[2],
          low: parseFloat(m[3]),
          high: parseFloat(m[4]),
        };
      }
      setParsedParams(params);
    } catch {
      setParsedParams({});
    }
  }, []);

  useEffect(() => {
    parseParamsFromCode(code);
  }, [code, parseParamsFromCode]);

  const toggleAsset = (ticker: string) => {
    setSelectedAssets((prev) =>
      prev.includes(ticker)
        ? prev.filter((t) => t !== ticker)
        : [...prev, ticker]
    );
  };

  const filteredAssets = assets.filter(
    (a) =>
      a.ticker.toLowerCase().includes(assetSearch.toLowerCase()) ||
      (a.name && a.name.toLowerCase().includes(assetSearch.toLowerCase()))
  );

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Strategy name is required");
      return;
    }
    if (selectedAssets.length === 0) {
      setError("Select at least one asset");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getAuthToken()}`,
        },
        body: JSON.stringify({
          code,
          name,
          description,
          selected_assets: selectedAssets,
          parameters: parsedParams,
          train_start: trainStart,
          train_end: trainEnd,
          test_start: testStart,
          test_end: testEnd,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to submit backtest");
        return;
      }

      router.push(`/results/${data.backtest_id}`);
    } catch (err) {
      setError(
        `Submission failed: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="h-[calc(100vh-56px)] flex">
      {/* Left Panel — Code Editor (60%) */}
      <div className="w-[60%] flex flex-col border-r border-gray-800">
        <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between">
          <span className="text-sm text-gray-400">strategy.py</span>
          <span className="text-xs text-gray-600">
            Python | Allowed: numpy, pandas, scipy, sklearn, statsmodels, ta
          </span>
        </div>
        <div className="flex-1">
          <Editor
            height="100%"
            language="python"
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              padding: { top: 12 },
            }}
          />
        </div>
      </div>

      {/* Right Panel — Configuration (40%) */}
      <div className="w-[40%] overflow-y-auto bg-gray-900/30">
        <div className="p-6 space-y-6">
          {/* Strategy Info */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Strategy Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Momentum Crossover"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of your strategy..."
              rows={2}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
            />
          </div>

          {/* Asset Selector */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Assets ({selectedAssets.length} selected)
            </label>
            <input
              type="text"
              value={assetSearch}
              onChange={(e) => setAssetSearch(e.target.value)}
              placeholder="Search tickers..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-2"
            />
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 bg-gray-800/50 rounded-md border border-gray-700">
              {filteredAssets.map((asset) => (
                <button
                  key={asset.ticker}
                  onClick={() => toggleAsset(asset.ticker)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    selectedAssets.includes(asset.ticker)
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-700 text-gray-400 hover:bg-gray-600"
                  }`}
                  title={asset.name || asset.ticker}
                >
                  {asset.ticker}
                </button>
              ))}
            </div>
          </div>

          {/* Parsed Parameters */}
          {Object.keys(parsedParams).length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Detected Parameters
              </label>
              <div className="bg-gray-800/50 rounded-md border border-gray-700 p-3 space-y-2">
                {Object.entries(parsedParams).map(([name, spec]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="font-mono text-gray-300">{name}</span>
                    <span className="text-gray-500">
                      {spec.type} [{spec.low}, {spec.high}]
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Date Ranges */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Train Start
              </label>
              <input
                type="date"
                value={trainStart}
                onChange={(e) => setTrainStart(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Train End
              </label>
              <input
                type="date"
                value={trainEnd}
                onChange={(e) => setTrainEnd(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Test Start
              </label>
              <input
                type="date"
                value={testStart}
                onChange={(e) => setTestStart(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Test End
              </label>
              <input
                type="date"
                value={testEnd}
                onChange={(e) => setTestEnd(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800 rounded-md text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:cursor-not-allowed text-white font-medium rounded-md transition-colors"
          >
            {submitting ? "Running Backtest..." : "Run Backtest"}
          </button>

          {/* Interface Docs */}
          <div className="border-t border-gray-800 pt-4">
            <h3 className="text-sm font-medium text-gray-400 mb-2">
              Strategy Interface
            </h3>
            <div className="text-xs text-gray-500 space-y-1 font-mono leading-relaxed">
              <p>signal(market_data, state, parameters) -&gt; float [-1, 1]</p>
              <p className="text-gray-600">
                Signal at bar T executes at T+1 OPEN
              </p>
              <p className="text-gray-600">
                P&L: T+1 open to T+1 close
              </p>
              <p className="text-gray-600">
                Cost: 0.05% per side when signal changes &gt; 0.01
              </p>
              <p className="text-gray-600">
                Warm-up: first 60 bars (signal called, returns not counted)
              </p>
              <p className="text-gray-600">
                Limits: 2s/bar, 256MB, state &lt; 10MB / 100 keys
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function getAuthToken(): string {
  // In production, get from Supabase auth session
  // For now, return empty string (auth handled by Supabase client)
  if (typeof window !== "undefined") {
    const session = localStorage.getItem("supabase.auth.token");
    if (session) {
      try {
        const parsed = JSON.parse(session);
        return parsed?.currentSession?.access_token || "";
      } catch {
        return "";
      }
    }
  }
  return "";
}
