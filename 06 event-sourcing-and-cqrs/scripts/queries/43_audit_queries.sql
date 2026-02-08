-- Audit trail and transfer chain tracking

-- Q1: Full audit trail for account 1
SELECT
    sequence_number,
    event_type,
    amount,
    balance_after,
    metadata->>'description' AS description,
    created_at
FROM account_events
WHERE account_id = 1
ORDER BY sequence_number;

-- Q2: Find a transfer chain (first transfer pair)
SELECT
    ae.account_id,
    a.account_number,
    a.holder_name,
    ae.event_type,
    ae.amount,
    ae.balance_after,
    ae.metadata->>'transfer_id' AS transfer_id,
    ae.metadata->>'description' AS description
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
WHERE ae.metadata->>'transfer_id' = (
    SELECT metadata->>'transfer_id'
    FROM account_events
    WHERE metadata->>'transfer_id' IS NOT NULL
    LIMIT 1
)
ORDER BY ae.created_at;

-- Q3: Accounts with most fees charged
SELECT
    ae.account_id,
    a.account_number,
    a.holder_name,
    COUNT(*) AS fee_count,
    SUM(ae.amount) AS total_fees
FROM account_events ae
JOIN accounts a ON ae.account_id = a.id
WHERE ae.event_type = 'fee_charged'
GROUP BY ae.account_id, a.account_number, a.holder_name
ORDER BY total_fees DESC
LIMIT 10;
