-- Phase 2: Build proj_monthly_statements from full event replay

TRUNCATE proj_monthly_statements;

INSERT INTO proj_monthly_statements
    (account_id, statement_month, opening_balance, closing_balance,
     total_credits, total_debits, transaction_count, fees_charged, interest_earned)
SELECT
    sub.account_id,
    sub.statement_month,
    -- Opening balance: balance_after of last event BEFORE this month
    (SELECT balance_after FROM account_events prev
     WHERE prev.account_id = sub.account_id
       AND prev.created_at < sub.statement_month
     ORDER BY prev.sequence_number DESC LIMIT 1),
    -- Closing balance: balance_after of last event IN this month
    (SELECT balance_after FROM account_events last_ev
     WHERE last_ev.account_id = sub.account_id
       AND DATE_TRUNC('month', last_ev.created_at) = sub.statement_month
     ORDER BY last_ev.sequence_number DESC LIMIT 1),
    sub.total_credits,
    sub.total_debits,
    sub.tx_count,
    sub.fees_charged,
    sub.interest_earned
FROM (
    SELECT
        ae.account_id,
        DATE_TRUNC('month', ae.created_at)::DATE AS statement_month,
        SUM(CASE WHEN ae.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
            THEN ae.amount ELSE 0 END) AS total_credits,
        SUM(CASE WHEN ae.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN ae.amount ELSE 0 END) AS total_debits,
        COUNT(*) AS tx_count,
        SUM(CASE WHEN ae.event_type = 'fee_charged' THEN ae.amount ELSE 0 END) AS fees_charged,
        SUM(CASE WHEN ae.event_type = 'interest_applied' THEN ae.amount ELSE 0 END) AS interest_earned
    FROM account_events ae
    GROUP BY ae.account_id, DATE_TRUNC('month', ae.created_at)
) sub
ORDER BY sub.account_id, sub.statement_month;
