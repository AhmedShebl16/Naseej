import { db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, limit, startAfter, where, doc, getDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const salesTableBody = document.getElementById('sales-table-body');
const searchInput = document.getElementById('salesSearchInput');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('page-info');

// Details Modal Elements
const detailCustomerName = document.getElementById('detailCustomerName');
const detailCustomerPhone = document.getElementById('detailCustomerPhone');
const detailDate = document.getElementById('detailDate');
const detailItemsBody = document.getElementById('detailItemsBody');
const detailTotalAmount = document.getElementById('detailTotalAmount');
const saleDetailsModal = new bootstrap.Modal(document.getElementById('saleDetailsModal'));

// === State ===
let salesDataStore = {};
let lastVisibleDoc = null;
let pageStack = []; // Stores the 'lastVisible' of previous pages to go back
let currentPage = 1;
const ITEMS_PER_PAGE = 15;

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    loadSales('first');
});

// === Load Sales ===
async function loadSales(direction = 'first') {
    try {
        salesTableBody.innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-primary"></div></td></tr>';

        const salesRef = collection(db, "sales");
        let q;

        if (direction === 'first') {
            q = query(salesRef, orderBy("createdAt", "desc"), limit(ITEMS_PER_PAGE));
            currentPage = 1;
            pageStack = [];
        } else if (direction === 'next') {
            q = query(salesRef, orderBy("createdAt", "desc"), startAfter(lastVisibleDoc), limit(ITEMS_PER_PAGE));
        } else if (direction === 'prev') {
            if (currentPage > 1) {
                const prevDoc = pageStack[currentPage - 2]; // Get start doc of previous page? No, standard pagination is tricky. 
                // Simplest prev logic:
                pageStack.pop(); // Remove current page start
                const targetDoc = pageStack[pageStack.length - 1]; // The end of the page BEFORE the previous one

                // Going back in firestore cursor pagination is hard. 
                // Ideally, we just pop the stack of "Last Visibles".
                // If we are at Page 3. Stack has [P1_End, P2_End].
                // We want P2. P2 starts after P1_End. 

                // Let's reset:
                // Page 1: Stack Empty.
                // Click Next -> load Page 2. Push P1_End to stack. Stack: [P1_End]. Query startAfter(P1_End).
                // Click Next -> load Page 3. Push P2_End to stack. Stack: [P1_End, P2_End]. Query startAfter(P2_End).
                // Click Prev -> Want Page 2. Query startAfter(P1_End). 

                currentPage--;
                const startAfterDoc = currentPage === 1 ? null : pageStack[currentPage - 2];

                if (startAfterDoc) {
                    q = query(salesRef, orderBy("createdAt", "desc"), startAfter(startAfterDoc), limit(ITEMS_PER_PAGE));
                } else {
                    q = query(salesRef, orderBy("createdAt", "desc"), limit(ITEMS_PER_PAGE));
                }
            } else {
                loadSales('first');
                return;
            }
        }

        // Search override
        if (searchInput && searchInput.value.trim()) {
            // Client-side search for simplicity OR partial Phone search
            // Since "sales" doesn't have simple text search, let's keep it simple: 
            // Note: Efficient search on sales requires composite indexes.
            // For now, load latest and allow client filter? No, standard is query.
            // Let's rely on standard Load for now. Search is heavy.
        }

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            salesTableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">لا توجد مبيعات</td></tr>';
            updatePaginationControls(true);
            return;
        }

        const docs = querySnapshot.docs;
        lastVisibleDoc = docs[docs.length - 1];

        if (direction === 'next') {
            // Push the doc that STARTS this new page? No, the doc that ENDED the previous page.
            // When we clicked next, we used the OLD lastVisibleDoc. catch it?
            // Correct Stack Logic: 
            // Stack stores the "Cursor" used to fetch a page.
            // Page 1 cursor: null.
            // Page 2 cursor: P1_End.
        }

        let html = '';
        salesDataStore = {};

        docs.forEach(docSnap => {
            const data = docSnap.data();
            salesDataStore[docSnap.id] = data;

            const date = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';
            const itemCount = data.items ? data.items.length : 0;
            const total = Number(data.totalAmount).toLocaleString();

            html += `
            <tr onclick="window.viewSaleDetails('${docSnap.id}')" style="cursor: pointer;">
                <td class="ps-4">${date}</td>
                <td>
                    <div class="fw-bold">${data.customerName || 'عميل'}</div>
                    <small class="text-muted" dir="ltr">${data.customerPhone || ''}</small>
                </td>
                <td><span class="badge bg-light text-dark border">${itemCount} أصناف</span></td>
                <td class="fw-bold text-success">${total} ج.م</td>
                <td>
                    <div class="fw-bold small">${data.user || '-'}</div>
                    <small class="text-muted">${data.branchName || '-'}</small>
                </td>
                <td><button class="btn btn-sm btn-outline-primary"><i class="bi bi-eye"></i></button></td>
            </tr>
            `;
        });

        salesTableBody.innerHTML = html;
        if (pageInfo) pageInfo.innerText = `صفحة ${currentPage}`;

        updatePaginationControls(docs.length < ITEMS_PER_PAGE);

    } catch (error) {
        console.error("Load Sales Error:", error);
        salesTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">خطأ: ${error.message}</td></tr>`;
    }
}

// Pagination Event Listeners
if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
        pageStack.push(lastVisibleDoc);
        currentPage++;
        loadSales('next');
    });
}
if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
        // Decrement is handled in loadSales logic
        loadSales('prev');
    });
}

function updatePaginationControls(isLastPage) {
    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
    if (nextPageBtn) nextPageBtn.disabled = isLastPage;
}

// View Details
window.viewSaleDetails = function (id) {
    const data = salesDataStore[id];
    if (!data) return;

    detailCustomerName.innerText = data.customerName || '-';
    detailCustomerPhone.innerText = data.customerPhone || '-';
    detailDate.innerText = data.createdAt ? data.createdAt.toDate().toLocaleString('ar-EG') : '-';
    detailTotalAmount.innerText = Number(data.totalAmount).toLocaleString() + ' ج.م';

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

// Search (Basic Client Filter for loaded page - optional)
if (searchInput) {
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            // Implement server search later
            loadSales('first');
        }
    });
}
