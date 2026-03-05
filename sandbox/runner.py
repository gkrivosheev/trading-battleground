"""
Trading Battleground — Modal Sandbox Runner

Wraps the backtester in an isolated Modal container for safe execution.
"""

import modal
from modal import fastapi_endpoint

app = modal.App("trading-battleground")

image = (
    modal.Image.debian_slim()
    .pip_install([
        "pandas",
        "numpy",
        "scipy",
        "scikit-learn",
        "statsmodels",
        "ta",
        "optuna",
        "fastapi[standard]",
    ])
    .add_local_dir("core", remote_path="/root/core")
)


@app.function(
    image=image,
    timeout=300,        # 5 min max per backtest
    memory=512,         # 512MB container
    cpu=1.0,
)
def run_backtest_sandboxed(payload: dict) -> dict:
    """
    Execute a backtest in an isolated container.

    payload contains:
        code: str               - user's full strategy code
        selected_assets: list   - tickers to include
        market_data: dict       - {ticker: [{date, open, high, low, close, volume}, ...]}
        start_date: str         - 'YYYY-MM-DD'
        end_date: str           - 'YYYY-MM-DD'
        parameter_overrides: dict - optuna-provided or user defaults
    """
    import sys
    sys.path.insert(0, "/root")

    try:
        import pandas as pd
        from core.backtester import run_backtest, validate_code

        # Validate code BEFORE running (import whitelist check)
        validate_code(payload["code"])

        # Convert serialized market data back to DataFrames
        market_data_df = {}
        for ticker, rows in payload["market_data"].items():
            df = pd.DataFrame(rows)
            df["date"] = pd.to_datetime(df["date"])
            for col in ["open", "high", "low", "close"]:
                df[col] = df[col].astype(float)
            df["volume"] = df["volume"].astype(int)
            market_data_df[ticker] = df

        result = run_backtest(
            code=payload["code"],
            selected_assets=payload["selected_assets"],
            market_data_df=market_data_df,
            start_date=payload["start_date"],
            end_date=payload["end_date"],
            parameter_overrides=payload.get("parameter_overrides", {}),
        )

        return result

    except Exception as e:
        return {
            "status": "error",
            "error": f"{type(e).__name__}: {str(e)}",
            "metrics": None,
            "equity_curve": [],
            "signals": [],
        }


@app.function(
    image=image,
    timeout=300,
    memory=512,
    cpu=1.0,
)
@fastapi_endpoint(method="POST")
def run_backtest_web(payload: dict) -> dict:
    """HTTP POST endpoint that delegates to run_backtest_sandboxed."""
    return run_backtest_sandboxed.local(payload)


@app.function(
    image=image,
    timeout=300,
    memory=512,
    cpu=1.0,
)
def optimize_sandboxed(payload: dict) -> dict:
    """
    Run Optuna optimization in an isolated container.

    payload contains:
        code: str
        selected_assets: list
        market_data: dict
        train_start: str
        train_end: str
        n_trials: int
    """
    import sys
    sys.path.insert(0, "/root")

    try:
        import pandas as pd
        from core.backtester import validate_code
        from core.optimizer import optimize_parameters

        validate_code(payload["code"])

        market_data_df = {}
        for ticker, rows in payload["market_data"].items():
            df = pd.DataFrame(rows)
            df["date"] = pd.to_datetime(df["date"])
            for col in ["open", "high", "low", "close"]:
                df[col] = df[col].astype(float)
            df["volume"] = df["volume"].astype(int)
            market_data_df[ticker] = df

        best_params = optimize_parameters(
            code=payload["code"],
            selected_assets=payload["selected_assets"],
            market_data_df=market_data_df,
            train_start=payload["train_start"],
            train_end=payload["train_end"],
            n_trials=payload.get("n_trials", 50),
        )

        return {"status": "success", "best_params": best_params}

    except Exception as e:
        return {"status": "error", "error": str(e), "best_params": {}}
