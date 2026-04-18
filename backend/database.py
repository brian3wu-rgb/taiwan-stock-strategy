"""
database.py
─────────────────────────────────────────────────────────────────────
SQLite 資料庫管理模組。
支援：初始化、新欄位自動遷移、儲存 / 讀取掃描結果。
"""

import os
import sqlite3
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

DB_PATH: str = os.getenv("DATABASE_URL", "./data/stocks.db")


# ─────────────────────────────────────────────
#  初始化 & 遷移
# ─────────────────────────────────────────────

def _add_column_if_missing(cursor: sqlite3.Cursor, table: str, column: str, col_type: str) -> None:
    """若欄位不存在則自動新增（SQLite 不支援 ALTER COLUMN IF NOT EXISTS）。"""
    cursor.execute(f"PRAGMA table_info({table})")
    existing = {row[1] for row in cursor.fetchall()}
    if column not in existing:
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        logger.info("DB migration: added column %s.%s", table, column)


def init_db() -> None:
    """建立資料表並自動補齊新欄位（支援舊版 DB 升級）。"""
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    # ── 掃描結果表 ───────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS scan_results (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol          TEXT    NOT NULL,
            name            TEXT    NOT NULL,
            signal          TEXT    NOT NULL,
            price           REAL    NOT NULL,
            ma5             REAL,
            ma100           REAL,
            cross_proximity REAL,           -- |MA5-MA100|/MA100，越小越接近交叉
            volume_ratio    REAL,           -- 今日量 / 20日均量
            scan_date       TEXT    NOT NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)

    # 舊版 DB 補欄位遷移
    _add_column_if_missing(cur, "scan_results", "cross_proximity", "REAL")
    _add_column_if_missing(cur, "scan_results", "volume_ratio",    "REAL")

    # ── 掃描日誌表 ───────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS scan_logs (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at      TIMESTAMP,
            finished_at     TIMESTAMP,
            total_scanned   INTEGER,
            signals_found   INTEGER,
            status          TEXT,
            error_msg       TEXT
        )
    """)

    conn.commit()
    conn.close()
    logger.info("Database ready: %s", DB_PATH)


# ─────────────────────────────────────────────
#  寫入
# ─────────────────────────────────────────────

def save_scan_results(results: List[Dict], scan_date: str) -> None:
    """
    儲存掃描結果。同一日期舊資料先清除（冪等性）。
    results 中的每筆 dict 需包含：
      symbol, name, signal, price, ma5, ma100,
      cross_proximity, volume_ratio, scan_date
    """
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()
    cur.execute("DELETE FROM scan_results WHERE scan_date = ?", (scan_date,))

    for r in results:
        cur.execute("""
            INSERT INTO scan_results
              (symbol, name, signal, price, ma5, ma100, cross_proximity, volume_ratio, scan_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            r["symbol"],
            r["name"],
            r["signal"],
            r["price"],
            r.get("ma5"),
            r.get("ma100"),
            r.get("cross_proximity"),
            r.get("volume_ratio"),
            scan_date,
        ))

    conn.commit()
    conn.close()
    logger.info("Saved %d results for %s", len(results), scan_date)


def log_scan(started_at, finished_at, total_scanned: int,
             signals_found: int, status: str, error_msg: str = "") -> None:
    """寫入掃描執行紀錄。"""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        INSERT INTO scan_logs
          (started_at, finished_at, total_scanned, signals_found, status, error_msg)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (started_at, finished_at, total_scanned, signals_found, status, error_msg))
    conn.commit()
    conn.close()


# ─────────────────────────────────────────────
#  讀取
# ─────────────────────────────────────────────

def get_latest_scan_results() -> List[Dict]:
    """
    回傳最新一次掃描結果，依 cross_proximity 升冪排列
    （越接近交叉點排越前面）。
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur  = conn.cursor()
    cur.execute("""
        SELECT symbol, name, signal, price, ma5, ma100,
               cross_proximity, volume_ratio, scan_date
        FROM scan_results
        WHERE scan_date = (SELECT MAX(scan_date) FROM scan_results)
        ORDER BY cross_proximity ASC, symbol ASC
    """)
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]


def get_last_scan_date() -> Optional[str]:
    """回傳最後掃描日期，無資料時回傳 None。"""
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()
    cur.execute("SELECT MAX(scan_date) FROM scan_results")
    result = cur.fetchone()
    conn.close()
    return result[0] if result and result[0] else None


def get_results_by_date(date: str) -> List[Dict]:
    """回傳指定日期的掃描結果。"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur  = conn.cursor()
    cur.execute("""
        SELECT symbol, name, signal, price, ma5, ma100,
               cross_proximity, volume_ratio, scan_date
        FROM scan_results WHERE scan_date = ?
        ORDER BY cross_proximity ASC
    """, (date,))
    rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]
