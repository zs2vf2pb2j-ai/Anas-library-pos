// =========================================================================
// ANAS LIBRARY CLOUD ERP & POS — FULL ARCHITECTURE (NO SHORTCUTS)
// =========================================================================

let DB = {
    settings: {
        storeName: 'مكتبة أنس للمستلزمات العصرية',
        phone: '01000000000',
        address: 'مصر — بني سويف',
        allowNegativeStock: false,
        reserveStockOnOrder: true,
        showExactStockToCustomer: false,
        enableDelivery: true,
        paymentMethods: ['نقدي', 'تحويل / دفع إلكتروني', 'آجل'],
        expenseCategories: ['إيجار', 'كهرباء ومياه', 'أجور ومرتبات', 'نقل وشحن', 'صيانة', 'مصروفات تشغيلية أخرى'],
        lastBackupDate: null
    },
    users: [],
    categories: [],
    products: [],
    customers: [],
    suppliers: [],
    sales: [],
    salesReturns: [],
    purchases: [],
    external_orders: [],
    expenses: [],
    cashTransactions: [],
    inventoryMovements: [],
    auditLogs: []
};

let currentUser = null;
let currentAdminPage = 'dashboard';
let posCart = [];
let posCurrentIdempotencyKey = generateUUID();
let customerCart = [];
let storeSelectedCategory = 'all';
let storeSearchQuery = '';
let processedKeysCache = new Set();

const ROLE_LABELS = {
    admin: 'المدير العام',
    cashier: 'كاشير',
    storekeeper: 'أمين مخزن'
};

const MENU_DEFINITIONS = [
    { id: 'dashboard', label: '1. لوحة التحكم', roles: ['admin', 'cashier', 'storekeeper'] },
    { id: 'pos', label: '2. نقطة البيع POS', roles: ['admin', 'cashier'] },
    { id: 'sales', label: '3. فواتير المبيعات والمرتجعات', roles: ['admin', 'cashier'] },
    { id: 'external_orders', label: '4. الطلبات الخارجية', roles: ['admin', 'cashier'] },
    { id: 'products', label: '5. المنتجات والأصناف', roles: ['admin', 'cashier', 'storekeeper'] },
    { id: 'inventory', label: '6. المخزون والجرد والتسوية', roles: ['admin', 'storekeeper'] },
    { id: 'purchases', label: '7. المشتريات', roles: ['admin', 'storekeeper'] },
    { id: 'suppliers', label: '8. الموردون', roles: ['admin'] },
    { id: 'customers', label: '9. العملاء', roles: ['admin', 'cashier'] },
    { id: 'debts', label: '10. الحسابات والمديونيات', roles: ['admin'] },
    { id: 'payments', label: '11. المدفوعات والتحصيلات', roles: ['admin', 'cashier'] },
    { id: 'expenses', label: '12. المصروفات', roles: ['admin'] },
    { id: 'treasury', label: '13. الخزينة وحركة النقدية', roles: ['admin'] },
    { id: 'reports', label: '14. التقارير المالية والتحليلية', roles: ['admin'] },
    { id: 'users', label: '15. المستخدمون والصلاحيات', roles: ['admin'] },
    { id: 'notifications', label: '16. الإشعارات والتنبيهات', roles: ['admin', 'cashier', 'storekeeper'] },
    { id: 'audit', label: '17. سجل العمليات (Audit Log)', roles: ['admin'] },
    { id: 'settings', label: '18. إعدادات النظام', roles: ['admin'] },
    { id: 'backup', label: '19. النسخ الاحتياطي والاستعادة', roles: ['admin'] }
];

// =========================================================================
// INITIALIZATION & REAL-TIME LISTENERS
// =========================================================================
window.addEventListener('firebase-ready', async () => {
    try {
        await fetchAllCloudData();
        document.getElementById('cloudStatusText').textContent = '🟢 متصل بقاعدة بيانات Firebase السحابية';
        document.getElementById('storeFrontTitle').textContent = '📚 ' + DB.settings.storeName;
        initAuthUI();
        setupRealtimeListeners();
    } catch (err) {
        console.error(err);
        document.getElementById('cloudStatusText').textContent = '🔴 خطأ في الاتصال بـ Firebase (راجع قواعد Firestore Rules)';
        showToast('تعذر الاتصال بقاعدة البيانات: ' + err.message, true);
    }
});

function setupRealtimeListeners() {
    const { db, collection, onSnapshot } = window.FB;

    onSnapshot(collection(db, 'products'), snapshot => {
        DB.products = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        updateTopbarNotifications();
        if (!document.getElementById('adminApp').classList.contains('hidden')) {
            if (currentAdminPage === 'pos') renderPOSProductsGrid();
            if (currentAdminPage === 'products') renderProducts(document.getElementById('adminMainContent'));
        }
        if (!document.getElementById('customerApp').classList.contains('hidden')) {
            renderStoreView('catalog');
        }
    });

    onSnapshot(collection(db, 'external_orders'), snapshot => {
        DB.external_orders = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        DB.external_orders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        updateTopbarNotifications();
        if (!document.getElementById('adminApp').classList.contains('hidden')) {
            renderSidebar();
            if (currentAdminPage === 'external_orders') {
                renderExternalOrdersPage(document.getElementById('adminMainContent'));
            }
        }
    });
}

async function fetchAllCloudData() {
    const { db, collection, getDocs, doc, getDoc } = window.FB;
    const setSnap = await getDoc(doc(db, 'app_settings', 'main'));
    if (setSnap.exists()) {
        DB.settings = { ...DB.settings, ...setSnap.data() };
    }
    const cols = [
        'users', 'categories', 'products', 'customers', 'suppliers',
        'sales', 'salesReturns', 'purchases', 'external_orders',
        'expenses', 'cashTransactions', 'inventoryMovements', 'auditLogs'
    ];
    for (const c of cols) {
        const snap = await getDocs(collection(db, c));
        DB[c] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        DB[c].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }
}

// =========================================================================
// HELPERS & AUDIT
// =========================================================================
function generateUUID() {
    return 'IDEMP-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

function showToast(msg, isError = false) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    if (isError) el.style.background = '#b91c1c';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3500);
}

function formatMoney(num) {
    return Number(num || 0).toFixed(2) + ' ج.م';
}

function nowCairo() {
    return new Date().toLocaleString('sv-SE', { timeZone: 'Africa/Cairo' }).replace(' ', 'T');
}

async function logAuditCloud(action, details) {
    const { db, collection, addDoc } = window.FB;
    const entry = {
        action,
        details,
        user: currentUser ? currentUser.name : 'النظام / عميل خارجي',
        createdAt: nowCairo()
    };
    const ref = await addDoc(collection(db, 'auditLogs'), entry);
    DB.auditLogs.unshift({ id: ref.id, ...entry });
}

function hasPermission(pageId) {
    if (!currentUser) return false;
    const m = MENU_DEFINITIONS.find(x => x.id === pageId);
    return m ? m.roles.includes(currentUser.role) : false;
}

// =========================================================================
// AUTHENTICATION & SEEDING
// =========================================================================
function initAuthUI() {
    const hasAdmin = DB.users.some(u => u.role === 'admin');
    if (!hasAdmin) {
        document.getElementById('firstAdminSetupBox').classList.remove('hidden');
        document.getElementById('standardLoginBox').classList.add('hidden');
    } else {
        document.getElementById('firstAdminSetupBox').classList.add('hidden');
        document.getElementById('standardLoginBox').classList.remove('hidden');
    }
}

async function createFirstAdmin() {
    const name = document.getElementById('setupAdminName').value.trim();
    const username = document.getElementById('setupAdminUser').value.trim();
    const password = document.getElementById('setupAdminPass').value.trim();
    if (!name || !username || !password) return showToast('يرجى إدخال جميع البيانات', true);

    const { db, collection, addDoc } = window.FB;
    const newUser = {
        name,
        username,
        passwordHash: btoa(password),
        role: 'admin',
        active: true,
        createdAt: nowCairo()
    };
    const ref = await addDoc(collection(db, 'users'), newUser);
    currentUser = { id: ref.id, ...newUser };
    DB.users.push(currentUser);
    await logAuditCloud('تهيئة النظام', `إنشاء المدير العام الأول: ${name}`);
    enterWorkspace();
    showToast('تم إنشاء حساب المدير العام بنجاح');
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const user = DB.users.find(u => u.username === username && u.passwordHash === btoa(password));
    if (!user) return showToast('بيانات الدخول غير صحيحة', true);
    if (!user.active) return showToast('هذا الحساب معطّل من الإدارة', true);

    currentUser = user;
    await logAuditCloud('تسجيل دخول', `دخول المستخدم ${user.name} (${ROLE_LABELS[user.role]})`);
    enterWorkspace();
}

function logoutAdmin() {
    currentUser = null;
    document.getElementById('adminWorkspace').classList.add('hidden');
    document.getElementById('adminLoginScreen').classList.remove('hidden');
    initAuthUI();
}

function enterWorkspace() {
    document.getElementById('adminLoginScreen').classList.add('hidden');
    document.getElementById('adminWorkspace').classList.remove('hidden');
    document.getElementById('currentUserDisplay').textContent = currentUser.name;
    document.getElementById('currentRoleDisplay').textContent = ROLE_LABELS[currentUser.role];
    document.getElementById('topbarStoreName').textContent = DB.settings.storeName;
    renderSidebar();
    navigateAdmin('dashboard');
    updateTopbarNotifications();
}

async function seedTestDataToFirebase() {
    const { db, collection, addDoc } = window.FB;
    showToast('جاري تهيئة الحسابات والأقسام والمنتجات الافتراضية على السحابة...');

    if (DB.users.length === 0) {
        await addDoc(collection(db, 'users'), { name: 'م. أحمد (مدير عام)', username: 'admin', passwordHash: btoa('123456'), role: 'admin', active: true, createdAt: nowCairo() });
        await addDoc(collection(db, 'users'), { name: 'محمد (كاشير)', username: 'cashier', passwordHash: btoa('123456'), role: 'cashier', active: true, createdAt: nowCairo() });
        await addDoc(collection(db, 'users'), { name: 'محمود (أمين مخزن)', username: 'store', passwordHash: btoa('123456'), role: 'storekeeper', active: true, createdAt: nowCairo() });
    }

    if (DB.categories.length === 0) {
        const defaultCats = [
            'الكتب والكراسات',
            'الأدوات المدرسية والمكتبية',
            'الأدوات المنزلية',
            'العطور ومستحضرات التجميل',
            'المنظفات',
            'لعب وهدايا وإكسسوارات',
            'الحفاضات والمناديل والفوط الصحية'
        ];
        for (const c of defaultCats) {
            await addDoc(collection(db, 'categories'), { name: c, createdAt: nowCairo() });
        }
    }

    if (DB.products.length === 0) {
        await addDoc(collection(db, 'products'), {
            sku: 'TEST-5070', barcode: '1001',
            name: 'كشكول سلك 100 ورقة (اختبار قياسي)',
            categoryName: 'الكتب والكراسات',
            desc: 'منتج اختبار قياسي: تكلفة 50 ج.م / بيع 70 ج.م / ربح الوحدة 20 ج.م',
            costPrice: 50, sellPrice: 70, stock: 25, reserved: 0, minStock: 5,
            active: true, showInStore: true, createdAt: nowCairo()
        });
        await addDoc(collection(db, 'products'), {
            sku: 'PEN-01', barcode: '1002',
            name: 'علبة أقلام جاف أزرق (12 قلم)',
            categoryName: 'الأدوات المدرسية والمكتبية',
            desc: 'أقلام جاف خط ناعم للاستخدام المدرسي والمكتبي',
            costPrice: 30, sellPrice: 45, stock: 40, reserved: 0, minStock: 10,
            active: true, showInStore: true, createdAt: nowCairo()
        });
        await addDoc(collection(db, 'products'), {
            sku: 'PERF-05', barcode: '1003',
            name: 'عطر رجالي كلاسيك 100 مل',
            categoryName: 'العطور ومستحضرات التجميل',
            desc: 'ثبات عالي ورائحة مميزة',
            costPrice: 120, sellPrice: 180, stock: 12, reserved: 0, minStock: 3,
            active: true, showInStore: true, createdAt: nowCairo()
        });
    }

    if (DB.customers.length === 0) {
        await addDoc(collection(db, 'customers'), {
            name: 'عميل نقدي افتراضي', phone: '-', address: '-', balance: 0, isDefaultCash: true, createdAt: nowCairo()
        });
    }

    if (DB.suppliers.length === 0) {
        await addDoc(collection(db, 'suppliers'), {
            name: 'شركة الفجر لتوزيع الأدوات المكتبية', phone: '01112223334', address: 'القاهرة - الفجالة', balance: 0, createdAt: nowCairo()
        });
    }

    await fetchAllCloudData();
    initAuthUI();
    document.getElementById('loginUsername').value = 'admin';
    document.getElementById('loginPassword').value = '123456';
    showToast('✅ تمت تهيئة البيانات السحابية بنجاح! يمكنك الدخول الآن (admin / 123456)');
}

