const jsonServer = require('json-server');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const FAKE_SECRET = process.env.FAKE_SECRET || 'thiqa-dev-fake-2024';
const PORT = process.env.PORT || 8001;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';

const MOCK_USERS = {
  'admin@thiqascore.com': {
    id: 'u-admin-001',
    password: 'admin123',
    role: 'super_admin',
    is_super_user: true,
    merchant_id: null,
    full_name: 'Admin User',
    mobile_number: '0991000001',
  },
  'merchant@demo.com': {
    id: 'u-merch-001',
    password: 'merchant123',
    role: 'merchant_user',
    is_super_user: false,
    merchant_id: 'm-syr-001',
    full_name: 'Merchant User',
    mobile_number: '0991000002',
  },
};

const FIXTURE_MAP = {
  // Original test profiles
  '0100123456': 'syriatel_low_risk.json',
  '0200789012': 'syriatel_high_risk.json',
  '0300345678': 'mtn_medium_risk.json',
  '0400901234': 'mixed_sims_stable.json',
  // Real-format fixtures
  '03280033883': 'syriatel_03280033883_detailed.json',
  '90010106821': 'mtn_90010106821.json',
  '01122334455': 'syriatel_01122334455.json',
  '06677889900': 'mtn_06677889900.json',
  '04455667788': 'syriatel_04455667788.json',
  // Generated 50 customers — various risk profiles
  '01100000001': 'customer_01100000001.json',
  '01100000002': 'customer_01100000002.json',
  '01100000003': 'customer_01100000003.json',
  '01100000004': 'customer_01100000004.json',
  '01100000005': 'customer_01100000005.json',
  '01100000006': 'customer_01100000006.json',
  '01100000007': 'customer_01100000007.json',
  '01100000008': 'customer_01100000008.json',
  '01100000009': 'customer_01100000009.json',
  '01100000010': 'customer_01100000010.json',
  '01100000011': 'customer_01100000011.json',
  '01100000012': 'customer_01100000012.json',
  '01100000013': 'customer_01100000013.json',
  '01100000014': 'customer_01100000014.json',
  '01100000015': 'customer_01100000015.json',
  '01100000016': 'customer_01100000016.json',
  '01100000017': 'customer_01100000017.json',
  '01100000018': 'customer_01100000018.json',
  '01100000019': 'customer_01100000019.json',
  '01100000020': 'customer_01100000020.json',
  '01100000021': 'customer_01100000021.json',
  '01100000022': 'customer_01100000022.json',
  '01100000023': 'customer_01100000023.json',
  '01100000024': 'customer_01100000024.json',
  '01100000025': 'customer_01100000025.json',
  '01100000026': 'customer_01100000026.json',
  '01100000027': 'customer_01100000027.json',
  '01100000028': 'customer_01100000028.json',
  '01100000029': 'customer_01100000029.json',
  '01100000030': 'customer_01100000030.json',
  '01100000031': 'customer_01100000031.json',
  '01100000032': 'customer_01100000032.json',
  '01100000033': 'customer_01100000033.json',
  '01100000034': 'customer_01100000034.json',
  '01100000035': 'customer_01100000035.json',
  '01100000036': 'customer_01100000036.json',
  '01100000037': 'customer_01100000037.json',
  '01100000038': 'customer_01100000038.json',
  '01100000039': 'customer_01100000039.json',
  '01100000040': 'customer_01100000040.json',
  '01100000041': 'customer_01100000041.json',
  '01100000042': 'customer_01100000042.json',
  '01100000043': 'customer_01100000043.json',
  '01100000044': 'customer_01100000044.json',
  '01100000045': 'customer_01100000045.json',
  '01100000046': 'customer_01100000046.json',
  '01100000047': 'customer_01100000047.json',
  '01100000048': 'customer_01100000048.json',
  '01100000049': 'customer_01100000049.json',
  '01100000050': 'customer_01100000050.json',
};

