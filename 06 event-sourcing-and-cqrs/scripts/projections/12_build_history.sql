-- Phase 2: Build proj_transaction_history from full event replay

TRUNCATE proj_transaction_history;

INSERT INTO proj_transaction_history
    (event_id, account_id, account_number, event_type, description,
     debit, credit, balance_after, counterparty, created_at)
SELECT
    ae.event_id,
    ae.account_id,
    a.account_number,
    ae.event_type,
    ae.metadata->>'description',
    CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN ae.amount END AS debit,
    CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
        THEN ae.amount END AS credit,
    ae.balance_after,
    CASE WHEN ae.metadata->>'counterparty_account_id' IS NOT NULL
        THEN (SELECT account_number FROM accounts
              WHERE id = (ae.metadata->>'counterparty_account_id')::INTEGER)
    END AS counterparty,
    ae.created_at
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
ORDER BY ae.created_at;
