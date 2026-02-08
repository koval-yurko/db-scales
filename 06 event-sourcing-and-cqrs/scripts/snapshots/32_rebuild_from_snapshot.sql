-- Phase 4: Rebuild from snapshot + delta events
-- Demonstrates rebuilding a single account from snapshot instead of full replay

-- Step A: Show snapshot state for account 1
SELECT
    s.account_id,
    s.snapshot_sequence,
    s.balance AS snapshot_balance,
    s.transaction_count AS snapshot_tx_count,
    s.created_at AS snapshot_taken_at
FROM account_snapshots s
WHERE s.account_id = 1
ORDER BY s.snapshot_sequence DESC
LIMIT 1;

-- Step B: Count events after snapshot (delta)
SELECT
    COUNT(*) AS delta_events
FROM account_events ae
WHERE ae.account_id = 1
  AND ae.sequence_number > (
      SELECT snapshot_sequence FROM account_snapshots
      WHERE account_id = 1
      ORDER BY snapshot_sequence DESC LIMIT 1
  );

-- Step C: Show delta events
SELECT
    ae.sequence_number,
    ae.event_type,
    ae.amount,
    ae.balance_after,
    ae.created_at
FROM account_events ae
WHERE ae.account_id = 1
  AND ae.sequence_number > (
      SELECT snapshot_sequence FROM account_snapshots
      WHERE account_id = 1
      ORDER BY snapshot_sequence DESC LIMIT 1
  )
ORDER BY ae.sequence_number;
