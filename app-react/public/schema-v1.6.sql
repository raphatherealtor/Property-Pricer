-- Property Pricer v1.6 PostgreSQL DDL
-- Core intake, append-only computed outputs, structured persona extensions.

CREATE TABLE IF NOT EXISTS core_intake (
  intake_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  zip VARCHAR(10) NOT NULL,
  baseline_value NUMERIC(12,2) NOT NULL CHECK (baseline_value > 0),
  target_price NUMERIC(12,2) NOT NULL CHECK (target_price > 0),
  listing_state VARCHAR(20) NOT NULL DEFAULT 'pre_listing'
    CHECK (listing_state IN ('pre_listing', 'active', 'pending', 'closed', 'withdrawn')),
  actual_dom INT DEFAULT NULL CHECK (actual_dom IS NULL OR actual_dom >= 0),
  uii_months NUMERIC(4,2) NOT NULL CHECK (uii_months > 0),
  median_dom_zip INT NOT NULL CHECK (median_dom_zip > 0),
  dom_clock_basis VARCHAR(20) NOT NULL DEFAULT 'closed_only'
    CHECK (dom_clock_basis IN ('closed_only', 'cumulative', 'unknown')),
  gla_sqft INT NOT NULL DEFAULT 2000 CHECK (gla_sqft > 0),
  hvac_age INT NOT NULL CHECK (hvac_age >= 0),
  roof_age INT NOT NULL CHECK (roof_age >= 0),
  wh_age INT NOT NULL CHECK (wh_age >= 0),
  input_hash VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS computed_outputs (
  output_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id UUID NOT NULL REFERENCES core_intake(intake_id) ON DELETE CASCADE,
  calc_version VARCHAR(20) NOT NULL DEFAULT '1.6.1',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  u_eff NUMERIC(6,4) NOT NULL,
  kappa_t NUMERIC(6,4) NOT NULL,
  kappa_eff NUMERIC(6,4) NOT NULL,
  expected_dom NUMERIC(6,1) NOT NULL,
  p50_dom NUMERIC(6,1) NOT NULL,
  p_stale_120d NUMERIC(6,4) NOT NULL,
  p_sold_2wk NUMERIC(6,4) NOT NULL,
  expected_discount_pct NUMERIC(6,4) NOT NULL,
  expected_sale_price NUMERIC(12,2) NOT NULL,
  cost_of_testing NUMERIC(12,2) NOT NULL,
  scaled_holdback NUMERIC(12,2) NOT NULL,
  terminal_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  read_confidence VARCHAR(10) NOT NULL DEFAULT 'HIGH',
  UNIQUE (intake_id, calc_version)
);

CREATE TABLE IF NOT EXISTS lender_ext (
  intake_id UUID PRIMARY KEY REFERENCES core_intake(intake_id) ON DELETE CASCADE,
  ltv NUMERIC(5,4) NOT NULL,
  note_rate NUMERIC(6,4) NOT NULL,
  term_months INT NOT NULL DEFAULT 360,
  loan_type VARCHAR(20) NOT NULL DEFAULT 'conventional',
  appraised_value NUMERIC(12,2) NOT NULL,
  program_reserve_months INT NOT NULL DEFAULT 6
);

CREATE TABLE IF NOT EXISTS investor_ext (
  intake_id UUID PRIMARY KEY REFERENCES core_intake(intake_id) ON DELETE CASCADE,
  purchase_price NUMERIC(12,2) NOT NULL,
  rent_roll_monthly NUMERIC(10,2) NOT NULL,
  hold_years INT NOT NULL DEFAULT 5,
  exit_overshoot_pct NUMERIC(5,4) NOT NULL DEFAULT 0.06,
  opex_ratio NUMERIC(5,4) NOT NULL DEFAULT 0.45
);

CREATE TABLE IF NOT EXISTS commercial_ext (
  intake_id UUID PRIMARY KEY REFERENCES core_intake(intake_id) ON DELETE CASCADE,
  available_sf INT NOT NULL,
  monthly_absorbed_sf INT NOT NULL,
  walt_months NUMERIC(6,2) NOT NULL,
  cap_rate_entry_pct NUMERIC(6,4) NOT NULL,
  tenant_rollover JSONB NOT NULL DEFAULT '[]'::jsonb,
  roof_inventory JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_core_intake_zip ON core_intake(zip);
CREATE INDEX IF NOT EXISTS idx_computed_outputs_lookup ON computed_outputs(intake_id, calc_version);
