import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, addDoc, doc, setDoc, getDoc, updateDoc, increment, Timestamp, writeBatch, runTransaction } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === State ===
let cart = [];
let currentType = 'tailoring';
let servicesCache = {};
let currentCustomer = null;
let currentBranchId = null;
let currentBranchName = null;
let branchInventory = [];
let tempMaterialsList = []; // For the modal

// === DOM Elements ===
const grid = document.getElementById('servicesGrid');
const cartContainer = document.getElementById('cartItemsContainer');
const cartTotalEl = document.getElementById('cartTotal');
const searchInput = document.getElementById('serviceSearchInput');
const customerPhoneInput = document.getElementById('customerPhone');
const searchCustomerBtn = document.getElementById('searchCustomerBtn');
const customerInfoDiv = document.getElementById('customerInfo');
const custNameSpan = document.getElementById('custName');
const newCustomerInputDiv = document.getElementById('newCustomerInput');
const newCustomerNameInput = document.getElementById('newCustomerName');
const checkoutBtn = document.getElementById('checkoutBtn');
const cashierNameDisplay = document.getElementById('cashierNameDisplay');
const branchSelect = document.getElementById('branchSelect');

// Modal Elements
const materialModal = new bootstrap.Modal(document.getElementById('materialModal'));
const materialSelect = document.getElementById('materialSelect');
const materialQty = document.getElementById('materialQty');
const addMaterialToListBtn = document.getElementById('addMaterialToListBtn');
const selectedMaterialsList = document.getElementById('selectedMaterialsList');
const stockInfo = document.getElementById('stockInfo');
const confirmAddBtn = document.getElementById('confirmAddToCarBtn');

// Toast Elements
const liveToastBtn = document.getElementById('liveToastBtn');
const liveToast = document.getElementById('liveToast');
const toastMessage = document.getElementById('toastMessage');
const toastInstance = new bootstrap.Toast(liveToast);

// === Init ===
document.addEventListener('DOMContentLoaded', async () => {
    cashierNameDisplay.innerText = localStorage.getItem('fullName') || 'Cashier';
    await loadBranches();
    loadServices('tailoring');

    searchInput.addEventListener('input', (e) => filterGrid(e.target.value.toLowerCase()));
    customerPhoneInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchCustomerBtn.click();
    });
});

// === Toast Helper ===
function showToast(msg, type = 'danger') {
    liveToast.classList.remove('bg-danger', 'bg-success', 'bg-primary');
    liveToast.classList.add('bg-' + type);
    toastMessage.innerText = msg;
    toastInstance.show();
}

// === Branch Logic ===
async function loadBranches() {
    try {
        const q = query(collection(db, "branches"));
        const snapshot = await getDocs(q);
        branchSelect.innerHTML = '<option value="" disabled selected>اختر الفرع...</option>';
        snapshot.forEach(doc => {
            const b = doc.data();
            const opt = document.createElement('option');
            opt.value = doc.id;
            opt.text = b.name;
            branchSelect.appendChild(opt);
        });
        const storedBranch = localStorage.getItem('branchId');
        if (storedBranch && snapshot.docs.some(d => d.id === storedBranch)) {
            branchSelect.value = storedBranch;
            handleBranchChange();
        }
        branchSelect.addEventListener('change', handleBranchChange);
    } catch (error) {
        console.error("Error loading branches:", error);
    }
}

async function handleBranchChange() {
    currentBranchId = branchSelect.value;
    currentBranchName = branchSelect.options[branchSelect.selectedIndex].text;
    localStorage.setItem('branchId', currentBranchId);
    localStorage.setItem('branchName', currentBranchName);
    await loadBranchInventory(currentBranchId);
}

async function loadBranchInventory(branchId) {
    try {
        const q = query(
            collection(db, "inventory"),
            where("branchId", "==", branchId),
            where("type", "==", "raw")
        );
        const snapshot = await getDocs(q);
        branchInventory = [];
        snapshot.forEach(doc => {
            branchInventory.push({ id: doc.id, ...doc.data() });
        });
    } catch (error) {
        console.error("Inventory Load Error:", error);
    }
}

