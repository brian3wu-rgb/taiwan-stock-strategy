"""
database.py
─────────────────────────────────────────────────────────────────────
資料庫管理模組。
支援 PostgreSQL（Neon / Supabase 等雲端）與本地 SQLite（開發用）。
DATABASE_URL 格式：
  PostgreSQL: postgresql://user:pass@host/dbname?sslmode=require
  SQLite:     ./data/stocks.db  （以 / 或 . 開頭視為 SQLite）
"""

import os
import logging
from typing import List, Dict, Optional

logger = logging.getLogger(__name__)

DATABASE_URL: str = os.getenv("DATABASE_URL", "./data/stocks.db")

# ─────────────────────────────────────────────
#  判斷 DB 類型
# ─────────────────────────────────────────────

def _is_postgres() -> bool:
    return DATABASE_URL.startswith("postgresql://") or DATABASE_URL.startswith("postgres://")


def _connect():
    if _is_postgres():
        import psycopg2
        import psycopg2.extras
        conn = psycopg2.connect(DATABASE_URL)
        return conn
    else:
        import sqlite3
        os.makedirs(os.path.dirname(os.path.abspath(DATABASE_URL)), exist_ok=True)
        return sqlite3.connect(DATABASE_URL)


def _dict_rows(conn, cur) -> List[Dict]:
    """將 cursor 結果轉為 List[Dict]，相容 SQLite 與 psycopg2。"""
    if _is_postgres():
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]
    else:
        import sqlite3
        conn.row_factory = sqlite3.Row
        return [dict(r) for r in cur.fetchall()]


# ─────────────────────────────────────────────
#  初始化 & 遷移
# ─────────────────────────────────────────────

def _column_exists(cur, table: str, column: str) -> bool:
    if _is_postgres():
        cur.execute("""
            SELECT 1 FROM information_schema.columns
            WHERE table_name = %s AND column_name = %s
        """, (table, column))
    else:
        cur.execute(f"PRAGMA table_info({table})")
        cols = {row[1] for row in cur.fetchall()}
        return column in cols
    return cur.fetchone() is not None


def _add_column_if_missing(cur, table: str, column: str, col_type: str) -> None:
    if not _column_exists(cur, table, column):
        cur.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
        logger.info("DB migration: added column %s.%s", table, column)


def init_db() -> None:
    """建立資料表並自動補齊新欄位。"""
    conn = _connect()
    cur  = conn.cursor()
    ph   = "%s" if _is_postgres() else "?"
    auto = "SERIAL" if _is_postgres() else "INTEGER"
    now  = "NOW()" if _is_postgres() else "CURRENT_TIMESTAMP"

    # ── 掃描結果表 ───────────────────────────────
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS scan_results (
            id              {auto} PRIMARY KEY,
            symbol          TEXT    NOT NULL,
            name            TEXT    NOT NULL,
            signal          TEXT    NOT NULL,
            price           REAL    NOT NULL,
            ma5             REAL,
            ma100           REAL,
            cross_proximity REAL,
            volume_ratio    REAL,
            scan_date       TEXT    NOT NULL,
            created_at      TIMESTAMP DEFAULT {now}
        )
    """)
    _add_column_if_missing(cur, "scan_results", "cross_proximity", "REAL")
    _add_column_if_missing(cur, "scan_results", "volume_ratio",    "REAL")

    # ── 掃描日誌表 ───────────────────────────────
    cur.execute(f"""
        CREATE TABLE IF NOT EXISTS scan_logs (
            id              {auto} PRIMARY KEY,
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
    db_type = "PostgreSQL" if _is_postgres() else "SQLite"
    logger.info("Database ready (%s)", db_type)


# ─────────────────────────────────────────────
#  寫入
# ─────────────────────────────────────────────

def save_scan_results(results: List[Dict], scan_date: str) -> None:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(f"DELETE FROM scan_results WHERE scan_date = {ph}", (scan_date,))

    for r in results:
        cur.execute(f"""
            INSERT INTO scan_results
              (symbol, name, signal, price, ma5, ma100, cross_proximity, volume_ratio, scan_date)
            VALUES ({ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph},{ph})
        """, (
            r["symbol"], r["name"], r["signal"], r["price"],
            r.get("ma5"), r.get("ma100"),
            r.get("cross_proximity"), r.get("volume_ratio"),
            scan_date,
        ))

    conn.commit()
    conn.close()
    logger.info("Saved %d results for %s", len(results), scan_date)


def log_scan(started_at, finished_at, total_scanned: int,
             signals_found: int, status: str, error_msg: str = "") -> None:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(f"""
        INSERT INTO scan_logs
          (started_at, finished_at, total_scanned, signals_found, status, error_msg)
        VALUES ({ph},{ph},{ph},{ph},{ph},{ph})
    """, (started_at, finished_at, total_scanned, signals_found, status, error_msg))
    conn.commit()
    conn.close()


# ─────────────────────────────────────────────
#  讀取
# ─────────────────────────────────────────────

def get_latest_scan_results() -> List[Dict]:
    conn = _connect()
    cur  = conn.cursor()
    cur.execute("""
        SELECT symbol, name, signal, price, ma5, ma100,
               cross_proximity, volume_ratio, scan_date
        FROM scan_results
        WHERE scan_date = (SELECT MAX(scan_date) FROM scan_results)
        ORDER BY cross_proximity ASC, symbol ASC
    """)
    if _is_postgres():
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    else:
        import sqlite3
        rows_raw = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows_raw]
    conn.close()
    return rows


def get_last_scan_date() -> Optional[str]:
    conn = _connect()
    cur  = conn.cursor()
    cur.execute("SELECT MAX(scan_date) FROM scan_results")
    result = cur.fetchone()
    conn.close()
    return result[0] if result and result[0] else None


def get_results_by_date(date: str) -> List[Dict]:
    ph   = "%s" if _is_postgres() else "?"
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(f"""
        SELECT symbol, name, signal, price, ma5, ma100,
               cross_proximity, volume_ratio, scan_date
        FROM scan_results WHERE scan_date = {ph}
        ORDER BY cross_proximity ASC
    """, (date,))
    if _is_postgres():
        cols = [d.name for d in cur.description]
        rows = [dict(zip(cols, row)) for row in cur.fetchall()]
    else:
        rows_raw = cur.fetchall()
        cols = [d[0] for d in cur.description]
        rows = [dict(zip(cols, r)) for r in rows_raw]
    conn.close()
    return rows
