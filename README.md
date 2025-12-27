# Naseej (نسيج) - Hybrid ERP/POS System

Naseej is a hybrid ERP and POS system designed for clothing factories and tailoring shops.

## Features
- **Authentication**: Role-based access control (Superadmin, Inventory, Sales).
- **Inventory Management**: Track raw materials and finished products.
- **Barcode System**: Daily barcode generation and thermal printing.
- **Scanning**: Quick product lookup via barcode scanner.

## Setup Instructions
1. **Prerequisites**: Ensure you have [Node.js](https://nodejs.org/) installed.
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Environment Variables**: Create a `.env` file in the root directory and add your Firebase credentials (see `.env.example`).
4. **Run the App**:
   ```bash
   npm start
   ```

## Technologies
- **Frontend**: Electron.js, Vanilla JS, Bootstrap 5.
- **Backend**: Firebase Firestore.
- **Barcode**: JsBarcode.