// === Tab & Grid Logic ===
window.switchTab = function (type, btn) {
    currentType = type;
    document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadServices(type);
}

async function loadServices(type) {
    grid.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-light"></div></div>';
    if (servicesCache[type]) { renderGrid(servicesCache[type]); return; }
    try {
        const q = query(collection(db, "services"), where("type", "==", type));
        const snapshot = await getDocs(q);
        const services = [];
        snapshot.forEach(doc => services.push({ id: doc.id, ...doc.data() }));
        servicesCache[type] = services;
        renderGrid(services);
    } catch (error) { console.error(error); }
}

function renderGrid(services) {
    grid.innerHTML = '';
    if (services.length === 0) {
        grid.innerHTML = '<div class="col-12 text-center text-muted py-5">لا توجد خدمات متاحة هنا</div>';
        return;
    }

    // Icon Map
    const icons = {
        'tailoring': 'bi-scissors',
        'repair': 'bi-tools',
        'dry_clean': 'bi-droplet'
    };
    const currentIcon = icons[currentType] || 'bi-scissors';

    services.forEach(service => {
        const col = document.createElement('div');
        col.className = 'col-6 col-md-4 col-lg-3';
        col.innerHTML = `
            <div class="card h-100 service-card-modern p-3 d-flex flex-column justify-content-center align-items-center cursor-pointer">
                <i class="bi ${currentIcon} card-icon"></i>
                <h6 class="card-title text-center">${service.name}</h6>
                <div class="card-price">${Number(service.price).toLocaleString()} ج.م</div>
            </div>
        `;
        // Make the whole card clickable
        col.firstElementChild.addEventListener('click', () => openMaterialModal(service));
        grid.appendChild(col);
    });
}

function filterGrid(term) {
    const services = servicesCache[currentType] || [];
    renderGrid(services.filter(s => s.name.toLowerCase().includes(term)));
}

// === Multi-Material Modal Logic ===
let tempService = null;

function openMaterialModal(service) {
    if (!currentBranchId) {
        showToast("برجاء اختيار الفرع أولاً!", "warning");
        branchSelect.focus();
        return;
    }

    tempService = service;
    tempMaterialsList = []; // Reset list

    // Populate Select
    materialSelect.innerHTML = '<option value="" selected>اختر خامة...</option>';
    branchInventory.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.dataset.max = item.quantity;
        opt.dataset.cost = item.cost || 0;
        opt.dataset.name = item.name;
        opt.dataset.unit = item.unit || 'وحدة'; // Default to 'وحدة' if missing
        opt.textContent = `${item.name} (${opt.dataset.unit}) (المتاح: ${item.quantity})`;
        materialSelect.appendChild(opt);
    });

    materialQty.value = 1;
    stockInfo.innerText = "";
    renderMaterialsList();
    materialModal.show();
}

materialSelect.addEventListener('change', () => {
    if (materialSelect.value) {
        const opt = materialSelect.selectedOptions[0];
        stockInfo.innerText = `الحد الأقصى المتاح: ${opt.dataset.max}`;
        materialQty.max = opt.dataset.max;
    } else {
        stockInfo.innerText = "";
    }
});

addMaterialToListBtn.addEventListener('click', () => {
    if (!materialSelect.value) return;

    const qty = Number(materialQty.value);
    const opt = materialSelect.selectedOptions[0];
    const max = Number(opt.dataset.max);

    if (qty <= 0) { showToast("الكمية غير صحيحة", "warning"); return; }
    if (qty > max) { showToast(`الكمية أكبر من المتاح (${max})`, "warning"); return; }

    // Add to temp list
    const newItem = {
        id: materialSelect.value,
        name: opt.dataset.name,
        cost: Number(opt.dataset.cost),
        unit: opt.dataset.unit,
        qty: qty
    };

    // Check if exists?
    const existing = tempMaterialsList.find(i => i.id === newItem.id);
    if (existing) {
        if (existing.qty + qty > max) {
            showToast("الكمية الإجمالية تتجاوز المتاح!", "warning");
            return;
        }
        existing.qty += qty;
    } else {
        tempMaterialsList.push(newItem);
    }

    // Clear Input
    materialSelect.value = "";
    materialQty.value = 1;
    stockInfo.innerText = "";
    renderMaterialsList();
});

