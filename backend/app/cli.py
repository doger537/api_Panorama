from __future__ import annotations

import argparse
import getpass
from pathlib import Path
from backend.app.maintenance import backup, restore, collect_orphans

from backend.app.auth import create_organizer
from backend.app.db import initialize_database


def main() -> None:
    parser = argparse.ArgumentParser(prog="ttkmap")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("init-db")
    subparsers.add_parser("seed-demo")
    backup_parser = subparsers.add_parser('backup')
    backup_parser.add_argument('destination', type=Path)
    restore_parser = subparsers.add_parser('restore')
    restore_parser.add_argument('source', type=Path)
    restore_parser.add_argument('destination', type=Path)
    gc = subparsers.add_parser('gc')
    gc.add_argument('--apply', action='store_true')
    gc.add_argument('--retention-days', type=int, default=30)
    gc.add_argument('--services-stopped', action='store_true')
    organizer = subparsers.add_parser("create-organizer")
    organizer.add_argument("--email", required=True)
    args = parser.parse_args()
    if args.command == 'backup':
        backup(args.destination)
        return
    if args.command == 'restore':
        restore(args.source, args.destination)
        return
    if args.command == 'gc':
        if args.apply and not args.services_stopped:
            raise SystemExit('Stop uploads and worker; pass --services-stopped before applying GC')
        print(collect_orphans(apply=args.apply,retention_days=args.retention_days))
        return
    if args.command == "init-db":
        initialize_database()
        return
    if args.command == "seed-demo":
        from scripts.seed_demo import seed_demo_data
        seed_demo_data()
        return
    initialize_database()
    password = getpass.getpass("Organizer password (minimum 12 characters): ")
    if not 12 <= len(password) <= 128:
        raise SystemExit("Password must contain 12..128 characters")
    print(create_organizer(args.email, password))


if __name__ == "__main__":
    main()
