import { db } from "./firebase-config.js";
import { collection, getDocs, query, where, doc, getDoc, setDoc, addDoc, updateDoc, increment, writeBatch, Timestamp, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const productGrid = document.getElementById('products-grid');
const cartItemsBody = document.getElementById('cart-items-body');
const cartCountEl = document.getElementById('cart-count');
const cartTotalEl = document.getElementById('cart-total');
const checkoutBtn = document.getElementById('checkoutBtn');
const searchInput = document.getElementById('posSearchInput');

// Customer DOM
const customerPhoneInput = document.getElementById('customerPhone');
const customerNameInput = document.getElementById('customerName');
const clearCustomerBtn = document.getElementById('clearCustomerBtn');

// === State ===
let allProducts = []; // Local cache of finished products
let cart = []; // Array of { id, name, price, qty, stock }
let currentCustomer = null; // { phone, name, isNew } or null
let currentUser = {
    username: localStorage.getItem('username') || 'Unknown',
    role: localStorage.getItem('userRole') || 'guest',
    branchId: localStorage.getItem('branchId') || '',
    branchName: localStorage.getItem('branchName') || ''
};

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
    applyCashierMode();
    await loadBranchesIfNeeded(); // For Admin
    loadProducts();
});

function applyCashierMode() {
    if (currentUser.role === 'cashier') {
        const sidebar = document.querySelector('.sidebar');
        const layout = document.querySelector('.pos-layout');

        if (sidebar) sidebar.style.display = 'none';
        if (layout) layout.style.marginRight = '0'; // Full width
    }
}

async function loadBranchesIfNeeded() {
    // If Admin, render a branch selector in the header
    if (currentUser.role === 'admin' || currentUser.role === 'manager') { // Adjust roles as needed
        const headerContainer = document.querySelector('.product-grid-area .d-flex.justify-content-between div:first-child');

        // Create Select
        const select = document.createElement('select');
        select.className = "form-select form-select-sm mt-1";
        select.id = "branchSelector";
        select.style.maxWidth = "200px";

        // Load Branches
        try {
            const snap = await getDocs(collection(db, "branches"));
            let options = `<option value="">كل الفروع / المخزن الرئيسي</option>`;
            snap.forEach(doc => {
                const b = doc.data();
                options += `<option value="${doc.id}" ${doc.id === currentUser.branchId ? 'selected' : ''}>${b.name}</option>`;
            });
            select.innerHTML = options;

            // Append
            headerContainer.appendChild(select);

            // Listener
            select.addEventListener('change', (e) => {
                currentUser.branchId = e.target.value;
                currentUser.branchName = e.target.options[e.target.selectedIndex].text;
                // Reload products if filtered by branch? 
                // Currently loadProducts loads ALL finished. 
                // If we want to filter inventory by branch, we need to update loadProducts logic.
                // For now, let's assume specific branch inventory logic isn't strictly enforced on READ yet, 
                // but we tag the SALE with this branch.
            });

        } catch (e) {
            console.error("Branch Load Error", e);
        }
    }
}

// === Load Products ===
async function loadProducts() {
    // ... existing loadProducts code ...
    try {
        productGrid.innerHTML = `
        <div class="col-12 text-center py-5">
            <div class="spinner-border text-primary" role="status"></div>
            <p>جاري تحميل المنتجات...</p>
        </div>`;

        // Fetch ONLY finished products (type == 'finished')
        const q = query(collection(db, "inventory"), where("type", "==", "finished"));
        const querySnapshot = await getDocs(q);

        allProducts = [];
        querySnapshot.forEach(docSnap => {
            const data = docSnap.data();
            // Basic validation
            if (data.quantity > 0) { // Only show in-stock items? Or show 0 stock but disabled?
                allProducts.push({
                    id: docSnap.id,
                    name: data.name,
                    price: Number(data.sellingPrice) || 0,
                    cost: Number(data.cost) || 0,
                    quantity: Number(data.quantity) || 0,
                    barcode: data.barcode || ''
                });
            }
        });

        renderProducts(allProducts);

    } catch (error) {
        console.error("Load POS Error:", error);
        productGrid.innerHTML = `<div class="alert alert-danger">فشل تحميل المنتجات: ${error.message}</div>`;
    }
}

