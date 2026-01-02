import { db } from "./firebase-config.js";
import { collection, addDoc, getDocs, query, where, Timestamp, deleteDoc, doc, updateDoc, orderBy } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === DOM Elements ===
const usersTableBody = document.getElementById('users-table-body');
const addUserForm = document.getElementById('addUserForm');
const editUserForm = document.getElementById('editUserForm');
const totalUsersEl = document.getElementById('total-users');
const userBranchSelect = document.getElementById('userBranch');
const editUserBranchSelect = document.getElementById('editUserBranch');

// --- Global State ---
let usersStore = {};

// === Role Mapping (For display) ===
const roleLabels = {
    'admin': 'أدمن (Admin)',
    'store_manager': 'مسؤول مخازن',
    'cashier': 'كاشير',
    'tailor': 'فني (Tailor)',
    'branch_admin': 'إداري فروع'
};

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

// === Load Users ===
async function loadUsers() {
    if (!usersTableBody) return;
    usersTableBody.innerHTML = '<tr><td colspan="6" class="text-center">جاري التحميل...</td></tr>';

    try {
        const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            usersTableBody.innerHTML = '<tr><td colspan="6" class="text-center">لا يوجد مستخدمين حالياً</td></tr>';
            if (totalUsersEl) totalUsersEl.innerText = "0";
            return;
        }

        let html = '';
        usersStore = {};
        let count = 0;

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;
            usersStore[id] = data;
            count++;

            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString('ar-EG') : '-';
            const roleLabel = roleLabels[data.role] || data.role;

            html += `
                <tr>
                    <td>${data.name}</td>
                    <td>${data.username}</td>
                    <td><span class="badge bg-primary">${roleLabel}</span></td>
                    <td>${data.branchName || 'كل الفروع'}</td>
                    <td><small>${date}</small></td>
                    <td>
                        <div class="btn-group" dir="ltr">
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteUser('${id}')"><i class="bi bi-trash"></i></button>
                            <button class="btn btn-sm btn-outline-info" onclick="openEditUserModal('${id}')"><i class="bi bi-pencil"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        usersTableBody.innerHTML = html;
        if (totalUsersEl) totalUsersEl.innerText = count.toLocaleString();

    } catch (error) {
        console.error("Load Users Error:", error);
        usersTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">حدث خطأ: ${error.message}</td></tr>`;
    }
}

// === Load Branches for Dropdowns ===
async function loadBranches() {
    try {
        const branchesSnap = await getDocs(collection(db, "branches"));
        let options = '<option value="">كل الفروع / غير محدد</option>';

        branchesSnap.forEach(docSnap => {
            const branch = docSnap.data();
            options += `<option value="${docSnap.id}">${branch.name}</option>`;
        });

        if (userBranchSelect) userBranchSelect.innerHTML = options;
        if (editUserBranchSelect) editUserBranchSelect.innerHTML = options;
    } catch (error) {
        console.error("Load Branches Error:", error);
    }
}

// === Add New User ===
if (addUserForm) {
    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = addUserForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        const name = document.getElementById('userName').value;
        const username = document.getElementById('userUsername').value;
        const password = document.getElementById('userPassword').value;
        const role = document.getElementById('userRole').value;
        const branchId = document.getElementById('userBranch').value;
        const branchName = branchId ? document.getElementById('userBranch').options[document.getElementById('userBranch').selectedIndex].text : '';

        try {
            await addDoc(collection(db, "users"), {
                name,
                username,
                password, // Note: In a real app, use Firebase Auth for passwords!
                role,
                branchId,
                branchName,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });

            showToast('تمت إضافة المستخدم بنجاح!');
            bootstrap.Modal.getInstance(document.getElementById('addUserModal')).hide();
            addUserForm.reset();
            await loadUsers();
        } catch (error) {
            console.error("Add User Error:", error);
            showToast('حدث خطأ أثناء الإضافة: ' + error.message, 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// === Delete User ===
window.deleteUser = async function (id) {
    if (confirm('هل أنت متأكد من حذف هذا المستخدم؟')) {
        try {
            await deleteDoc(doc(db, "users", id));
            await loadUsers();
            showToast('تم حذف المستخدم بنجاح');
        } catch (error) {
            console.error("Delete User Error:", error);
            showToast('حدث خطأ أثناء الحذف', 'danger');
        }
    }
};

// === Edit User ===
window.openEditUserModal = function (id) {
    const data = usersStore[id];
    if (!data) return;

    document.getElementById('editUserId').value = id;
    document.getElementById('editUserName').value = data.name;
    document.getElementById('editUserRole').value = data.role;
    document.getElementById('editUserBranch').value = data.branchId || '';

    const editModal = new bootstrap.Modal(document.getElementById('editUserModal'));
    editModal.show();
};

if (editUserForm) {
    editUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('editUserId').value;
        const submitBtn = editUserForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;

        const branchId = document.getElementById('editUserBranch').value;
        const branchName = branchId ? document.getElementById('editUserBranch').options[document.getElementById('editUserBranch').selectedIndex].text : '';

        const updatedData = {
            name: document.getElementById('editUserName').value,
            role: document.getElementById('editUserRole').value,
            branchId: branchId,
            branchName: branchName,
            updatedAt: Timestamp.now()
        };

        try {
            await updateDoc(doc(db, "users", id), updatedData);
            showToast('تم تحديث البيانات بنجاح');
            bootstrap.Modal.getInstance(document.getElementById('editUserModal')).hide();
            await loadUsers();
        } catch (error) {
            console.error("Update User Error:", error);
            showToast('حدث خطأ أثناء التحديث', 'danger');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// --- Initialize ---
loadBranches();
loadUsers();
