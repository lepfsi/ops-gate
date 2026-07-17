-- ============================================================================
-- Migration: Shadow AI Discovery + Risk Score
-- Date: 2026-07-17
-- Feature: SHADOW-AI-RISK-SCORE
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Table: user_risk_scores
-- Stocke le score de risque calculé par agent / période
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_risk_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id          UUID NOT NULL,
  score             INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  score_previous    INTEGER,
  factors           JSONB NOT NULL DEFAULT '{}'::jsonb,
  period_start      TIMESTAMPTZ NOT NULL,
  period_end        TIMESTAMPTZ NOT NULL,
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_user_risk_scores_org_agent_period
    UNIQUE (org_id, agent_id, period_end)
);

COMMENT ON TABLE user_risk_scores IS 'Risk scores calculés pour Shadow AI + Risk Score feature';
COMMENT ON COLUMN user_risk_scores.factors IS 'Détail transparent du calcul (JSON) pour affichage "Pourquoi ce score ?"';
COMMENT ON COLUMN user_risk_scores.score_previous IS 'Score de la période précédente (pour calculer la tendance)';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_risk_scores_org_score
  ON user_risk_scores (org_id, score DESC);

CREATE INDEX IF NOT EXISTS idx_user_risk_scores_agent
  ON user_risk_scores (agent_id, calculated_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_risk_scores_org_period
  ON user_risk_scores (org_id, period_end DESC);


-- ----------------------------------------------------------------------------
-- 2. Table: org_ai_tools
-- Inventaire et statut (authorized / unauthorized) des outils IA détectés
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_ai_tools (
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tool            TEXT NOT NULL,                    -- hostname normalisé (ex: chatgpt.com)
  display_name    TEXT,
  status          TEXT NOT NULL DEFAULT 'unknown'
                    CHECK (status IN ('authorized', 'unauthorized', 'unknown')),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID,                             -- admin qui a changé le statut

  PRIMARY KEY (org_id, tool)
);

COMMENT ON TABLE org_ai_tools IS 'Shadow AI inventory + authorization status per organization';
COMMENT ON COLUMN org_ai_tools.tool IS 'Hostname normalisé de l''outil IA';
COMMENT ON COLUMN org_ai_tools.status IS 'authorized | unauthorized | unknown';

CREATE INDEX IF NOT EXISTS idx_org_ai_tools_status
  ON org_ai_tools (org_id, status);


-- ----------------------------------------------------------------------------
-- 3. Enrichissement optionnel de la table events (si elle existe déjà)
-- On ajoute les colonnes nécessaires si elles n'existent pas encore
-- ----------------------------------------------------------------------------

-- Note: Adapter le nom de la table events selon le schéma réel du projet
-- (ex: detection_events, events, agent_events...)

DO $$
BEGIN
  -- ai_tool
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'detection_events' AND column_name = 'ai_tool'
  ) THEN
    ALTER TABLE detection_events ADD COLUMN ai_tool TEXT;
  END IF;

  -- decision
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'detection_events' AND column_name = 'decision'
  ) THEN
    ALTER TABLE detection_events ADD COLUMN decision TEXT;
  END IF;

  -- max_severity
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'detection_events' AND column_name = 'max_severity'
  ) THEN
    ALTER TABLE detection_events ADD COLUMN max_severity TEXT;
  END IF;

  -- categories (array)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'detection_events' AND column_name = 'categories'
  ) THEN
    ALTER TABLE detection_events ADD COLUMN categories TEXT[] DEFAULT '{}';
  END IF;
END $$;


-- Index utiles sur les events pour le calcul de score
CREATE INDEX IF NOT EXISTS idx_detection_events_org_agent_created
  ON detection_events (org_id, agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_detection_events_ai_tool
  ON detection_events (org_id, ai_tool);


-- ----------------------------------------------------------------------------
-- 4. Row Level Security (si le projet active RLS)
-- ----------------------------------------------------------------------------
-- Décommente et adapte si OPSGATE_PG_RLS = true

-- ALTER TABLE user_risk_scores ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE org_ai_tools ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY user_risk_scores_org_isolation ON user_risk_scores
--   USING (org_id = current_setting('app.current_org_id')::uuid);

-- CREATE POLICY org_ai_tools_org_isolation ON org_ai_tools
--   USING (org_id = current_setting('app.current_org_id')::uuid);


-- ----------------------------------------------------------------------------
-- Fin de la migration
-- ----------------------------------------------------------------------------
