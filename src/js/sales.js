import { db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, limit, startAfter, where, doc, getDoc, updateDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const salesTableBody = document.getElementById('sales-table-body');
const searchInput = document.getElementById('searchSalesInput');
const searchBtn = document.getElementById('searchSalesBtn');
const typeFilter = document.getElementById('typeFilter');
const branchFilter = document.getElementById('branchFilter');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('page-info');

// Details Modal Elements
const detailOrderId = document.getElementById('detailOrderId');
const detailCustomerName = document.getElementById('detailCustomerName');
const detailCustomerPhone = document.getElementById('detailCustomerPhone');
const detailDate = document.getElementById('detailDate');
const detailItemsBody = document.getElementById('detailItemsBody');
const detailTotalAmount = document.getElementById('detailTotalAmount');
const saleDetailsModal = new bootstrap.Modal(document.getElementById('saleDetailsModal'));

// Update Status Modal Elements
const updateStatusModal = new bootstrap.Modal(document.getElementById('updateStatusModal'));
const updateSaleIdInput = document.getElementById('updateSaleId');
const newStatusSelect = document.getElementById('newStatusSelect');
const saveStatusBtn = document.getElementById('saveStatusBtn');

// === State ===
let salesDataStore = {};
let lastVisibleDoc = null;
let pageStack = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 15;
let currentQueryType = 'standard'; // 'standard', 'search'

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
    await loadBranches();
    loadSales('first');
});

// Event Listeners
if (searchBtn) searchBtn.addEventListener('click', () => loadSales('first'));
if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadSales('first');
    });
}
if (typeFilter) typeFilter.addEventListener('change', () => loadSales('first'));
if (branchFilter) branchFilter.addEventListener('change', () => loadSales('first'));

if (nextPageBtn) nextPageBtn.addEventListener('click', () => loadSales('next'));
if (prevPageBtn) prevPageBtn.addEventListener('click', () => loadSales('prev'));

if (saveStatusBtn) saveStatusBtn.addEventListener('click', updateSaleStatus);

// === Branch Loading ===
async function loadBranches() {
    if (!branchFilter) return;
    try {
        const q = query(collection(db, "branches"));
        const snapshot = await getDocs(q);

        // Save current selection if re-loading (rare, but good practice)
        const currentVal = branchFilter.value;

        let html = '<option value="all">كل الفروع</option>';
        snapshot.forEach(doc => {
            const data = doc.data();
            html += `<option value="${doc.id}">${data.name}</option>`;
        });
        branchFilter.innerHTML = html;

        // Restore if valid
        if (currentVal && Array.from(branchFilter.options).some(o => o.value === currentVal)) {
            branchFilter.value = currentVal;
        }

    } catch (error) {
        console.error("Error loading branches:", error);
        branchFilter.innerHTML = '<option value="all">كل الفروع (خطأ)</option>';
    }
}

