-- Phase 3: Trigger functions for live projection updates

-- Update proj_account_balances on new event
CREATE OR REPLACE FUNCTION update_balance_projection()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO proj_account_balances
        (account_id, account_number, holder_name, account_type,
         current_balance, total_deposits, total_withdrawals,
         transaction_count, last_transaction_at, last_event_sequence)
    SELECT
        NEW.account_id,
        a.account_number,
        a.holder_name,
        a.account_type,
        NEW.balance_after,
        CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
            THEN NEW.amount ELSE 0 END,
        CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN NEW.amount ELSE 0 END,
        1,
        NEW.created_at,
        NEW.sequence_number
    FROM accounts a WHERE a.id = NEW.account_id
    ON CONFLICT (account_id) DO UPDATE SET
        current_balance = NEW.balance_after,
        total_deposits = proj_account_balances.total_deposits +
            CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
                THEN NEW.amount ELSE 0 END,
        total_withdrawals = proj_account_balances.total_withdrawals +
            CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
                THEN NEW.amount ELSE 0 END,
        transaction_count = proj_account_balances.transaction_count + 1,
        last_transaction_at = NEW.created_at,
        last_event_sequence = NEW.sequence_number,
        last_updated = CURRENT_TIMESTAMP;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update proj_transaction_history on new event
CREATE OR REPLACE FUNCTION update_history_projection()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO proj_transaction_history
        (event_id, account_id, account_number, event_type, description,
         debit, credit, balance_after, counterparty, created_at)
    SELECT
        NEW.event_id,
        NEW.account_id,
        a.account_number,
        NEW.event_type,
        NEW.metadata->>'description',
        CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN NEW.amount END,
        CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
            THEN NEW.amount END,
        NEW.balance_after,
        CASE WHEN NEW.metadata->>'counterparty_account_id' IS NOT NULL
            THEN (SELECT account_number FROM accounts
                  WHERE id = (NEW.metadata->>'counterparty_account_id')::INTEGER)
        END,
        NEW.created_at
    FROM accounts a WHERE a.id = NEW.account_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update proj_monthly_statements on new event
CREATE OR REPLACE FUNCTION update_statement_projection()
RETURNS TRIGGER AS $$
DECLARE
    v_month DATE;
BEGIN
    v_month := DATE_TRUNC('month', NEW.created_at)::DATE;

    INSERT INTO proj_monthly_statements
        (account_id, statement_month, opening_balance, closing_balance,
         total_credits, total_debits, transaction_count, fees_charged, interest_earned)
    VALUES (
        NEW.account_id,
        v_month,
        NEW.balance_after - COALESCE(NEW.amount, 0),
        NEW.balance_after,
        CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
            THEN NEW.amount ELSE 0 END,
        CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
            THEN NEW.amount ELSE 0 END,
        1,
        CASE WHEN NEW.event_type = 'fee_charged' THEN NEW.amount ELSE 0 END,
        CASE WHEN NEW.event_type = 'interest_applied' THEN NEW.amount ELSE 0 END
    )
    ON CONFLICT (account_id, statement_month) DO UPDATE SET
        closing_balance = NEW.balance_after,
        total_credits = proj_monthly_statements.total_credits +
            CASE WHEN NEW.event_type IN ('money_deposited','transfer_received','interest_applied','account_opened')
                THEN NEW.amount ELSE 0 END,
        total_debits = proj_monthly_statements.total_debits +
            CASE WHEN NEW.event_type IN ('money_withdrawn','transfer_sent','fee_charged')
                THEN NEW.amount ELSE 0 END,
        transaction_count = proj_monthly_statements.transaction_count + 1,
        fees_charged = proj_monthly_statements.fees_charged +
            CASE WHEN NEW.event_type = 'fee_charged' THEN NEW.amount ELSE 0 END,
        interest_earned = proj_monthly_statements.interest_earned +
            CASE WHEN NEW.event_type = 'interest_applied' THEN NEW.amount ELSE 0 END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
