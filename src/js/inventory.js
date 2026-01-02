import { db } from "./firebase-config.js";
window.inventoryStore = {};
import { collection, addDoc, getDocs, query, where, Timestamp, deleteDoc, doc, updateDoc, orderBy, limit, startAfter, startAt, endBefore, limitToLast, or, and, getCountFromServer, getAggregateFromServer, sum, average, count } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === Non-Blocking Toast Notification ===
// === Non-Blocking Toast Notification ===
function showToast(message, type = 'success') {
    const toastEl = document.getElementById('appToast');
    const toastBody = document.getElementById('toastMessage');
    if (toastEl && toastBody) {
        toastBody.innerHTML = message;
        toastEl.className = `toast align-items-center text-bg-${type} border-0`;
        const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
        toast.show();
    }
}

// === DOM Elements ===
const tableBody = document.getElementById('inventory-table-body');
const addItemForm = document.getElementById('addItemForm');
const editItemForm = document.getElementById('editItemForm');
const totalItemsEl = document.getElementById('total-items');
const totalValueEl = document.getElementById('total-value');
const lowStockEl = document.getElementById('low-stock-count');

// --- Filter/Search Elements ---
const searchInput = document.getElementById('searchInput');
const filterBranchSelect = document.getElementById('filterBranch');
const sortOptionsSelect = document.getElementById('sortOptions');
const applyFiltersBtn = document.getElementById('applyFilters');
const resetFiltersBtn = document.getElementById('resetFilters');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const totalResultsEl = document.getElementById('total-results');

// --- Branch Selectors ---
const itemBranchSelect = document.getElementById('itemBranch');
const editItemBranchSelect = document.getElementById('editItemBranch');
const transferToBranchSelect = document.getElementById('transferToBranch');
const transferForm = document.getElementById('transferForm');

// --- Global State ---
let lastVisible = null;
let firstVisible = null;
let pageStack = [];
let pageSize = 10;
let currentFilters = {
    search: '',
    branchId: '',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    type: 'raw', // Default to raw on initial load
    alertMode: false // true = show only low stock
};

// === Selling Price Visibility Toggle ===
const itemTypeSelect = document.getElementById('itemType');
const sellingPriceGroup = document.getElementById('sellingPriceGroup');
const editItemTypeSelect = document.getElementById('editItemType');
const editSellingPriceGroup = document.getElementById('editSellingPriceGroup');

function toggleSellingPrice(typeValue, groupEl) {
    if (groupEl) {
        groupEl.style.display = typeValue === 'finished' ? 'block' : 'none';
    }
}

if (itemTypeSelect) {
    itemTypeSelect.addEventListener('change', (e) => {
        toggleSellingPrice(e.target.value, sellingPriceGroup);
    });
}

if (editItemTypeSelect) {
    editItemTypeSelect.addEventListener('change', (e) => {
        toggleSellingPrice(e.target.value, editSellingPriceGroup);
    });
}

// === Sidebar Navigation ===
function setActiveNav(id) {
    document.querySelectorAll('.nav-link-custom').forEach(el => el.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
}

// Event Listeners for Sidebar
document.getElementById('nav-raw')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveNav('nav-raw');
    currentFilters.type = 'raw';
    currentFilters.alertMode = false;
    document.getElementById('page-title').innerText = 'مخزون الخامات (Raw)';
    loadInventory('first');
});

document.getElementById('nav-finished')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveNav('nav-finished');
    currentFilters.type = 'finished';
    currentFilters.alertMode = false;
    document.getElementById('page-title').innerText = 'مخزون المنتج التام';
    loadInventory('first');
});

document.getElementById('nav-alerts')?.addEventListener('click', (e) => {
    e.preventDefault();
    setActiveNav('nav-alerts');
    currentFilters.type = 'all';
    currentFilters.alertMode = true;
    document.getElementById('page-title').innerText = 'تنبيهات النواقص';
    loadInventory('first');
});