function loadFixture(nationalId) {
  const filename = FIXTURE_MAP[nationalId];
  if (!filename) return null;
  const p = path.join(__dirname, 'fixtures', filename);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// ── Format normalizer ─────────────────────────────────────────────────────────
// Converts provider-format fixtures (sims[]) to the format telecom_processor.py
// expects (sim_cards[] with sim_type, activation_date, six_month_summary, etc.)

function computeMonthsActive(purchaseDate) {
  if (!purchaseDate) return null;
  const start = new Date(purchaseDate);
  const now = new Date();
  return Math.max(0, Math.floor((now - start) / (1000 * 60 * 60 * 24 * 30.44)));
}

function aggregateTopupsByMonth(topups) {
  const monthly = {};
  for (const t of topups) {
    if (!t.date) continue;
    const month = t.date.substring(0, 7);
    monthly[month] = (monthly[month] || 0) + (t.amount || 0);
  }
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, monthly_total_syp]) => ({ month, monthly_total_syp }));
}

function normalizeToSimCards(fixture) {
  // Already in sim_cards format — pass through unchanged
  if (fixture.sim_cards) return fixture;

  // Transform sims[] (provider format) → sim_cards[] (processor format)
  const sim_cards = (fixture.sims || []).map(sim => {
    const simType = sim.type || 'prepaid';
    const normalized = {
      phone_number: sim.phone_number,
      sim_type: simType,
      status: sim.status,
      activation_date: sim.purchase_date,
      months_active: computeMonthsActive(sim.purchase_date),
      last_network_activity: sim.last_network_activity || null,
    };

    if (simType === 'prepaid') {
      const topups = sim.topups_last_6_months || [];
      const total = topups.reduce((sum, t) => sum + (t.amount || 0), 0);
      const monthlyActivity = aggregateTopupsByMonth(topups);

      normalized.six_month_summary = {
        total_topups: topups.length,
        total_topup_value_syp: total,
        average_monthly_topup_syp: total > 0 ? Math.round(total / 6) : 0,
      };
      normalized.monthly_activity = monthlyActivity;

      // last_topup_date from most recent entry
      const sorted = topups.slice().sort((a, b) => (a.date > b.date ? 1 : -1));
      if (sorted.length > 0) normalized.last_topup_date = sorted[sorted.length - 1].date;

    } else if (simType === 'contract') {
      normalized.monthly_fee_syp = sim.monthly_fee || null;
      normalized.payment_status = sim.payment_status || null;
      normalized.payments_last_6_months = (sim.payments_last_6_months || []).map(p => ({
        month: p.month,
        status: p.status,
      }));
    }

    return normalized;
  });

  return {
    national_id: fixture.national_id,
    provider: fixture.provider,
    request_id: fixture.request_id || ('req-' + fixture.national_id),
    generated_at: fixture.generated_at || new Date().toISOString(),
    customer: fixture.customer || { national_id: fixture.national_id },
    sim_cards,
  };
}

function makeToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, merchant_id: user.merchant_id },
    FAKE_SECRET,
    { expiresIn: '1h' }
  );
}

function verifyToken(req) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  try { return jwt.verify(token, FAKE_SECRET); } catch { return null; }
}

const server = jsonServer.create();
const router = jsonServer.router(path.join(__dirname, 'db.json'));
const middlewares = jsonServer.defaults({ noCors: true });

// Parse JSON bodies
server.use(require('express').json());

// CORS — must be before all routes
server.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Telecom provider endpoint (called by real ThiqaScore backend) ─────────────
// ThiqaScore's merchant_sync.py calls:
//   GET {integration.base_url}{integration.credit_accounts_endpoint}?national_id=X
// With integration.base_url=http://localhost:8001 and credit_accounts_endpoint=/api/customer-report

server.get('/api/customer-report', (req, res) => {
  const { national_id } = req.query;
  if (!national_id) {
    return res.status(400).json({ error: 'national_id query parameter is required' });
  }
  const raw = loadFixture(national_id);
  if (!raw) {
    return res.status(404).json({
      error: `No data found for national_id: ${national_id}`,
      available_ids: Object.keys(FIXTURE_MAP),
    });
  }
  // Normalize to sim_cards format so telecom_processor.py can process it
  const normalized = normalizeToSimCards(raw);
  res.json(normalized);
});

// ── Auth ─────────────────────────────────────────────────────────────────────

