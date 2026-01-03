import { db } from "./firebase-config.js";
import { collection, getDocs, query, orderBy, where, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const totalSalesEl = document.getElementById('totalSales');
const totalCostEl = document.getElementById('totalCost');
const netProfitEl = document.getElementById('netProfit');
const orderCountEl = document.getElementById('orderCount');
const profitMarginBar = document.getElementById('profitMarginBar');
const profitMarginText = document.getElementById('profitMarginText');
const avgOrderValueEl = document.getElementById('avgOrderValue');
const summaryTableBody = document.getElementById('summaryTableBody');

const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const quickFilterSelect = document.getElementById('quickFilter');
const applyFilterBtn = document.getElementById('applyFilterBtn');

// === Initialize Date Inputs ===
document.addEventListener('DOMContentLoaded', () => {
    setQuickFilter('month');
    loadReports();
});

// === Quick Filter ===
function setQuickFilter(period) {
    const today = new Date();
    let startDate, endDate;

    switch (period) {
        case 'today':
            startDate = new Date(today.setHours(0, 0, 0, 0));
            endDate = new Date();
            break;
        case 'week':
            const dayOfWeek = today.getDay();
            startDate = new Date(today);
            startDate.setDate(today.getDate() - dayOfWeek);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            break;
        case 'month':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            endDate = new Date();
            break;
        case 'year':
            startDate = new Date(today.getFullYear(), 0, 1);
            endDate = new Date();
            break;
        case 'all':
            startDate = new Date(2020, 0, 1); // Arbitrary old date
            endDate = new Date();
            break;
    }

    startDateInput.value = formatDate(startDate);
    endDateInput.value = formatDate(endDate);
}

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

// === Event Listeners ===
if (quickFilterSelect) {
    quickFilterSelect.addEventListener('change', (e) => {
        setQuickFilter(e.target.value);
    });
}

if (applyFilterBtn) {
    applyFilterBtn.addEventListener('click', () => {
        loadReports();
    });
}

// === Load Reports ===
async function loadReports() {
    // Show loading state
    totalSalesEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    totalCostEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    netProfitEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    orderCountEl.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    summaryTableBody.innerHTML = '<tr><td colspan="2" class="text-center py-4"><span class="spinner-border text-primary"></span></td></tr>';

    try {
        const statsRef = collection(db, "daily_stats");

        // Get date range strings (YYYY-MM-DD)
        const startStr = startDateInput.value;
        const endStr = endDateInput.value;

        // Query daily_stats by date string
        // Since ID is YYYY-MM-DD, we can also use where('date', ...)
        const q = query(
            statsRef,
            where("date", ">=", startStr),
            where("date", "<=", endStr),
            orderBy("date", "desc")
        );

        const snapshot = await getDocs(q);

        // Calculate totals from aggregated daily stats
        let totalSales = 0;
        let totalCost = 0;
        let orderCount = 0;

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            totalSales += Number(data.totalSales) || 0;
            totalCost += Number(data.totalCost) || 0;
            orderCount += Number(data.orderCount) || 0;
        });

        // Calculate profit and margin
        const netProfit = totalSales - totalCost;
        const profitMargin = totalSales > 0 ? ((netProfit / totalSales) * 100).toFixed(1) : 0;
        const avgOrderValue = orderCount > 0 ? Math.round(totalSales / orderCount) : 0;

        // Update UI
        totalSalesEl.innerText = totalSales.toLocaleString() + ' ج.م';
        totalCostEl.innerText = totalCost.toLocaleString() + ' ج.م';
        orderCountEl.innerText = orderCount.toLocaleString();
        avgOrderValueEl.innerText = avgOrderValue.toLocaleString() + ' ج.م';

        // Profit with color
        if (netProfit >= 0) {
            netProfitEl.className = 'fw-bold mb-0 text-success';
            netProfitEl.innerText = '+' + netProfit.toLocaleString() + ' ج.م';
        } else {
            netProfitEl.className = 'fw-bold mb-0 text-danger';
            netProfitEl.innerText = netProfit.toLocaleString() + ' ج.م';
        }

        // Profit margin bar
        const marginWidth = Math.min(Math.max(profitMargin, 0), 100);
        profitMarginBar.style.width = marginWidth + '%';
        profitMarginBar.className = `progress-bar ${netProfit >= 0 ? 'bg-success' : 'bg-danger'}`;
        profitMarginText.innerText = profitMargin + '%';

        // Summary table
        summaryTableBody.innerHTML = `
            <tr>
                <td class="ps-4"><i class="bi bi-cash text-primary"></i> إجمالي المبيعات</td>
                <td class="text-start fw-bold">${totalSales.toLocaleString()} ج.م</td>
            </tr>
            <tr>
                <td class="ps-4"><i class="bi bi-box text-warning"></i> تكلفة البضاعة المباعة</td>
                <td class="text-start fw-bold text-warning">${totalCost.toLocaleString()} ج.م</td>
            </tr>
            <tr class="table-${netProfit >= 0 ? 'success' : 'danger'}">
                <td class="ps-4"><i class="bi bi-graph-${netProfit >= 0 ? 'up' : 'down'}-arrow"></i> صافي الربح</td>
                <td class="text-start fw-bold">${netProfit >= 0 ? '+' : ''}${netProfit.toLocaleString()} ج.م</td>
            </tr>
            <tr>
                <td class="ps-4"><i class="bi bi-percent text-info"></i> هامش الربح</td>
                <td class="text-start fw-bold">${profitMargin}%</td>
            </tr>
            <tr>
                <td class="ps-4"><i class="bi bi-receipt text-secondary"></i> عدد الطلبات</td>
                <td class="text-start fw-bold">${orderCount.toLocaleString()}</td>
            </tr>
            <tr>
                <td class="ps-4"><i class="bi bi-calculator text-primary"></i> متوسط قيمة الطلب</td>
                <td class="text-start fw-bold">${avgOrderValue.toLocaleString()} ج.م</td>
            </tr>
        `;

    } catch (error) {
        console.error("Load Reports Error:", error);
        totalSalesEl.innerText = 'خطأ';
        totalCostEl.innerText = 'خطأ';
        netProfitEl.innerText = 'خطأ';
        orderCountEl.innerText = 'خطأ';
        summaryTableBody.innerHTML = `<tr><td colspan="2" class="text-center text-danger py-4">خطأ: ${error.message}<br><small class="text-muted">قد تحتاج لإنشاء فهرس (Index) في Firebase Console</small></td></tr>`;
    }
}
