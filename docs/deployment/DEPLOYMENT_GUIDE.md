# Kisan Vikas — Production Deployment & Setup Guide

## 1. System Prerequisites

- **Node.js**: v18.0.0 or later (v20+ recommended)
- **PostgreSQL**: v14.0 or later
- **npm**: v9.0 or later
- **Asterisk PBX** (Optional, for IVR telephony): v18 LTS or later
- **Git**: Installed and configured

---

## 2. PostgreSQL Database Setup

1. Create a PostgreSQL database:
   ```sql
   CREATE DATABASE kisan_queue;
   ```
2. Configure your database connection string in `.env`:
   ```bash
   DATABASE_URL=postgres://username:password@localhost:5432/kisan_queue
   ```
3. Run the baseline migrations and provisioning:
   ```bash
   cd backend
   node seed.js
   node scripts/migrate_master_platform.js
   node scripts/migrate_demo_and_expiry_schema.js
   node scripts/migrate_concurrency_hardening.js
   node scripts/provision_centre_admins.js
   node scripts/provision_district_officers.js
   node scripts/provision_csc_operators.js
   ```

---

## 3. Starting Platform Services

### 3.1 Backend API & FastAGI Ext 2000
```bash
cd backend
npm install
npm start
# Express API runs on http://localhost:4000
# FastAGI Ext 2000 listens on 0.0.0.0:4574 (Authoritative Telephony)
```

### 3.2 Farmer Web Portal
```bash
cd frontend
npm install
npm run dev
# Accessible at http://localhost:5173
```

### 3.3 Centre Admin & Officer Portal
```bash
cd admin-dashboard
npm install
npm run dev
# Accessible at http://localhost:5174
```

---

## 4. Production Build Verification
To build static assets for production deployment:
```bash
# Build Farmer Web
cd frontend && npm run build

# Build Admin Portal
cd ../admin-dashboard && npm run build
```
Both applications compile directly with Vite and output production bundles to their respective `dist/` directories.
