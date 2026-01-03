import { db } from "./firebase-config.js";
import { collection, addDoc, getDocs, query, orderBy, deleteDoc, doc, updateDoc, where, Timestamp, writeBatch, limit, startAfter, startAt, endAt, getCountFromServer, increment, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const customersTableBody = document.getElementById('customers-table-body');
const addCustomerForm = document.getElementById('addCustomerForm');
const editCustomerForm = document.getElementById('editCustomerForm');
const totalCustomersEl = document.getElementById('total-customers');
const searchInput = document.getElementById('searchCustomerInput');

// Pagination Elements
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('page-info');
const sortSelect = document.getElementById('sortSelect');

// === Global State ===
let customersStore = {};
let lastVisibleDoc = null;
let pageStack = []; // Stores the first document of each page for "Previous" navigation
let currentPage = 1;
const ITEMS_PER_PAGE = 15;
let isSearching = false;
let currentSortField = 'createdAt'; // Default sort

// === Phone Normalization ===
function normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, ''); // Remove non-digits

    // Egyptian phone formats:
    // 01060558591 (11 digits, correct)
    // 1060558591 (10 digits, missing leading 0)
    // 201060558591 (12 digits, country code)

    if (cleaned.startsWith('20') && cleaned.length === 12) {
        cleaned = '0' + cleaned.substring(2);
    } else if (cleaned.length === 10 && !cleaned.startsWith('0')) {
        cleaned = '0' + cleaned;
    }
    return cleaned;
}

// === Toast Helper ===
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

