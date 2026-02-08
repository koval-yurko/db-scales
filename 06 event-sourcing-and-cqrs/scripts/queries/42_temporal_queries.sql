-- Temporal queries: point-in-time balance lookups

-- Q1: What was account 1's balance 6 months ago?
SELECT balance_after AS balance_at_date
FROM account_events
WHERE account_id = 1
  AND created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
ORDER BY sequence_number DESC
LIMIT 1;

-- Q2: All account balances 6 months ago
SELECT DISTINCT ON (account_id)
    account_id,
    balance_after AS balance_at_date
FROM account_events
WHERE created_at <= (CURRENT_TIMESTAMP - INTERVAL '6 months')
ORDER BY account_id, sequence_number DESC;

-- Q3: Account 1's balance at end of each month
SELECT DISTINCT ON (DATE_TRUNC('month', created_at))
    DATE_TRUNC('month', created_at)::DATE AS month,
    balance_after AS end_of_month_balance
FROM account_events
WHERE account_id = 1
ORDER BY DATE_TRUNC('month', created_at), sequence_number DESC;