function renderProducts(products) {
    if (products.length === 0) {
        productGrid.innerHTML = '<div class="col-12 text-center text-muted">لا توجد منتجات متاحة</div>';
        return;
    }

    productGrid.innerHTML = products.map(product => `
        <div class="col-md-4 col-lg-3">
            <div class="card product-card h-100" onclick="addToCart('${product.id}')">
                <div class="card-body text-center d-flex flex-column justify-content-between">
                    <span class="badge bg-${product.quantity < 5 ? 'danger' : 'success'} stock-badge">
                        ${product.quantity} متاح
                    </span>
                    
                    <div class="mb-2">
                         <i class="bi bi-box-seam display-4 text-secondary opacity-25"></i>
                    </div>

                    <h6 class="card-title fw-bold mb-2 text-truncate" title="${product.name}">${product.name}</h6>
                    
                    <div class="mt-auto">
                        <h5 class="product-price mb-0">${product.price.toLocaleString()} ج.م</h5>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

// === Search Filter ===
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (!term) {
            renderProducts(allProducts);
            return;
        }

        const filtered = allProducts.filter(p =>
            p.name.toLowerCase().includes(term) ||
            (p.barcode && p.barcode.includes(term))
        );
        renderProducts(filtered);
    });
}

// === Cart Logic ===
window.addToCart = function (productId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;

    // Check stock
    const cartItem = cart.find(item => item.id === productId);
    const currentQty = cartItem ? cartItem.qty : 0;

    if (currentQty + 1 > product.quantity) {
        showToast('لا توجد كمية كافية في المخزون', 'warning');
        return;
    }

    if (cartItem) {
        cartItem.qty++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            cost: product.cost,
            maxStock: product.quantity,
            qty: 1
        });
    }

    updateCartUI();
};

window.removeFromCart = function (productId) {
    cart = cart.filter(item => item.id !== productId);
    updateCartUI();
};

window.updateQty = function (productId, delta) {
    const item = cart.find(i => i.id === productId);
    if (!item) return;

    const newQty = item.qty + delta;
    if (newQty <= 0) {
        removeFromCart(productId);
    } else if (newQty > item.maxStock) {
        showToast('الكمية المطلوبة أكبر من المتاح', 'warning');
    } else {
        item.qty = newQty;
        updateCartUI();
    }
};

function updateCartUI() {
    // Render Items
    if (cart.length === 0) {
        cartItemsBody.innerHTML = `
            <div class="text-center text-muted py-5">
                <i class="bi bi-basket3 display-1 opacity-25"></i>
                <p class="mt-2">السلة فارغة</p>
            </div>`;
        checkoutBtn.disabled = true;
        cartCountEl.innerText = '0';
        cartTotalEl.innerText = '0.00 ج.م';
        return;
    }

    let total = 0;
    cartItemsBody.innerHTML = cart.map(item => {
        total += item.price * item.qty;
        return `
        <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
            <div>
                <h6 class="mb-0 fw-bold">${item.name}</h6>
                <small class="text-muted">${item.price} ج.م × ${item.qty}</small>
            </div>
            <div class="d-flex align-items-center gap-2">
                <button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="updateQty('${item.id}', -1)">-</button>
                <span class="fw-bold">${item.qty}</span>
                <button class="btn btn-sm btn-outline-success py-0 px-2" onclick="updateQty('${item.id}', 1)">+</button>
            </div>
        </div>
        `;
    }).join('');

    cartCountEl.innerText = cart.length;
    cartTotalEl.innerText = total.toLocaleString() + ' ج.م';
    checkoutBtn.disabled = false;
}

// === Customer Logic (Phone Lookup) ===
if (customerPhoneInput) {
    // Trigger on Blur or Enter
    customerPhoneInput.addEventListener('change', async (e) => {
        const phone = e.target.value.trim();
        if (phone.length < 10) return; // Basic validation

        customerPhoneInput.disabled = true; // Lock while searching

        try {
            const docRef = doc(db, "customers", phone);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                // Found!
                const data = docSnap.data();
                customerNameInput.value = data.name;
                customerNameInput.disabled = true; // Lock Name (it's existing)
                showToast(`أهلاً بك، ${data.name}`, 'success');
                currentCustomer = { phone, name: data.name, isNew: false };
            } else {
                // Not Found - New Customer
                customerNameInput.value = "";
                customerNameInput.disabled = false; // Unlock Name for entry
                customerNameInput.focus();
                showToast('عميل جديد - يرجى إدخال الاسم', 'info');
                currentCustomer = { phone, name: '', isNew: true };
            }
        } catch (err) {
            console.error(err);
            customerPhoneInput.disabled = false;
        }
    });
}

if (clearCustomerBtn) {
    clearCustomerBtn.addEventListener('click', () => {
        customerPhoneInput.value = '';
        customerNameInput.value = '';
        customerPhoneInput.disabled = false;
        customerNameInput.disabled = true; // Lock name until phone is checked
        currentCustomer = null;
    });
}

// === Checkout Logic ===
if (checkoutBtn) {
    checkoutBtn.addEventListener('click', async () => {
        if (cart.length === 0) return;

        // 1. Validate Customer
        if (!currentCustomer && customerPhoneInput.value) {
            // Case: User typed phone but didn't trigger 'change' (e.g. focused out directly to checkout)
            // We should enforce validation? For now, allow proceed as "Walk-in" if blank?
            // Requirement says: "User enter number... if not db will set name".
            // Let's assume customer is mandatory if phone is present.
            // If phone is empty, it's a "Walk-in Client" (generic).
        }

        // Handle Walk-in logic
        let saleCustomer = null;
        if (currentCustomer) {
            // Updated name from input if new
            if (currentCustomer.isNew) {
                const nameIn = customerNameInput.value.trim();
                if (!nameIn) {
                    showToast('يرجى إدخال اسم العميل الجديد', 'danger');
                    customerNameInput.focus();
                    return;
                }
                currentCustomer.name = nameIn;
            }
            saleCustomer = currentCustomer;
        } else {
            // Walk-in
            saleCustomer = { name: "عميل نقدي", phone: "Walk-in" };
        }

        if (!confirm(`إتمام البيع بمبلغ ${cartTotalEl.innerText}؟`)) return;

        checkoutBtn.disabled = true;
        checkoutBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري المعالجة...';

        try {
            const batch = writeBatch(db);

            // 2. Handle Customer (Upsert) - Zero-Read Strategy
            if (saleCustomer.phone !== "Walk-in") {
                const custRef = doc(db, "customers", saleCustomer.phone);

                const customerData = {
                    name: saleCustomer.name,
                    phone: saleCustomer.phone,
                    updatedAt: Timestamp.now()
                };

                if (saleCustomer.isNew) {
                    customerData.createdAt = Timestamp.now();
                }

                batch.set(custRef, customerData, { merge: true });

                if (currentCustomer && currentCustomer.isNew) {
                    const statsRef = doc(db, "stats", "general");
                    batch.update(statsRef, { customersCount: increment(1) });
                }
            }

            // 3. Create Sale Record
            const saleRef = doc(collection(db, "sales"));
            const totalAmount = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

            batch.set(saleRef, {
                customerName: saleCustomer.name,
                customerPhone: saleCustomer.phone,
                items: cart, // {id, name, qty, price, cost}
                totalAmount: totalAmount,
                createdAt: Timestamp.now(),
                user: currentUser.username,
                branchId: currentUser.branchId,
                branchName: currentUser.branchName
            });

            // 4. Update Inventory (Decrement Stock)
            cart.forEach(item => {
                const itemRef = doc(db, "inventory", item.id);
                batch.update(itemRef, {
                    quantity: increment(-item.qty)
                });
            });

            // 5. Commit
            await batch.commit();

            showToast('تمت عملية البيع بنجاح!', 'success');

            // Reset
            cart = [];
            updateCartUI();
            clearCustomerBtn.click(); // Reset customer inputs
            await loadProducts(); // Reload stock

        } catch (error) {
            console.error("Checkout Error:", error);
            showToast('حدث خطأ أثناء البيع: ' + error.message, 'danger');
        } finally {
            checkoutBtn.disabled = false;
            checkoutBtn.innerHTML = '<i class="bi bi-credit-card-2-front"></i> إتمام البيع';
        }
    });
}

// === Toast Helper ===
function showToast(message, type = 'success') {
    const toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
        // Create if missing (reuse from other pages)
        const container = document.createElement('div');
        container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
        container.style.zIndex = '1090';
        document.body.appendChild(container);
    }

    // ... Implement simple toast logic or assume existing global? 
    // Since this is a module, I'll assume I need to inject simple toast HTML
    const toastHtml = `
    <div class="toast align-items-center text-white bg-${type} border-0 show" role="alert" aria-live="assertive" aria-atomic="true">
        <div class="d-flex">
            <div class="toast-body">
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    </div>`;

    document.querySelector('.toast-container').insertAdjacentHTML('beforeend', toastHtml);
    // Auto remove
    setTimeout(() => {
        const toasts = document.querySelectorAll('.toast');
        if (toasts.length > 0) toasts[0].remove();
    }, 3000);
}
