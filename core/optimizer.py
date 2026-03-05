"""
Trading Battleground — Optuna Parameter Optimizer

Optimizes strategy parameters on the training period to maximize Sharpe ratio.
"""

import optuna

from core.backtester import parse_parameters, run_backtest

# Suppress Optuna's verbose logging
optuna.logging.set_verbosity(optuna.logging.WARNING)


def optimize_parameters(
    code: str,
    selected_assets: list[str],
    market_data_df: dict,
    train_start: str,
    train_end: str,
    n_trials: int = 50,
) -> dict:
    """
    Find optimal parameters on the training set.

    Args:
        code: user's full strategy code
        selected_assets: tickers to include
        market_data_df: {ticker: pd.DataFrame}
        train_start: 'YYYY-MM-DD'
        train_end: 'YYYY-MM-DD'
        n_trials: number of Optuna trials

    Returns:
        dict of best parameters found
    """
    param_schema = parse_parameters(code)

    if not param_schema:
        return {}

    def objective(trial):
        # Map parameter schema to Optuna suggestions
        overrides = {}
        for name, spec in param_schema.items():
            param_type = spec.get("type", "float")
            low = spec.get("low", 0)
            high = spec.get("high", 1)

            if param_type == "int":
                overrides[name] = trial.suggest_int(name, int(low), int(high))
            else:
                overrides[name] = trial.suggest_float(name, float(low), float(high))

        # Run backtest with these parameters
        result = run_backtest(
            code=code,
            selected_assets=selected_assets,
            market_data_df=market_data_df,
            start_date=train_start,
            end_date=train_end,
            parameter_overrides=overrides,
        )

        if result["status"] == "error":
            return -999.0

        return result["metrics"]["sharpe_ratio"]

    study = optuna.create_study(direction="maximize")
    study.optimize(objective, n_trials=n_trials, timeout=240)

    return study.best_params
