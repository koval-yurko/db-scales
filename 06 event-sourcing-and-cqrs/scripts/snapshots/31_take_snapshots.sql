-- Phase 4: Snapshot all accounts at their current sequence

INSERT INTO account_snapshots
    (account_id, snapshot_sequence, balance, total_deposits,
     total_withdrawals, transaction_count, snapshot_data)
SELECT
    account_id,
    last_event_sequence,
    current_balance,
    total_deposits,
    total_withdrawals,
    transaction_count,
    json_build_object(
        'holder_name', holder_name,
        'account_number', account_number,
        'account_type', account_type,
        'last_transaction_at', last_transaction_at
    )
FROM proj_account_balances
ON CONFLICT (account_id, snapshot_sequence) DO NOTHING;
