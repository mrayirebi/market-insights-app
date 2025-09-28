from __future__ import annotations

import sys
from pathlib import Path

# Ensure repo root on path for direct execution
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.db import get_connection, init_db


def main() -> None:
    with get_connection() as conn:
        init_db(conn)
        cur = conn.execute("DELETE FROM prices WHERE source = ?", ("demo",))
        conn.commit()
        print(f"[clear_demo] Deleted {cur.rowcount} demo price rows.")


if __name__ == "__main__":
    main()