function renderMaterialsList() {
    selectedMaterialsList.innerHTML = '';
    if (tempMaterialsList.length === 0) {
        selectedMaterialsList.innerHTML = '<li class="list-group-item bg-dark text-muted small text-center py-2">لم يتم إضافة خامات</li>';
        return;
    }

    tempMaterialsList.forEach((item, index) => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center small';
        li.innerHTML = `
            <span class="fw-bold text-dark">${item.name} <span class="text-muted fw-normal">(${item.qty} ${item.unit || ''})</span></span>
            <button class="btn btn-sm text-danger p-0" onclick="window.removeTempMaterial(${index})"><i class="bi bi-x-circle-fill"></i></button>
        `;
        selectedMaterialsList.appendChild(li);
    });
}
window.removeTempMaterial = (index) => {
    tempMaterialsList.splice(index, 1);
    renderMaterialsList();
};

confirmAddBtn.addEventListener('click', () => {
    if (!tempService) return;
    addToCart(tempService, tempMaterialsList);
    materialModal.hide();
});

// === Cart Logic ===
function addToCart(service, materials) {
    const cartItem = {
        uniqueId: Date.now(),
        serviceId: service.id,
        name: service.name,
        price: service.price,
        qty: 1,
        materials: materials || [] // Array of materials
    };
    cart.push(cartItem);
    renderCart();
}

window.cartMethods = {
    removeFromCart: (uid) => {
        cart = cart.filter(item => item.uniqueId !== uid);
        renderCart();
    },
    updateQty: (uid, change) => {
        const item = cart.find(i => i.uniqueId == uid);
        if (!item) return;

        const newQty = item.qty + change;
        if (newQty <= 0) {
            window.cartMethods.removeFromCart(uid);
            return;
        }

        // Multi-Material Stock Check
        if (change > 0 && item.materials.length > 0) {
            for (const mat of item.materials) {
                const invItem = branchInventory.find(inv => inv.id === mat.id);
                if (invItem) {
                    const totalNeeded = newQty * mat.qty;
                    if (totalNeeded > invItem.quantity) {
                        showToast(`لا رصيد كافي من ${mat.name}!`, "warning");
                        return;
                    }
                }
            }
        }
        item.qty = newQty;
        renderCart();
    }
};

function renderCart() {
    cartContainer.innerHTML = '';
    let total = 0;
    if (cart.length === 0) {
        cartContainer.innerHTML = '<div class="text-center text-muted mt-5 py-5"><i class="bi bi-cart-x display-4 opacity-25"></i><p class="mt-2 small">السلة فارغة</p></div>';
        cartTotalEl.innerText = '0.00';
        return;
    }

    cart.forEach(item => {
        const itemTotal = item.price * item.qty;
        total += itemTotal;

        let matHtml = '';
        if (item.materials && item.materials.length > 0) {
            matHtml = `<div class="mt-1 ps-2 border-start border-primary">`;
            item.materials.forEach(m => {
                matHtml += `<div class="text-muted small" style="font-size:0.75em">• ${m.name}: ${m.qty} <span class="opacity-75">x${item.qty}</span></div>`;
            });
            matHtml += `</div>`;
        }

        const div = document.createElement('div');
        div.className = 'cart-item-modern d-flex justify-content-between align-items-center';
        div.innerHTML = `
            <div style="width: 45%">
                <div class="item-title text-truncate">${item.name}</div>
                ${matHtml}
                <div class="item-price mt-1">${Number(item.price).toLocaleString()} ج.م</div>
            </div>
            
            <div class="qty-control">
                <button class="btn btn-sm btn-link text-dark p-0" onclick="window.cartMethods.updateQty(${item.uniqueId}, -1)"><i class="bi bi-dash"></i></button>
                <span class="fw-bold mx-2" style="font-size:0.9rem">${item.qty}</span>
                <button class="btn btn-sm btn-link text-dark p-0" onclick="window.cartMethods.updateQty(${item.uniqueId}, 1)"><i class="bi bi-plus"></i></button>
            </div>

            <div class="text-end" style="width: 20%">
                <div class="fw-bold text-primary small">${itemTotal.toLocaleString()}</div>
                <button class="btn btn-sm delete-btn p-0 mt-1" onclick="window.cartMethods.removeFromCart(${item.uniqueId})"><i class="bi bi-trash"></i></button>
            </div>
        `;
        cartContainer.appendChild(div);
    });
    cartTotalEl.innerText = total.toLocaleString() + ' ج.م';
}

function normalizePhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/\D/g, '');
    if (cleaned.startsWith('20') && cleaned.length === 12) cleaned = '0' + cleaned.substring(2);
    else if (cleaned.startsWith('1') && cleaned.length === 10) cleaned = '0' + cleaned;
    return cleaned;
}

searchCustomerBtn.addEventListener('click', async () => {
    const rawPhone = customerPhoneInput.value.trim();
    if (!rawPhone) return;
    const phone = normalizePhone(rawPhone);
    customerPhoneInput.value = phone;
    try {
        const docRef = doc(db, "customers", phone);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            currentCustomer = { id: docSnap.id, ...docSnap.data() };
            customerInfoDiv.style.display = 'block';
            custNameSpan.innerText = currentCustomer.name;
            newCustomerInputDiv.style.display = 'none';
        } else {
            currentCustomer = null;
            customerInfoDiv.style.display = 'none';
            newCustomerInputDiv.style.display = 'block';
            newCustomerNameInput.focus();
        }
    } catch (error) { console.error(error); showToast("خطأ في البحث"); }
});

// === Checkout Button (Opens Modal) ===
checkoutBtn.addEventListener('click', () => {
    if (cart.length === 0) {
        showToast("السلة فارغة!");
        return;
    }
    if (!currentBranchId) {
        showToast("خطأ: لم يتم تحديد الفرع.");
        return;
    }

    const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    document.getElementById('checkoutTotalDisplay').value = total.toLocaleString();
    document.getElementById('amountPaidInput').value = '';
    document.getElementById('remainingAmountDisplay').value = total.toLocaleString();
    document.getElementById('deliveryDateInput').value = '';
    document.getElementById('deliveryTimeInput').value = '';

    const modal = new bootstrap.Modal(document.getElementById('checkoutDetailsModal'));
    modal.show();
});

// Update Remaining on Input
document.getElementById('amountPaidInput').addEventListener('input', (e) => {
    const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const paid = parseFloat(e.target.value) || 0;
    const remaining = total - paid;
    document.getElementById('remainingAmountDisplay').value = remaining.toLocaleString();
});

