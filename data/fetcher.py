"""
Data pipeline: fetch market data via yfinance and cache in Supabase.
Called nightly by Vercel cron job.
"""

import os
from datetime import datetime, timedelta

import pandas as pd

UNIVERSE = [
    # US Equity ETFs
    "SPY", "QQQ", "IWM", "DIA",
    # Sector ETFs
    "XLF", "XLK", "XLE", "XLV", "XLI",
    # Bonds
    "TLT", "IEF", "HYG", "LQD",
    # Commodities / Alternatives
    "GLD", "SLV", "USO",
    # Volatility
    "VIXY",
    # Crypto
    "BTC-USD", "ETH-USD",
    # FX
    "UUP",
]


def fetch_and_cache(tickers: list[str], supabase_client):
    """
    Fetch last 5 years of daily OHLCV for all tickers via yfinance.
    Upsert into market_data table.
    Called by nightly Vercel cron job.
    """
    import yfinance as yf

    end_date = datetime.utcnow().strftime("%Y-%m-%d")
    start_date = (datetime.utcnow() - timedelta(days=5 * 365)).strftime("%Y-%m-%d")

    for ticker in tickers:
        try:
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if df.empty:
                print(f"No data for {ticker}")
                continue

            # Handle multi-level columns from yfinance
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.get_level_values(0)

            df = df.reset_index()
            df = df.rename(columns={
                "Date": "date",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            })

            rows = []
            for _, row in df.iterrows():
                rows.append({
                    "ticker": ticker,
                    "date": row["date"].strftime("%Y-%m-%d"),
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": int(row["volume"]) if pd.notna(row["volume"]) else 0,
                })

            # Upsert in batches of 500
            batch_size = 500
            for i in range(0, len(rows), batch_size):
                batch = rows[i : i + batch_size]
                supabase_client.table("market_data").upsert(
                    batch, on_conflict="ticker,date"
                ).execute()

            print(f"Cached {len(rows)} rows for {ticker}")

        except Exception as e:
            print(f"Error fetching {ticker}: {e}")


def load_market_data(tickers: list[str], supabase_client) -> dict:
    """
    Load from Supabase into {ticker: pd.DataFrame} dict.
    Called by backtester before running.
    """
    result = {}

    for ticker in tickers:
        response = (
            supabase_client.table("market_data")
            .select("date,open,high,low,close,volume")
            .eq("ticker", ticker)
            .order("date")
            .execute()
        )

        if response.data:
            df = pd.DataFrame(response.data)
            df["date"] = pd.to_datetime(df["date"])
            for col in ["open", "high", "low", "close"]:
                df[col] = df[col].astype(float)
            df["volume"] = df["volume"].astype(int)
            result[ticker] = df

    return result
