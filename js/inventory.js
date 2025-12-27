import { db } from "./firebase-config.js";
import { collection, addDoc, getDocs, query, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const tableBody = document.getElementById('inventory-table-body');
const addItemForm = document.getElementById('addItemForm');
const totalItemsEl = document.getElementById('total-items');
const totalValueEl = document.getElementById('total-value');
const lowStockEl = document.getElementById('low-stock-count');

// === Load Inventory ===
async function loadInventory() {
    tableBody.innerHTML = '<tr><td colspan="7" class="text-center">جاري التحميل...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "inventory"));

        let html = '';
        let totalCount = 0;
        let totalVal = 0;
        let lowStock = 0;

        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const isLow = data.quantity <= data.minQuantity;

            if (isLow) lowStock++;
            totalCount += parseInt(data.quantity);
            totalVal += (parseInt(data.quantity) * parseFloat(data.cost));

            // Generate Barcode SVG string if needed, or just show text
            // Format: DDMMYYYY + ID (We show data.barcode if exists)

            html += `
                <tr class="${isLow ? 'table-danger' : ''}">
                    <td>${data.barcode || doc.id.substr(0, 5)}</td>
                    <td>${data.name}</td>
                    <td>
                        ${data.type === 'raw' ? '<span class="badge bg-secondary">خام</span>' : '<span class="badge bg-success">منتج تام</span>'}
                        <small class="d-block text-muted">${data.unit || ''}</small>
                    </td>
                    <td>${data.quantity}</td>
                    <td>${data.minQuantity}</td>
                    <td>${data.cost} ج.م</td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="printBarcode('${data.barcode}')"><i class="bi bi-upc-scan"></i></button>
                    </td>
                </tr>
            `;
        });

        tableBody.innerHTML = html || '<tr><td colspan="7" class="text-center">لا توجد أصناف</td></tr>';

        // Update Stats
        totalItemsEl.innerText = totalCount;
        totalValueEl.innerText = totalVal.toLocaleString() + ' ج.م';
        lowStockEl.innerText = lowStock;

    } catch (error) {
        console.error("Error loading inventory:", error);
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center text-danger">خطأ في تحميل البيانات</td></tr>';
    }
}

// === Helper: Generate Barcode ===
async function generateDailyBarcode() {
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const yyyy = today.getFullYear();

    // Start of day timestamp
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // Query items created today to determine ID
    const q = query(
        collection(db, "inventory"),
        where("createdAt", ">=", Timestamp.fromDate(startOfDay)),
        where("createdAt", "<=", Timestamp.fromDate(endOfDay))
    );

    const snapshot = await getDocs(q);
    const count = snapshot.size + 1;
    const countStr = String(count).padStart(3, '0'); // 001, 002, etc.

    return `${dd}${mm}${yyyy}${countStr}`;
}

// === Add New Item ===
if (addItemForm) {
    addItemForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('itemName').value;
        const type = document.getElementById('itemType').value;
        const unit = document.getElementById('itemUnit').value;
        const qty = parseInt(document.getElementById('itemQty').value);
        const minQty = parseInt(document.getElementById('itemMinQty').value);
        const cost = parseFloat(document.getElementById('itemCost').value);

        try {
            const barcode = await generateDailyBarcode();

            await addDoc(collection(db, "inventory"), {
                name: name,
                type: type,
                unit: unit,
                quantity: qty,
                minQuantity: minQty,
                cost: cost,
                barcode: barcode,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });

            alert(`تمت الإضافة بنجاح! الباركود: ${barcode}`);

            // 1. Close Modal
            const modalEl = document.getElementById('addItemModal');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) {
                modalInstance.hide();
            }

            // 2. Reset Form
            addItemForm.reset();

            // 3. Refresh Inventory List Immediately
            await loadInventory();

            // 4. Ask to print
            if (confirm('هل تريد طباعة الباركود الآن؟')) {
                printBarcode(barcode);
            }

        } catch (e) {
            console.error("Error adding document: ", e);
            alert('حدث خطأ أثناء الإضافة');
        }
    });
}