// === Confirm Checkout & Save ===
document.getElementById('confirmCheckoutBtn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('confirmCheckoutBtn');

    // Validate
    let customerName = '';
    let customerId = '';
    const phone = normalizePhone(customerPhoneInput.value.trim());

    if (!currentCustomer) {
        if (!phone || phone.length < 10) { showToast("رقم الهاتف غير صحيح", "warning"); return; }
        customerName = newCustomerNameInput.value.trim();
        if (!customerName) { showToast("أدخل اسم العميل", "warning"); return; }
        customerId = phone;
    } else {
        customerId = currentCustomer.id;
        customerName = currentCustomer.name;
    }

    const deliveryDate = document.getElementById('deliveryDateInput').value;
    const deliveryTime = document.getElementById('deliveryTimeInput').value;

    if (!deliveryDate) {
        alert('تاريخ التسليم مطلوب!');
        return;
    }

    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري الحفظ...';

    // === TRANSACTION START ===
    try {
        await runTransaction(db, async (transaction) => {
            // 1. Generate Custom Order ID
            const now = new Date();
            const dd = String(now.getDate()).padStart(2, '0');
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const yyyy = now.getFullYear();
            const dateStr = `${dd}${mm}${yyyy}`; // 03012026

            const counterRef = doc(db, "counters", "sales_" + dateStr);
            const counterSnap = await transaction.get(counterRef);

            let newCount = 1;
            if (counterSnap.exists()) {
                newCount = counterSnap.data().count + 1;
            }
            transaction.set(counterRef, { count: newCount }, { merge: true });

            const orderId = `${dateStr}${String(newCount).padStart(3, '0')}`; // 03012026001

            // 2. Calculations
            const total = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
            const paid = parseFloat(document.getElementById('amountPaidInput').value) || 0;

            // 3. Deduct Materials (Inventory)
            let totalCost = 0;
            for (const item of cart) {
                if (item.materials && item.materials.length > 0) {
                    for (const mat of item.materials) {
                        const totalMatQty = item.qty * mat.qty;
                        const matRef = doc(db, "inventory", mat.id);
                        transaction.update(matRef, { quantity: increment(-totalMatQty) });
                        totalCost += (mat.cost || 0) * totalMatQty;
                    }
                }
            }

            // 4. Update/Create Customer
            const custRef = doc(db, "customers", customerId);
            if (!currentCustomer) {
                transaction.set(custRef, {
                    name: customerName,
                    phone: customerId,
                    totalSpent: total,
                    orderCount: 1,
                    lastOrderDate: Timestamp.now(),
                    createdAt: Timestamp.now()
                });
            } else {
                transaction.update(custRef, {
                    totalSpent: increment(total),
                    orderCount: increment(1),
                    lastOrderDate: Timestamp.now()
                });
            }

            // 5. Create Sale Record with Custom ID
            const saleRef = doc(db, "sales", orderId); // Use Custom ID as Doc ID
            const user = localStorage.getItem('username') || 'Unknown';

            const saleData = {
                orderId: orderId, // Explicit Field
                customerName: customerName,
                customerPhone: customerId,
                items: cart.map(i => ({
                    id: i.serviceId,
                    name: i.name,
                    price: i.price,
                    qty: i.qty,
                    type: 'service',
                    usedMaterials: i.materials ? i.materials.map(m => ({
                        id: m.id,
                        name: m.name,
                        qtyPerUnit: m.qty,
                        unit: m.unit || ''
                    })) : []
                })),
                totalAmount: total,
                amountPaid: paid,
                remainingAmount: total - paid,
                deliveryDate: deliveryDate,
                deliveryTime: deliveryTime || null,
                type: 'service',
                serviceType: currentType, // 'tailoring', 'repair', or 'dry_clean'
                status: 'received',
                branchId: currentBranchId,
                branchName: currentBranchName,
                user: user,
                createdAt: Timestamp.now()
            };
            transaction.set(saleRef, saleData);

            // 6. Update Daily Stats
            const todayIso = now.toISOString().split('T')[0];
            const dailyStatsRef = doc(db, "daily_stats", todayIso);
            transaction.set(dailyStatsRef, {
                date: todayIso,
                totalSales: increment(total),
                totalCost: increment(totalCost),
                orderCount: increment(1),
                updatedAt: Timestamp.now()
            }, { merge: true });
        });



        showToast('تم حفظ الطلب بنجاح!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('checkoutDetailsModal')).hide();

        // 5. Reset UI
        cart = [];
        renderCart();
        customerPhoneInput.value = '';
        customerInfoDiv.style.display = 'none';
        newCustomerInputDiv.style.display = 'none';
        newCustomerNameInput.value = '';
        currentCustomer = null;

    } catch (error) {
        console.error("Checkout Error:", error);
        showToast('حدث خطأ أثناء الحفظ: ' + error.message, 'danger');
    } finally {
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="bi bi-save me-2"></i> تأكيد وحفظ الطلب';
    }
});