// === Main Load Function ===
async function loadSales(direction = 'first') {
    try {
        salesTableBody.innerHTML = '<tr><td colspan="9" class="text-center py-5"><div class="spinner-border text-primary"></div></td></tr>';

        const filterVal = typeFilter.value;
        const branchVal = branchFilter ? branchFilter.value : 'all';
        const searchTerm = searchInput.value.trim();

        const salesRef = collection(db, "sales");
        let q;

        // Normalization for Search
        let normalizedTerm = searchTerm;
        const isPhone = /^\d+$/.test(searchTerm);
        if (isPhone) {
            normalizedTerm = normalizePhone(searchTerm);
        }

        // --- Build Constraints Common Logic ---
        let constraints = [];

        // 1. Search Query
        if (searchTerm) {
            currentQueryType = 'search';

            if (isPhone) {
                // Determine if it's an Order ID or Phone
                // Order ID is DDMMYYYYXXX (11 digits)
                // Egyptian Phone is 01XXXXXXXXX (11 digits)
                // A key differentiator: Phones start with 01. 
                // Order IDs for days 03, 04... will start with 0 but 2nd digit is day digit.
                if (searchTerm.length === 11 && !searchTerm.startsWith('01')) {
                    constraints.push(where("orderId", "==", searchTerm));
                } else if (searchTerm.length > 11) {
                    // Likely a Doc ID or long Order ID
                    constraints.push(where("orderId", "==", searchTerm));
                } else {
                    constraints.push(where("customerPhone", "==", normalizedTerm));
                }
            } else {
                constraints.push(where("customerName", ">=", normalizedTerm));
                constraints.push(where("customerName", "<=", normalizedTerm + "\uf8ff"));
            }
        } else {
            currentQueryType = 'standard';
            constraints.push(orderBy("createdAt", "desc"));
        }

        // 2. Filters (Applied to both Search and Standard)
        if (filterVal !== 'all') {
            if (['tailoring', 'repair', 'dry_clean'].includes(filterVal)) {
                constraints.push(where("serviceType", "==", filterVal));
            } else {
                constraints.push(where("type", "==", filterVal));
            }
        }

        if (branchVal !== 'all') {
            constraints.push(where("branchId", "==", branchVal));
        }

        // 3. Pagination limits (Only for standard mainly, search assumes limits)
        if (currentQueryType === 'search') {
            constraints.push(limit(50));
            // Note: Mixing range (Name) + Equality (Type/Branch) usually needs composite index
        } else {
            // Standard Pagination
            if (direction === 'first') {
                currentPage = 1;
                pageStack = [];
                constraints.push(limit(ITEMS_PER_PAGE));
            } else if (direction === 'next') {
                currentPage++;
                pageStack.push(lastVisibleDoc);
                constraints.push(startAfter(lastVisibleDoc));
                constraints.push(limit(ITEMS_PER_PAGE));
            } else if (direction === 'prev') {
                currentPage = Math.max(1, currentPage - 1);
                pageStack.pop();
                const targetStartDoc = currentPage === 1 ? null : pageStack[currentPage - 2];
                if (targetStartDoc) constraints.push(startAfter(targetStartDoc));
                constraints.push(limit(ITEMS_PER_PAGE));
            }
        }

        q = query(salesRef, ...constraints);


        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            salesTableBody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-5">لا توجد نتائج</td></tr>';
            updatePaginationControls(true);
            return;
        }

        const docs = querySnapshot.docs;
        lastVisibleDoc = docs[docs.length - 1];
        salesDataStore = {};

        renderTable(docs);
        updatePaginationControls(docs.length < ITEMS_PER_PAGE);
        if (pageInfo) pageInfo.innerText = searchTerm ? `نتائج البحث` : `صفحة ${currentPage}`;

    } catch (error) {
        console.error("Load Sales Error:", error);
        salesTableBody.innerHTML = `<tr><td colspan="9" class="text-center text-danger py-4">خطأ (ربما يحتاج فهرس): ${error.message}</td></tr>`;
    }
}

function renderTable(docs) {
    let html = '';
    docs.forEach(docSnap => {
        const data = docSnap.data();
        salesDataStore[docSnap.id] = data;

        const date = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';
        const itemCount = data.items ? data.items.length : 0;
        const total = Number(data.totalAmount || 0);
        const paid = Number(data.amountPaid || 0);
        const remaining = Number(data.remainingAmount || 0);

        // Status
        let statusBadge = '<span class="badge bg-secondary">غير محدد</span>';
        const s = data.status || '';
        if (s === 'received') statusBadge = '<span class="badge bg-info text-dark">تم الاستلام</span>';
        else if (s === 'in_progress') statusBadge = '<span class="badge bg-warning text-dark">بدأ العمل</span>';
        else if (s === 'completed') statusBadge = '<span class="badge bg-primary">تم التنفيذ</span>';
        else if (s === 'delivered_and_paid') statusBadge = '<span class="badge bg-success">تم التسليم</span>';

        // Type
        let typeLabel = data.type === 'pos' ? 'MOP' : 'خدمة';
        if (data.serviceType) {
            const types = {
                'tailoring': 'تفصيل',
                'repair': 'تصليح',
                'dry_clean': 'دراي كلين'
            };
            typeLabel = types[data.serviceType] ? `خدمة: ${types[data.serviceType]}` : typeLabel;
        }

        const typeBadge = data.type === 'service' ?
            `<span class="badge bg-purple text-white small">${typeLabel}</span>` :
            `<span class="badge bg-light text-dark border small">POS</span>`;

        html += `
        <tr class="align-middle">
            <td class="ps-4">${date}</td>
            <td class="fw-bold text-primary">${data.orderId || docSnap.id}</td>
            <td>
                <div class="fw-bold">${data.customerName || 'عميل'}</div>
                <small class="text-muted" dir="ltr">${data.customerPhone || ''}</small>
            </td>
            <td>${typeBadge} (${itemCount})</td>
            <td class="fw-bold">${total.toLocaleString()} ج.م</td>
            <td class="text-primary">${paid.toLocaleString()}</td>
            <td class="${remaining > 0 ? 'text-danger fw-bold' : 'text-success'}">${remaining.toLocaleString()}</td>
            <td>${statusBadge}</td>
            <td>
                <div class="fw-bold small">${data.user || '-'}</div>
                <small class="text-muted">${data.branchName || 'غير محدد'}</small>
            </td>
            <td>
                <button class="btn btn-sm btn-outline-secondary me-1" onclick="window.viewSaleDetails('${docSnap.id}')" title="تفاصيل"><i class="bi bi-eye"></i></button>
                <button class="btn btn-sm btn-outline-primary" onclick="window.openUpdateStatus('${docSnap.id}')" title="تعديل الحالة"><i class="bi bi-pencil-square"></i></button>
            </td>
        </tr>
        `;
    });
    salesTableBody.innerHTML = html;
}