// === Function to Print Barcode ===
window.printBarcode = function (barcodeValue) {
    // Create a new window for printing
    const printWindow = window.open('', '', 'width=300,height=200');

    printWindow.document.write(`
        <html>
            <head>
                <title>Print Barcode</title>
                <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
                <style>
                    body { margin: 0; padding: 0; }
                    @media print {
                        @page {
                            margin: 0;
                            size: 2.2in 2in;
                        }
                        body { 
                            margin: 0; 
                            padding: 0;
                        }
                        .badge-container {
                            position: absolute;
                            top: 0;
                            left: 0;
                            width: 100%;
                            height: 100%;
                            display: block;
                            text-align: center;
                            /* Position maintained */
                            margin-top: -4mm; 
                        }
                        svg {
                            /* Reduced width even more for maximum Quiet Zones */
                            width: 60%; 
                            height: 30mm;
                        }
                    }
                </style>
            </head>
            <body>
                <div class="badge-container">
                    <svg id="barcode"></svg>
                </div>
                <script>
                    JsBarcode("#barcode", "${barcodeValue}", {
                        format: "CODE128",
                        lineColor: "#000",
                        width: 2,
                        height: 40,
                        displayValue: true,
                        fontSize: 22, /* Larger Font */
                        textMargin: 5, /* Space between bars and text */
                        margin: 0
                    });
                    window.onload = function() {
                        window.print();
                        window.close();
                    }
                </script>
            </body>
        </html>
    `);

    printWindow.document.close();
}

// Initial Load
loadInventory();

// -----------------------------------------------------
// Barcode Scanner Logic
// -----------------------------------------------------

const barcodeInput = document.getElementById('barcodeInput');
const beepSound = new Audio('assets/beep.mp3'); // Optional: Add a simple beep sound file to assets

if (barcodeInput) {
    // Focus automatically on load
    barcodeInput.focus();

    // Prevent losing focus (keep scanner active)
    document.addEventListener('click', () => {
        // Optional: verify if clicks are outside other inputs
        // barcodeInput.focus(); 
    });

    barcodeInput.addEventListener('keypress', async function (e) {
        if (e.key === 'Enter') {
            const code = barcodeInput.value.trim();
            if (code) {
                await searchByBarcode(code);
                barcodeInput.value = ''; // Clear for next scan
            }
        }
    });
}

// Global Listener (Optional: if scanner acts as keyboard without specific focus)
// document.addEventListener('keydown', (e) => { ... });

async function searchByBarcode(barcode) {
    try {
        const q = query(collection(db, "inventory"), where("barcode", "==", barcode));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const product = querySnapshot.docs[0].data();
            showScanModal(product);
            // new Audio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg').play().catch(e=>{}); // Simple beep
        } else {
            // Not Found
            alert("المنتج غير موجود! \n Barcode: " + barcode);
            // new Audio('https://actions.google.com/sounds/v1/alarms/error.ogg').play().catch(e=>{});
        }
    } catch (e) {
        console.error("Error searching barcode:", e);
    }
}

function showScanModal(product) {
    document.getElementById('scanName').innerText = product.name;
    document.getElementById('scanBarcode').innerText = product.barcode;
    document.getElementById('scanCost').innerText = (product.cost || 0) + ' ج.م';
    document.getElementById('scanQty').innerText = product.quantity;
    document.getElementById('scanType').innerText = product.category || '-';
    document.getElementById('scanUnit').innerText = product.unit || '-';

    // Show Modal
    const scanModal = new bootstrap.Modal(document.getElementById('scanModal'));
    scanModal.show();

    // Auto focus back to input when modal closes
    document.getElementById('scanModal').addEventListener('hidden.bs.modal', function () {
        if (barcodeInput) barcodeInput.focus();
    });
}
