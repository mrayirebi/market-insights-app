from __future__ import annotations

from app.db import get_connection, init_db, list_prices


def main():
    with get_connection() as conn:
        init_db(conn)
        rows = list_prices(conn, limit=10)
        for r in rows:
            print(r)


if __name__ == "__main__":
    main()
