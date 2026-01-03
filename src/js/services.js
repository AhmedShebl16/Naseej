import { db } from "./firebase-config.js";
import { collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where, orderBy, Timestamp, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === State ===
window.currentType = 'tailoring'; // Default tab
let servicesCache = []; // Only for current page
let lastVisibleDoc = null;
let pageStack = []; // To handle 'Previous' button
let currentPage = 1;
const ITEMS_PER_PAGE = 10;

// === DOM Elements ===
const tableBody = document.getElementById('servicesTableBody');
const addForm = document.getElementById('addServiceForm');
const editForm = document.getElementById('editServiceForm');
const addModal = new bootstrap.Modal(document.getElementById('addServiceModal'));
const editModal = new bootstrap.Modal(document.getElementById('editServiceModal'));

// Pagination DOM
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const pageInfo = document.getElementById('pageInfo');

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
    loadServices('first');

    // Auto-select type in Add Modal based on current tab
    document.getElementById('addServiceModal').addEventListener('show.bs.modal', () => {
        document.getElementById('serviceType').value = window.currentType;
    });
});

// === Load Services (Paginated & Filtered) ===
// direction: 'first', 'next', 'prev'
async function loadServices(direction = 'first') {
    try {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center py-5"><span class="spinner-border text-primary"></span></td></tr>';

        const servicesRef = collection(db, "services");
        let q;

        // Base constraints: Filter by Type + Order by CreatedAt
        // Note: Firestore requires an index for this combination (type + createdAt).
        // If index is missing, it will throw an error with a link to create it.

        if (direction === 'first') {
            q = query(
                servicesRef,
                where("type", "==", window.currentType),
                orderBy("createdAt", "desc"),
                limit(ITEMS_PER_PAGE)
            );
            currentPage = 1;
            pageStack = [];
        } else if (direction === 'next') {
            q = query(
                servicesRef,
                where("type", "==", window.currentType),
                orderBy("createdAt", "desc"),
                startAfter(lastVisibleDoc),
                limit(ITEMS_PER_PAGE)
            );
        } else if (direction === 'prev') {
            // "Prev" is tricky with cursors. We rely on pageStack.
            // Pop the current page start to go back?
            // Simplified logic: Reset to first for now or implement full stack navigation.
            // Let's implement stack popping if we saved it correctly.

            // If we are on Page 2 (Stack has P1_LastDoc), we want query(startAfter(null? no, from beginning?))
            // Actually, best way for 'Prev' in simple cursor pagination is hard without keeping all docs.
            // Let's stick to simple "Stack of LastDocs".

            pageStack.pop(); // Remove current page's start-reference
            // The NEW top of stack is the end of the page BEFORE the previous one.
            // Wait, standard pattern: 
            // P1 -> Stack Empty.
            // Click Next -> Push P1_LastDoc. Query(startAfter(P1_LastDoc)).
            // We are on P2. Stack: [P1_LastDoc].
            // Click Prev -> We want P1. Pop P1_LastDoc. Stack Empty. Query(startAfter(null) i.e. First).

            const prevCursor = pageStack[pageStack.length - 1]; // This was the cursor used to load CURRENT page? No.
            // We want the cursor used to load the PREVIOUS page.
            // If Stack has 1 item, we are on Page 2. Pop it -> Empty. Load First.

            currentPage--;

            if (pageStack.length === 0) {
                q = query(
                    servicesRef,
                    where("type", "==", window.currentType),
                    orderBy("createdAt", "desc"),
                    limit(ITEMS_PER_PAGE)
                );
            } else {
                // This logic is slightly flawed for generic n-pages back.
                // Accurate way: Store array of start-docs? 
                // Let's just re-load 'first' if logic gets complex, but let's try pushing properly.
                // Actually, let's keep it robust:
                // If Prev -> just slice the stack?
                // Real simple prev:
                const cursor = pageStack[currentPage - 2]; // If on Pg3, we need cursor for Pg2.
                if (!cursor) {
                    q = query(
                        servicesRef,
                        where("type", "==", window.currentType),
                        orderBy("createdAt", "desc"),
                        limit(ITEMS_PER_PAGE)
                    );
                } else {
                    q = query(
                        servicesRef,
                        where("type", "==", window.currentType),
                        orderBy("createdAt", "desc"),
                        startAfter(cursor),
                        limit(ITEMS_PER_PAGE)
                    );
                }
            }
        }

        const snapshot = await getDocs(q);

        servicesCache = [];
        snapshot.forEach(doc => {
            servicesCache.push({ id: doc.id, ...doc.data() });
        });

        // Update State
        if (!snapshot.empty) {
            lastVisibleDoc = snapshot.docs[snapshot.docs.length - 1];

            if (direction === 'next') {
                // If we successfully loaded next page, the doc we used as cursor (PREVIOUS lastVisible) should be in stack.
                // But we need to have pushed it BEFORE calling load.
                // Let's handle stack in Event Listeners to be cleaner.
            }
        }

        renderTable(snapshot.empty);
        updatePaginationUI(snapshot.size);

    } catch (error) {
        console.error("Error loading services:", error);
        tableBody.innerHTML = `<tr><td colspan="3" class="text-center text-danger">
            خطأ في التحميل: ${error.message}<br>
            <small class="text-muted">ربما تحتاج لإنشاء Index في Firebase Console (type + createdAt)</small>
        </td></tr>`;
    }
}