server.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = MOCK_USERS[email];
  if (!user || user.password !== password) {
    return res.status(401).json({ detail: 'Invalid email or password' });
  }
  const token = makeToken({ ...user, email });
  res.cookie('refresh_token', 'fake-refresh-' + Date.now(), { httpOnly: true, sameSite: 'lax' });
  res.json({
    access_token: token,
    token_type: 'bearer',
    user: { id: user.id, email, role: user.role, merchant_id: user.merchant_id },
  });
});

server.post('/auth/refresh', (req, res) => {
  // Always issue a fresh admin token for dev convenience
  const token = makeToken({ id: 'u-admin-001', email: 'admin@thiqascore.com', role: 'super_admin', merchant_id: null });
  res.json({ access_token: token, token_type: 'bearer' });
});

server.post('/auth/logout', (req, res) => {
  res.clearCookie('refresh_token');
  res.json({ message: 'Logged out successfully' });
});

// ── Users ─────────────────────────────────────────────────────────────────────

server.get('/users/me', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });
  const user = Object.values(MOCK_USERS).find(u => u.id === payload.sub);
  if (!user) return res.status(401).json({ detail: 'User not found' });
  res.json({
    id: user.id,
    email: payload.email,
    full_name: user.full_name,
    mobile_number: user.mobile_number,
    role: user.role,
    merchant_id: user.merchant_id,
    is_active: true,
    is_super_user: user.is_super_user,
    last_login: new Date().toISOString(),
    created_at: '2025-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
  });
});

server.patch('/users/me', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });
  res.json({ message: 'Profile updated (mock — not persisted after restart)' });
});

server.post('/users/me/change-password', (req, res) => {
  res.json({ message: 'Password changed (mock)' });
});

// ── Admin: users (stub) ───────────────────────────────────────────────────────

server.get('/admin/users', (req, res) => {
  const items = Object.entries(MOCK_USERS).map(([email, u]) => ({
    id: u.id, email, full_name: u.full_name, mobile_number: u.mobile_number,
    role: u.role, merchant_id: u.merchant_id, is_active: true,
    is_super_user: u.is_super_user, last_login: new Date().toISOString(),
    created_at: '2025-01-01T00:00:00Z', updated_at: new Date().toISOString(),
  }));
  res.json({ items, total: items.length, page: 1, per_page: 20 });
});

// ── Telecom Preview ───────────────────────────────────────────────────────────

server.get('/admin/merchant-integrations/:id/telecom-preview', (req, res) => {
  const { national_id } = req.query;
  if (!national_id) {
    return res.status(400).json({ detail: 'national_id query param is required' });
  }
  const fixture = loadFixture(national_id);
  if (!fixture) {
    return res.status(404).json({
      detail: `No fixture found for national_id: ${national_id}. Available: ${Object.keys(FIXTURE_MAP).join(', ')}`,
    });
  }
  const integrations = router.db.get('merchant_integrations').value();
  const integration = integrations.find(i => i.id === req.params.id);
  res.json({
    merchant_id: req.params.id,
    national_id,
    provider: integration?.provider || fixture.provider,
    raw_payload: fixture,
  });
});

// ── Telecom Ingest ────────────────────────────────────────────────────────────

server.post('/admin/telecom/ingest', (req, res) => {
  const { merchant_id, payload } = req.body || {};
  if (!payload?.customer?.national_id) {
    return res.status(422).json({ detail: 'payload.customer.national_id is required' });
  }
  const { national_id } = payload.customer;
  const fixture = loadFixture(national_id);

  const reportId = 'rpt-' + Date.now();
  const simCards = payload.sim_cards || fixture?.sim_cards || [];
  const report = {
    id: reportId,
    national_id,
    merchant_id: merchant_id || null,
    provider: payload.provider || fixture?.provider || 'Unknown',
    // Append timestamp so the same fixture can be ingested multiple times
    request_id: (payload.request_id || 'req') + '-' + Date.now(),
    account_status: 'active',
    number_of_sims: simCards.length,
    generated_at: payload.generated_at || new Date().toISOString(),
    ingested_at: new Date().toISOString(),
  };

  router.db.get('telecom_reports').push(report).write();

  res.status(201).json({
    report_id: reportId,
    national_id,
    provider: report.provider,
    features: fixture?.features || {},
  });
});

// ── Telecom Features CSV Export ───────────────────────────────────────────────

