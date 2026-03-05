"""
Trading Battleground — Core Backtester

Pure Python module with no web dependencies. Importable and testable standalone.
"""

import ast
import math
import pickle
from types import SimpleNamespace

import numpy as np
import pandas as pd


# ---------- Exceptions ----------

class SignalError(Exception):
    """Raised when user signal() returns invalid value."""
    pass


class StateError(Exception):
    """Raised when user state dict violates constraints."""
    pass


class ImportError_(Exception):
    """Raised when user code uses disallowed imports."""
    pass


# ---------- Import Whitelist / AST Validation ----------

ALLOWED_MODULES = frozenset([
    "numpy", "pandas", "scipy", "sklearn", "statsmodels", "ta", "math",
    "collections", "itertools", "functools", "typing", "types",
])

BANNED_NAMES = frozenset(["eval", "exec", "open", "__import__", "compile"])


def validate_code(code: str) -> None:
    """
    Parse user code with ast and validate:
    - Only whitelisted imports
    - No banned built-in calls
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ImportError_(f"Syntax error in strategy code: {e}")

    for node in ast.walk(tree):
        # Check import statements
        if isinstance(node, ast.Import):
            for alias in node.names:
                root_module = alias.name.split(".")[0]
                if root_module not in ALLOWED_MODULES:
                    raise ImportError_(
                        f"Import of '{alias.name}' is not allowed. "
                        f"Allowed modules: {sorted(ALLOWED_MODULES)}"
                    )
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                root_module = node.module.split(".")[0]
                if root_module not in ALLOWED_MODULES:
                    raise ImportError_(
                        f"Import from '{node.module}' is not allowed. "
                        f"Allowed modules: {sorted(ALLOWED_MODULES)}"
                    )

        # Check for banned function calls
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in BANNED_NAMES:
                raise ImportError_(f"Use of '{func.id}()' is not allowed.")
            if isinstance(func, ast.Attribute) and func.attr in BANNED_NAMES:
                raise ImportError_(f"Use of '.{func.attr}()' is not allowed.")

        # Check for banned name references (e.g. assigning __import__ to a var)
        if isinstance(node, ast.Name) and node.id == "__import__":
            raise ImportError_("Use of '__import__' is not allowed.")


# ---------- State Validation ----------

MAX_STATE_BYTES = 10 * 1024 * 1024  # 10MB
MAX_STATE_KEYS = 100


def validate_state(state: dict, bar_index: int) -> None:
    """Validate state dict after each signal() call."""
    if not isinstance(state, dict):
        raise StateError(f"Bar {bar_index}: state must be a dict, got {type(state).__name__}")

    if len(state) > MAX_STATE_KEYS:
        raise StateError(
            f"Bar {bar_index}: state has {len(state)} keys, max is {MAX_STATE_KEYS}"
        )

    for key in state:
        if not isinstance(key, str):
            raise StateError(f"Bar {bar_index}: state keys must be strings, got {type(key).__name__}")

    try:
        size = len(pickle.dumps(state))
    except Exception as e:
        raise StateError(f"Bar {bar_index}: state is not picklable: {e}")

    if size > MAX_STATE_BYTES:
        raise StateError(
            f"Bar {bar_index}: state size is {size / 1024 / 1024:.1f}MB, max is 10MB"
        )


# ---------- Signal Validation ----------

def validate_signal(signal_value, bar_index: int) -> float:
    """Validate and normalize signal return value."""
    if signal_value is None:
        raise SignalError(f"Bar {bar_index}: signal() returned None, expected float in [-1, 1]")

    try:
        signal_value = float(signal_value)
    except (TypeError, ValueError):
        raise SignalError(
            f"Bar {bar_index}: signal() returned {type(signal_value).__name__}, expected float"
        )

    if math.isnan(signal_value) or math.isinf(signal_value):
        raise SignalError(f"Bar {bar_index}: signal() returned {signal_value}, must be finite")

    if signal_value < -1.0 or signal_value > 1.0:
        raise SignalError(
            f"Bar {bar_index}: signal() returned {signal_value}, must be in [-1.0, 1.0]"
        )

    return signal_value


# ---------- Market Data Object ----------

class MarketDataView:
    """
    Provides a view of market data up to (and including) the current bar.
    Prevents lookahead by slicing DataFrames.
    """

    def __init__(
        self,
        close_df: pd.DataFrame,
        open_df: pd.DataFrame,
        high_df: pd.DataFrame,
        low_df: pd.DataFrame,
        volume_df: pd.DataFrame,
        dates: list[str],
        assets: list[str],
        current_index: int,
    ):
        # STRICT LOOKAHEAD PREVENTION: slice up to current_index + 1
        end = current_index + 1
        self.close = close_df.iloc[:end].copy()
        self.open = open_df.iloc[:end].copy()
        self.high = high_df.iloc[:end].copy()
        self.low = low_df.iloc[:end].copy()
        self.volume = volume_df.iloc[:end].copy()
        self.today = dates[current_index]
        self.assets = list(assets)


# ---------- Parameter Parsing ----------

def parse_parameters(code: str) -> dict:
    """
    Extract the `parameters = {...}` dict from user code.
    Returns the parameter schema dict.
    """
    try:
        tree = ast.parse(code)
    except SyntaxError:
        return {}

    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "parameters":
                    try:
                        return ast.literal_eval(node.value)
                    except (ValueError, TypeError):
                        return {}
    return {}


def build_parameters(param_schema: dict, overrides: dict) -> SimpleNamespace:
    """
    Build a SimpleNamespace from parameter schema + overrides.
    Uses midpoint as default if no override provided.
    """
    params = {}
    for name, spec in param_schema.items():
        if name in overrides:
            params[name] = overrides[name]
        else:
            # Default to midpoint
            low = spec.get("low", 0)
            high = spec.get("high", 1)
            if spec.get("type") == "int":
                params[name] = int((low + high) / 2)
            else:
                params[name] = (low + high) / 2
    return SimpleNamespace(**params)


# ---------- Core Backtester ----------

WARM_UP_BARS = 60
TRANSACTION_COST_PER_SIDE = 0.0005
SIGNAL_CHANGE_THRESHOLD = 0.01


def run_backtest(
    code: str,
    selected_assets: list[str],
    market_data_df: dict,
    start_date: str,
    end_date: str,
    parameter_overrides: dict | None = None,
) -> dict:
    """
    Run a backtest on user strategy code.

    Args:
        code: user's full strategy code (parameters dict + signal fn)
        selected_assets: tickers to include in market_data
        market_data_df: {ticker: pd.DataFrame with columns date/open/high/low/close/volume}
        start_date: 'YYYY-MM-DD'
        end_date: 'YYYY-MM-DD'
        parameter_overrides: optuna-provided values or user defaults

    Returns:
        dict with status, error, metrics, equity_curve, signals
    """
    if parameter_overrides is None:
        parameter_overrides = {}

    try:
        # Step 1: Validate code (import whitelist + banned names)
        validate_code(code)

        # Step 2: Build aligned DataFrames from market data
        # Find common date range across all selected assets
        all_dates = None
        for ticker in selected_assets:
            if ticker not in market_data_df:
                return {
                    "status": "error",
                    "error": f"No market data available for ticker '{ticker}'",
                    "metrics": None,
                    "equity_curve": [],
                    "signals": [],
                }
            df = market_data_df[ticker]
            df_dates = set(df["date"].astype(str))
            if all_dates is None:
                all_dates = df_dates
            else:
                all_dates = all_dates.intersection(df_dates)

        if not all_dates:
            return {
                "status": "error",
                "error": "No overlapping dates found for selected assets",
                "metrics": None,
                "equity_curve": [],
                "signals": [],
            }

        # Filter to date range and sort
        all_dates = sorted([d for d in all_dates if start_date <= d <= end_date])

        if len(all_dates) < WARM_UP_BARS + 10:
            return {
                "status": "error",
                "error": f"Not enough data: {len(all_dates)} bars, need at least {WARM_UP_BARS + 10}",
                "metrics": None,
                "equity_curve": [],
                "signals": [],
            }

        # Build aligned DataFrames
        close_data = {}
        open_data = {}
        high_data = {}
        low_data = {}
        volume_data = {}

        for ticker in selected_assets:
            df = market_data_df[ticker].copy()
            df["date_str"] = df["date"].astype(str)
            df = df[df["date_str"].isin(all_dates)].sort_values("date_str")
            df = df.set_index("date_str").reindex(all_dates)

            close_data[ticker] = df["close"].values
            open_data[ticker] = df["open"].values
            high_data[ticker] = df["high"].values
            low_data[ticker] = df["low"].values
            volume_data[ticker] = df["volume"].values

        close_df = pd.DataFrame(close_data, index=all_dates)
        open_df = pd.DataFrame(open_data, index=all_dates)
        high_df = pd.DataFrame(high_data, index=all_dates)
        low_df = pd.DataFrame(low_data, index=all_dates)
        volume_df = pd.DataFrame(volume_data, index=all_dates)

        # Step 3: Parse parameters and build namespace
        param_schema = parse_parameters(code)
        parameters = build_parameters(param_schema, parameter_overrides)

        # Step 4: Execute user code to define signal function
        user_globals = {"__builtins__": __builtins__}
        exec(code, user_globals)

        if "signal" not in user_globals:
            return {
                "status": "error",
                "error": "Strategy code must define a 'signal(market_data, state, parameters)' function",
                "metrics": None,
                "equity_curve": [],
                "signals": [],
            }

        signal_fn = user_globals["signal"]

        # Step 5: Run bar-by-bar simulation
        state = {}
        signals_list = []
        daily_returns = []
        equity = [1.0]
        signal_records = []
        prev_signal = 0.0
        n_bars = len(all_dates)

        for t in range(n_bars):
            # Build market data view up to bar T (strict lookahead prevention)
            market_view = MarketDataView(
                close_df=close_df,
                open_df=open_df,
                high_df=high_df,
                low_df=low_df,
                volume_df=volume_df,
                dates=all_dates,
                assets=selected_assets,
                current_index=t,
            )

            # Call user signal function
            try:
                raw_signal = signal_fn(market_view, state, parameters)
            except Exception as e:
                return {
                    "status": "error",
                    "error": f"Bar {t} ({all_dates[t]}): signal() raised {type(e).__name__}: {e}",
                    "metrics": None,
                    "equity_curve": [],
                    "signals": [],
                }

            # Validate signal
            sig = validate_signal(raw_signal, t)
            signals_list.append(sig)

            # Validate state
            validate_state(state, t)

            signal_records.append({"date": all_dates[t], "signal": sig})

            # Compute returns (skip warm-up and last bar)
            if t >= WARM_UP_BARS and t < n_bars - 1:
                # Signal from bar T is executed at bar T+1 OPEN
                # P&L marked from T+1 open to T+1 close
                next_open = open_df.iloc[t + 1]
                next_close = close_df.iloc[t + 1]

                # For multi-asset: use equal-weighted average of selected assets
                # Each asset gets the same signal
                asset_returns = []
                for ticker in selected_assets:
                    o = next_open[ticker]
                    c = next_close[ticker]
                    if o != 0 and pd.notna(o) and pd.notna(c):
                        asset_returns.append((c - o) / o)

                if asset_returns:
                    avg_return = np.mean(asset_returns)
                else:
                    avg_return = 0.0

                # Transaction cost
                signal_change = abs(sig - prev_signal)
                tx_cost = TRANSACTION_COST_PER_SIDE * 2 if signal_change > SIGNAL_CHANGE_THRESHOLD else 0.0

                daily_ret = sig * avg_return - tx_cost
                daily_returns.append(daily_ret)
                equity.append(equity[-1] * (1 + daily_ret))

            prev_signal = sig

        # Step 6: Calculate metrics
        daily_returns = np.array(daily_returns)

        if len(daily_returns) == 0 or np.std(daily_returns) == 0:
            sharpe = 0.0
        else:
            sharpe = float(np.mean(daily_returns) / np.std(daily_returns) * np.sqrt(252))

        total_pnl = float(equity[-1] / equity[0] - 1) if equity else 0.0

        # Max drawdown
        equity_arr = np.array(equity)
        running_max = np.maximum.accumulate(equity_arr)
        drawdowns = (equity_arr - running_max) / running_max
        max_drawdown = float(np.min(drawdowns)) if len(drawdowns) > 0 else 0.0

        # Win rate
        nonzero_returns = daily_returns[daily_returns != 0]
        if len(nonzero_returns) > 0:
            win_rate = float(np.sum(nonzero_returns > 0) / len(nonzero_returns))
        else:
            win_rate = 0.0

        # Average turnover
        signal_changes = np.abs(np.diff(signals_list[WARM_UP_BARS:]))
        avg_turnover = float(np.mean(signal_changes)) if len(signal_changes) > 0 else 0.0

        # Count trades (signal changes > threshold)
        n_trades = int(np.sum(signal_changes > SIGNAL_CHANGE_THRESHOLD))

        # Build equity curve output (from warm-up onward)
        equity_curve = []
        eq_dates = all_dates[WARM_UP_BARS: WARM_UP_BARS + len(equity)]
        for i, date in enumerate(eq_dates):
            if i < len(equity):
                equity_curve.append({"date": date, "value": round(equity[i], 6)})

        return {
            "status": "success",
            "error": None,
            "metrics": {
                "sharpe_ratio": round(sharpe, 4),
                "total_pnl": round(total_pnl, 4),
                "max_drawdown": round(max_drawdown, 4),
                "win_rate": round(win_rate, 4),
                "avg_turnover": round(avg_turnover, 4),
                "n_trades": n_trades,
            },
            "equity_curve": equity_curve,
            "signals": signal_records,
        }

    except (SignalError, StateError, ImportError_) as e:
        return {
            "status": "error",
            "error": str(e),
            "metrics": None,
            "equity_curve": [],
            "signals": [],
        }
    except Exception as e:
        return {
            "status": "error",
            "error": f"Unexpected error: {type(e).__name__}: {e}",
            "metrics": None,
            "equity_curve": [],
            "signals": [],
        }