// === Load Stats (Global) ===
// === Load Stats (Server-Side Control) ===
async function updateStats() {
    try {
        let qStats = collection(db, "inventory");
        let constraints = [];

        // Filter by type (raw, finished, all)
        if (currentFilters.type && currentFilters.type !== 'all') {
            constraints.push(where("type", "==", currentFilters.type));
        }

        if (currentFilters.branchId) {
            constraints.push(where("branchId", "==", currentFilters.branchId));
        }

        if (currentFilters.search) {
            const val = currentFilters.search.trim();
            if (/^\d{5,}$/.test(val)) {
                constraints.push(where("barcode", ">=", val), where("barcode", "<=", val + "\uf8ff"));
            } else {
                constraints.push(where("name", ">=", val), where("name", "<=", val + "\uf8ff"));
            }
        }

        const aggQuery = query(qStats, ...constraints);

        // Get documents for counting and calculations
        const statsQuery = await getDocs(aggQuery);
        let itemCount = 0;
        let tVal = 0;
        let lStock = 0;

        statsQuery.forEach(doc => {
            const data = doc.data();
            const qty = parseInt(data.quantity || 0);
            const cost = parseFloat(data.cost || 0);
            const minQty = parseInt(data.minQuantity || 0);

            itemCount++;
            tVal += (qty * cost);
            if (qty <= minQty) lStock++;
        });

        if (totalItemsEl) totalItemsEl.innerText = itemCount.toLocaleString();
        if (totalValueEl) totalValueEl.innerText = tVal.toLocaleString() + ' ج.م';
        if (lowStockEl) lowStockEl.innerText = lStock.toLocaleString();
    } catch (error) {
        console.error("Stats Error:", error);
    }
}

