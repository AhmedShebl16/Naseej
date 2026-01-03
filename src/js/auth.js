import { db } from "./firebase-config.js";
import { collection, query, where, getDocs, addDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === Login Logic ===
const loginForm = document.getElementById('loginForm');
const setupAdminBtn = document.getElementById('setupAdminBtn');

if (setupAdminBtn) {
    setupAdminBtn.addEventListener('click', async () => {
        if (!confirm('Create default Admin user (admin/123)?')) return;

        try {
            // Check if any user exists
            const snap = await getDocs(collection(db, "users"));
            if (!snap.empty) {
                alert("Users already exist! Cannot create default admin.");
                return;
            }

            await addDoc(collection(db, "users"), {
                name: "Admin System",
                username: "admin",
                password: "123",
                role: "admin",
                branchId: "",
                branchName: "Main Branch",
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });

            alert("Admin Created! Login with: admin / 123");
        } catch (error) {
            console.error(error);
            alert("Error: " + error.message);
        }
    });
}
const loginBtn = document.getElementById('loginBtn');
const errorBox = document.getElementById('loginError');

if (loginForm) {
    // Reset form state on load
    window.addEventListener('DOMContentLoaded', () => {
        document.getElementById('username').disabled = false;
        document.getElementById('password').disabled = false;
        loginBtn.disabled = false;
        loginBtn.innerHTML = 'تسجيل الدخول';
        errorBox.style.display = 'none';
        loginForm.reset();
    });

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault(); // Prevent page reload

        const userIn = document.getElementById('username').value.trim();
        const passIn = document.getElementById('password').value.trim();

        // Change button state
        loginBtn.innerHTML = 'جاري التحقق...';
        loginBtn.disabled = true;
        errorBox.style.display = 'none';

        try {
            // Check users collection
            const q = query(
                collection(db, "users"),
                where("username", "==", userIn),
                where("password", "==", passIn)
            );

            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                // == Login Success ==
                const userData = querySnapshot.docs[0].data();

                // 1. Save user data to LocalStorage
                localStorage.setItem('userRole', userData.role);
                localStorage.setItem('username', userData.username);
                localStorage.setItem('fullName', userData.name || userIn);
                localStorage.setItem('branchId', userData.branchId || '');
                localStorage.setItem('branchName', userData.branchName || '');

                // 2. Redirect based on Role
                if (userData.role === 'cashier' || userData.role === 'sales') {
                    window.location.href = 'pos.html';
                } else if (userData.role === 'tailor') {
                    window.location.href = 'pos_services.html';
                } else if (userData.role === 'inventory') {
                    window.location.href = 'inventory.html';
                } else {
                    // superadmin, admin, manager, or unknown
                    window.location.href = 'index.html';
                }

            } else {
                // == Login Failed ==
                showError("اسم المستخدم أو كلمة المرور غير صحيحة");
            }

        } catch (error) {
            console.error("Login Error:", error);
            showError("حدث خطأ في الاتصال! تأكد من الإنترنت.");
        } finally {
            // Reset button
            loginBtn.innerHTML = 'تسجيل الدخول';
            loginBtn.disabled = false;
        }
    });
}

function showError(msg) {
    if (errorBox) {
        errorBox.innerText = msg;
        errorBox.style.display = 'block';
    }
}