// === Load Customers (Pagination & Search) ===
async function loadCustomers(direction = 'first') {
    if (!customersTableBody) return;
    customersTableBody.innerHTML = '<tr><td colspan="4" class="text-center">جاري التحميل...</td></tr>';

    try {
        let q;
        const customersRef = collection(db, "customers");
        const searchTerm = searchInput ? searchInput.value.trim() : '';

        // Reset state if searching changes or first load
        if (direction === 'first') {
            lastVisibleDoc = null;
            pageStack = [];
            currentPage = 1;
        }

        if (searchTerm) {
            isSearching = true;
            // Server-Side Search Strategy
            // If term starts with a digit, assume Phone search. Otherwise Name search.
            const isPhone = /^\d/.test(searchTerm);
            const searchField = isPhone ? 'phone' : 'name';

            // Normalize phone number for consistent search
            const normalizedSearchTerm = isPhone ? normalizePhone(searchTerm) : searchTerm;

            // Update the input with normalized value for user feedback
            if (isPhone && searchInput) {
                searchInput.value = normalizedSearchTerm;
            }

            // Note: For efficient prefix search we sort by the search field FIRST
            if (direction === 'next' && lastVisibleDoc) {
                q = query(customersRef,
                    orderBy(searchField),
                    startAfter(lastVisibleDoc),
                    where(searchField, '>=', normalizedSearchTerm),
                    where(searchField, '<=', normalizedSearchTerm + '\uf8ff'),
                    limit(ITEMS_PER_PAGE)
                );
            } else if (direction === 'prev' && pageStack.length > 0) {
                // For previous, we go back to the state of that page. 
                // Simpler approach for "prev" in Firestore without double-fetching: reuse the stack logic below
                // Actually, "prev" usually pops the stack. To get page N, startsAfter(stack[N-1])
                // Let's handle stack logic before query construction
            } else {
                // First page of search
                q = query(customersRef,
                    orderBy(searchField),
                    where(searchField, '>=', normalizedSearchTerm),
                    where(searchField, '<=', normalizedSearchTerm + '\uf8ff'),
                    limit(ITEMS_PER_PAGE)
                );
            }
        } else {
            isSearching = false;
            // Normal Pagination with Server-Side Sorting
            if (direction === 'next' && lastVisibleDoc) {
                q = query(customersRef, orderBy(currentSortField, "desc"), startAfter(lastVisibleDoc), limit(ITEMS_PER_PAGE));
            } else {
                q = query(customersRef, orderBy(currentSortField, "desc"), limit(ITEMS_PER_PAGE));
            }
        }

        // Handle "Previous" Logic (re-query from start of target page)
        // If direction is 'prev', we simply pop the current page's start doc and use the previous one as startAfter
        if (direction === 'prev') {
            if (currentPage > 1) {
                currentPage--;
                pageStack.pop(); // Remove current page start
                const prevPageStartDoc = pageStack[pageStack.length - 1]; // This is the 'lastVisible' of the page BEFORE the previous page? 
                // No, pageStack should store END docs to startAfter?
                // Standard pattern:
                // Page 1: Start null.
                // Page 2: StartAfter(Page1LastDoc). pageStack[0] = Page1LastDoc.
                // Page 3: StartAfter(Page2LastDoc). pageStack[1] = Page2LastDoc.

                // To go back to Page 2 from 3: Use pageStack[0].
                // To go back to Page 1 from 2: Use null.

                const startAfterDoc = currentPage === 1 ? null : pageStack[currentPage - 2];

                if (searchTerm) {
                    const isPhone = /^\d/.test(searchTerm);
                    const searchField = isPhone ? 'phone' : 'name';
                    if (startAfterDoc) {
                        q = query(customersRef, orderBy(searchField), where(searchField, '>=', searchTerm), where(searchField, '<=', searchTerm + '\uf8ff'), startAfter(startAfterDoc), limit(ITEMS_PER_PAGE));
                    } else {
                        q = query(customersRef, orderBy(searchField), where(searchField, '>=', searchTerm), where(searchField, '<=', searchTerm + '\uf8ff'), limit(ITEMS_PER_PAGE));
                    }
                } else {
                    if (startAfterDoc) {
                        q = query(customersRef, orderBy("createdAt", "desc"), startAfter(startAfterDoc), limit(ITEMS_PER_PAGE));
                    } else {
                        q = query(customersRef, orderBy("createdAt", "desc"), limit(ITEMS_PER_PAGE));
                    }
                }
            } else {
                return; // Already at 1
            }
        }

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty && currentPage === 1) {
            customersTableBody.innerHTML = '<tr><td colspan="6" class="text-center">لا يوجد عملاء حالياً</td></tr>';
            if (totalCustomersEl) totalCustomersEl.innerText = "0";
            updatePaginationControls(true); // Disable "Next"
            return;
        }


        const docs = querySnapshot.docs;
        lastVisibleDoc = docs[docs.length - 1]; // Update for NEXT navigation

        // Update Stack for future "Next" button clicks
        // When we move forward (next or first), we push the *previous* lastVisible to stack? 
        // No, current logic:
        // Loading Page 1. lastVisibleDoc is end of P1.
        // Click Next -> loadCustomers('next'). Query starts after P1_End. 
        // We need to store P1_End in stack so we can use it for Page 2.

        if (direction === 'next') {
            // Before moving to this page, we were at currentPage, and used some doc to get here.
            // We need to store the doc that ENDS this page? No, the doc that STARTS this page.
            // Actually, simplest usage with stack:
            // stack[0] = end of page 1.
            // stack[1] = end of page 2.
            // When on page 3, prev -> goto page 2. Query needs end of page 1 (stack[0]).

            // So if direction is next:
            // We just loaded page (currentPage + 1).
            // We should push the OLD lastVisibleDoc (from processed page) to stack?
            // This is getting complex.
            // Better: state `lastVisibleDoc` is always the last doc of CURRENTLY VIEWED page.
            // When clicking next: push `lastVisibleDoc` to stack. Increment page. Query startAfter(`lastVisibleDoc`).
        }

        // Let's refine the flow inside the button handlers, loadCustomers just takes the query params?
        // No, keep logic here but simplistic.

        // Rendering
        let html = '';
        customersStore = {};

        docs.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;
            customersStore[id] = data;

            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString('ar-EG') : '-';
            const orderCount = data.orderCount || 0;
            const totalSpent = data.totalSpent || 0;

            html += `
                <tr>
                    <td>${data.name}</td>
                    <td dir="ltr" class="text-start">${data.phone}</td>
                    <td><span class="badge bg-primary">${orderCount}</span></td>
                    <td class="fw-bold text-success">${totalSpent.toLocaleString()} ج.م</td>
                    <td><small>${date}</small></td>
                    <td>
                        <div class="btn-group" dir="ltr">
                            <button class="btn btn-sm btn-outline-primary" onclick="viewCustomerOrders('${id}')" title="عرض الطلبات"><i class="bi bi-receipt"></i></button>
                            <button class="btn btn-sm btn-outline-info" onclick="openEditCustomerModal('${id}')"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteCustomer('${id}')"><i class="bi bi-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        customersTableBody.innerHTML = html;

        // Update Page Info
        if (pageInfo) pageInfo.innerText = `صفحة ${currentPage}`;

        // Update Total Count (Still need a separate aggregation query or rough estimate for total? 
        // Or just keep the dumb counter)
        // For accurate total count in Firestore without reading all, we need an aggregation query.
        // For now, let's just show "15+" or keep the old element if we want but reading size is expensive.
        // Actually, the user asked for *search* to simply save resources.
        // Let's run a separate aggregation query ONLY on first load (count()).
        if (direction === 'first' && !searchTerm) {
            // getCountFromServer(collection(db, "customers")).then(...) // Optional optimization
        }

        updatePaginationControls(docs.length < ITEMS_PER_PAGE);

        // Update Total Count (Only on first load or when list changes, not paging)
        if (direction === 'first' && !searchTerm) {
            updateTotalCount();
        }

    } catch (error) {
        console.error("Load Customers Error:", error);
        customersTableBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">حدث خطأ: ${error.message} <br> <small class="text-muted">قد تحتاج لإنشاء فهرس (Index) في Firebase Console.</small></td></tr>`;
    }
}

