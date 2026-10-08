/**
 * AI Procurement Operations Assistant API Routes
 * Endpoints for District Officers and Centre Admins (Uzhavarsethu / Kisan Queue)
 * 
 * Strict RBAC & Tenant Isolation:
 * - DISTRICT_OFFICER: Strictly bound to req.user.district from verified JWT.
 * - CENTRE_ADMIN: Strictly bound to req.user.centreId from verified JWT.
 * - FARMER / CSC_OPERATOR: 403 Forbidden.
 * - Zero database mutations (read-only decision support).
 */

const express = require('express');
const { authenticateToken, requireRole } = require('./auth');
const { OfficerOperationsService } = require('./services/ai/officerOperationsService');

function formatOfficerResponse(result) {
  if (!result || typeof result !== 'object') return result;
  const {
    provider_used,
    model_used,
    provider_model,
    model_name,
    model,
    raw_response,
    prompt_tokens,
    completion_tokens,
    total_tokens,
    ...cleanResult
  } = result;
  return cleanResult;
}

function createOfficerAiRouter({ pool }) {
  const router = express.Router();
  const operationsService = new OfficerOperationsService({ pool });

  /**
   * Health & Capability Check
   */
  router.get('/health', (req, res) => {
    try {
      const aiHealth = operationsService.factory.getHealth();
      res.json({
        status: 'ok',
        service: 'Kisan Queue AI Procurement Operations Assistant',
        role_access: ['DISTRICT_OFFICER', 'CENTRE_ADMIN'],
        ai_providers: {
          primary: aiHealth.primary?.provider || 'gemini',
          primary_model: aiHealth.primary_model,
          fallbacks: aiHealth.fallbacks || [],
          offline_fallback: true
        },
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      res.status(500).json({ error: 'health_check_failed', message: err.message });
    }
  });

  /**
   * Contextual Suggested Prompts
   */
  router.get('/suggested-prompts', authenticateToken, requireRole('DISTRICT_OFFICER', 'CENTRE_ADMIN'), async (req, res) => {
    try {
      const isDistrict = req.user.role === 'DISTRICT_OFFICER';
      const district = req.user.district || 'Thanjavur';
      const centreId = req.user.centreId || req.user.centre_id;

      if (isDistrict) {
        return res.json({
          role: 'DISTRICT_OFFICER',
          scope: district,
          prompts: [
            {
              id: 'briefing',
              label: 'Daily District Briefing',
              query: `Give me today's operational summary and procurement posture for ${district} district.`
            },
            {
              id: 'risk_analysis',
              label: 'Storage & Risk Alerts',
              query: `Which centres in ${district} are at HIGH risk of storage overload or queue delays?`
            },
            {
              id: 'sim_arrivals_20',
              label: 'What-If: +20% Arrivals',
              query: `What if harvest arrivals increase by 20% tomorrow across ${district}?`,
              scenario: { type: 'arrival_change', percentage: 20 }
            },
            {
              id: 'grievances_sla',
              label: 'Grievance SLA Status',
              query: `Summarize open farmer grievances and SLA breaches in ${district}.`
            },
            {
              id: 'pacing_recommendations',
              label: 'Pacing & Dispatch Advice',
              query: `Recommend pacing delay adjustments and grain transport priorities for congested centres.`
            }
          ]
        });
      } else {
        return res.json({
          role: 'CENTRE_ADMIN',
          scope: centreId,
          prompts: [
            {
              id: 'centre_summary',
              label: 'Today\'s Centre Briefing',
              query: `Give me a comprehensive operational briefing for my centre today.`
            },
            {
              id: 'wait_times',
              label: 'Queue & Wait Times',
              query: `What is my current queue wait time, active farmer backlog, and hourly throughput?`
            },
            {
              id: 'sim_arrivals_25',
              label: 'What-If: +25% Surge',
              query: `What happens if tractor arrivals spike by 25% today?`,
              scenario: { type: 'arrival_change', percentage: 25 }
            },
            {
              id: 'sim_counter_add',
              label: 'What-If: Add Counter',
              query: `Simulate adding 1 extra weighment counter to reduce wait times.`,
              scenario: { type: 'counter_change', counter_delta: 1 }
            },
            {
              id: 'storage_headroom',
              label: 'Storage Headroom',
              query: `How much storage capacity is remaining before we risk yard congestion?`
            }
          ]
        });
      }
    } catch (err) {
      res.status(500).json({ error: 'failed_prompts', message: err.message });
    }
  });

  /**
   * Daily Operational Briefing (Quick Shortcut)
   */
  router.get('/briefing', authenticateToken, requireRole('DISTRICT_OFFICER', 'CENTRE_ADMIN'), async (req, res) => {
    try {
      const isDistrict = req.user.role === 'DISTRICT_OFFICER';
      const userDistrict = req.user.district;
      const userCentreId = req.user.centreId || req.user.centre_id;

      const query = isDistrict
        ? `Daily operational briefing for ${userDistrict} district.`
        : `Daily operational briefing for centre ${userCentreId}.`;

      const result = await operationsService.processOfficerQuery({
        query,
        role: req.user.role,
        userDistrict,
        userCentreId
      });

      // Audit logging
      await operationsService.logAudit({
        userId: req.user.userId || req.user.username,
        role: req.user.role,
        scopeType: isDistrict ? 'DISTRICT' : 'CENTRE',
        scopeId: isDistrict ? userDistrict : userCentreId,
        query,
        intent: result.intent,
        providerUsed: result.provider_used
      });

      res.json({
        success: true,
        ...formatOfficerResponse(result)
      });
    } catch (err) {
      console.error('[OFFICER AI] Briefing error:', err);
      res.status(500).json({ error: 'briefing_error', message: err.message });
    }
  });

  /**
   * Explicit What-If Scenario Simulation
   */
  router.post('/simulate', authenticateToken, requireRole('DISTRICT_OFFICER', 'CENTRE_ADMIN'), async (req, res) => {
    try {
      const isDistrict = req.user.role === 'DISTRICT_OFFICER';
      const userDistrict = req.user.district;
      const userCentreId = req.user.centreId || req.user.centre_id;

      // Anti-tampering check: Reject if request attempts to override assigned tenant scope
      if (isDistrict && req.body.district && req.body.district.toLowerCase() !== userDistrict.toLowerCase()) {
        return res.status(403).json({
          error: 'forbidden_scope',
          message: `Access denied. You are restricted to your assigned district: ${userDistrict}.`
        });
      }
      if (!isDistrict && req.body.centre_id && req.body.centre_id !== userCentreId) {
        return res.status(403).json({
          error: 'forbidden_scope',
          message: `Access denied. You are restricted to your assigned centre: ${userCentreId}.`
        });
      }

      const scenario = req.body.scenario || {
        type: req.body.type || 'arrival_change',
        percentage: req.body.percentage !== undefined ? Number(req.body.percentage) : 20,
        counter_delta: req.body.counter_delta !== undefined ? Number(req.body.counter_delta) : 0,
        source_centre_id: req.body.source_centre_id || null,
        target_centre_id: req.body.target_centre_id || null,
      };

      if (scenario.quantity_mt !== undefined && scenario.quantity_mt <= 0) {
        return res.status(400).json({
          error: 'invalid_parameter',
          message: 'Simulation quantity must be greater than 0 MT.'
        });
      }

      const query = req.body.query || `Simulate ${scenario.type} with parameters ${JSON.stringify(scenario)}`;

      const result = await operationsService.processOfficerQuery({
        query,
        role: req.user.role,
        userDistrict,
        userCentreId,
        scenario
      });

      // Audit logging
      await operationsService.logAudit({
        userId: req.user.userId || req.user.username,
        role: req.user.role,
        scopeType: isDistrict ? 'DISTRICT' : 'CENTRE',
        scopeId: isDistrict ? userDistrict : userCentreId,
        query,
        intent: 'simulation',
        providerUsed: result.provider_used,
        isSimulation: true
      });

      res.json({
        success: true,
        ...formatOfficerResponse(result)
      });
    } catch (err) {
      console.error('[OFFICER AI] Simulation error:', err);
      res.status(500).json({ error: 'simulation_error', message: err.message });
    }
  });

  /**
   * Main Conversational / Natural Language Analytics & Decision Support
   */
  router.post('/ask', authenticateToken, requireRole('DISTRICT_OFFICER', 'CENTRE_ADMIN'), async (req, res) => {
    try {
      const isDistrict = req.user.role === 'DISTRICT_OFFICER';
      const userDistrict = req.user.district;
      const userCentreId = req.user.centreId || req.user.centre_id;

      // Anti-tampering check: Reject if request attempts to override assigned tenant scope
      if (isDistrict && req.body.district && req.body.district.toLowerCase() !== userDistrict.toLowerCase()) {
        return res.status(403).json({
          error: 'forbidden_scope',
          message: `Access denied. You are restricted to your assigned district: ${userDistrict}.`
        });
      }
      if (!isDistrict && req.body.centre_id && req.body.centre_id !== userCentreId) {
        return res.status(403).json({
          error: 'forbidden_scope',
          message: `Access denied. You are restricted to your assigned centre: ${userCentreId}.`
        });
      }

      const rawQuery = (req.body.query || req.body.question || '').trim();
      const { scenario, conversationHistory = [] } = req.body;
      if (!rawQuery && !scenario) {
        return res.status(400).json({
          error: 'missing_query',
          message: 'Please provide an operational question or what-if scenario parameter.'
        });
      }

      const query = rawQuery;

      const result = await operationsService.processOfficerQuery({
        query,
        role: req.user.role,
        userDistrict,
        userCentreId,
        scenario: scenario || null,
        conversationHistory
      });

      // Audit logging
      await operationsService.logAudit({
        userId: req.user.userId || req.user.username,
        role: req.user.role,
        scopeType: isDistrict ? 'DISTRICT' : 'CENTRE',
        scopeId: isDistrict ? userDistrict : userCentreId,
        query: query || 'Simulation request',
        intent: result.intent,
        providerUsed: result.provider_used,
        isSimulation: Boolean(scenario || result.simulation)
      });

      res.json({
        success: true,
        ...formatOfficerResponse(result)
      });
    } catch (err) {
      console.error('[OFFICER AI] Ask query error:', err);
      res.status(500).json({ error: 'officer_ai_error', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createOfficerAiRouter
};
