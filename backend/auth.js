const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const JWT_SECRET = process.env.JWT_SECRET || 'kisan-queue-super-secret-key-2026';
const SALT = 'kisan_queue_salt_2026';

function hashPassword(password) {
  return crypto.pbkdf2Sync(password, SALT, 1000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, hash) {
  const computed = hashPassword(password);
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(hash, 'hex'));
}

// Lightweight, dependency-free JWT (HS256) implementation
function base64UrlEncode(str) {
  return Buffer.from(str).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf8');
}

function generateToken(payload, expiresInSeconds = 86400 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload = { ...payload, exp };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyTokenString(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // expired
    }
    return payload;
  } catch (err) {
    return null;
  }
}

// Middleware: Strict Token Authentication
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  const token = authHeader && (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

  if (!token) {
    return res.status(401).json({
      error: 'auth_required',
      message: 'Authentication token is required to access this resource.'
    });
  }

  const user = verifyTokenString(token);
  if (!user) {
    return res.status(401).json({
      error: 'invalid_token',
      message: 'Authentication token is invalid or has expired.'
    });
  }

  if (user) {
    user.centreId = user.centreId || user.centre_id;
    user.centre_id = user.centreId;
    user.farmerId = user.farmerId || user.farmer_id;
    user.farmer_id = user.farmerId;
  }
  req.user = user;
  next();
}

// Middleware: Optional Token (attaches req.user if token provided)
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['x-auth-token'];
  const token = authHeader && (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader);

  if (token) {
    const user = verifyTokenString(token);
    if (user) {
      user.centreId = user.centreId || user.centre_id;
      user.centre_id = user.centreId;
      user.farmerId = user.farmerId || user.farmer_id;
      user.farmer_id = user.farmerId;
      req.user = user;
    }
  }
  next();
}

// Middleware: Require specific role(s)
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'auth_required', message: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'forbidden_role',
        message: `Access denied. Role ${req.user.role} does not have permission.`
      });
    }
    next();
  };
}

// Centre Admin Isolation: Enforce that CENTRE_ADMIN can ONLY manage their assigned centre
function enforceCentreAdminIsolation(req, res, next) {
  if (req.user && req.user.role === 'CENTRE_ADMIN') {
    const adminCentre = req.user.centreId || req.user.centre_id;
    const requestedCentreId =
      req.params?.centreId ||
      req.params?.id ||
      req.query?.centreId ||
      req.query?.centre_id ||
      req.body?.centre_id ||
      req.body?.centreId;

    if (requestedCentreId && requestedCentreId !== adminCentre) {
      return res.status(403).json({
        error: 'centre_access_denied',
        message: `Forbidden: You are assigned to centre ${adminCentre} and cannot view or modify centre ${requestedCentreId}.`
      });
    }
  }
  next();
}

// District Officer Isolation: Enforce that DISTRICT_OFFICER can ONLY access their assigned district
function enforceDistrictOfficerIsolation(req, res, next) {
  if (req.user && req.user.role === 'DISTRICT_OFFICER') {
    const requestedDistrict =
      req.params?.district ||
      req.query?.district ||
      req.body?.district;

    if (requestedDistrict && requestedDistrict.toLowerCase() !== req.user.district.toLowerCase()) {
      return res.status(403).json({
        error: 'district_access_denied',
        message: `Forbidden: You are assigned to district ${req.user.district} and cannot view or monitor district ${requestedDistrict}.`
      });
    }
  }
  next();
}

// Farmer Isolation: Enforce that FARMER can ONLY view their own bookings and profile
function enforceFarmerIsolation(req, res, next) {
  if (req.user && req.user.role === 'FARMER') {
    const farmerId = req.user.farmerId || req.user.farmer_id;
    const requestedFarmerId =
      req.params?.farmerId ||
      req.params?.id ||
      req.body?.farmer_id ||
      req.query?.farmer_id;

    if (requestedFarmerId && requestedFarmerId !== farmerId) {
      return res.status(403).json({
        error: 'farmer_access_denied',
        message: `Forbidden: You can only access records for your own Farmer ID (${farmerId}).`
      });
    }
  }
  next();
}

// Normalization helper for district names (e.g. Thiruchirappalli vs legacy Tiruchirappalli)
function normalizeDistrictName(district) {
  if (!district || typeof district !== 'string') return '';
  const d = district.trim().toLowerCase();
  if (d === 'tiruchirappalli' || d === 'thiruchirappalli' || d === 'trichy') {
    return 'thiruchirappalli';
  }
  return d;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyTokenString,
  authenticateToken,
  optionalAuthenticate,
  requireRole,
  enforceCentreAdminIsolation,
  enforceDistrictOfficerIsolation,
  enforceFarmerIsolation,
  normalizeDistrictName
};