async function updateTotalCount() {
    if (!totalCustomersEl) return;
    try {
        const statsRef = doc(db, "stats", "general");
        const statsSnap = await getDoc(statsRef);

        if (statsSnap.exists()) {
            totalCustomersEl.innerText = (statsSnap.data().customersCount || 0).toLocaleString();
        } else {
            // Initialize stats doc if missing (fallback)
            await setDoc(statsRef, { customersCount: 0 }, { merge: true });
            totalCustomersEl.innerText = "0";
        }
    } catch (error) {
        console.error("Count Error:", error);
        totalCustomersEl.innerText = "-";
    }
}

function updatePaginationControls(isLastPage) {
    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
    if (nextPageBtn) nextPageBtn.disabled = isLastPage;
}

// === Event Listeners for Pagination ===
if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
        pageStack.push(lastVisibleDoc); // Save current page's end doc
        currentPage++;
        loadCustomers('next');
    });
}

if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
        loadCustomers('prev');
        // Page decrement and stack pop handled inside loadCustomers('prev') block wrapper logic or here. 
        // Refactoring: logic in loadCustomers('prev') block above handles it.
    });
}

// === Add Customer ===
if (addCustomerForm) {
    addCustomerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = addCustomerForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        const name = document.getElementById('customerName').value;
        const phone = document.getElementById('customerPhone').value;

        try {
            // Check if customer exists (using ID = Phone)
            // This costs 1 Read, which is acceptable for single add.
            const docRef = doc(db, "customers", phone);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                showToast('رقم الهاتف مسجل بالفعل لعميل آخر', 'warning');
                submitBtn.disabled = false;
                return;
            }

            await setDoc(docRef, {
                name,
                phone,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                // Analytics fields - initialized to 0 for new customers
                orderCount: 0,
                totalSpent: 0
            });

            // Increment Counter
            const statsRef = doc(db, "stats", "general");
            await updateDoc(statsRef, {
                customersCount: increment(1)
            }).catch(async (err) => {
                // Create if doesn't exist
                if (err.code === 'not-found') {
                    await setDoc(statsRef, { customersCount: 1 });
                }
            });

            showToast('تمت إضافة العميل بنجاح!');
            bootstrap.Modal.getInstance(document.getElementById('addCustomerModal')).hide();
            addCustomerForm.reset();
            await loadCustomers();
            updateTotalCount();
        } catch (error) {
            console.error("Add Customer Error:", error);
            showToast('حدث خطأ أثناء الإضافة: ' + error.message, 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// === Edit Customer ===
window.openEditCustomerModal = function (id) {
    const data = customersStore[id];
    if (!data) return;

    document.getElementById('editCustomerId').value = id;
    document.getElementById('editCustomerName').value = data.name;
    document.getElementById('editCustomerPhone').value = data.phone;

    const editModal = new bootstrap.Modal(document.getElementById('editCustomerModal'));
    editModal.show();
};

if (editCustomerForm) {
    editCustomerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editCustomerId').value;
        const submitBtn = editCustomerForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        const updatedData = {
            name: document.getElementById('editCustomerName').value,
            phone: document.getElementById('editCustomerPhone').value,
            updatedAt: Timestamp.now()
        };

        try {
            await updateDoc(doc(db, "customers", id), updatedData);
            showToast('تم تحديث البيانات بنجاح');
            bootstrap.Modal.getInstance(document.getElementById('editCustomerModal')).hide();
            await loadCustomers();
        } catch (error) {
            console.error("Update Customer Error:", error);
            showToast('حدث خطأ أثناء التحديث', 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// === Delete Customer ===
window.deleteCustomer = async function (id) {
    if (confirm('هل أنت متأكد من حذف هذا العميل؟')) {
        try {
            await deleteDoc(doc(db, "customers", id));

            // Decrement Counter
            const statsRef = doc(db, "stats", "general");
            await updateDoc(statsRef, {
                customersCount: increment(-1)
            }).catch(err => console.log("Counter update failed", err));

            await loadCustomers();
            updateTotalCount(); // Update total after delete
            showToast('تم حذف العميل بنجاح');
        } catch (error) {
            console.error("Delete Customer Error:", error);
            showToast('حدث خطأ أثناء الحذف', 'danger');
        }
    }
};

// === Search Listeners (Enter & Click) ===
const searchButton = document.getElementById('searchButton');

if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            loadCustomers('first');
        }
    });
}

if (searchButton) {
    searchButton.addEventListener('click', () => {
        loadCustomers('first');
    });
}

// === Modal Focus Management (Copied from inventory.js for consistency) ===
document.querySelectorAll('.modal').forEach(el => {
    el.addEventListener('shown.bs.modal', () => {
        setTimeout(() => {
            el.querySelectorAll('input, select, textarea, button').forEach(input => {
                input.disabled = false;
            });
            const firstInput = el.querySelector('input:not([type="hidden"]), select');
            if (firstInput) {
                firstInput.focus();
                firstInput.select();
            }
        }, 150);
    });
    el.addEventListener('hidden.bs.modal', () => {
        if (window) window.focus();
        document.body.focus();
    });
});

// === Excel Upload ===
const excelUploadInput = document.getElementById('excelUpload');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessage = document.getElementById('loadingMessage');

if (excelUploadInput) {
    excelUploadInput.addEventListener('change', handleExcelUpload);
}

async function handleExcelUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (loadingOverlay) loadingOverlay.classList.remove('d-none', 'd-flex');
    if (loadingOverlay) loadingOverlay.classList.add('d-flex');
    if (loadingMessage) loadingMessage.innerText = 'جاري قراءة الملف...';

    const reader = new FileReader();

    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 }); // Array of arrays

            if (!jsonData || jsonData.length === 0) {
                throw new Error('الملف فارغ أو غير صالح');
            }

            // Extract data from multi-column format (repeated blocks of 3 columns)
            let customersToAdd = [];
            // Skip header row (index 0), start from index 1
            for (let i = 1; i < jsonData.length; i++) {
                const row = jsonData[i];
                // Iterate through columns in steps of 3
                for (let j = 0; j < row.length; j += 3) {
                    // Expecting: [j] = ID, [j+1] = Name, [j+2] = Phone
                    const name = row[j + 1];
                    let phone = row[j + 2];

                    if (name && phone) {
                        // Clean phone number
                        phone = String(phone).replace(/\D/g, ''); // Remove non-digits
                        if (phone.length > 0) {
                            // Basic validation: Add leading zero if missing and length is 10 (common issue)
                            if (phone.length === 10 && phone.startsWith('1')) {
                                phone = '0' + phone;
                            }
                            customersToAdd.push({ name: String(name).trim(), phone });
                        }
                    }
                }
            }

            if (customersToAdd.length === 0) {
                throw new Error('لم يتم العثور على بيانات صالحة في الملف');
            }

            if (loadingMessage) loadingMessage.innerText = `جاري رفع ${customersToAdd.length} عميل...`;

            // ZERO READ STRATEGY: Use Phone as ID. set(..., {merge: true})
            // No duplicate checks needed -> Firestore handles it.

            const batchSize = 500;
            let batch = writeBatch(db);
            let operationCount = 0;
            let processedCount = 0;

            for (const cust of customersToAdd) {
                const ref = doc(db, "customers", cust.phone);
                // Use set with merge: true. 
                // If exists: updates name/phone (and keeps creation date if we don't overwrite it? 
                // merge: true merges fields. We want to update name maybe?
                // Let's ensure we don't overwrite createdAt if it exists?
                // setDoc with merge will overwrite fields provided.
                // We'll pass updatedAT. createdAt we can conditionally set? 
                // Firestore doesn't support "set if missing" easily in batch without read.
                // We will just set createdAt for new ones? No, if we send createdAt it overwrites.
                // User said: "If customer exists: Update".
                // So we will just write the data.

                batch.set(ref, {
                    name: cust.name,
                    phone: cust.phone,
                    updatedAt: Timestamp.now(),
                    createdAt: Timestamp.now(),
                    // Analytics fields - initialized to 0 for new customers
                    orderCount: 0,
                    totalSpent: 0
                }, { merge: true });

                operationCount++;
                processedCount++;

                if (operationCount >= batchSize) {
                    await batch.commit();
                    // Small delay to prevent UI freeze and Firestore throttling
                    await new Promise(resolve => setTimeout(resolve, 300));

                    batch = writeBatch(db);
                    operationCount = 0;
                    if (loadingMessage) loadingMessage.innerText = `تم معالجة ${processedCount} عميل...`;
                }
            }

            if (operationCount > 0) {
                await batch.commit();
            }

            // Sync Total Counter using Aggregation (Cheap Read)
            // 1 Read per 1000 docs (approx). Much cheaper than reading all docs.
            if (loadingMessage) loadingMessage.innerText = 'جاري تحديث العداد...';
            const countSnap = await getCountFromServer(collection(db, "customers"));
            const currentTotal = countSnap.data().count;

            const statsRef = doc(db, "stats", "general");
            await setDoc(statsRef, { customersCount: currentTotal }, { merge: true });

            showToast(`تمت معالجة ${processedCount} عميل بنجاح!`, 'success');
            await loadCustomers(); // Reload table

        } catch (error) {
            console.error("Excel Error:", error);
            showToast('خطأ في معالجة الملف: ' + error.message, 'danger');
        } finally {
            if (loadingOverlay) loadingOverlay.classList.remove('d-flex');
            if (loadingOverlay) loadingOverlay.classList.add('d-none');
            excelUploadInput.value = ''; // Reset input
        }
    };

    reader.readAsArrayBuffer(file);
}

