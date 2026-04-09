#!/bin/bash
# ──────────────────────────────────────────────────────────
# Seed the deployed BirdDog dev server with test data
# Run from pe-mgmt/: ./scripts/seed-remote.sh
# ──────────────────────────────────────────────────────────

API="https://pe-mgmt-dev.fly.dev/api"
HEADER="X-Requested-With: BirdDog"

# Login as super_admin to get a cookie
echo "🔑 Logging in as jeremiah..."
LOGIN=$(curl -s -c - "$API/auth/login" \
  -H "Content-Type: application/json" \
  -H "$HEADER" \
  -d '{"username":"jeremiah","password":"pueblo2026"}')

TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed. Response:"
  echo "$LOGIN"
  exit 1
fi
echo "✅ Logged in (token: ${TOKEN:0:8}...)"

AUTH="Authorization: Bearer $TOKEN"

# Seed time tracking
echo ""
echo "⏱  Seeding time tracking data..."
RESULT1=$(curl -s -X POST "$API/seed/time-tracking" \
  -H "$AUTH" \
  -H "$HEADER" \
  -H "Content-Type: application/json")
echo "$RESULT1" | grep -q '"success":true' && echo "✅ Time tracking seeded" || echo "❌ $RESULT1"

# Seed comprehensive (assets, tools, vehicles, cost codes)
echo ""
echo "🔧 Seeding comprehensive data (tools, vehicles, cost codes)..."
RESULT2=$(curl -s -X POST "$API/seed/comprehensive" \
  -H "$AUTH" \
  -H "$HEADER" \
  -H "Content-Type: application/json")
echo "$RESULT2" | grep -q '"success":true' && echo "✅ Comprehensive seed complete" || echo "❌ $RESULT2"

echo ""
echo "🐕 Done! Test at https://pe-mgmt-dev.fly.dev"
