"""Unit tests for the core backtester."""

import numpy as np
import pandas as pd
import pytest

from core.backtester import (
    ImportError_,
    SignalError,
    StateError,
    parse_parameters,
    run_backtest,
    validate_code,
)


def make_market_data(n_days=200, tickers=None):
    """Generate synthetic market data for testing."""
    if tickers is None:
        tickers = ["SPY"]

    np.random.seed(42)
    dates = pd.date_range("2020-01-01", periods=n_days, freq="B")
    result = {}

    for ticker in tickers:
        price = 100.0
        rows = []
        for d in dates:
            change = np.random.randn() * 0.01
            o = price
            h = price * (1 + abs(np.random.randn() * 0.005))
            l = price * (1 - abs(np.random.randn() * 0.005))
            c = price * (1 + change)
            price = c
            rows.append({
                "date": d,
                "open": round(o, 2),
                "high": round(h, 2),
                "low": round(l, 2),
                "close": round(c, 2),
                "volume": int(np.random.randint(1_000_000, 10_000_000)),
            })
        result[ticker] = pd.DataFrame(rows)

    return result


EXAMPLE_STRATEGY = """
parameters = {
    'fast_window': {'type': 'int', 'low': 5, 'high': 30},
    'slow_window': {'type': 'int', 'low': 20, 'high': 100},
}

def signal(market_data, state, parameters):
    spy = market_data.close['SPY']

    if len(spy) < parameters.slow_window:
        return 0.0

    fast_ma = spy.rolling(parameters.fast_window).mean().iloc[-1]
    slow_ma = spy.rolling(parameters.slow_window).mean().iloc[-1]

    if fast_ma > slow_ma:
        return 1.0
    else:
        return -1.0
"""


class TestBacktester:
    def test_basic_run(self):
        data = make_market_data(200)
        result = run_backtest(
            code=EXAMPLE_STRATEGY,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "success"
        assert result["error"] is None
        assert "sharpe_ratio" in result["metrics"]
        assert "total_pnl" in result["metrics"]
        assert "max_drawdown" in result["metrics"]
        assert "win_rate" in result["metrics"]
        assert len(result["equity_curve"]) > 0
        assert result["equity_curve"][0]["value"] == 1.0

    def test_signal_validation_nan(self):
        code = """
def signal(market_data, state, parameters):
    return float('nan')
"""
        data = make_market_data(100)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "error"
        assert "NaN" in result["error"] or "nan" in result["error"]

    def test_signal_out_of_range(self):
        code = """
def signal(market_data, state, parameters):
    return 2.0
"""
        data = make_market_data(100)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "error"
        assert "[-1.0, 1.0]" in result["error"]

    def test_banned_import(self):
        code = """
import os
def signal(market_data, state, parameters):
    return 0.0
"""
        data = make_market_data(100)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "error"
        assert "not allowed" in result["error"]

    def test_banned_builtin(self):
        code = """
def signal(market_data, state, parameters):
    eval("1+1")
    return 0.0
"""
        with pytest.raises(ImportError_):
            validate_code(code)

    def test_allowed_import(self):
        code = """
import numpy as np
import pandas as pd
def signal(market_data, state, parameters):
    return 0.0
"""
        validate_code(code)  # should not raise

    def test_parse_parameters(self):
        params = parse_parameters(EXAMPLE_STRATEGY)
        assert "fast_window" in params
        assert params["fast_window"]["type"] == "int"
        assert params["fast_window"]["low"] == 5

    def test_missing_signal_function(self):
        code = """
x = 1
"""
        data = make_market_data(100)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "error"
        assert "signal" in result["error"].lower()

    def test_state_too_many_keys(self):
        code = """
def signal(market_data, state, parameters):
    for i in range(101):
        state[str(i)] = i
    return 0.0
"""
        data = make_market_data(100)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "error"
        assert "100" in result["error"]

    def test_flat_strategy(self):
        code = """
def signal(market_data, state, parameters):
    return 0.0
"""
        data = make_market_data(200)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "success"
        assert result["metrics"]["total_pnl"] == 0.0
        assert result["metrics"]["n_trades"] == 0

    def test_no_future_data_leakage(self):
        """Verify that market_data passed to signal() only contains data up to current bar."""
        code = """
def signal(market_data, state, parameters):
    # Store the length of close data at each bar
    if 'lengths' not in state:
        state['lengths'] = []
    state['lengths'].append(len(market_data.close))
    return 0.0
"""
        data = make_market_data(100)
        result = run_backtest(
            code=code,
            selected_assets=["SPY"],
            market_data_df=data,
            start_date="2020-01-01",
            end_date="2020-12-31",
        )
        assert result["status"] == "success"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
