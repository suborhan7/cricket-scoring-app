#!/bin/sh
# Runs the migration and the security checks on a fresh local database.
# Usage: PGHOST=/tmp PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
set -e
cd "$(dirname "$0")"
DB=cricket_scorer_test
dropdb --if-exists "$DB" && createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../migrations/0001_init.sql
psql -q -o /dev/null -v ON_ERROR_STOP=1 -d "$DB" -f rls_test.sql
dropdb "$DB"