// =========================================================================
// SIDEBAR & NAVIGATION
// =========================================================================
function renderSidebar() {
    const list = document.getElementById('adminNavList');
    list.innerHTML = '';
    const newOrders = DB.external_orders.filter(o => o.status === 'جديد').length;

    MENU_DEFINITIONS.forEach(m => {
        const allowed = m.roles.includes(currentUser.role);
        const li = document.createElement('li');
        li.className = 'nav-item' + (currentAdminPage === m.id ? ' active' : '');
        if (!allowed) li.style.opacity = '0.45';
        li.innerHTML = `
            <span>${m.label}</span>
            ${m.id === 'external_orders' && newOrders > 0 ? `<span class="badge badge-new">${newOrders}</span>` : ''}
        `;
        li.onclick = () => {
            navigateAdmin(m.id);
            if (window.innerWidth <= 900) closeSidebarMobile();
        };
        list.appendChild(li);
    });
}

function toggleSidebar() {
    const sb = document.getElementById('adminSidebar');
    const bd = document.getElementById('sidebarBackdrop');
    sb.classList.toggle('closed');
    if (window.innerWidth <= 900) {
        if (!sb.classList.contains('closed')) bd.classList.add('show');
        else bd.classList.remove('show');
    }
}

function closeSidebarMobile() {
    document.getElementById('adminSidebar').classList.add('closed');
    document.getElementById('sidebarBackdrop').classList.remove('show');
}

function updateTopbarNotifications() {
    const newOrders = DB.external_orders.filter(o => o.status === 'جديد').length;
    const lowStock = DB.products.filter(p => (p.stock - (p.reserved || 0)) <= (p.minStock || 5)).length;
    const b1 = document.getElementById('topbarNewOrdersBadge');
    const b2 = document.getElementById('topbarAlertsBadge');
    if (b1) b1.textContent = newOrders;
    if (b2) b2.textContent = lowStock;
}

function navigateAdmin(pageId) {
    if (!hasPermission(pageId)) {
        logAuditCloud('محاولة وصول مرفوضة', `حاول ${currentUser.name} فتح صفحة ${pageId}`);
        return showToast('⛔ ليس لديك صلاحية للوصول إلى هذه الصفحة', true);
    }
    currentAdminPage = pageId;
    document.getElementById('currentPageBreadcrumb').textContent = MENU_DEFINITIONS.find(m => m.id === pageId)?.label || pageId;
    renderSidebar();
    const c = document.getElementById('adminMainContent');

    switch (pageId) {
        case 'dashboard': renderDashboard(c); break;
        case 'pos': renderPOS(c); break;
        case 'sales': renderSalesInvoicesPage(c); break;
        case 'external_orders': renderExternalOrdersPage(c); break;
        case 'products': renderProducts(c); break;
        case 'inventory': renderInventoryPage(c); break;
        case 'purchases': renderPurchasesPage(c); break;
        case 'suppliers': renderSuppliersPage(c); break;
        case 'customers': renderCustomersPage(c); break;
        case 'debts': renderDebtsPage(c); break;
        case 'payments': renderPaymentsPage(c); break;
        case 'expenses': renderExpensesPage(c); break;
        case 'treasury': renderTreasuryPage(c); break;
        case 'reports': renderReportsPage(c); break;
        case 'users': renderUsersPage(c); break;
        case 'notifications': renderNotificationsPage(c); break;
        case 'audit': renderAuditLogsPage(c); break;
        case 'settings': renderSettingsPage(c); break;
        case 'backup': renderBackupPage(c); break;
    }
}