server.get('/admin/telecom/features/export', (req, res) => {
  const reports = router.db.get('telecom_reports').value();
  const cols = [
    'id', 'national_id', 'provider', 'total_sims', 'has_contract_sim',
    'contract_ontime_rate', 'max_tenure_months', 'days_since_last_activity',
    'prepaid_total_spend_6m', 'prepaid_avg_monthly_spend',
    'prepaid_spend_stddev', 'prepaid_spend_trend', 'prepaid_topup_frequency_6m',
    'computed_at', 'feature_version',
  ];
  const lines = [cols.join(',')];
  for (const r of reports) {
    const fixture = loadFixture(r.national_id);
    const f = fixture?.features || {};
    lines.push(cols.map(c => {
      const val = r[c] ?? f[c] ?? '';
      return String(val).includes(',') ? `"${val}"` : val;
    }).join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="telecom_features.csv"');
  res.send(lines.join('\n'));
});

// ── Merchant portal stubs (prevent 404s on empty lists) ────────────────────────

server.get('/merchant/verifications/summary', (req, res) => {
  res.json({ total: 0, verified: 0, failed: 0, review_required: 0 });
});

server.get('/admin/merchants/:id/verifications/summary', (req, res) => {
  res.json({ total: 0, verified: 0, failed: 0, review_required: 0 });
});

// ── Transactions ─────────────────────────────────────────────────────────────

// GET /merchant/transactions — global list, filterable
server.get('/merchant/transactions', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });

  let txns = router.db.get('transactions').value() || [];

  if (req.query.merchant_id) txns = txns.filter(t => t.merchant_id === req.query.merchant_id);
  if (req.query.credit_account_id) txns = txns.filter(t => t.credit_account_id === req.query.credit_account_id);
  if (req.query.transaction_type) txns = txns.filter(t => t.transaction_type === req.query.transaction_type);
  if (req.query.from_date) txns = txns.filter(t => t.transaction_date >= req.query.from_date);
  if (req.query.to_date) txns = txns.filter(t => t.transaction_date <= req.query.to_date + 'T23:59:59Z');

  if (payload.role !== 'super_admin' && payload.merchant_id) {
    txns = txns.filter(t => t.merchant_id === payload.merchant_id);
  }

  txns = txns.slice().sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));
  const page = parseInt(req.query.page) || 1;
  const per_page = parseInt(req.query.per_page) || 50;
  res.json(txns.slice((page - 1) * per_page, page * per_page));
});

// GET /merchant/credit-accounts/:id/transactions
server.get('/merchant/credit-accounts/:id/transactions', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });

  const txns = (router.db.get('transactions').value() || [])
    .filter(t => t.credit_account_id === req.params.id)
    .slice()
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date));

  const page = parseInt(req.query.page) || 1;
  const per_page = parseInt(req.query.per_page) || 50;
  res.json(txns.slice((page - 1) * per_page, page * per_page));
});

// POST /merchant/credit-accounts/:id/transactions
server.post('/merchant/credit-accounts/:id/transactions', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });

  const account = (router.db.get('credit_accounts').value() || []).find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ detail: 'Credit account not found' });

  const { transaction_type, direction, amount, transaction_date, reference, description } = req.body || {};
  if (!transaction_type || !amount) {
    return res.status(422).json({ detail: 'transaction_type and amount are required' });
  }

  if (account.account_type === 'BEHAVIOUR_PROFILE' && transaction_type !== 'TOPUP') {
    return res.status(400).json({ detail: 'BEHAVIOUR_PROFILE accounts only accept TOPUP transactions' });
  }

  const AUTO_DIR = {
    OPENING_BALANCE: 'DEBIT', PURCHASE: 'DEBIT', BILL: 'DEBIT',
    INTEREST: 'DEBIT', FEE: 'DEBIT',
    TOPUP: 'CREDIT', REFUND: 'CREDIT', REVERSAL: 'CREDIT',
  };
  const resolvedDir = direction || AUTO_DIR[transaction_type] || 'DEBIT';

  let balance_after = null;
  if (account.account_type !== 'BEHAVIOUR_PROFILE') {
    let balance = parseFloat(account.current_balance) || 0;
    if (transaction_type === 'OPENING_BALANCE') balance = parseFloat(amount);
    else if (resolvedDir === 'DEBIT') balance += parseFloat(amount);
    else balance = Math.max(0, balance - parseFloat(amount));
    balance_after = parseFloat(balance.toFixed(2));

    router.db.get('credit_accounts')
      .find({ id: req.params.id })
      .assign({
        current_balance: balance_after,
        balance_remaining: balance_after,
        status: balance_after <= 0 ? 'SETTLED' : 'ACTIVE',
        updated_at: new Date().toISOString(),
      })
      .write();
  }

  const txn = {
    id: 'txn-' + Date.now(),
    credit_account_id: req.params.id,
    merchant_id: account.merchant_id,
    transaction_type,
    direction: resolvedDir,
    amount: parseFloat(amount),
    balance_after,
    transaction_date: transaction_date || new Date().toISOString(),
    reference: reference || null,
    description: description || null,
    metadata_json: {},
    created_at: new Date().toISOString(),
  };

  router.db.get('transactions').push(txn).write();
  res.status(201).json(txn);
});

