-- Phase 2: Build proj_account_balances from full event replay

TRUNCATE proj_account_balances;

INSERT INTO proj_account_balances
    (account_id, account_number, holder_name, account_type,
     current_balance, total_deposits, total_withdrawals,
     transaction_count, last_transaction_at, last_event_sequence)
SELECT
    ae.account_id,
    a.account_number,
    a.holder_name,
    a.account_type,
    -- Current balance: latest balance_after
    (SELECT balance_after FROM account_events ae2
     WHERE ae2.account_id = ae.account_id
     ORDER BY sequence_number DESC LIMIT 1),
    -- Total deposits
    SUM(CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
        THEN ae.amount ELSE 0 END),
    -- Total withdrawals
    SUM(CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN ae.amount ELSE 0 END),
    -- Transaction count
    COUNT(*),
    -- Last transaction
    MAX(ae.created_at),
    -- Last sequence
    MAX(ae.sequence_number)
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
GROUP BY ae.account_id, a.account_number, a.holder_name, a.account_type;
