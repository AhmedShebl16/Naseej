import { db } from "./firebase-config.js";
window.inventoryStore = {};
import { collection, addDoc, getDocs, query, where, Timestamp, deleteDoc, doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const tableBody = document.getElementById('inventory-table-body');
const addItemForm = document.getElementById('addItemForm');
const editItemForm = document.getElementById('editItemForm');
const totalItemsEl = document.getElementById('total-items');
const totalValueEl = document.getElementById('total-value');
const lowStockEl = document.getElementById('low-stock-count');

// --- Branch Selectors ---
const itemBranchSelect = document.getElementById('itemBranch');
const editItemBranchSelect = document.getElementById('editItemBranch');
const transferToBranchSelect = document.getElementById('transferToBranch');
const transferForm = document.getElementById('transferForm');

// === Load Inventory ===
async function loadInventory() {
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="7" class="text-center">جاري التحميل...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "inventory"));

        let html = '';
        let totalCount = 0;
        let totalVal = 0;
        let lowStock = 0;

        // Fetch all branches first for lookup (or cache them)
        const branchesSnap = await getDocs(collection(db, "branches"));
        const branchMap = {};
        branchesSnap.forEach(b => branchMap[b.id] = b.data().name);

        // Populate branch dropdowns
        populateBranchDropdowns(branchesSnap);

        querySnapshot.forEach((docSnapshot) => {
            const data = docSnapshot.data();
            const id = docSnapshot.id;
            const isLow = data.quantity <= (data.minQuantity || 0);

            // Store for reuse
            window.inventoryStore[id] = { id, ...data };

            if (isLow) lowStock++;
            totalCount += parseInt(data.quantity || 0);
            totalVal += (parseInt(data.quantity || 0) * parseFloat(data.cost || 0));

            html += `
                <tr class="${isLow ? 'table-danger' : ''}">
                    <td><small>${data.barcode || id.substr(0, 5)}</small></td>
                    <td>${data.name}</td>
                    <td>
                        ${data.type === 'raw' ? '<span class="badge bg-secondary">خام</span>' : '<span class="badge bg-success">منتج تام</span>'}
                        <small class="d-block text-muted">${data.unit || ''}</small>
                    </td>
                    <td><small class="text-muted">${data.color || '-'}</small></td>
                    <td><span class="badge bg-light text-dark border">${data.branchName || '-'}</span></td>
                    <td class="fw-bold">${data.quantity}</td>
                    <td>${data.minQuantity || 0}</td>
                    <td>${data.cost} ج.م</td>
                    <td>
                        <div class="btn-group" dir="ltr">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteItem('${id}')" title="حذف"><i class="bi bi-trash"></i></button>
                            <button class="btn btn-sm btn-outline-info" onclick="openEditModal('${id}')" title="تعديل"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-primary" onclick="printBarcode('${data.barcode}')" title="طباعة"><i class="bi bi-printer"></i></button>
                            <button class="btn btn-sm btn-outline-warning" onclick="openTransferModal('${id}')" title="تحويل"><i class="bi bi-arrow-left-right"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html || '<tr><td colspan="8" class="text-center">لا توجد أصناف</td></tr>';

        // Update Stats
        if (totalItemsEl) totalItemsEl.innerText = totalCount;
        if (totalValueEl) totalValueEl.innerText = totalVal.toLocaleString() + ' ج.م';
        if (lowStockEl) lowStockEl.innerText = lowStock;

    } catch (error) {
        console.error("Error loading inventory:", error);
        if (tableBody) tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">خطأ في تحميل البيانات</td></tr>';
    }
}

function populateBranchDropdowns(branchesSnap) {
    let options = '<option value="" disabled selected>اختر الفرع...</option>';
    branchesSnap.forEach(doc => {
        options += `<option value="${doc.id}">${doc.data().name}</option>`;
    });
    if (itemBranchSelect) itemBranchSelect.innerHTML = options;
    if (editItemBranchSelect) editItemBranchSelect.innerHTML = options;

    // For transfer, usually we exclude the current branch but simpler to just show all for now or filter in JS
    if (transferToBranchSelect) transferToBranchSelect.innerHTML = options;
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
                    alert('تم تحديث الكمية بنجاح!');
                } else {
                    await createNewBatch(name, type, unit, qty, minQty, cost, color, branchId, branchName);
                }
            } else {
                await createNewBatch(name, type, unit, qty, minQty, cost, color, branchId, branchName);
            }

            bootstrap.Modal.getInstance(document.getElementById('addItemModal')).hide();
            addItemForm.reset();
            await loadInventory();

        } catch (e) {
            console.error("Error adding document: ", e);
            alert('حدث خطأ أثناء الإضافة');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

async function createNewBatch(name, type, unit, qty, minQty, cost, color, branchId, branchName) {
    const barcode = await generateDailyBarcode();
    await addDoc(collection(db, "inventory"), {
        name, type, unit, color: color || '', quantity: qty, minQuantity: minQty, cost, barcode,
        branchId, branchName,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now()
    });
    alert(`تمت الإضافة بنجاح! الباركود: ${barcode}`);
    if (confirm('هل تريد طباعة الباركود الآن؟')) {
        printBarcode(barcode);
    }
}

// === Delete Item ===
window.deleteItem = async function (id) {
    if (confirm('هل أنت متأكد من حذف هذا الصنف نهائياً؟')) {
        try {
            await deleteDoc(doc(db, "inventory", id));
            await loadInventory();
        } catch (e) {
            console.error("Delete Error:", e);
            alert('خطأ أثناء الحذف');
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

    const editModal = new bootstrap.Modal(document.getElementById('editItemModal'));
    editModal.show();
}

if (editItemForm) {
    editItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editItemId').value;
        const submitBtn = document.getElementById('editSubmitBtn');
        submitBtn.disabled = true;

        const updatedData = {
            branchId: document.getElementById('editItemBranch').value,
            branchName: document.getElementById('editItemBranch').options[document.getElementById('editItemBranch').selectedIndex].text,
            name: document.getElementById('editItemName').value,
            type: document.getElementById('editItemType').value,
            unit: document.getElementById('editItemUnit').value,
            color: document.getElementById('editItemColor').value,
            quantity: parseInt(document.getElementById('editItemQty').value),
            minQuantity: parseInt(document.getElementById('editItemMinQty').value),
            cost: parseFloat(document.getElementById('editItemCost').value),
            updatedAt: Timestamp.now()
        };

        try {
            await updateDoc(doc(db, "inventory", id), updatedData);
            bootstrap.Modal.getInstance(document.getElementById('editItemModal')).hide();
            await loadInventory();
            alert('تم التعديل بنجاح');
        } catch (e) {
            console.error("Update Error:", e);
            alert('خطأ أثناء التحديث');
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
        alert("المنتج غير موجود!");
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
            alert('الكمية المطلوبة أكبر من الرصيد المتاح!');
            return;
        }
        if (toBranchId === currentItemForTransfer.branchId) {
            alert('لا يمكن التحويل لنفس الفرع!');
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

            alert('تم التحويل بنجاح!');
            bootstrap.Modal.getInstance(document.getElementById('transferModal')).hide();
            await loadInventory();

        } catch (error) {
            console.error("Transfer Full Error:", error);
            alert('حدث خطأ أثناء عملية التحويل: ' + error.message);
        } finally {
            submitBtn.disabled = false;
        }
    });
}

loadInventory();
