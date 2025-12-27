// Import Firebase libraries
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// === Credentials ===
const firebaseConfig = {
    apiKey: window.env.FIREBASE_API_KEY,
    authDomain: window.env.FIREBASE_AUTH_DOMAIN,
    projectId: window.env.FIREBASE_PROJECT_ID,
    storageBucket: window.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: window.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: window.env.FIREBASE_APP_ID,
    measurementId: window.env.FIREBASE_MEASUREMENT_ID
};

// Initialize Connection
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// === Login Logic ===
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const errorBox = document.getElementById('loginError');

if (loginForm) {
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
                localStorage.setItem('fullName', userData.fullName || userIn);

                // 2. Redirect based on Role
                if (userData.role === 'superadmin') {
                    window.location.href = 'index.html';
                } else if (userData.role === 'inventory') {
                    window.location.href = 'inventory.html';
                } else if (userData.role === 'sales') {
                    window.location.href = 'pos.html'; // Placeholder for now
                } else {
                    window.location.href = 'index.html'; // Fallback
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