// =========================================================================
// 1. DASHBOARD
// =========================================================================
function renderDashboard(c) {
    const todayStr = nowCairo().slice(0, 10);
    const todaySales = DB.sales.filter(s => (s.createdAt || '').startsWith(todayStr));
    const todayTotal = todaySales.reduce((a, b) => a + b.total, 0);

    const totalSalesAll = DB.sales.reduce((a, b) => a + b.total, 0);
    const totalReturnsAll = DB.salesReturns.reduce((a, b) => a + b.totalRefund, 0);
    const netSales = totalSalesAll - totalReturnsAll;

    let totalCOGS = 0;
    DB.sales.forEach(s => (s.items || []).forEach(it => totalCOGS += ((it.costPrice || 0) * it.qty)));
    DB.salesReturns.forEach(r => (r.items || []).forEach(it => totalCOGS -= ((it.costPrice || 0) * it.qty)));

    const grossProfit = netSales - totalCOGS;
    const totalExpenses = DB.expenses.reduce((a, b) => a + b.amount, 0);
    const netProfit = grossProfit - totalExpenses;

    const customerDebts = DB.customers.reduce((a, b) => a + (b.balance > 0 ? b.balance : 0), 0);
    const supplierDebts = DB.suppliers.reduce((a, b) => a + (b.balance > 0 ? b.balance : 0), 0);
    const stockCostValue = DB.products.reduce((a, p) => a + (p.stock * p.costPrice), 0);

    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>📊 الملخص المالي والتشغيلي اللحظي</h3>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-primary btn-sm" onclick="navigateAdmin('pos')">+ فاتورة مبيعات POS</button>
                    <button class="btn btn-outline btn-sm" onclick="fetchAllCloudData().then(()=>renderDashboard(document.getElementById('adminMainContent')))">🔄 تحديث السحابة</button>
                </div>
            </div>
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-title">مبيعات اليوم (${todaySales.length} فاتورة)</div><div class="kpi-value" style="color:var(--primary);">${formatMoney(todayTotal)}</div></div>
                <div class="kpi-card"><div class="kpi-title">صافي المبيعات (بعد المرتجعات)</div><div class="kpi-value">${formatMoney(netSales)}</div></div>
                <div class="kpi-card"><div class="kpi-title">تكلفة البضاعة المباعة (COGS)</div><div class="kpi-value">${formatMoney(totalCOGS)}</div></div>
                <div class="kpi-card"><div class="kpi-title">مجمل الربح</div><div class="kpi-value" style="color:var(--success);">${formatMoney(grossProfit)}</div></div>
                <div class="kpi-card"><div class="kpi-title">إجمالي المصروفات</div><div class="kpi-value" style="color:var(--danger);">${formatMoney(totalExpenses)}</div></div>
                <div class="kpi-card"><div class="kpi-title">صافي الربح التقديري</div><div class="kpi-value" style="color:${netProfit >= 0 ? 'var(--success)' : 'var(--danger)'};">${formatMoney(netProfit)}</div></div>
                <div class="kpi-card"><div class="kpi-title">مديونيات العملاء</div><div class="kpi-value" style="color:var(--warning);">${formatMoney(customerDebts)}</div></div>
                <div class="kpi-card"><div class="kpi-title">مستحقات الموردين</div><div class="kpi-value" style="color:var(--danger);">${formatMoney(supplierDebts)}</div></div>
                <div class="kpi-card"><div class="kpi-title">قيمة المخزون بالتكلفة</div><div class="kpi-value">${formatMoney(stockCostValue)}</div></div>
            </div>
        </div>

        <div class="panel">
            <div class="panel-header"><h3>🕒 أحدث 5 فواتير مبيعات</h3></div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الدفع</th></tr></thead>
                    <tbody>
                        ${DB.sales.slice(0, 5).map(s => {
                            const cust = DB.customers.find(x => x.id === s.customerId);
                            return `<tr>
                                <td><strong>${s.invoiceNo}</strong></td>
                                <td>${(s.createdAt || '').replace('T', ' ')}</td>
                                <td>${cust ? cust.name : 'عميل نقدي'}</td>
                                <td><strong>${formatMoney(s.total)}</strong></td>
                                <td>${formatMoney(s.paid)}</td>
                                <td style="color:${s.remaining > 0 ? 'var(--danger)' : 'inherit'}">${formatMoney(s.remaining)}</td>
                                <td>${s.paymentMethod}</td>
                            </tr>`;
                        }).join('') || '<tr><td colspan="7" style="text-align:center;">لا توجد فواتير مسجلة بعد</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

// =========================================================================
// 2. POINT OF SALE (POS) WITH ATOMIC TRANSACTIONS & BARCODE SUPPORT
// =========================================================================
function renderPOS(c) {
    c.innerHTML = `
        <div class="pos-grid">
            <div class="panel">
                <div class="panel-header">
                    <h3>🛒 المنتجات المتاحة للبيع</h3>
                    <input type="text" id="posSearchInput" placeholder="ابحث بالاسم أو الكود أو امسح الباركود..." oninput="renderPOSProductsGrid()" onkeydown="handlePOSBarcodeEnter(event)" style="max-width:270px;">
                </div>
                <div class="pos-product-grid" id="posProductsGrid"></div>
            </div>

            <div class="panel">
                <div class="panel-header">
                    <h3>🧾 الفاتورة الحالية</h3>
                    <button class="btn btn-outline btn-sm" onclick="posCart=[];posCurrentIdempotencyKey=generateUUID();renderPOSCart()">تفريغ السلة</button>
                </div>

                <div class="form-row" style="margin-bottom:10px;">
                    <div>
                        <label style="font-size:12px;">العميل</label>
                        <select id="posCustomerSelect">
                            ${DB.customers.map(cu => `<option value="${cu.id}">${cu.name} ${cu.balance > 0 ? `(مديونية: ${cu.balance})` : ''}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label style="font-size:12px;">طريقة الدفع</label>
                        <select id="posPaymentMethod" onchange="updatePOSTotals(true)">
                            ${DB.settings.paymentMethods.map(m => `<option value="${m}">${m}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div class="table-wrap" style="max-height:240px; overflow-y:auto; margin-bottom:10px;">
                    <table>
                        <thead><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th><th></th></tr></thead>
                        <tbody id="posCartBody"></tbody>
                    </table>
                </div>

                <div class="form-row">
                    <div class="form-group"><label>الخصم (ج.م)</label><input type="number" id="posDiscountInput" value="0" min="0" oninput="updatePOSTotals(true)"></div>
                    <div class="form-group"><label>المبلغ المدفوع (ج.م)</label><input type="number" id="posPaidInput" value="0" min="0" oninput="updatePOSTotals(false)"></div>
                </div>

                <div style="background:#f8fafc; padding:12px; border-radius:8px; margin-bottom:12px; border:1px solid var(--border-color);">
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span>الإجمالي قبل الخصم:</span><strong id="posSubTotal">0.00 ج.م</strong></div>
                    <div style="display:flex; justify-content:space-between; margin-bottom:4px; font-size:16px;"><span>الإجمالي النهائي:</span><strong id="posGrandTotal" style="color:var(--primary);">0.00 ج.م</strong></div>
                    <div style="display:flex; justify-content:space-between; color:var(--danger);"><span>المتبقي (آجل):</span><strong id="posRemaining">0.00 ج.م</strong></div>
                </div>

                <button class="btn btn-success w-100" id="btnCompleteCloudSale" style="padding:12px; font-size:15px;" onclick="submitCloudSale()">✅ اعتماد الفاتورة وإتمام البيع</button>
            </div>
        </div>
    `;
    renderPOSProductsGrid();
    renderPOSCart();
}

function handlePOSBarcodeEnter(e) {
    if (e.key === 'Enter') {
        const q = e.target.value.trim().toLowerCase();
        if (!q) return;
        const exact = DB.products.find(p => p.active !== false && ((p.barcode && p.barcode.toLowerCase() === q) || (p.sku && p.sku.toLowerCase() === q)));
        if (exact) {
            addToPOSCart(exact.id);
            e.target.value = '';
            renderPOSProductsGrid();
        }
    }
}

function renderPOSProductsGrid() {
    const q = (document.getElementById('posSearchInput')?.value || '').trim().toLowerCase();
    const grid = document.getElementById('posProductsGrid');
    if (!grid) return;

    const filtered = DB.products.filter(p => p.active !== false && (
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q)) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    ));

    grid.innerHTML = filtered.map(p => {
        const avail = p.stock - (p.reserved || 0);
        return `
            <div class="pos-item-card" onclick="addToPOSCart('${p.id}')">
                <div style="font-size:11px; color:var(--text-muted);">${p.sku}</div>
                <div style="font-weight:700; font-size:13px; margin:3px 0;">${p.name}</div>
                <div style="color:var(--primary); font-weight:800;">${formatMoney(p.sellPrice)}</div>
                <div style="font-size:11px; color:${avail <= (p.minStock || 5) ? 'var(--danger)' : 'var(--secondary)'};">المتاح: ${avail}</div>
            </div>
        `;
    }).join('') || '<p>لا توجد منتجات مطابقة</p>';
}

function addToPOSCart(productId) {
    const prod = DB.products.find(p => p.id === productId);
    if (!prod) return;
    const avail = prod.stock - (prod.reserved || 0);
    const existing = posCart.find(i => i.productId === productId);

    if (!DB.settings.allowNegativeStock && ((existing ? existing.qty + 1 : 1) > avail)) {
        return showToast(`الكمية المتاحة من "${prod.name}" هي ${avail} فقط`, true);
    }

    if (existing) existing.qty += 1;
    else posCart.push({ productId: prod.id, name: prod.name, qty: 1, sellPrice: prod.sellPrice, costPrice: prod.costPrice });
    renderPOSCart();
}

function renderPOSCart() {
    const b = document.getElementById('posCartBody');
    if (!b) return;
    b.innerHTML = posCart.map((i, idx) => `
        <tr>
            <td>${i.name}</td>
            <td>${i.sellPrice}</td>
            <td><input type="number" value="${i.qty}" min="1" style="width:60px; padding:4px;" onchange="updatePOSCartQty(${idx}, this.value)"></td>
            <td><strong>${(i.qty * i.sellPrice).toFixed(2)}</strong></td>
            <td><button class="btn btn-danger btn-sm" onclick="posCart.splice(${idx},1); renderPOSCart();">✕</button></td>
        </tr>
    `).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">السلة فارغة — اختر منتجات من القائمة</td></tr>';
    updatePOSTotals(true);
}

function updatePOSCartQty(idx, val) {
    const newQty = Math.max(1, parseInt(val) || 1);
    const item = posCart[idx];
    const prod = DB.products.find(p => p.id === item.productId);
    const avail = prod ? (prod.stock - (prod.reserved || 0)) : newQty;
    if (!DB.settings.allowNegativeStock && newQty > avail) {
        showToast(`الحد الأقصى المتاح في المخزون هو ${avail}`, true);
        item.qty = avail;
    } else {
        item.qty = newQty;
    }
    renderPOSCart();
}

function updatePOSTotals(autoFillPaid = false) {
    const sub = posCart.reduce((s, i) => s + (i.qty * i.sellPrice), 0);
    const disc = parseFloat(document.getElementById('posDiscountInput')?.value) || 0;
    const total = Math.max(0, sub - disc);
    const method = document.getElementById('posPaymentMethod')?.value;
    const paidEl = document.getElementById('posPaidInput');

    if (autoFillPaid && paidEl) {
        paidEl.value = method === 'آجل' ? 0 : total;
    }
    const paid = parseFloat(paidEl?.value) || 0;
    const rem = Math.max(0, total - paid);

    if (document.getElementById('posSubTotal')) document.getElementById('posSubTotal').textContent = formatMoney(sub);
    if (document.getElementById('posGrandTotal')) document.getElementById('posGrandTotal').textContent = formatMoney(total);
    if (document.getElementById('posRemaining')) document.getElementById('posRemaining').textContent = formatMoney(rem);
}

async function submitCloudSale() {
    if (posCart.length === 0) return showToast('السلة فارغة!', true);
    if (processedKeysCache.has(posCurrentIdempotencyKey)) return showToast('تم تنفيذ هذه الفاتورة مسبقاً', true);

    const btn = document.getElementById('btnCompleteCloudSale');
    btn.disabled = true;

    const { db, collection, doc, runTransaction, addDoc } = window.FB;
    try {
        const invoiceNo = 'INV-' + (1000 + DB.sales.length + 1);
        const discount = parseFloat(document.getElementById('posDiscountInput').value) || 0;
        const paid = parseFloat(document.getElementById('posPaidInput').value) || 0;
        const paymentMethod = document.getElementById('posPaymentMethod').value;
        const customerId = document.getElementById('posCustomerSelect').value;

        const saleData = await runTransaction(db, async (transaction) => {
            let subtotal = 0;
            const verifiedItems = [];
            const prodUpdates = [];

            for (const item of posCart) {
                const pRef = doc(db, 'products', item.productId);
                const pSnap = await transaction.get(pRef);
                if (!pSnap.exists()) throw new Error(`المنتج ${item.name} غير موجود`);
                const pData = pSnap.data();
                const avail = pData.stock - (pData.reserved || 0);
                if (!DB.settings.allowNegativeStock && item.qty > avail) {
                    throw new Error(`المخزون المتاح من ${pData.name} غير كافٍ (${avail})`);
                }
                subtotal += pData.sellPrice * item.qty;
                verifiedItems.push({
                    productId: item.productId,
                    name: pData.name,
                    qty: item.qty,
                    costPrice: pData.costPrice,
                    sellPrice: pData.sellPrice
                });
                prodUpdates.push({ ref: pRef, newStock: pData.stock - item.qty });
            }

            const total = Math.max(0, subtotal - discount);
            const remaining = Math.max(0, total - paid);

            if (remaining > 0) {
                const cust = DB.customers.find(x => x.id === customerId);
                if (!cust || cust.isDefaultCash) {
                    throw new Error('لا يمكن تسجيل مبلغ متبقٍ (آجل) على العميل النقدي الافتراضي. اختر عميلاً مسجلاً.');
                }
            }

            for (const u of prodUpdates) {
                transaction.update(u.ref, { stock: u.newStock });
            }

            if (remaining > 0 && customerId) {
                const cRef = doc(db, 'customers', customerId);
                const cSnap = await transaction.get(cRef);
                if (cSnap.exists()) {
                    transaction.update(cRef, { balance: (cSnap.data().balance || 0) + remaining });
                }
            }

            return {
                invoiceNo,
                idempotencyKey: posCurrentIdempotencyKey,
                customerId,
                items: verifiedItems,
                subtotal,
                discount,
                total,
                paid,
                remaining,
                paymentMethod,
                user: currentUser.name,
                createdAt: nowCairo()
            };
        });

        const sRef = await addDoc(collection(db, 'sales'), saleData);
        const savedSale = { id: sRef.id, ...saleData };
        DB.sales.unshift(savedSale);

        for (const it of saleData.items) {
            await addDoc(collection(db, 'inventoryMovements'), {
                productId: it.productId,
                productName: it.name,
                type: 'صرف مبيعات',
                qty: -it.qty,
                reason: `فاتورة ${invoiceNo}`,
                user: currentUser.name,
                createdAt: nowCairo()
            });
        }

        if (saleData.paid > 0) {
            await addDoc(collection(db, 'cashTransactions'), {
                type: 'مبيعات POS',
                amount: saleData.paid,
                direction: 'in',
                refNo: invoiceNo,
                notes: `تحصيل فاتورة مبيعات ${invoiceNo}`,
                user: currentUser.name,
                createdAt: nowCairo()
            });
        }

        processedKeysCache.add(posCurrentIdempotencyKey);
        await logAuditCloud('إصدار فاتورة مبيعات', `فاتورة ${invoiceNo} بقيمة ${saleData.total}`);
        await fetchAllCloudData();

        posCart = [];
        posCurrentIdempotencyKey = generateUUID();
        renderPOSCart();
        showToast(`✅ تم اعتماد الفاتورة ${invoiceNo} بنجاح!`);
        printInvoiceReceipt(savedSale);
    } catch (err) {
        showToast(err.message, true);
    } finally {
        btn.disabled = false;
    }
}

function printInvoiceReceipt(sale) {
    const cust = DB.customers.find(c => c.id === sale.customerId);
    const pa = document.getElementById('printArea');
    pa.innerHTML = `
        <div style="max-width:420px; margin:0 auto; font-family:'Cairo',sans-serif; direction:rtl; border:1px solid #ccc; padding:16px;">
            <div style="text-align:center; border-bottom:1px dashed #333; padding-bottom:10px; margin-bottom:10px;">
                <h2 style="margin:0;">${DB.settings.storeName}</h2>
                <div style="font-size:12px;">${DB.settings.address} | هاتف: ${DB.settings.phone}</div>
                <div style="font-weight:bold; margin-top:6px;">فاتورة مبيعات رقم: ${sale.invoiceNo}</div>
                <div style="font-size:12px;">التاريخ: ${(sale.createdAt || '').replace('T', ' ')}</div>
                <div style="font-size:12px;">العميل: ${cust ? cust.name : 'عميل نقدي'}</div>
            </div>
            <table style="width:100%; font-size:12px; border-collapse:collapse;">
                <thead><tr style="border-bottom:1px solid #333;"><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
                <tbody>
                    ${(sale.items || []).map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${i.sellPrice}</td><td>${(i.qty * i.sellPrice).toFixed(2)}</td></tr>`).join('')}
                </tbody>
            </table>
            <div style="border-top:1px dashed #333; margin-top:10px; padding-top:8px; font-size:13px;">
                <div>الإجمالي قبل الخصم: ${formatMoney(sale.subtotal || sale.total)}</div>
                <div>الخصم: ${formatMoney(sale.discount || 0)}</div>
                <div style="font-size:15px; font-weight:bold;">الصافي المطلوب: ${formatMoney(sale.total)}</div>
                <div>المدفوع: ${formatMoney(sale.paid)} | المتبقي: ${formatMoney(sale.remaining)}</div>
            </div>
            <div style="text-align:center; margin-top:14px; font-size:12px;">شكراً لتعاملكم معنا!</div>
        </div>
    `;
    window.print();
}

// =========================================================================
// 3. SALES INVOICES & SALES RETURNS
// =========================================================================
function renderSalesInvoicesPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>🧾 سجل فواتير المبيعات</h3>
                <button class="btn btn-primary btn-sm" onclick="navigateAdmin('pos')">+ فاتورة جديدة</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>العميل</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الدفع</th><th>إجراءات</th></tr></thead>
                    <tbody>
                        ${DB.sales.map(s => {
                            const cust = DB.customers.find(x => x.id === s.customerId);
                            return `<tr>
                                <td><strong>${s.invoiceNo}</strong></td>
                                <td>${(s.createdAt || '').replace('T', ' ')}</td>
                                <td>${cust ? cust.name : 'عميل نقدي'}</td>
                                <td><strong>${formatMoney(s.total)}</strong></td>
                                <td>${formatMoney(s.paid)}</td>
                                <td style="color:${s.remaining > 0 ? 'var(--danger)' : 'inherit'}">${formatMoney(s.remaining)}</td>
                                <td>${s.paymentMethod}</td>
                                <td style="display:flex; gap:5px;">
                                    <button class="btn btn-outline btn-sm" onclick='printInvoiceReceipt(${JSON.stringify(s)})'>🖨️ طباعة</button>
                                    <button class="btn btn-warning btn-sm" onclick="openSalesReturnModal('${s.id}')">↩️ مرتجع</button>
                                </td>
                            </tr>`;
                        }).join('') || '<tr><td colspan="8" style="text-align:center;">لا توجد فواتير مبيعات</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <div class="panel">
            <div class="panel-header"><h3>↩️ سجل مرتجعات المبيعات</h3></div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>رقم المرتجع</th><th>الفاتورة الأصلية</th><th>التاريخ</th><th>قيمة المرتجع</th><th>الموظف</th></tr></thead>
                    <tbody>
                        ${DB.salesReturns.map(r => `<tr>
                            <td><strong>${r.returnNo}</strong></td>
                            <td>${r.invoiceNo}</td>
                            <td>${(r.createdAt || '').replace('T', ' ')}</td>
                            <td style="color:var(--danger); font-weight:700;">${formatMoney(r.totalRefund)}</td>
                            <td>${r.user}</td>
                        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;">لا توجد مرتجعات مسجلة</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function openSalesReturnModal(saleId) {
    const sale = DB.sales.find(s => s.id === saleId);
    if (!sale) return;
    openModal(`
        <h3>↩️ تسجيل مرتجع مبيعات للفاتورة ${sale.invoiceNo}</h3>
        <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">حدد الكمية المرتجعة لكل صنف (0 = لن يتم إرجاعه):</p>
        <table>
            <thead><tr><th>الصنف</th><th>الكمية المباعة</th><th>سعر البيع</th><th>كمية المرتجع</th></tr></thead>
            <tbody>
                ${(sale.items || []).map((it, idx) => `
                    <tr>
                        <td>${it.name}</td>
                        <td>${it.qty}</td>
                        <td>${formatMoney(it.sellPrice)}</td>
                        <td><input type="number" id="retQty_${idx}" min="0" max="${it.qty}" value="0" style="width:75px;"></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div style="display:flex; gap:8px; margin-top:16px;">
            <button class="btn btn-danger" onclick="submitSalesReturn('${sale.id}')">تأكيد المرتجع وإعادة للمخزون</button>
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
        </div>
    `);
}

async function submitSalesReturn(saleId) {
    const sale = DB.sales.find(s => s.id === saleId);
    if (!sale) return;
    const { db, doc, updateDoc, addDoc, collection } = window.FB;

    const returnedItems = [];
    let totalRefund = 0;

    sale.items.forEach((it, idx) => {
        const q = parseInt(document.getElementById(`retQty_${idx}`)?.value) || 0;
        if (q > 0 && q <= it.qty) {
            returnedItems.push({ ...it, qty: q });
            totalRefund += q * it.sellPrice;
        }
    });

    if (returnedItems.length === 0) return showToast('يرجى إدخال كمية مرتجعة صحيحة', true);

    const returnNo = 'RET-' + (100 + DB.salesReturns.length + 1);

    for (const rit of returnedItems) {
        const prod = DB.products.find(p => p.id === rit.productId);
        if (prod) {
            await updateDoc(doc(db, 'products', prod.id), { stock: prod.stock + rit.qty });
        }
        await addDoc(collection(db, 'inventoryMovements'), {
            productId: rit.productId,
            productName: rit.name,
            type: 'وارد مرتجع مبيعات',
            qty: rit.qty,
            reason: `مرتجع ${returnNo} لفاتورة ${sale.invoiceNo}`,
            user: currentUser.name,
            createdAt: nowCairo()
        });
    }

    await addDoc(collection(db, 'salesReturns'), {
        returnNo,
        saleId: sale.id,
        invoiceNo: sale.invoiceNo,
        items: returnedItems,
        totalRefund,
        user: currentUser.name,
        createdAt: nowCairo()
    });

    await addDoc(collection(db, 'cashTransactions'), {
        type: 'مرتجع مبيعات',
        amount: totalRefund,
        direction: 'out',
        refNo: returnNo,
        notes: `رد نقدية مرتجع ${returnNo} لفاتورة ${sale.invoiceNo}`,
        user: currentUser.name,
        createdAt: nowCairo()
    });

    await logAuditCloud('مرتجع مبيعات', `إصدار مرتجع ${returnNo} بقيمة ${totalRefund}`);
    await fetchAllCloudData();
    closeModal();
    navigateAdmin('sales');
    showToast(`✅ تم تسجيل المرتجع ${returnNo} وإعادة الأصناف للمخزون`);
}

// =========================================================================
// 4. EXTERNAL ORDERS (STOREFRONT ORDERS)
// =========================================================================
function renderExternalOrdersPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>🛍️ الطلبات الخارجية الواردة من متجر العملاء (مزامنة لحظية)</h3>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>رقم الطلب</th><th>العميل</th><th>الهاتف</th><th>الاستلام</th><th>الإجمالي</th><th>الحالة</th><th>إجراءات</th></tr></thead>
                    <tbody>
                        ${DB.external_orders.map(o => `<tr>
                            <td><strong>${o.orderNo}</strong><br><small style="color:var(--text-muted);">${(o.createdAt || '').replace('T', ' ')}</small></td>
                            <td>${o.customerName}</td>
                            <td>${o.phone}</td>
                            <td>${o.deliveryMethod || 'استلام من المكتبة'}</td>
                            <td><strong>${formatMoney(o.total)}</strong></td>
                            <td><span class="badge ${o.status === 'جديد' ? 'badge-new' : (o.status === 'مكتمل' ? 'badge-done' : 'badge-prep')}">${o.status}</span></td>
                            <td><button class="btn btn-primary btn-sm" onclick="openCloudOrderModal('${o.id}')">إدارة الطلب</button></td>
                        </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;">لا توجد طلبات خارجية حالياً</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function openCloudOrderModal(orderId) {
    const o = DB.external_orders.find(x => x.id === orderId);
    if (!o) return;
    openModal(`
        <h3>إدارة الطلب الخارجي: ${o.orderNo}</h3>
        <div style="background:#f8fafc; padding:10px; border-radius:8px; margin:10px 0; font-size:13px;">
            <div><strong>العميل:</strong> ${o.customerName} | <strong>الهاتف:</strong> ${o.phone}</div>
            <div><strong>طريقة الاستلام:</strong> ${o.deliveryMethod || 'استلام من المكتبة'}</div>
            <div><strong>العنوان / ملاحظات:</strong> ${o.notes || '-'}</div>
        </div>
        <table>
            <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>${(o.items || []).map(i => `<tr><td>${i.name}</td><td>${i.qty}</td><td>${formatMoney(i.sellPrice)}</td><td>${formatMoney(i.qty * i.sellPrice)}</td></tr>`).join('')}</tbody>
        </table>
        <div style="margin:12px 0; font-weight:800; font-size:16px; color:var(--primary);">إجمالي الطلب: ${formatMoney(o.total)}</div>
        <div class="form-group">
            <label>حالة الطلب</label>
            <select id="cloudOrderStatusSel" ${o.convertedInvoiceNo ? 'disabled' : ''}>
                ${['جديد', 'قيد المراجعة', 'مقبول', 'قيد التجهيز', 'جاهز للاستلام', 'خرج للتوصيل', 'مرفوض', 'ملغى'].map(st => `<option value="${st}" ${o.status === st ? 'selected' : ''}>${st}</option>`).join('')}
            </select>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:14px;">
            ${!o.convertedInvoiceNo ? `
                <button class="btn btn-primary" onclick="updateCloudOrderStatus('${o.id}')">حفظ الحالة</button>
                <button class="btn btn-success" onclick="convertCloudOrderToInvoice('${o.id}')">✅ اعتماد البيع وتحويل لفاتورة رسمية</button>
            ` : `<span class="badge badge-done">تم التحويل للفاتورة الرسمية رقم: ${o.convertedInvoiceNo}</span>`}
            <button class="btn btn-outline" onclick="closeModal()">إغلاق</button>
        </div>
    `);
}

async function updateCloudOrderStatus(orderId) {
    const { db, doc, updateDoc } = window.FB;
    const status = document.getElementById('cloudOrderStatusSel').value;
    await updateDoc(doc(db, 'external_orders', orderId), { status });
    await logAuditCloud('تحديث طلب خارجي', `تغيير حالة الطلب إلى ${status}`);
    closeModal();
    showToast('تم تحديث حالة الطلب بنجاح');
}

async function convertCloudOrderToInvoice(orderId) {
    const o = DB.external_orders.find(x => x.id === orderId);
    if (!o || o.convertedInvoiceNo) return;
    const { db, doc, runTransaction, addDoc, collection } = window.FB;

    try {
        const invoiceNo = 'INV-' + (1000 + DB.sales.length + 1);
        const verifiedItems = [];

        await runTransaction(db, async (transaction) => {
            const updates = [];
            for (const it of o.items) {
                const pRef = doc(db, 'products', it.productId);
                const pSnap = await transaction.get(pRef);
                if (!pSnap.exists()) throw new Error(`المنتج ${it.name} غير موجود`);
                const pData = pSnap.data();
                if (!DB.settings.allowNegativeStock && pData.stock < it.qty) {
                    throw new Error(`المخزون غير كافٍ للصنف ${pData.name} (المتوفر: ${pData.stock})`);
                }
                verifiedItems.push({
                    productId: it.productId,
                    name: pData.name,
                    qty: it.qty,
                    costPrice: pData.costPrice,
                    sellPrice: it.sellPrice
                });
                updates.push({ ref: pRef, newStock: pData.stock - it.qty });
            }
            for (const u of updates) transaction.update(u.ref, { stock: u.newStock });
            transaction.update(doc(db, 'external_orders', orderId), { status: 'مكتمل', convertedInvoiceNo: invoiceNo });
        });

        await addDoc(collection(db, 'sales'), {
            invoiceNo,
            items: verifiedItems,
            subtotal: o.total,
            discount: 0,
            total: o.total,
            paid: o.total,
            remaining: 0,
            paymentMethod: 'نقدي (طلب أونلاين)',
            user: currentUser.name,
            createdAt: nowCairo()
        });

        for (const it of verifiedItems) {
            await addDoc(collection(db, 'inventoryMovements'), {
                productId: it.productId,
                productName: it.name,
                type: 'صرف طلب خارجي',
                qty: -it.qty,
                reason: `طلب ${o.orderNo} / فاتورة ${invoiceNo}`,
                user: currentUser.name,
                createdAt: nowCairo()
            });
        }

        await addDoc(collection(db, 'cashTransactions'), {
            type: 'طلب خارجي',
            amount: o.total,
            direction: 'in',
            refNo: invoiceNo,
            notes: `تحصيل طلب أونلاين ${o.orderNo}`,
            user: currentUser.name,
            createdAt: nowCairo()
        });

        await logAuditCloud('اعتماد طلب خارجي', `تحويل ${o.orderNo} إلى فاتورة ${invoiceNo}`);
        await fetchAllCloudData();
        closeModal();
        navigateAdmin('external_orders');
        showToast(`✅ تم اعتماد الطلب وتحويله للفاتورة ${invoiceNo}`);
    } catch (err) {
        showToast(err.message, true);
    }
}

// =========================================================================
// 5. PRODUCTS & CATEGORIES
// =========================================================================
function renderProducts(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>📦 إدارة المنتجات والأصناف</h3>
                <div style="display:flex; gap:8px;">
                    <button class="btn btn-outline btn-sm" onclick="openCloudCategoriesModal()">📁 إدارة الأقسام (${DB.categories.length})</button>
                    <button class="btn btn-primary btn-sm" onclick="openCloudProductModal()">+ إضافة منتج جديد</button>
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>الكود SKU</th><th>الباركود</th><th>الاسم</th><th>القسم</th><th>التكلفة</th><th>سعر البيع</th><th>الرصيد</th><th>المتجر</th><th>إجراء</th></tr></thead>
                    <tbody>
                        ${DB.products.map(p => `<tr>
                            <td>${p.sku}</td>
                            <td>${p.barcode || '-'}</td>
                            <td><strong>${p.name}</strong></td>
                            <td>${p.categoryName || '-'}</td>
                            <td>${formatMoney(p.costPrice)}</td>
                            <td><strong>${formatMoney(p.sellPrice)}</strong></td>
                            <td style="font-weight:700; color:${p.stock <= (p.minStock || 5) ? 'var(--danger)' : 'var(--success)'};">${p.stock}</td>
                            <td>${p.showInStore !== false ? '✅ معروض' : '❌ مخفي'}</td>
                            <td><button class="btn btn-outline btn-sm" onclick="openCloudProductModal('${p.id}')">تعديل</button></td>
                        </tr>`).join('') || '<tr><td colspan="9" style="text-align:center;">لا توجد منتجات</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function openCloudCategoriesModal() {
    openModal(`
        <h3>📁 إدارة أقسام المكتبة</h3>
        <div style="display:flex; gap:8px; margin:12px 0;">
            <input type="text" id="newCloudCatName" placeholder="اسم القسم الجديد...">
            <button class="btn btn-primary" onclick="addCloudCategory()">إضافة</button>
        </div>
        <table>
            <thead><tr><th>اسم القسم</th><th>إجراء</th></tr></thead>
            <tbody>
                ${DB.categories.map(cat => `<tr><td>${cat.name}</td><td><button class="btn btn-danger btn-sm" onclick="deleteCloudCategory('${cat.id}')">حذف</button></td></tr>`).join('')}
            </tbody>
        </table>
        <button class="btn btn-outline" style="margin-top:12px;" onclick="closeModal()">إغلاق</button>
    `);
}

async function addCloudCategory() {
    const name = document.getElementById('newCloudCatName').value.trim();
    if (!name) return;
    const { db, collection, addDoc } = window.FB;
    const ref = await addDoc(collection(db, 'categories'), { name, createdAt: nowCairo() });
    DB.categories.push({ id: ref.id, name });
    openCloudCategoriesModal();
    showToast('تمت إضافة القسم');
}

async function deleteCloudCategory(catId) {
    const { db, doc, deleteDoc } = window.FB;
    await deleteDoc(doc(db, 'categories', catId));
    DB.categories = DB.categories.filter(c => c.id !== catId);
    openCloudCategoriesModal();
    showToast('تم حذف القسم');
}

function openCloudProductModal(prodId = null) {
    const p = prodId ? DB.products.find(x => x.id === prodId) : null;
    openModal(`
        <h3>${p ? 'تعديل بيانات المنتج' : 'إضافة منتج جديد'}</h3>
        <div class="form-row">
            <div class="form-group"><label>اسم المنتج *</label><input type="text" id="cpName" value="${p ? p.name : ''}"></div>
            <div class="form-group"><label>القسم</label>
                <select id="cpCat">${DB.categories.map(cat => `<option value="${cat.name}" ${p && p.categoryName === cat.name ? 'selected' : ''}>${cat.name}</option>`).join('')}</select>
            </div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>كود المنتج SKU *</label><input type="text" id="cpSku" value="${p ? p.sku : 'SKU-' + (DB.products.length + 101)}"></div>
            <div class="form-group"><label>الباركود</label><input type="text" id="cpBarcode" value="${p ? (p.barcode || '') : ''}"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>سعر التكلفة (الشراء) *</label><input type="number" id="cpCost" value="${p ? p.costPrice : 0}"></div>
            <div class="form-group"><label>سعر البيع *</label><input type="number" id="cpSell" value="${p ? p.sellPrice : 0}"></div>
        </div>
        <div class="form-row">
            <div class="form-group"><label>الرصيد الافتتاحي</label><input type="number" id="cpStock" value="${p ? p.stock : 0}" ${p ? 'disabled' : ''}></div>
            <div class="form-group"><label>حد التنبيه الأدنى</label><input type="number" id="cpMin" value="${p ? (p.minStock || 5) : 5}"></div>
        </div>
        <div class="form-group"><label>وصف المنتج (يظهر للعملاء في المتجر)</label><input type="text" id="cpDesc" value="${p ? (p.desc || '') : ''}"></div>
        <div class="form-group">
            <label><input type="checkbox" id="cpShowStore" style="width:auto;" ${!p || p.showInStore !== false ? 'checked' : ''}> عرض المنتج في تطبيق العملاء (المتجر الإلكتروني)</label>
        </div>
        <div style="display:flex; gap:8px; margin-top:12px;">
            <button class="btn btn-primary" onclick="saveCloudProduct(${p ? `'${p.id}'` : 'null'})">حفظ المنتج</button>
            <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
        </div>
    `);
}

async function saveCloudProduct(prodId) {
    const name = document.getElementById('cpName').value.trim();
    const categoryName = document.getElementById('cpCat').value;
    const sku = document.getElementById('cpSku').value.trim();
    const barcode = document.getElementById('cpBarcode').value.trim();
    const costPrice = parseFloat(document.getElementById('cpCost').value) || 0;
    const sellPrice = parseFloat(document.getElementById('cpSell').value) || 0;
    const stock = parseInt(document.getElementById('cpStock').value) || 0;
    const minStock = parseInt(document.getElementById('cpMin').value) || 5;
    const desc = document.getElementById('cpDesc').value.trim();
    const showInStore = document.getElementById('cpShowStore').checked;

    if (!name || !sku || sellPrice <= 0) return showToast('يرجى إدخال الاسم والكود وسعر البيع الصحيح', true);
    const { db, collection, addDoc, doc, updateDoc } = window.FB;

    if (prodId) {
        await updateDoc(doc(db, 'products', prodId), { name, categoryName, sku, barcode, costPrice, sellPrice, minStock, desc, showInStore });
        await logAuditCloud('تعديل منتج', `تعديل ${name}`);
    } else {
        const ref = await addDoc(collection(db, 'products'), {
            name, categoryName, sku, barcode, costPrice, sellPrice, stock, reserved: 0, minStock, desc, active: true, showInStore, createdAt: nowCairo()
        });
        if (stock > 0) {
            await addDoc(collection(db, 'inventoryMovements'), {
                productId: ref.id, productName: name, type: 'رصيد افتتاحي', qty: stock, reason: 'إضافة منتج جديد', user: currentUser.name, createdAt: nowCairo()
            });
        }
        await logAuditCloud('إضافة منتج', `إضافة ${name} برصيد ${stock}`);
    }
    closeModal();
    showToast('تم حفظ المنتج بنجاح');
}

// =========================================================================
// 6. INVENTORY & STOCK ADJUSTMENT
// =========================================================================
function renderInventoryPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>📋 الجرد وتسوية المخزون</h3>
                <button class="btn btn-warning btn-sm" onclick="openStockAdjustModal()">⚖️ تسوية جرد يدوية</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>التاريخ</th><th>المنتج</th><th>نوع الحركة</th><th>الكمية</th><th>السبب</th><th>الموظف</th></tr></thead>
                    <tbody>
                        ${DB.inventoryMovements.map(m => `<tr>
                            <td>${(m.createdAt || '').replace('T', ' ')}</td>
                            <td><strong>${m.productName || '-'}</strong></td>
                            <td>${m.type}</td>
                            <td style="font-weight:700; color:${m.qty >= 0 ? 'var(--success)' : 'var(--danger)'};">${m.qty > 0 ? '+' + m.qty : m.qty}</td>
                            <td>${m.reason}</td>
                            <td>${m.user}</td>
                        </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;">لا توجد حركات مخزون</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function openStockAdjustModal() {
    if (DB.products.length === 0) return showToast('لا توجد منتجات', true);
    openModal(`
        <h3>⚖️ تسوية رصيد المخزون (جرد فعلي)</h3>
        <div class="form-group"><label>اختر المنتج</label>
            <select id="adjProdId">${DB.products.map(p => `<option value="${p.id}">${p.name} (الرصيد الدفتري: ${p.stock})</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>الرصيد الفعلي الجديد بعد الجرد</label><input type="number" id="adjActualStock" min="0" value="0"></div>
        <div class="form-group"><label>سبب التسوية</label><input type="text" id="adjReason" placeholder="مثال: جرد دوري / تالف"></div>
        <button class="btn btn-primary" onclick="submitStockAdjustment()">اعتماد التسوية</button>
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
    `);
}

async function submitStockAdjustment() {
    const prodId = document.getElementById('adjProdId').value;
    const actual = parseInt(document.getElementById('adjActualStock').value);
    const reason = document.getElementById('adjReason').value.trim() || 'تسوية جرد';
    if (isNaN(actual) || actual < 0) return showToast('أدخل رقماً صحيحاً', true);

    const prod = DB.products.find(p => p.id === prodId);
    const diff = actual - prod.stock;
    if (diff === 0) return showToast('الرصيد الفعلي مطابق للدفتري', true);

    const { db, doc, updateDoc, addDoc, collection } = window.FB;
    await updateDoc(doc(db, 'products', prodId), { stock: actual });
    await addDoc(collection(db, 'inventoryMovements'), {
        productId: prodId, productName: prod.name, type: 'تسوية جرد', qty: diff, reason, user: currentUser.name, createdAt: nowCairo()
    });
    await logAuditCloud('تسوية مخزون', `تعديل رصيد ${prod.name} بمقدار ${diff}`);
    await fetchAllCloudData();
    closeModal();
    navigateAdmin('inventory');
    showToast('تمت تسوية المخزون بنجاح');
}

// =========================================================================
// 7. PURCHASES
// =========================================================================
function renderPurchasesPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>🚚 فواتير المشتريات وتوريد البضاعة</h3>
                <button class="btn btn-primary btn-sm" onclick="openCloudPurchaseModal()">+ فاتورة مشتريات جديدة</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>رقم الفاتورة</th><th>المورد</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي للمورد</th><th>التاريخ</th></tr></thead>
                    <tbody>
                        ${DB.purchases.map(p => {
                            const sup = DB.suppliers.find(s => s.id === p.supplierId);
                            return `<tr>
                                <td><strong>${p.purchaseNo}</strong></td>
                                <td>${sup ? sup.name : '-'}</td>
                                <td>${formatMoney(p.total)}</td>
                                <td>${formatMoney(p.paid)}</td>
                                <td style="color:${p.remaining > 0 ? 'var(--danger)' : 'inherit'}">${formatMoney(p.remaining)}</td>
                                <td>${(p.createdAt || '').replace('T', ' ')}</td>
                            </tr>`;
                        }).join('') || '<tr><td colspan="6" style="text-align:center;">لا توجد فواتير مشتريات</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function openCloudPurchaseModal() {
    if (DB.products.length === 0) return showToast('أضف منتجات أولاً', true);
    openModal(`
        <h3>🚚 استلام فاتورة مشتريات جديدة</h3>
        <div class="form-group"><label>المورد</label>
            <select id="purSup">${DB.suppliers.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>المنتج</label>
            <select id="purProd">${DB.products.map(p => `<option value="${p.id}">${p.name} (التكلفة الحالية: ${p.costPrice})</option>`).join('')}</select>
        </div>
        <div class="form-row">
            <div class="form-group"><label>الكمية المشتراة</label><input type="number" id="purQty" min="1" value="10"></div>
            <div class="form-group"><label>سعر شراء الوحدة</label><input type="number" id="purCost" min="0" value="50"></div>
        </div>
        <div class="form-group"><label>المبلغ المدفوع للمورد الآن (ج.م)</label><input type="number" id="purPaid" min="0" value="500"></div>
        <button class="btn btn-success" onclick="saveCloudPurchase()">اعتماد الاستلام وإضافة للمخزون</button>
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
    `);
}

async function saveCloudPurchase() {
    const supplierId = document.getElementById('purSup').value;
    const prodId = document.getElementById('purProd').value;
    const qty = parseInt(document.getElementById('purQty').value) || 0;
    const cost = parseFloat(document.getElementById('purCost').value) || 0;
    const paid = parseFloat(document.getElementById('purPaid').value) || 0;

    if (qty <= 0 || cost <= 0) return showToast('أدخل كمية وسعر صحيحين', true);

    const { db, doc, updateDoc, addDoc, collection } = window.FB;
    const prod = DB.products.find(x => x.id === prodId);
    const total = qty * cost;
    const remaining = Math.max(0, total - paid);
    const purchaseNo = 'PUR-' + (100 + DB.purchases.length + 1);

    await updateDoc(doc(db, 'products', prodId), { stock: prod.stock + qty, costPrice: cost });

    if (remaining > 0 && supplierId) {
        const sup = DB.suppliers.find(s => s.id === supplierId);
        if (sup) await updateDoc(doc(db, 'suppliers', supplierId), { balance: (sup.balance || 0) + remaining });
    }

    await addDoc(collection(db, 'purchases'), {
        purchaseNo, supplierId, productId: prodId, qty, cost, total, paid, remaining, user: currentUser.name, createdAt: nowCairo()
    });

    await addDoc(collection(db, 'inventoryMovements'), {
        productId: prodId, productName: prod.name, type: 'وارد مشتريات', qty, reason: `فاتورة شراء ${purchaseNo}`, user: currentUser.name, createdAt: nowCairo()
    });

    if (paid > 0) {
        await addDoc(collection(db, 'cashTransactions'), {
            type: 'سداد مشتريات', amount: paid, direction: 'out', refNo: purchaseNo, notes: `دفعة فاتورة مشتريات ${purchaseNo}`, user: currentUser.name, createdAt: nowCairo()
        });
    }

    await logAuditCloud('فاتورة مشتريات', `استلام ${purchaseNo} بقيمة ${total}`);
    await fetchAllCloudData();
    closeModal();
    navigateAdmin('purchases');
    showToast(`✅ تم اعتماد فاتورة المشتريات ${purchaseNo}`);
}

// =========================================================================
// 8. SUPPLIERS & 9. CUSTOMERS
// =========================================================================
function renderSuppliersPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>🏢 إدارة الموردين</h3>
                <button class="btn btn-primary btn-sm" onclick="openAddEntityModal('supplier')">+ إضافة مورد جديد</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>اسم المورد</th><th>الهاتف</th><th>العنوان</th><th>المستحقات له (الرصيد)</th></tr></thead>
                    <tbody>
                        ${DB.suppliers.map(s => `<tr>
                            <td><strong>${s.name}</strong></td>
                            <td>${s.phone}</td>
                            <td>${s.address || '-'}</td>
                            <td style="font-weight:700; color:${s.balance > 0 ? 'var(--danger)' : 'var(--success)'};">${formatMoney(s.balance)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderCustomersPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>👥 إدارة العملاء</h3>
                <button class="btn btn-primary btn-sm" onclick="openAddEntityModal('customer')">+ إضافة عميل جديد</button>
            </div>
            <div class="table-wrap">
                <table>
                    <thead><tr><th>اسم العميل</th><th>الهاتف</th><th>العنوان</th><th>المديونية عليه</th></tr></thead>
                    <tbody>
                        ${DB.customers.map(cu => `<tr>
                            <td><strong>${cu.name}</strong></td>
                            <td>${cu.phone}</td>
                            <td>${cu.address || '-'}</td>
                            <td style="font-weight:700; color:${cu.balance > 0 ? 'var(--danger)' : 'var(--success)'};">${formatMoney(cu.balance)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function openAddEntityModal(type) {
    const title = type === 'customer' ? 'إضافة عميل جديد' : 'إضافة مورد جديد';
    openModal(`
        <h3>${title}</h3>
        <div class="form-group"><label>الاسم *</label><input type="text" id="entName"></div>
        <div class="form-group"><label>الهاتف</label><input type="text" id="entPhone"></div>
        <div class="form-group"><label>العنوان</label><input type="text" id="entAddr"></div>
        <button class="btn btn-primary" onclick="saveNewEntity('${type}')">حفظ</button>
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
    `);
}

async function saveNewEntity(type) {
    const name = document.getElementById('entName').value.trim();
    const phone = document.getElementById('entPhone').value.trim();
    const address = document.getElementById('entAddr').value.trim();
    if (!name) return showToast('أدخل الاسم', true);

    const { db, collection, addDoc } = window.FB;
    const colName = type === 'customer' ? 'customers' : 'suppliers';
    await addDoc(collection(db, colName), { name, phone, address, balance: 0, createdAt: nowCairo() });
    await fetchAllCloudData();
    closeModal();
    navigateAdmin(colName);
    showToast('تم الحفظ بنجاح');
}

// =========================================================================
// 10. DEBTS & 11. PAYMENTS / COLLECTIONS
// =========================================================================
function renderDebtsPage(c) {
    const indebtedCustomers = DB.customers.filter(x => x.balance > 0);
    const owedSuppliers = DB.suppliers.filter(x => x.balance > 0);

    c.innerHTML = `
        <div class="panel">
            <div class="panel-header"><h3>📒 مديونيات العملاء المستحقة للمكتبة</h3></div>
            <table>
                <thead><tr><th>العميل</th><th>الهاتف</th><th>المبلغ المستحق</th><th>إجراء</th></tr></thead>
                <tbody>
                    ${indebtedCustomers.map(cu => `<tr>
                        <td><strong>${cu.name}</strong></td>
                        <td>${cu.phone}</td>
                        <td style="color:var(--danger); font-weight:800;">${formatMoney(cu.balance)}</td>
                        <td><button class="btn btn-success btn-sm" onclick="navigateAdmin('payments')">تحصيل دفعة</button></td>
                    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;">لا توجد مديونيات على العملاء</td></tr>'}
                </tbody>
            </table>
        </div>

        <div class="panel">
            <div class="panel-header"><h3>📕 مستحقات الموردين على المكتبة</h3></div>
            <table>
                <thead><tr><th>المورد</th><th>الهاتف</th><th>المبلغ المستحق له</th><th>إجراء</th></tr></thead>
                <tbody>
                    ${owedSuppliers.map(s => `<tr>
                        <td><strong>${s.name}</strong></td>
                        <td>${s.phone}</td>
                        <td style="color:var(--danger); font-weight:800;">${formatMoney(s.balance)}</td>
                        <td><button class="btn btn-primary btn-sm" onclick="navigateAdmin('payments')">سداد دفعة</button></td>
                    </tr>`).join('') || '<tr><td colspan="4" style="text-align:center;">لا توجد مستحقات للموردين</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function renderPaymentsPage(c) {
    c.innerHTML = `
        <div class="form-row">
            <div class="panel">
                <h3>💰 تحصيل دفعة من عميل</h3>
                <div class="form-group"><label>اختر العميل</label>
                    <select id="payCustSel">${DB.customers.filter(x => !x.isDefaultCash).map(cu => `<option value="${cu.id}">${cu.name} (المديونية: ${formatMoney(cu.balance)})</option>`).join('')}</select>
                </div>
                <div class="form-group"><label>المبلغ المحصّل (ج.م)</label><input type="number" id="payCustAmt" min="1"></div>
                <div class="form-group"><label>ملاحظات</label><input type="text" id="payCustNote" placeholder="سداد نقدي / تحويل"></div>
                <button class="btn btn-success w-100" onclick="processCustomerCollection()">تسجيل التحصيل وإضافة للخزينة</button>
            </div>

            <div class="panel">
                <h3>💸 سداد دفعة لمورد</h3>
                <div class="form-group"><label>اختر المورد</label>
                    <select id="paySupSel">${DB.suppliers.map(s => `<option value="${s.id}">${s.name} (المستحق: ${formatMoney(s.balance)})</option>`).join('')}</select>
                </div>
                <div class="form-group"><label>المبلغ المسدد (ج.م)</label><input type="number" id="paySupAmt" min="1"></div>
                <div class="form-group"><label>ملاحظات</label><input type="text" id="paySupNote" placeholder="سداد من الخزينة"></div>
                <button class="btn btn-primary w-100" onclick="processSupplierPayment()">تسجيل السداد وخصم من الخزينة</button>
            </div>
        </div>
    `;
}

async function processCustomerCollection() {
    const custId = document.getElementById('payCustSel')?.value;
    const amount = parseFloat(document.getElementById('payCustAmt')?.value) || 0;
    const note = document.getElementById('payCustNote')?.value.trim() || 'تحصيل من عميل';
    if (!custId || amount <= 0) return showToast('أدخل مبلغاً صحيحاً', true);

    const { db, doc, updateDoc, addDoc, collection } = window.FB;
    const cust = DB.customers.find(c => c.id === custId);
    await updateDoc(doc(db, 'customers', custId), { balance: (cust.balance || 0) - amount });
    await addDoc(collection(db, 'cashTransactions'), {
        type: 'تحصيل عميل', amount, direction: 'in', refNo: 'COL-' + Date.now().toString().slice(-4),
        notes: `${note} (${cust.name})`, user: currentUser.name, createdAt: nowCairo()
    });

    await logAuditCloud('تحصيل عميل', `تحصيل ${amount} من ${cust.name}`);
    await fetchAllCloudData();
    navigateAdmin('payments');
    showToast('✅ تم تسجيل التحصيل وتحديث رصيد العميل والخزينة');
}

async function processSupplierPayment() {
    const supId = document.getElementById('paySupSel')?.value;
    const amount = parseFloat(document.getElementById('paySupAmt')?.value) || 0;
    const note = document.getElementById('paySupNote')?.value.trim() || 'سداد لمورد';
    if (!supId || amount <= 0) return showToast('أدخل مبلغاً صحيحاً', true);

    const { db, doc, updateDoc, addDoc, collection } = window.FB;
    const sup = DB.suppliers.find(s => s.id === supId);
    await updateDoc(doc(db, 'suppliers', supId), { balance: (sup.balance || 0) - amount });
    await addDoc(collection(db, 'cashTransactions'), {
        type: 'سداد مورد', amount, direction: 'out', refNo: 'PAY-' + Date.now().toString().slice(-4),
        notes: `${note} (${sup.name})`, user: currentUser.name, createdAt: nowCairo()
    });

    await logAuditCloud('سداد مورد', `سداد ${amount} للمورد ${sup.name}`);
    await fetchAllCloudData();
    navigateAdmin('payments');
    showToast('✅ تم تسجيل السداد وتحديث حساب المورد والخزينة');
}

// =========================================================================
// 12. EXPENSES & 13. TREASURY
// =========================================================================
function renderExpensesPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>💸 سجل المصروفات التشغيلية</h3>
                <button class="btn btn-danger btn-sm" onclick="openCloudExpModal()">+ تسجيل مصروف جديد</button>
            </div>
            <table>
                <thead><tr><th>التاريخ</th><th>البند</th><th>المبلغ</th><th>البيان</th><th>الموظف</th></tr></thead>
                <tbody>
                    ${DB.expenses.map(e => `<tr>
                        <td>${(e.createdAt || '').replace('T', ' ')}</td>
                        <td><strong>${e.category}</strong></td>
                        <td style="color:var(--danger); font-weight:700;">${formatMoney(e.amount)}</td>
                        <td>${e.notes || '-'}</td>
                        <td>${e.user}</td>
                    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;">لا توجد مصروفات مسجلة</td></tr>'}
                </tbody>
            </table>
        </div>
    `;
}

function openCloudExpModal() {
    openModal(`
        <h3>💸 تسجيل مصروف جديد</h3>
        <div class="form-group"><label>تصنيف المصروف</label>
            <select id="expCat">${DB.settings.expenseCategories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>المبلغ (ج.م)</label><input type="number" id="expAmt" min="1"></div>
        <div class="form-group"><label>البيان / التفاصيل</label><input type="text" id="expNotes"></div>
        <button class="btn btn-danger" onclick="saveCloudExp()">حفظ المصروف وخصمه من الخزينة</button>
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
    `);
}

async function saveCloudExp() {
    const category = document.getElementById('expCat').value;
    const amount = parseFloat(document.getElementById('expAmt').value) || 0;
    const notes = document.getElementById('expNotes').value.trim();
    if (amount <= 0) return showToast('أدخل مبلغاً صحيحاً', true);

    const { db, collection, addDoc } = window.FB;
    await addDoc(collection(db, 'expenses'), { category, amount, notes, user: currentUser.name, createdAt: nowCairo() });
    await addDoc(collection(db, 'cashTransactions'), {
        type: 'مصروفات', amount, direction: 'out', refNo: 'EXP', notes: `${category}: ${notes}`, user: currentUser.name, createdAt: nowCairo()
    });
    await logAuditCloud('تسجيل مصروف', `${category} بقيمة ${amount}`);
    await fetchAllCloudData();
    closeModal();
    navigateAdmin('expenses');
    showToast('تم تسجيل المصروف');
}

function renderTreasuryPage(c) {
    const totalIn = DB.cashTransactions.filter(t => t.direction === 'in').reduce((s, t) => s + t.amount, 0);
    const totalOut = DB.cashTransactions.filter(t => t.direction === 'out').reduce((s, t) => s + t.amount, 0);
    const balance = totalIn - totalOut;

    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>🏦 الخزينة وحركة النقدية</h3>
                <div style="font-size:18px; font-weight:800; color:var(--primary);">الرصيد الحالي: ${formatMoney(balance)}</div>
            </div>
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-title">إجمالي المقبوضات (الوارد)</div><div class="kpi-value" style="color:var(--success);">${formatMoney(totalIn)}</div></div>
                <div class="kpi-card"><div class="kpi-title">إجمالي المدفوعات (الصادر)</div><div class="kpi-value" style="color:var(--danger);">${formatMoney(totalOut)}</div></div>
                <div class="kpi-card"><div class="kpi-title">صافي رصيد الخزينة</div><div class="kpi-value" style="color:var(--primary);">${formatMoney(balance)}</div></div>
            </div>
            <table>
                <thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>البيان</th><th>الوارد (+)</th><th>الصادر (-)</th></tr></thead>
                <tbody>
                    ${DB.cashTransactions.map(t => `<tr>
                        <td>${(t.createdAt || '').replace('T', ' ')}</td>
                        <td>${t.type}</td>
                        <td>${t.refNo || '-'}</td>
                        <td>${t.notes}</td>
                        <td style="color:var(--success); font-weight:700;">${t.direction === 'in' ? formatMoney(t.amount) : '-'}</td>
                        <td style="color:var(--danger); font-weight:700;">${t.direction === 'out' ? formatMoney(t.amount) : '-'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// =========================================================================
// 14. FINANCIAL & ANALYTICAL REPORTS
// =========================================================================
function renderReportsPage(c) {
    const totalStockCost = DB.products.reduce((s, p) => s + (p.stock * p.costPrice), 0);
    const totalStockSell = DB.products.reduce((s, p) => s + (p.stock * p.sellPrice), 0);

    c.innerHTML = `
        <div class="panel">
            <div class="panel-header"><h3>📈 تقرير تقييم المخزون والأرباح المتوقعة</h3></div>
            <div class="kpi-grid">
                <div class="kpi-card"><div class="kpi-title">إجمالي قيمة المخزون بسعر التكلفة</div><div class="kpi-value">${formatMoney(totalStockCost)}</div></div>
                <div class="kpi-card"><div class="kpi-title">إجمالي قيمة المخزون بسعر البيع</div><div class="kpi-value" style="color:var(--primary);">${formatMoney(totalStockSell)}</div></div>
                <div class="kpi-card"><div class="kpi-title">الربح المتوقع من المخزون الحالي</div><div class="kpi-value" style="color:var(--success);">${formatMoney(totalStockSell - totalStockCost)}</div></div>
            </div>
            <table>
                <thead><tr><th>المنتج</th><th>الرصيد</th><th>التكلفة</th><th>البيع</th><th>إجمالي التكلفة</th><th>إجمالي البيع</th><th>الربح المتوقع</th></tr></thead>
                <tbody>
                    ${DB.products.map(p => {
                        const cVal = p.stock * p.costPrice;
                        const sVal = p.stock * p.sellPrice;
                        return `<tr>
                            <td><strong>${p.name}</strong></td>
                            <td>${p.stock}</td>
                            <td>${formatMoney(p.costPrice)}</td>
                            <td>${formatMoney(p.sellPrice)}</td>
                            <td>${formatMoney(cVal)}</td>
                            <td>${formatMoney(sVal)}</td>
                            <td style="color:var(--success); font-weight:700;">${formatMoney(sVal - cVal)}</td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// =========================================================================
// 15. USERS, 16. NOTIFICATIONS, 17. AUDIT, 18. SETTINGS, 19. BACKUP
// =========================================================================
function renderUsersPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header">
                <h3>🔐 إدارة المستخدمين والصلاحيات</h3>
                <button class="btn btn-primary btn-sm" onclick="openAddUserModal()">+ إضافة مستخدم</button>
            </div>
            <table>
                <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>الحالة</th><th>إجراء</th></tr></thead>
                <tbody>
                    ${DB.users.map(u => `<tr>
                        <td><strong>${u.name}</strong></td>
                        <td>${u.username}</td>
                        <td>${ROLE_LABELS[u.role]}</td>
                        <td><span class="badge ${u.active ? 'badge-ready' : 'badge-cancel'}">${u.active ? 'نشط' : 'معطّل'}</span></td>
                        <td>${u.id !== currentUser.id ? `<button class="btn btn-outline btn-sm" onclick="toggleCloudUserActive('${u.id}', ${u.active})">${u.active ? 'تعطيل' : 'تفعيل'}</button>` : '-'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function openAddUserModal() {
    openModal(`
        <h3>إضافة مستخدم جديد</h3>
        <div class="form-group"><label>الاسم الكامل</label><input type="text" id="nuName"></div>
        <div class="form-group"><label>اسم المستخدم</label><input type="text" id="nuUser"></div>
        <div class="form-group"><label>كلمة المرور</label><input type="password" id="nuPass"></div>
        <div class="form-group"><label>الدور الوظيفي</label>
            <select id="nuRole">
                <option value="cashier">كاشير</option>
                <option value="storekeeper">أمين مخزن</option>
                <option value="admin">مدير عام</option>
            </select>
        </div>
        <button class="btn btn-primary" onclick="saveCloudUser()">حفظ المستخدم</button>
        <button class="btn btn-outline" onclick="closeModal()">إلغاء</button>
    `);
}

async function saveCloudUser() {
    const name = document.getElementById('nuName').value.trim();
    const username = document.getElementById('nuUser').value.trim();
    const password = document.getElementById('nuPass').value.trim();
    const role = document.getElementById('nuRole').value;
    if (!name || !username || !password) return showToast('أكمل جميع الحقول', true);

    const { db, collection, addDoc } = window.FB;
    await addDoc(collection(db, 'users'), { name, username, passwordHash: btoa(password), role, active: true, createdAt: nowCairo() });
    await fetchAllCloudData();
    closeModal();
    navigateAdmin('users');
    showToast('تمت إضافة المستخدم بنجاح');
}

async function toggleCloudUserActive(uid, currentState) {
    const { db, doc, updateDoc } = window.FB;
    await updateDoc(doc(db, 'users', uid), { active: !currentState });
    await fetchAllCloudData();
    navigateAdmin('users');
}

function renderNotificationsPage(c) {
    const lowStock = DB.products.filter(p => (p.stock - (p.reserved || 0)) <= (p.minStock || 5));
    const newOrders = DB.external_orders.filter(o => o.status === 'جديد');

    c.innerHTML = `
        <div class="panel">
            <h3>🔔 مركز التنبيهات والإشعارات</h3>
            <div style="margin-top:14px;">
                <h4 style="color:var(--primary); margin-bottom:8px;">طلبات أونلاين جديدة بانتظار المراجعة (${newOrders.length})</h4>
                ${newOrders.map(o => `<div class="alert-info">طلب جديد رقم <strong>${o.orderNo}</strong> من العميل ${o.customerName} بقيمة ${formatMoney(o.total)} <button class="btn btn-primary btn-sm" onclick="navigateAdmin('external_orders')">عرض</button></div>`).join('') || '<p>لا توجد طلبات جديدة</p>'}
            </div>
            <div style="margin-top:18px;">
                <h4 style="color:var(--danger); margin-bottom:8px;">أصناف وصلت للحد الأدنى للمخزون (${lowStock.length})</h4>
                ${lowStock.map(p => `<div style="background:#fee2e2; color:#b91c1c; padding:10px; border-radius:8px; margin-bottom:6px;">⚠️ الصنف <strong>${p.name}</strong> رصيده الحالي (${p.stock}) أقل من أو يساوي الحد الأدنى (${p.minStock || 5})</div>`).join('') || '<p>جميع الأصناف في مستوى آمن</p>'}
            </div>
        </div>
    `;
}

function renderAuditLogsPage(c) {
    c.innerHTML = `
        <div class="panel">
            <div class="panel-header"><h3>🛡️ سجل التدقيق والعمليات (Audit Log)</h3></div>
            <table>
                <thead><tr><th>التوقيت</th><th>المستخدم</th><th>الإجراء</th><th>التفاصيل</th></tr></thead>
                <tbody>
                    ${DB.auditLogs.map(l => `<tr>
                        <td>${(l.createdAt || '').replace('T', ' ')}</td>
                        <td><strong>${l.user}</strong></td>
                        <td>${l.action}</td>
                        <td>${l.details}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderSettingsPage(c) {
    c.innerHTML = `
        <div class="panel">
            <h3>⚙️ إعدادات المكتبة والنظام</h3>
            <div class="form-row" style="margin-top:14px;">
                <div class="form-group"><label>اسم المكتبة</label><input type="text" id="setStoreName" value="${DB.settings.storeName}"></div>
                <div class="form-group"><label>رقم الهاتف</label><input type="text" id="setPhone" value="${DB.settings.phone}"></div>
            </div>
            <div class="form-group"><label>العنوان</label><input type="text" id="setAddr" value="${DB.settings.address}"></div>
            <div class="form-group">
                <label><input type="checkbox" id="setNegStock" style="width:auto;" ${DB.settings.allowNegativeStock ? 'checked' : ''}> السماح بالبيع بالسالب عند نفاد الرصيد</label>
            </div>
            <button class="btn btn-primary" onclick="saveCloudSettings()">حفظ الإعدادات في السحابة</button>
        </div>
    `;
}

async function saveCloudSettings() {
    const { db, doc, setDoc } = window.FB;
    DB.settings.storeName = document.getElementById('setStoreName').value.trim();
    DB.settings.phone = document.getElementById('setPhone').value.trim();
    DB.settings.address = document.getElementById('setAddr').value.trim();
    DB.settings.allowNegativeStock = document.getElementById('setNegStock').checked;

    await setDoc(doc(db, 'app_settings', 'main'), DB.settings);
    document.getElementById('topbarStoreName').textContent = DB.settings.storeName;
    document.getElementById('storeFrontTitle').textContent = '📚 ' + DB.settings.storeName;
    await logAuditCloud('تعديل الإعدادات', 'تحديث إعدادات المكتبة');
    showToast('تم حفظ الإعدادات بنجاح');
}

function renderBackupPage(c) {
    c.innerHTML = `
        <div class="panel">
            <h3>💾 النسخ الاحتياطي السحابي</h3>
            <p style="font-size:13.5px; color:var(--text-muted); margin:10px 0;">يمكنك تنزيل نسخة احتياطية كاملة بصيغة JSON تحتوي على كافة الفواتير والمنتجات والحسابات المسجلة في Firebase.</p>
            <button class="btn btn-primary" onclick="downloadCloudBackup()">⬇️ تنزيل نسخة احتياطية كاملة (JSON)</button>
        </div>
    `;
}

function downloadCloudBackup() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `anas_library_backup_${nowCairo().slice(0, 10)}.json`;
    a.click();
}

// =========================================================================
// CUSTOMER STOREFRONT APPLICATION
// =========================================================================
function switchAppMode(mode) {
    if (mode === 'admin') {
        document.getElementById('adminApp').classList.remove('hidden');
        document.getElementById('customerApp').classList.add('hidden');
        document.getElementById('btnModeAdmin').classList.add('active');
        document.getElementById('btnModeCustomer').classList.remove('active');
    } else {
        document.getElementById('adminApp').classList.add('hidden');
        document.getElementById('customerApp').classList.remove('hidden');
        document.getElementById('btnModeCustomer').classList.add('active');
        document.getElementById('btnModeAdmin').classList.remove('active');
        renderStoreView('catalog');
    }
}

function renderStoreView(view) {
    const c = document.getElementById('storeMainContainer');
    document.getElementById('storeCartCount').textContent = customerCart.reduce((s, i) => s + i.qty, 0);

    if (view === 'catalog') {
        const visible = DB.products.filter(p => p.active !== false && p.showInStore !== false &&
            (storeSelectedCategory === 'all' || p.categoryName === storeSelectedCategory) &&
            p.name.toLowerCase().includes(storeSearchQuery.toLowerCase())
        );

        c.innerHTML = `
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px;">
                <input type="text" placeholder="ابحث عن كتاب، أداة مدرسية، عطر..." value="${storeSearchQuery}" oninput="storeSearchQuery=this.value; renderStoreView('catalog');" style="flex:1; min-width:220px;">
                <select onchange="storeSelectedCategory=this.value; renderStoreView('catalog');" style="max-width:240px;">
                    <option value="all">جميع الأقسام</option>
                    ${DB.categories.map(cat => `<option value="${cat.name}" ${storeSelectedCategory === cat.name ? 'selected' : ''}>${cat.name}</option>`).join('')}
                </select>
            </div>
            <div class="store-products-grid">
                ${visible.map(p => {
                    const inStock = (p.stock - (p.reserved || 0)) > 0;
                    return `
                        <div class="store-card">
                            <div>
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                                    <span style="font-size:11px; color:var(--text-muted);">${p.categoryName || ''}</span>
                                    <span class="badge ${inStock ? 'badge-ready' : 'badge-cancel'}">${inStock ? 'متوفر' : 'نفدت الكمية'}</span>
                                </div>
                                <h3 style="font-size:15.5px; margin-bottom:6px;">${p.name}</h3>
                                <p style="font-size:12.5px; color:var(--text-muted); margin-bottom:12px;">${p.desc || ''}</p>
                            </div>
                            <div>
                                <div style="font-size:19px; font-weight:800; color:var(--primary); margin-bottom:10px;">${formatMoney(p.sellPrice)}</div>
                                <button class="btn btn-primary w-100" ${!inStock ? 'disabled' : ''} onclick="addToCustomerCart('${p.id}')">+ أضف إلى السلة</button>
                            </div>
                        </div>
                    `;
                }).join('') || '<p>لا توجد منتجات معروضة حالياً</p>'}
            </div>
        `;
    } else if (view === 'cart') {
        const total = customerCart.reduce((s, i) => s + (i.qty * i.sellPrice), 0);
        c.innerHTML = `
            <div class="panel" style="max-width:680px; margin:0 auto;">
                <h3>🛒 سلة المشتريات وإتمام الطلب</h3>
                ${customerCart.length === 0 ? `
                    <p style="margin:16px 0; color:var(--text-muted);">سلة المشتريات فارغة حالياً.</p>
                    <button class="btn btn-primary" onclick="renderStoreView('catalog')">تصفح المنتجات</button>
                ` : `
                    <table style="margin:14px 0;">
                        <thead><tr><th>المنتج</th><th>السعر</th><th>الكمية</th><th>الإجمالي</th><th></th></tr></thead>
                        <tbody>
                            ${customerCart.map((it, idx) => `<tr>
                                <td>${it.name}</td>
                                <td>${formatMoney(it.sellPrice)}</td>
                                <td>${it.qty}</td>
                                <td><strong>${formatMoney(it.qty * it.sellPrice)}</strong></td>
                                <td><button class="btn btn-danger btn-sm" onclick="customerCart.splice(${idx},1); renderStoreView('cart');">حذف</button></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                    <div style="font-size:18px; font-weight:800; color:var(--primary); margin-bottom:16px;">إجمالي الطلب: ${formatMoney(total)}</div>
                    <div class="form-row">
                        <div class="form-group"><label>الاسم بالكامل *</label><input type="text" id="storeCustName" placeholder="أدخل اسمك"></div>
                        <div class="form-group"><label>رقم الهاتف (واتساب / اتصال) *</label><input type="text" id="storeCustPhone" placeholder="01xxxxxxxxx"></div>
                    </div>
                    <div class="form-group"><label>طريقة الاستلام</label>
                        <select id="storeDeliveryMethod">
                            <option value="استلام من المكتبة">استلام من فرع المكتبة</option>
                            <option value="توصيل للمنزل">توصيل للمنزل</option>
                        </select>
                    </div>
                    <div class="form-group"><label>العنوان بالتفصيل / ملاحظات إضافية</label><input type="text" id="storeCustNotes" placeholder="اكتب عنوانك في حالة طلب التوصيل..."></div>
                    <button class="btn btn-success w-100" style="padding:12px; font-size:15px;" onclick="submitStoreOrder()">🚀 تأكيد وإرسال الطلب للمكتبة</button>
                `}
            </div>
        `;
    } else if (view === 'track') {
        c.innerHTML = `
            <div class="panel" style="max-width:600px; margin:0 auto;">
                <h3>📦 متابعة حالة طلبك</h3>
                <p style="font-size:13px; color:var(--text-muted); margin:6px 0 12px;">أدخل رقم الطلب (مثل ORD-101) أو رقم الهاتف المسجل:</p>
                <div style="display:flex; gap:8px; margin-bottom:14px;">
                    <input type="text" id="trackInput" placeholder="ORD-101 أو 010...">
                    <button class="btn btn-primary" onclick="searchCloudOrder()">بحث</button>
                </div>
                <div id="trackRes"></div>
            </div>
        `;
    }
}

function addToCustomerCart(productId) {
    const p = DB.products.find(x => x.id === productId);
    if (!p) return;
    const ex = customerCart.find(i => i.productId === productId);
    if (ex) ex.qty += 1;
    else customerCart.push({ productId: p.id, name: p.name, qty: 1, sellPrice: p.sellPrice });
    document.getElementById('storeCartCount').textContent = customerCart.reduce((s, i) => s + i.qty, 0);
    showToast(`تمت إضافة "${p.name}" إلى السلة`);
}

async function submitStoreOrder() {
    const customerName = document.getElementById('storeCustName').value.trim();
    const phone = document.getElementById('storeCustPhone').value.trim();
    const deliveryMethod = document.getElementById('storeDeliveryMethod').value;
    const notes = document.getElementById('storeCustNotes').value.trim();
    if (!customerName || !phone) return showToast('يرجى إدخال الاسم ورقم الهاتف', true);

    const total = customerCart.reduce((s, i) => s + (i.qty * i.sellPrice), 0);
    const orderNo = 'ORD-' + (100 + DB.external_orders.length + 1);

    const { db, collection, addDoc } = window.FB;
    await addDoc(collection(db, 'external_orders'), {
        orderNo,
        customerName,
        phone,
        deliveryMethod,
        notes,
        items: customerCart,
        total,
        status: 'جديد',
        createdAt: nowCairo()
    });

    customerCart = [];
    document.getElementById('storeCartCount').textContent = '0';
    document.getElementById('storeMainContainer').innerHTML = `
        <div class="panel" style="max-width:520px; margin:0 auto; text-align:center; padding:32px;">
            <div style="font-size:48px;">🎉</div>
            <h2 style="color:var(--success); margin:10px 0;">تم إرسال طلبك بنجاح!</h2>
            <p>تم تسجيل طلبك في نظام المكتبة. احتفظ برقم الطلب للمتابعة:</p>
            <div style="font-size:26px; font-weight:800; color:var(--primary); background:#eff6ff; padding:12px; border-radius:10px; margin:14px 0;">${orderNo}</div>
            <button class="btn btn-primary" onclick="renderStoreView('track')">متابعة حالة الطلب</button>
        </div>
    `;
}

function searchCloudOrder() {
    const q = document.getElementById('trackInput').value.trim().toUpperCase();
    const matches = DB.external_orders.filter(o => (o.orderNo || '').toUpperCase() === q || o.phone === q);
    document.getElementById('trackRes').innerHTML = matches.map(o => `
        <div style="border:1px solid var(--border-color); border-radius:10px; padding:14px; margin-bottom:10px; background:#f8fafc;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
                <strong>رقم الطلب: ${o.orderNo}</strong>
                <span class="badge badge-new">${o.status}</span>
            </div>
            <div style="font-size:13px; margin-top:6px;">العميل: ${o.customerName} | الإجمالي: <strong>${formatMoney(o.total)}</strong></div>
            <div style="font-size:12px; color:var(--text-muted); margin-top:4px;">الأصناف: ${(o.items || []).map(i => `${i.name} (×${i.qty})`).join('، ')}</div>
        </div>
    `).join('') || '<p style="color:var(--danger);">لم يتم العثور على طلبات مطابقة</p>';
}

// =========================================================================
// MODAL HELPERS
// =========================================================================
function openModal(html) {
    const m = document.getElementById('modalContainer');
    m.innerHTML = `<div class="modal-overlay" onclick="if(event.target===this)closeModal()"><div class="modal-box">${html}</div></div>`;
    m.classList.remove('hidden');
}

function closeModal() {
    document.getElementById('modalContainer').classList.add('hidden');
}