// === Load Inventory (Universal Sorting) ===
async function loadInventory(direction = 'first') {
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="9" class="text-center">جاري التحميل...</td></tr>';

    try {
        updateStats(); // Refresh summary cards based on new filters
        let q = collection(db, "inventory");
        let constraints = [];
        let isBarcodeSearch = false;

        // 1. Filter by Branch
        if (currentFilters.branchId) {
            constraints.push(where("branchId", "==", currentFilters.branchId));
        }

        // 1.5 Filter by Type or Alert
        if (currentFilters.alertMode) {
            // NOTE: Firestore doesn't accept where(a, <, b) AND orderBy(c).
            // So for alerts (quantity <= minQuantity), we might need client-side filtering if we sort by createdAt.
            // However, we can try to query simplest form first.
            // Since `quantity <= minQuantity` involves comparing two fields, Firestore standard queries DON'T support field-to-field comparison directly in `where`.
            // We MUST do this client-side or store a flag `isLowStock` on the document.
            // For now, we'll fetch all (or by branch) and filter client-side for alerts.
            // To optimize, we can rely on client-side filtering after fetching.
        } else if (currentFilters.type !== 'all') {
            constraints.push(where("type", "==", currentFilters.type));
        }

        // 2. Search Logic
        if (currentFilters.search) {
            const searchVal = currentFilters.search.trim();
            if (/^\d{5,}$/.test(searchVal)) {
                constraints.push(where("barcode", ">=", searchVal));
                constraints.push(where("barcode", "<=", searchVal + "\uf8ff"));
                isBarcodeSearch = true;
            } else {
                constraints.push(where("name", ">=", searchVal));
                constraints.push(where("name", "<=", searchVal + "\uf8ff"));

                // Only order by name if we are searching by name
                constraints.push(orderBy("name", "asc"));
            }
        } else {
            // Apply default sort ONLY if we aren't doing a special filter that conflicts
            constraints.push(orderBy(currentFilters.sortBy, currentFilters.sortOrder));
        }

        if (!isBarcodeSearch && !currentFilters.alertMode) constraints.push(limit(pageSize + 1));

        // 4. Pagination
        if (!isBarcodeSearch && !currentFilters.alertMode) {
            if (direction === 'next' && lastVisible) {
                pageStack.push(firstVisible);
                constraints.push(startAfter(lastVisible));
            } else if (direction === 'prev' && pageStack.length > 0) {
                const prevFirstDoc = pageStack.pop();
                constraints.push(startAt(prevFirstDoc));
            } else if (direction === 'first') {
                pageStack = [];
            }
        }

        const querySnapshot = await getDocs(query(q, ...constraints));

        if (querySnapshot.empty) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center">لا توجد نتائج</td></tr>';
            if (nextPageBtn) nextPageBtn.disabled = true;
            if (prevPageBtn) prevPageBtn.disabled = true;
            if (totalResultsEl) totalResultsEl.innerText = "0";
            return;
        }

        let results = [];
        querySnapshot.forEach(doc => {
            const data = doc.data();
            // Client-side filtering for Alerts
            if (currentFilters.alertMode) {
                const qty = parseInt(data.quantity || 0);
                const min = parseInt(data.minQuantity || 0);
                if (qty > min) return; // Skip non-alert items
            }
            results.push({ id: doc.id, ...data, _snapshot: doc });
        });

        if (currentFilters.alertMode && results.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="9" class="text-center">لا توجد نواقص حالياً</td></tr>';
            if (totalResultsEl) totalResultsEl.innerText = "0";
            return;
        }

        // JavaScript Fallback Sort (For Barcode searches OR Alerts)
        if (isBarcodeSearch || currentFilters.alertMode) {
            const field = currentFilters.sortBy;
            const order = currentFilters.sortOrder;
            results.sort((a, b) => {
                let valA = a[field];
                let valB = b[field];
                if (typeof valA === 'string') return order === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
                return order === 'asc' ? valA - valB : valB - valA;
            });
        }

        // Detect Next Page
        let hasNextPage = false;
        let displayResults = results;

        if (!isBarcodeSearch && !currentFilters.alertMode) {
            hasNextPage = results.length > pageSize;
            if (hasNextPage) {
                displayResults = results.slice(0, pageSize);
            }
        }

        firstVisible = displayResults[0]._snapshot;
        lastVisible = displayResults[displayResults.length - 1]._snapshot;

        if (nextPageBtn) nextPageBtn.disabled = !hasNextPage;
        if (prevPageBtn) prevPageBtn.disabled = pageStack.length === 0;

        let html = '';
        window.inventoryStore = {};
        displayResults.forEach((data) => {
            const id = data.id;
            const isLow = data.quantity <= (data.minQuantity || 0);
            window.inventoryStore[id] = data;

            html += `
                <tr class="${isLow ? 'table-danger' : ''}">
                    <td><small>${data.barcode}</small></td>
                    <td>${data.name}</td>
                    <td>
                        <span class="badge ${data.type === 'raw' ? 'bg-secondary' : 'bg-success'}">${data.type === 'raw' ? 'خام' : 'منتج تام'}</span>
                        <small class="d-block text-muted">${data.unit || ''}</small>
                    </td>
                    <td><small>${data.color || '-'}</small></td>
                    <td><span class="badge bg-light text-dark border">${data.branchName || '-'}</span></td>
                    <td class="fw-bold">${data.quantity}</td>
                    <td>${data.minQuantity || 0}</td>
                    <td>${data.cost} ج.م</td>
                    <td>${data.type === 'finished' && data.sellingPrice ? data.sellingPrice + ' ج.م' : '-'}</td>
                    <td>
                        <div class="btn-group" dir="ltr">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteItem('${id}')"><i class="bi bi-trash"></i></button>
                            <button class="btn btn-sm btn-outline-info" onclick="openEditModal('${id}')"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-primary" onclick="printBarcode('${data.barcode}')"><i class="bi bi-printer"></i></button>
                            <button class="btn btn-sm btn-outline-warning" onclick="openTransferModal('${id}')"><i class="bi bi-arrow-left-right"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;
        if (totalResultsEl) {
            const start = isBarcodeSearch ? 1 : (pageStack.length * pageSize) + 1;
            const end = isBarcodeSearch ? displayResults.length : (pageStack.length * pageSize) + displayResults.length;
            totalResultsEl.innerText = `${start} - ${end}`;
        }
    } catch (error) {
        console.error("Load Error:", error);
        let errorMsg = `حدث خطأ: ${error.message}`;
        if (error.message.includes('requires an index')) {
            const match = error.message.match(/(https:\/\/console\.firebase\.google\.com[^\s]+)/);
            if (match) {
                errorMsg = `
                    <div class="text-start">
                        <strong>مطلوب إنشاء فهرس (Index)</strong><br>
                        يتطلب هذا الفرز/التصنيف إنشاء فهرس في قاعدة البيانات.<br>
                        <a href="${match[1]}" target="_blank" class="btn btn-sm btn-light text-danger fw-bold mt-2">
                            <i class="bi bi-box-arrow-up-right"></i> اضغط هنا لإنشاء الفهرس تلقائياً
                        </a>
                    </div>
                `;
            }
        }
        tableBody.innerHTML = `<tr><td colspan="9" class="text-center text-danger p-4">${errorMsg}</td></tr>`;
    }
}


function populateBranchDropdowns(branchesSnap) {
    let options = '<option value="" disabled selected>اختر الفرع...</option>';
    let filterOptions = '<option value="">كل الفروع</option>';

    branchesSnap.forEach(doc => {
        const b = doc.data();
        options += `<option value="${doc.id}">${b.name}</option>`;
        filterOptions += `<option value="${doc.id}">${b.name}</option>`;
    });

    if (itemBranchSelect) itemBranchSelect.innerHTML = options;
    if (editItemBranchSelect) editItemBranchSelect.innerHTML = options;
    if (transferToBranchSelect) transferToBranchSelect.innerHTML = options;
    if (filterBranchSelect) filterBranchSelect.innerHTML = filterOptions;
}

// === Helper: Generate Barcode ===
async function generateDailyBarcode() {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();

    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    const q = query(
        collection(db, "inventory"),
        where("createdAt", ">=", Timestamp.fromDate(startOfDay)),
        where("createdAt", "<=", Timestamp.fromDate(endOfDay))
    );

    const snapshot = await getDocs(q);
    const count = snapshot.size + 1;
    const countStr = String(count).padStart(3, '0');

    return `${dd}${mm}${yyyy}${countStr}`;
}

// === Add New Item ===
if (addItemForm) {
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = addItemForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        const name = document.getElementById('itemName').value;
        const branchId = document.getElementById('itemBranch').value;
        const branchName = document.getElementById('itemBranch').options[document.getElementById('itemBranch').selectedIndex].text;
        const type = document.getElementById('itemType').value;
        const unit = document.getElementById('itemUnit').value;
        const color = document.getElementById('itemColor').value;
        const qty = parseInt(document.getElementById('itemQty').value);
        const minQty = parseInt(document.getElementById('itemMinQty').value);
        const cost = parseFloat(document.getElementById('itemCost').value);
        const sellingPrice = type === 'finished' ? parseFloat(document.getElementById('itemSellingPrice').value) || 0 : null;

        try {
            // Check for duplication/merge (within same branch)
            const q = query(collection(db, "inventory"),
                where("name", "==", name),
                where("branchId", "==", branchId),
                where("type", "==", type),
                where("unit", "==", unit),
                where("color", "==", color)
            );
            const existingSnapshot = await getDocs(q);

            if (!existingSnapshot.empty) {
                const existingDoc = existingSnapshot.docs[0];
                const existingData = existingDoc.data();

                if (confirm(`هذا الصنف موجود بالفعل في هذا الفرع بباركود (${existingData.barcode}). \nهل تريد إضافة الكمية (${qty}) للرصيد الحالي (${existingData.quantity})؟`)) {
                    await updateDoc(doc(db, "inventory", existingDoc.id), {
                        quantity: existingData.quantity + qty,
                        updatedAt: Timestamp.now()
                    });
                    showToast('تم تحديث الكمية بنجاح!');
                } else {
                    await createNewBatch(name, type, unit, qty, minQty, cost, color, branchId, branchName, sellingPrice);
                }
            } else {
                await createNewBatch(name, type, unit, qty, minQty, cost, color, branchId, branchName, sellingPrice);
            }

            bootstrap.Modal.getInstance(document.getElementById('addItemModal')).hide();
            addItemForm.reset();
            await loadInventory();

        } catch (e) {
            console.error("Error adding document: ", e);
            showToast('حدث خطأ أثناء الإضافة', 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

async function createNewBatch(name, type, unit, qty, minQty, cost, color, branchId, branchName, sellingPrice = null) {
    const barcode = await generateDailyBarcode();
    const itemData = {
        name, type, unit, color: color || '', quantity: qty, minQuantity: minQty, cost, barcode,
        branchId, branchName,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now()
    };

    // Only add selling price for finished products
    if (type === 'finished' && sellingPrice !== null) {
        itemData.sellingPrice = sellingPrice;
    }

    await addDoc(collection(db, "inventory"), itemData);
    showToast(`تمت الإضافة بنجاح! الباركود: ${barcode}`);
    // Print dialog removed to prevent focus issues. User can print from the table.
}

// === Delete Item ===
window.deleteItem = async function (id) {
    if (confirm('هل أنت متأكد من حذف هذا الصنف نهائياً؟')) {
        try {
            await deleteDoc(doc(db, "inventory", id));
            await loadInventory();
            showToast('تم الحذف بنجاح');
        } catch (e) {
            console.error("Delete Error:", e);
            showToast('خطأ أثناء الحذف', 'danger');
        }
    }
}

// === Edit Item ===
window.openEditModal = function (id) {
    const data = window.inventoryStore[id];
    if (!data) return;

    document.getElementById('editItemId').value = id;
    document.getElementById('editItemBranch').value = data.branchId || '';
    document.getElementById('editItemName').value = data.name;
    document.getElementById('editItemType').value = data.type;
    document.getElementById('editItemUnit').value = data.unit;
    document.getElementById('editItemColor').value = data.color || '';
    document.getElementById('editItemQty').value = data.quantity;
    document.getElementById('editItemMinQty').value = data.minQuantity;
    document.getElementById('editItemCost').value = data.cost;

    // Populate selling price for finished products
    const editSellingPriceGroup = document.getElementById('editSellingPriceGroup');
    const editSellingPriceInput = document.getElementById('editItemSellingPrice');
    if (data.type === 'finished') {
        if (editSellingPriceGroup) editSellingPriceGroup.style.display = 'block';
        if (editSellingPriceInput) editSellingPriceInput.value = data.sellingPrice || 0;
    } else {
        if (editSellingPriceGroup) editSellingPriceGroup.style.display = 'none';
        if (editSellingPriceInput) editSellingPriceInput.value = '';
    }

    const editModal = new bootstrap.Modal(document.getElementById('editItemModal'));
    editModal.show();
}

if (editItemForm) {
    editItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editItemId').value;
        const submitBtn = document.getElementById('editSubmitBtn');
        submitBtn.disabled = true;

        const editType = document.getElementById('editItemType').value;
        const updatedData = {
            branchId: document.getElementById('editItemBranch').value,
            branchName: document.getElementById('editItemBranch').options[document.getElementById('editItemBranch').selectedIndex].text,
            name: document.getElementById('editItemName').value,
            type: editType,
            unit: document.getElementById('editItemUnit').value,
            color: document.getElementById('editItemColor').value,
            quantity: parseInt(document.getElementById('editItemQty').value),
            minQuantity: parseInt(document.getElementById('editItemMinQty').value),
            cost: parseFloat(document.getElementById('editItemCost').value),
            updatedAt: Timestamp.now()
        };

        // Only include selling price for finished products
        if (editType === 'finished') {
            updatedData.sellingPrice = parseFloat(document.getElementById('editItemSellingPrice').value) || 0;
        }

        try {
            await updateDoc(doc(db, "inventory", id), updatedData);
            bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
            await loadInventory();
            showToast('تم التعديل بنجاح');
        } catch (e) {
            console.error("Update Error:", e);
            showToast('خطأ أثناء التحديث', 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// === Function to Print Barcode ===
window.printBarcode = function (barcodeValue) {
    const printWindow = window.open('', '', 'width=300,height=200');
    printWindow.document.write(`
        <html>
            <head>
                <title>طباعة باركود</title>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                <style>
                    body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: center; height: 100vh; }
                    svg { width: 80%; height: auto; }
                </style>
            </head>
            <body>
                <svg id="barcode"></svg>
                <script>
                    JsBarcode("#barcode", "${barcodeValue}", {
                        format: "CODE128",
                        displayValue: true,
                        fontSize: 20
                    });
                    window.onload = () => { window.print(); window.close(); }
                </script>
            </body>
        </html>
    `);
    printWindow.document.close();
}

// === Barcode Scanner ===
const barcodeInput = document.getElementById('barcodeInput');
if (barcodeInput) {
    barcodeInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const code = barcodeInput.value.trim();
            if (code) {
                await searchByBarcode(code);
                barcodeInput.value = '';
            }
        }
    });
}

async function searchByBarcode(barcode) {
    const q = query(collection(db, "inventory"), where("barcode", "==", barcode));
    const snap = await getDocs(q);
    if (!snap.empty) {
        showScanModal(snap.docs[0].data());
    } else {
        showToast("المنتج غير موجود!", 'warning');
    }
}

function showScanModal(product) {
    document.getElementById('scanName').innerText = product.name;
    document.getElementById('scanBarcode').innerText = product.barcode;
    document.getElementById('scanCost').innerText = (product.cost || 0) + ' ج.م';
    document.getElementById('scanColor').innerText = product.color || '-';
    document.getElementById('scanBranch').innerText = product.branchName || '-';
    document.getElementById('scanQty').innerText = product.quantity;
    document.getElementById('scanType').innerText = product.type === 'raw' ? 'خام' : 'منتج تام';
    document.getElementById('scanUnit').innerText = product.unit || '-';
    new bootstrap.Modal(document.getElementById('scanModal')).show();
}

// === Transfer Item Logic ===
let currentItemForTransfer = null;

window.openTransferModal = function (id) {
    const item = window.inventoryStore[id];
    if (!item) return;

    currentItemForTransfer = item;
    document.getElementById('transferItemId').value = id;
    document.getElementById('transferItemName').innerText = item.name;
    document.getElementById('transferFromBranchName').innerText = item.branchName || 'غير محدد';
    document.getElementById('transferMaxQtyText').innerText = `من أصل ${item.quantity}`;
    document.getElementById('transferQty').max = item.quantity;

    new bootstrap.Modal(document.getElementById('transferModal')).show();
}

if (transferForm) {
    transferForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('transferSubmitBtn');
        const toBranchId = document.getElementById('transferToBranch').value;
        const toBranchName = document.getElementById('transferToBranch').options[document.getElementById('transferToBranch').selectedIndex].text;
        const transferQty = parseInt(document.getElementById('transferQty').value);

        if (!currentItemForTransfer) return;
        if (transferQty > currentItemForTransfer.quantity) {
            showToast('الكمية المطلوبة أكبر من الرصيد المتاح!', 'warning');
            return;
        }
        if (toBranchId === currentItemForTransfer.branchId) {
            showToast('لا يمكن التحويل لنفس الفرع!', 'warning');
            return;
        }

        submitBtn.disabled = true;

        try {
            // 1. Deduct from source
            const sourceRef = doc(db, "inventory", currentItemForTransfer.id);
            const newSourceQty = (currentItemForTransfer.quantity || 0) - transferQty;

            await updateDoc(sourceRef, {
                quantity: newSourceQty,
                updatedAt: Timestamp.now()
            });

            // 2. Check if item exists in target branch
            const q = query(collection(db, "inventory"),
                where("name", "==", currentItemForTransfer.name),
                where("branchId", "==", toBranchId),
                where("type", "==", currentItemForTransfer.type),
                where("unit", "==", currentItemForTransfer.unit),
                where("color", "==", currentItemForTransfer.color || '')
            );
            const targetSnapshot = await getDocs(q);

            if (!targetSnapshot.empty) {
                // Update existing item in target branch
                const targetDoc = targetSnapshot.docs[0];
                const targetData = targetDoc.data();
                await updateDoc(doc(db, "inventory", targetDoc.id), {
                    quantity: (targetData.quantity || 0) + transferQty,
                    updatedAt: Timestamp.now()
                });
            } else {
                // Create new entry for this item in target branch
                // Clone the item object and remove specific internal fields
                const newItemData = { ...currentItemForTransfer };
                delete newItemData.id;

                // Set the new branch and quantity
                newItemData.quantity = transferQty;
                newItemData.branchId = toBranchId;
                newItemData.branchName = toBranchName;
                newItemData.updatedAt = Timestamp.now();
                newItemData.createdAt = Timestamp.now(); // Optional: keep original or reset

                await addDoc(collection(db, "inventory"), newItemData);
            }

            showToast('تم التحويل بنجاح!');
            bootstrap.Modal.getInstance(document.getElementById('transferModal')).hide();
            await loadInventory();

        } catch (error) {
            console.error("Transfer Full Error:", error);
            showToast('حدث خطأ أثناء عملية التحويل: ' + error.message, 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// === Event Listeners for Filters & Pagination ===
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        currentFilters.search = e.target.value;
    });
    // Support for barcode scanners which usually append an Enter/Tab key
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            currentFilters.search = e.target.value;
            loadInventory('first');
        }
    });
}

if (filterBranchSelect) {
    filterBranchSelect.addEventListener('change', (e) => {
        currentFilters.branchId = e.target.value;
    });
}

if (sortOptionsSelect) {
    sortOptionsSelect.addEventListener('change', (e) => {
        const [field, order] = e.target.value.split('_');
        currentFilters.sortBy = field;
        currentFilters.sortOrder = order;
    });
}

if (applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', () => {
        loadInventory('first');
    });
}

if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
        currentFilters = { search: '', branchId: '', sortBy: 'createdAt', sortOrder: 'desc' };
        if (searchInput) searchInput.value = '';
        if (filterBranchSelect) filterBranchSelect.value = '';
        if (sortOptionsSelect) sortOptionsSelect.value = 'createdAt_desc';
        loadInventory('first');
    });
}

if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => loadInventory('next'));
}

if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => loadInventory('prev'));
}

// === Load Branches ===
async function initBranches() {
    try {
        const branchesSnap = await getDocs(collection(db, "branches"));
        populateBranchDropdowns(branchesSnap);
    } catch (error) {
        console.error("Branches Load Error:", error);
    }
}

// === Stability Fix: Force Enable Inputs on Modal Show ===
const modals = ['addItemModal', 'editItemModal', 'transferModal'];
modals.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('shown.bs.modal', () => {
            // Delay to ensure Bootstrap animation completes
            setTimeout(() => {
                el.querySelectorAll('input, select, textarea, button').forEach(input => {
                    input.disabled = false;
                });
                // Auto-focus the first input if available
                const firstInput = el.querySelector('input:not([type="hidden"]), select');
                if (firstInput) {
                    firstInput.focus();
                    firstInput.select(); // Highlight text if any
                }
            }, 150);
        });

        // Force focus back to window on hide to prevent trapped state
        el.addEventListener('hidden.bs.modal', () => {
            if (window) window.focus();
            document.body.focus();
        });
    }
});

// Initial Load
initBranches();
updateStats();
loadInventory('first');