function updatePaginationControls(isLastPage) {
    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1 || currentQueryType === 'search';
    if (nextPageBtn) nextPageBtn.disabled = isLastPage || currentQueryType === 'search';
}

// === Status Update Logic ===
window.openUpdateStatus = function (id) {
    const data = salesDataStore[id];
    if (!data) return;

    updateSaleIdInput.value = id;
    newStatusSelect.value = data.status || 'received';
    updateStatusModal.show();
}

async function updateSaleStatus() {
    const id = updateSaleIdInput.value;
    const newStatus = newStatusSelect.value;

    if (!id) return;

    saveStatusBtn.disabled = true;
    saveStatusBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> حفظ...';

    try {
        const saleRef = doc(db, "sales", id);
        await updateDoc(saleRef, {
            status: newStatus
        });

        // Update local store and UI instantly
        if (salesDataStore[id]) salesDataStore[id].status = newStatus;

        // Reload current view to refresh badges
        // Simple way: re-render or reload. Ideally just update the row but Reload ensures consistency.
        updateStatusModal.hide();
        loadSales(currentQueryType === 'search' ? 'first' : 'current'); // 'current' logic not imp., just reload first or stay?
        // Let's just reload 'first' for search, or if standard, maybe 'stay'? 
        // Actually, just calling loadSales('first') is safest to see updates.
        loadSales('first');

    } catch (error) {
        console.error("Update Error:", error);
        alert("حدث خطأ أثناء التحديث");
    } finally {
        saveStatusBtn.disabled = false;
        saveStatusBtn.innerText = 'حفظ التغييرات';
    }
}

// === View Details ===
window.viewSaleDetails = function (id) {
    const data = salesDataStore[id];
    if (!data) return;

    detailOrderId.innerText = data.orderId || id;
    detailCustomerName.innerText = data.customerName || '-';
    detailCustomerPhone.innerText = data.customerPhone || '-';
    detailDate.innerText = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';

    // Delivery & Status
    const dd = data.deliveryDate ? new Date(data.deliveryDate).toLocaleDateString('ar-EG') : 'غير محدد';
    const dt = data.deliveryTime ? data.deliveryTime : '';
    document.getElementById('detailDeliveryDate').innerText = `${dd} ${dt}`;
    document.getElementById('detailUser').innerText = data.user || '-';

    let statusBadge = 'غير محدد';
    const s = data.status || '';
    if (s === 'received') statusBadge = '<span class="badge bg-info text-dark">تم الاستلام</span>';
    else if (s === 'in_progress') statusBadge = '<span class="badge bg-warning text-dark">بدأ العمل</span>';
    else if (s === 'completed') statusBadge = '<span class="badge bg-primary">تم التنفيذ</span>';
    else if (s === 'delivered_and_paid') statusBadge = '<span class="badge bg-success">تم التسليم</span>';
    document.getElementById('detailStatusBadge').innerHTML = statusBadge;

    const total = Number(data.totalAmount || 0);
    const paid = Number(data.amountPaid || 0);
    const remaining = Number(data.remainingAmount || 0);

    detailTotalAmount.innerText = total.toLocaleString() + ' ج.م';
    document.getElementById('detailPaidAmount').innerText = paid.toLocaleString() + ' ج.م';
    document.getElementById('detailRemainingAmount').innerText = remaining.toLocaleString() + ' ج.م';

    let itemsHtml = '';
    if (data.items && Array.isArray(data.items)) {
        data.items.forEach(item => {
            itemsHtml += `
            <tr>
                <td>${item.name}</td>
                <td>${Number(item.price).toLocaleString()}</td>
                <td>${item.qty}</td>
                <td>${(Number(item.price) * Number(item.qty)).toLocaleString()}</td>
            </tr>
            `;
        });
    }
    detailItemsBody.innerHTML = itemsHtml;

    saleDetailsModal.show();
}

// === Phone Normalization ===
function normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('20') && cleaned.length === 12) {
        cleaned = '0' + cleaned.substring(2);
    } else if (cleaned.length === 10 && !cleaned.startsWith('0')) {
        cleaned = '0' + cleaned;
    }
    return cleaned;
}
