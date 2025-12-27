import { db } from './firebase-config.js';
import {
    collection,
    addDoc,
    getDocs,
    doc,
    deleteDoc,
    updateDoc,
    Timestamp,
    query,
    orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const branchesTableBody = document.getElementById('branchesTableBody');
const addBranchForm = document.getElementById('addBranchForm');
const editBranchForm = document.getElementById('editBranchForm');

// === Load Branches ===
async function loadBranches() {
    try {
        const q = query(collection(db, "branches"), orderBy("createdAt", "desc"));
        const querySnapshot = await getDocs(q);

        let html = '';
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            const id = doc.id;
            const date = data.createdAt ? data.createdAt.toDate().toLocaleDateString('ar-EG') : '-';

            html += `
                <tr>
                    <td class="fw-bold">${data.name}</td>
                    <td>${data.location || '-'}</td>
                    <td>
                        ${data.type === 'warehouse' ? '<span class="badge bg-secondary">مخزن</span>' : '<span class="badge bg-info text-dark">فرع</span>'}
                    </td>
                    <td>${date}</td>
                    <td>
                        <div class="btn-group">
                            <button class="btn btn-sm btn-outline-info" onclick='editBranch(${JSON.stringify({ id, ...data })})' title="تعديل"><i class="bi bi-pencil"></i></button>
                            <button class="btn btn-sm btn-outline-danger" onclick="deleteBranch('${id}')" title="حذف"><i class="bi bi-trash"></i></button>
                        </div>
                    </td>
                </tr>
            `;
        });

        branchesTableBody.innerHTML = html || '<tr><td colspan="5" class="text-center py-4">لا توجد فروع مسجلة</td></tr>';
    } catch (e) {
        console.error("Error loading branches:", e);
        branchesTableBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">خطأ في تحميل البيانات</td></tr>';
    }
}

// === Create Branch ===
if (addBranchForm) {
    addBranchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('branchSubmitBtn');
        submitBtn.disabled = true;

        const name = document.getElementById('branchName').value;
        const location = document.getElementById('branchLocation').value;
        const type = document.getElementById('branchType').value;

        try {
            await addDoc(collection(db, "branches"), {
                name,
                location,
                type,
                createdAt: Timestamp.now()
            });

            bootstrap.Modal.getInstance(document.getElementById('addBranchModal')).hide();
            addBranchForm.reset();
            await loadBranches();
            alert('تم إضافة الفرع بنجاح!');
        } catch (e) {
            console.error("Add Branch Error:", e);
            alert('خطأ أثناء الإضافة');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// === Delete Branch ===
window.deleteBranch = async function (id) {
    if (confirm('هل أنت متأكد من حذف هذا الفرع؟ سيؤدي ذلك لإزالته تماماً.')) {
        try {
            await deleteDoc(doc(db, "branches", id));
            await loadBranches();
        } catch (e) {
            console.error("Delete Error:", e);
            alert('خطأ أثناء الحذف');
        }
    }
}

// === Edit Branch ===
window.editBranch = function (data) {
    document.getElementById('editBranchId').value = data.id;
    document.getElementById('editBranchName').value = data.name;
    document.getElementById('editBranchLocation').value = data.location || '';
    document.getElementById('editBranchType').value = data.type;

    const editModal = new bootstrap.Modal(document.getElementById('editBranchModal'));
    editModal.show();
}

if (editBranchForm) {
    editBranchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('editBranchSubmitBtn');
        submitBtn.disabled = true;

        const id = document.getElementById('editBranchId').value;
        const name = document.getElementById('editBranchName').value;
        const location = document.getElementById('editBranchLocation').value;
        const type = document.getElementById('editBranchType').value;

        try {
            await updateDoc(doc(db, "branches", id), {
                name,
                location,
                type,
                updatedAt: Timestamp.now()
            });

            bootstrap.Modal.getInstance(document.getElementById('editBranchModal')).hide();
            await loadBranches();
            alert('تم تحديث بيانات الفرع بنجاح');
        } catch (e) {
            console.error("Update Error:", e);
            alert('خطأ أثناء التحديث');
        } finally {
            submitBtn.disabled = false;
        }
    });
}

// Initial Load
document.addEventListener('DOMContentLoaded', loadBranches);