// === Render Table ===
function renderTable(isEmpty) {
    if (isEmpty && servicesCache.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-4">لا توجد خدمات مضافة في هذا القسم</td></tr>';
        return;
    }

    let html = '';
    servicesCache.forEach(service => {
        html += `
        <tr>
            <td class="ps-4 fw-bold">${service.name}</td>
            <td><span class="badge bg-light text-dark border">${Number(service.price).toLocaleString()} ج.م</span></td>
            <td class="text-end pe-4">
                <button class="btn btn-sm btn-outline-primary me-1" onclick="openEditModal('${service.id}')">
                    <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteService('${service.id}')">
                    <i class="bi bi-trash"></i>
                </button>
            </td>
        </tr>
        `;
    });
    tableBody.innerHTML = html;
}

function updatePaginationUI(count) {
    if (pageInfo) pageInfo.innerText = `صفحة ${currentPage}`;

    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;

    // Disable next if we fetched fewer than limit
    if (nextPageBtn) nextPageBtn.disabled = count < ITEMS_PER_PAGE;
}


// === Tab Switch Logic ===
window.switchTab = function (type, btn) {
    // Update State
    window.currentType = type;

    // Update UI active state
    document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Reset and Load
    lastVisibleDoc = null;
    pageStack = [];
    currentPage = 1;
    loadServices('first');
}

// Remove old listeners
// const tabs = document.querySelectorAll... (Removed)

// === Pagination Listeners ===
if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
        pageStack.push(lastVisibleDoc);
        currentPage++;
        loadServices('next');
    });
}

if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
        // Logic handled inside loadServices('prev') using pageStack
        loadServices('prev');
    });
}


// === Add Service ===
addForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const type = document.getElementById('serviceType').value;
    const name = document.getElementById('serviceName').value;
    const price = Number(document.getElementById('servicePrice').value);

    try {
        await addDoc(collection(db, "services"), {
            type,
            name,
            price,
            createdAt: Timestamp.now()
        });

        addModal.hide();
        addForm.reset();

        // Reload current page/tab
        loadServices('first');

    } catch (error) {
        alert("حدث خطأ أثناء الإضافة: " + error.message);
    }
});

// === Edit Service ===
window.openEditModal = function (id) {
    const service = servicesCache.find(s => s.id === id);
    if (!service) return;

    document.getElementById('editServiceId').value = id;
    document.getElementById('editServiceType').value = service.type;
    document.getElementById('editServiceName').value = service.name;
    document.getElementById('editServicePrice').value = service.price;

    editModal.show();
}

editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('editServiceId').value;
    const name = document.getElementById('editServiceName').value;
    const price = Number(document.getElementById('editServicePrice').value);

    try {
        await updateDoc(doc(db, "services", id), {
            name,
            price,
            updatedAt: Timestamp.now()
        });

        editModal.hide();
        loadServices(currentPage === 1 ? 'first' : 'current'); // Simplified reload
        // Actually simplest is just reload 'first' or keep current state logic complex.
        // Let's reload 'first' to see update.
        loadServices('first');

    } catch (error) {
        alert("حدث خطأ أثناء التعديل: " + error.message);
    }
});

// === Delete Service ===
window.deleteService = async function (id) {
    if (!confirm("هل أنت متأكد من حذف هذه الخدمة؟")) return;

    try {
        await deleteDoc(doc(db, "services", id));
        loadServices('first');
    } catch (error) {
        alert("حدث خطأ أثناء الحذف: " + error.message);
    }
}