// GET /merchant/transactions/:id
server.get('/merchant/transactions/:id', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });
  const txn = (router.db.get('transactions').value() || []).find(t => t.id === req.params.id);
  if (!txn) return res.status(404).json({ detail: 'Transaction not found' });
  res.json(txn);
});

// POST /merchant/payments — block for BEHAVIOUR_PROFILE, update balance
server.post('/merchant/payments', (req, res) => {
  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ detail: 'Unauthorized' });

  const { credit_account_id, amount_paid } = req.body || {};
  const account = (router.db.get('credit_accounts').value() || []).find(a => a.id === credit_account_id);
  if (!account) return res.status(404).json({ detail: 'Credit account not found' });

  if (account.account_type === 'BEHAVIOUR_PROFILE') {
    return res.status(400).json({ detail: 'Payment events are not applicable to BEHAVIOUR_PROFILE accounts' });
  }

  const newBalance = parseFloat(Math.max(0, (parseFloat(account.current_balance) || 0) - parseFloat(amount_paid)).toFixed(2));
  router.db.get('credit_accounts')
    .find({ id: credit_account_id })
    .assign({
      current_balance: newBalance,
      balance_remaining: newBalance,
      status: newBalance <= 0 ? 'SETTLED' : 'ACTIVE',
      updated_at: new Date().toISOString(),
    })
    .write();

  const payment = {
    id: 'pay-' + Date.now(),
    merchant_id: account.merchant_id,
    ...req.body,
    amount_paid: parseFloat(amount_paid),
    created_at: new Date().toISOString(),
  };
  router.db.get('payments').push(payment).write();
  res.status(201).json(payment);
});

// ── Wire up json-server ───────────────────────────────────────────────────────

server.use(jsonServer.rewriter(require('./routes.json')));
server.use(middlewares);
server.use(router);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          ThiqaScore Fake API — Dev Mode              ║
╠══════════════════════════════════════════════════════╣
║  Running → http://localhost:${PORT}                     ║
║  DB view → http://localhost:${PORT}/db                   ║
╠══════════════════════════════════════════════════════╣
║  Login credentials                                   ║
║  admin@thiqascore.com / admin123  (super_admin)      ║
║  merchant@demo.com    / merchant123 (merchant_user)  ║
╠══════════════════════════════════════════════════════╣
║  Test national IDs for telecom preview               ║
║  0100123456  → Syriatel, low risk  (6/6 on-time)    ║
║  0200789012  → Syriatel, high risk (3 missed)        ║
║  0300345678  → MTN, medium risk    (prepaid only)    ║
║  0400901234  → Syriatel, 4 SIMs   (157mo tenure)    ║
║  03280033883 → Syriatel, 3 SIMs   (contract+2prep)  ║
║  90010106821 → MTN, 1 SIM         (low spend, gap)  ║
║  01122334455 → Syriatel, 4 SIMs   (1 inactive)      ║
║  06677889900 → MTN, high risk     (new+inactive)     ║
║  04455667788 → Syriatel, 2 SIMs   (contract+prep)   ║
╚══════════════════════════════════════════════════════╝
`);
});
