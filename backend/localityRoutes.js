/**
 * Locality Master API Routes
 * Endpoints for hierarchical geographic selection (District -> Taluk -> Village).
 */

const express = require('express');
const { LocalityService } = require('./services/locality/localityService');

function createLocalityRouter({ pool }) {
  const router = express.Router();
  const localityService = new LocalityService({ pool });

  /**
   * GET /api/localities/districts
   */
  router.get('/districts', async (req, res) => {
    try {
      const districts = await localityService.getDistricts();
      res.json({ success: true, districts });
    } catch (err) {
      res.status(500).json({ error: 'failed_to_fetch_districts', message: err.message });
    }
  });

  /**
   * GET /api/localities/taluks?district=...
   */
  router.get('/taluks', async (req, res) => {
    try {
      const district = req.query.district;
      if (!district) {
        return res.status(400).json({ error: 'missing_district', message: 'District query parameter is required.' });
      }
      const taluks = await localityService.getTaluks(district);
      res.json({ success: true, district, taluks });
    } catch (err) {
      res.status(500).json({ error: 'failed_to_fetch_taluks', message: err.message });
    }
  });

  /**
   * GET /api/localities?district=...&taluk=...&search=...
   */
  router.get('/', async (req, res) => {
    try {
      const { district, taluk, search, limit } = req.query;
      if (!district) {
        return res.status(400).json({ error: 'missing_district', message: 'District query parameter is required.' });
      }
      const localities = await localityService.getLocalities({
        district,
        taluk,
        search,
        limit: limit ? parseInt(limit, 10) : 100
      });
      res.json({ success: true, district, count: localities.length, localities });
    } catch (err) {
      res.status(500).json({ error: 'failed_to_fetch_localities', message: err.message });
    }
  });

  /**
   * /api/localities/validate (GET and POST)
   */
  router.all('/validate', async (req, res) => {
    try {
      const district = req.body?.district || req.query?.district;
      const locality = req.body?.locality || req.body?.locality_id || req.query?.locality || req.query?.locality_id;
      const result = await localityService.validateLocalityDistrict(district, locality);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: 'validation_error', message: err.message });
    }
  });

  return router;
}

module.exports = {
  createLocalityRouter
};
