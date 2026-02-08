-- Direct event store queries (no projections)
-- These scan the event log directly — correct but slow

-- Q1: Single account balance
SELECT balance_after AS current_balance
FROM account_events
WHERE account_id = 1
ORDER BY sequence_number DESC
LIMIT 1;

-- Q2: All account balances
SELECT DISTINCT ON (account_id)
    account_id,
    balance_after AS current_balance
FROM account_events
ORDER BY account_id, sequence_number DESC;

-- Q3: Monthly summary for account 1
SELECT
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS tx_count,
    SUM(CASE WHEN event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
        THEN amount ELSE 0 END) AS total_credits,
    SUM(CASE WHEN event_type IN ('money_withdrawn','transfer_sent','fee_charged')
        THEN amount ELSE 0 END) AS total_debits
FROM account_events
WHERE account_id = 1
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month;