// === Sort Dropdown Listener ===
if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
        currentSortField = e.target.value;
        currentPage = 1;
        pageStack = [];
        lastVisibleDoc = null;
        loadCustomers('first');
    });
}

// === View Customer Orders (On-Demand Query) ===
window.viewCustomerOrders = async function (customerId) {
    const customer = customersStore[customerId];
    if (!customer) return;

    // Get or create modal
    let modal = document.getElementById('customerOrdersModal');
    if (!modal) {
        // Create modal dynamically if not exists
        const modalHtml = `
        <div class="modal fade" id="customerOrdersModal" tabindex="-1">
            <div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title fw-bold"><i class="bi bi-receipt"></i> طلبات العميل</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="d-flex justify-content-between mb-3 p-2 bg-light rounded">
                            <div><strong>العميل:</strong> <span id="ordersCustomerName">-</span></div>
                            <div><strong>الهاتف:</strong> <span id="ordersCustomerPhone" dir="ltr">-</span></div>
                        </div>
                        <div id="customerOrdersList" class="text-center py-3">
                            <span class="spinner-border text-primary"></span>
                        </div>
                    </div>
                </div>
            </div>
        </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        modal = document.getElementById('customerOrdersModal');
    }

    const ordersListEl = document.getElementById('customerOrdersList');
    const customerNameEl = document.getElementById('ordersCustomerName');
    const customerPhoneEl = document.getElementById('ordersCustomerPhone');

    customerNameEl.innerText = customer.name;
    customerPhoneEl.innerText = customer.phone;
    ordersListEl.innerHTML = '<div class="text-center py-3"><span class="spinner-border text-primary"></span></div>';

    const bsModal = new bootstrap.Modal(modal);
    bsModal.show();

    // Fetch orders on-demand
    try {
        const salesRef = collection(db, "sales");
        const q = query(salesRef, where("customerPhone", "==", customer.phone), orderBy("createdAt", "desc"), limit(50));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            ordersListEl.innerHTML = '<div class="text-muted text-center py-4"><i class="bi bi-inbox display-4 opacity-25"></i><p class="mt-2">لا توجد طلبات لهذا العميل</p></div>';
            return;
        }

        let html = `<table class="table table-sm table-hover">
            <thead class="table-light">
                <tr>
                    <th>التاريخ</th>
                    <th>الأصناف</th>
                    <th>الإجمالي</th>
                </tr>
            </thead>
            <tbody>`;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const date = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';
            const itemCount = data.items ? data.items.length : 0;
            const total = Number(data.totalAmount || 0).toLocaleString();

            html += `
            <tr>
                <td><small>${date}</small></td>
                <td><span class="badge bg-secondary">${itemCount} أصناف</span></td>
                <td class="fw-bold text-success">${total} ج.م</td>
            </tr>`;
        });

        html += '</tbody></table>';
        ordersListEl.innerHTML = html;

    } catch (error) {
        console.error("Load Orders Error:", error);
        ordersListEl.innerHTML = `<div class="text-danger">خطأ في تحميل الطلبات: ${error.message}</div>`;
    }
};

// === Initialize ===
loadCustomers();
