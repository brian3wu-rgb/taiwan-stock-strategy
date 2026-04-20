"""
indicators.py
─────────────────────────────────────────────────────────────────────
技術指標計算模組：MA5、MA100、成交量比率、交叉接近程度，
以及做多 / 做空訊號判斷。

策略邏輯：近5個交易日內 close 穿越 MA100
  做多（LONG）：
    1. 最新收盤 > MA100（目前仍在 MA100 上方）
    2. 近5個交易日內，至少1天的收盤 < MA100（確認是近期突破，不是老早就過了）
    3. 非趨勢不明（|close - MA100| >= 0.3%）

  做空（SHORT）：
    1. 最新收盤 < MA100（目前仍在 MA100 下方）
    2. 近5個交易日內，至少1天的收盤 > MA100（確認是近期跌破）
    3. 非趨勢不明（|close - MA100| >= 0.3%）

排序欄位：
  cross_proximity = |MA5 - MA100| / MA100
  值越小 = 穿越時間點越接近（MA5 也接近 MA100）→ 排列越前面
"""

import pandas as pd
from typing import Tuple


# ─────────────────────────────────────────────
#  均線計算
# ─────────────────────────────────────────────

def calculate_ma(series: pd.Series, period: int) -> pd.Series:
    """計算簡單移動平均線（SMA）。資料不足 period 筆時回傳 NaN。"""
    return series.rolling(window=period, min_periods=period).mean()


# ─────────────────────────────────────────────
#  成交量過濾
# ─────────────────────────────────────────────

def check_volume_filter(df: pd.DataFrame, period: int = 20) -> Tuple[bool, float]:
    """
    當天成交量是否大於 N 日平均成交量。
    回傳 (pass: bool, volume_ratio: float)

    - pass=True  → 通過過濾（量能放大）
    - volume_ratio = 今日量 / N 日均量
    - 無法計算時預設放行（ratio=1.0）
    """
    if "Volume" not in df.columns or len(df) < period + 1:
        return True, 1.0

    vol_today = float(df["Volume"].iloc[-1])
    vol_avg   = float(df["Volume"].iloc[-(period + 1) : -1].mean())

    if vol_avg == 0 or pd.isna(vol_avg) or pd.isna(vol_today):
        return True, 1.0

    ratio = vol_today / vol_avg
    return True, round(ratio, 3)


# ─────────────────────────────────────────────
#  交叉接近程度
# ─────────────────────────────────────────────

def compute_cross_proximity(ma5: float, ma100: float) -> float:
    """
    計算 MA5 與 MA100 的交叉接近程度。
    回傳 |MA5 - MA100| / MA100，值越小代表越接近交叉點。
    """
    if ma100 == 0:
        return float("inf")
    return abs(ma5 - ma100) / ma100


# ─────────────────────────────────────────────
#  訊號判斷
# ─────────────────────────────────────────────

def check_long_signal(df: pd.DataFrame) -> bool:
    """
    做多訊號：近5個交易日內 close 突破 MA100 向上。
      1. 最新收盤 > MA100（目前仍在 MA100 上方）
      2. 最近5個交易日（今天之前）至少1天收盤 < MA100（確認是近期突破）
      3. 非趨勢不明（|close - MA100| >= 0.3%）
    """
    if len(df) < 6:
        return False

    today = df.iloc[-1]
    close = float(today["Close"])
    ma100 = float(today["MA100"]) if pd.notna(today.get("MA100")) else None

    if ma100 is None or ma100 == 0:
        return False

    # 條件1：目前在 MA100 上方
    if close <= ma100:
        return False

    # 條件3：排除趨勢不明（太接近 MA100）
    if abs(close - ma100) < ma100 * 0.003:
        return False

    # 條件2：近5個交易日內曾在 MA100 下方（確認是近期突破而非早就在上面）
    prev5 = df.iloc[-6:-1]   # 今天前5個交易日
    for _, row in prev5.iterrows():
        prev_close = float(row["Close"])
        prev_ma100 = float(row["MA100"]) if pd.notna(row.get("MA100")) else None
        if prev_ma100 and prev_close < prev_ma100:
            return True

    return False


def check_short_signal(df: pd.DataFrame) -> bool:
    """
    做空訊號：近5個交易日內 close 跌破 MA100 向下。
      1. 最新收盤 < MA100（目前仍在 MA100 下方）
      2. 最近5個交易日（今天之前）至少1天收盤 > MA100（確認是近期跌破）
      3. 非趨勢不明（|close - MA100| >= 0.3%）
    """
    if len(df) < 6:
        return False

    today = df.iloc[-1]
    close = float(today["Close"])
    ma100 = float(today["MA100"]) if pd.notna(today.get("MA100")) else None

    if ma100 is None or ma100 == 0:
        return False

    # 條件1：目前在 MA100 下方
    if close >= ma100:
        return False

    # 條件3：排除趨勢不明
    if abs(close - ma100) < ma100 * 0.003:
        return False

    # 條件2：近5個交易日內曾在 MA100 上方（確認是近期跌破）
    prev5 = df.iloc[-6:-1]   # 今天前5個交易日
    for _, row in prev5.iterrows():
        prev_close = float(row["Close"])
        prev_ma100 = float(row["MA100"]) if pd.notna(row.get("MA100")) else None
        if prev_ma100 and prev_close > prev_ma100:
            return True

    return False
